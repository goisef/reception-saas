import { Firestore, type Settings } from '@google-cloud/firestore';
import { GLOBAL_TENANT, type Collection, type Datastore, type Doc } from './datastore';

/**
 * Firestore ドライバ (PRD 13-5)。
 *
 * ドキュメントの置き方:
 *
 *   tenants/{tenantId}/{collection}/{docId}
 *
 * テナントごとにサブコレクションを切る。フラットな1コレクションに
 * tenantId フィールドを持たせる方式より、セキュリティルールが単純になり、
 * 「うっかり他テナントの文書を引く」経路を構造的に塞げる (原則 P-6)。
 *
 * テナント横断の読み取りは collectionGroup クエリで行う。これは
 * SuperAdmin 用途とAPIキーの引き当てに限る。
 */

// Firestore は `__...__` 形式のIDを予約しており、その名前では読み書きできない。
// アンダースコア2つで囲む命名は避けること。
const LOCKS = 'reception_locks';

/** ロックの寿命。取得したまま落ちたインスタンスがあっても、これを過ぎれば奪える。 */
const LOCK_TTL_MS = 15_000;
const LOCK_RETRY_INTERVAL_MS = 50;
const LOCK_ACQUIRE_TIMEOUT_MS = 10_000;

/**
 * Firestore は undefined を受け付けない。ドメイン型は「未設定」を null で
 * 表しているが、スプレッドの都合で undefined が紛れることがあるため落とす。
 */
function stripUndefined<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    result[key] = stripUndefined(item);
  }
  return result as T;
}

class FirestoreCollection<T extends Doc> implements Collection<T> {
  constructor(
    private readonly db: Firestore,
    private readonly name: string
  ) {}

  private ref(tenantId: string) {
    return this.db.collection('tenants').doc(tenantId).collection(this.name);
  }

  async get(tenantId: string, id: string): Promise<T | null> {
    const snapshot = await this.ref(tenantId).doc(id).get();
    return snapshot.exists ? (snapshot.data() as T) : null;
  }

  /**
   * NOTE: predicate は JS の関数なのでクエリに落とせず、テナント分の文書を
   * 全件読んでからメモリ上で絞っている。in-memory ドライバと同じ意味論を保つための
   * 割り切りで、件数が増えると読み取りコストが線形に効く。
   * 絞り込みが必要な一覧APIから順に、専用のクエリメソッドへ移していくこと。
   */
  async list(tenantId: string, predicate?: (doc: T) => boolean): Promise<T[]> {
    const snapshot = await this.ref(tenantId).get();
    const docs = snapshot.docs.map((d) => d.data() as T);
    return predicate ? docs.filter(predicate) : docs;
  }

  async listAcrossTenants(predicate?: (doc: T) => boolean): Promise<T[]> {
    const snapshot = await this.db.collectionGroup(this.name).get();
    const docs = snapshot.docs.map((d) => d.data() as T);
    return predicate ? docs.filter(predicate) : docs;
  }

  async insert(doc: T): Promise<T> {
    const clean = stripUndefined(doc);
    await this.ref(doc.tenantId).doc(doc.id).set(clean as Record<string, unknown>);
    return clean;
  }

  async update(tenantId: string, id: string, patch: Partial<T>): Promise<T | null> {
    const ref = this.ref(tenantId).doc(id);

    // in-memory ドライバと同じ「浅いマージ」にするため、Firestore の merge には
    // 頼らず読んで組み立て直す。merge:true は入れ子のマップをフィールド単位で
    // 混ぜるので、オブジェクト丸ごと差し替えたい箇所で意味が変わってしまう。
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return null;

      const current = snapshot.data() as T;
      // tenantId と id は不変。patch に紛れ込んでも無視する。
      const next = stripUndefined({
        ...current,
        ...patch,
        id: current.id,
        tenantId: current.tenantId,
      });
      tx.set(ref, next as Record<string, unknown>);
      return next;
    });
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    const ref = this.ref(tenantId).doc(id);
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return false;
      tx.delete(ref);
      return true;
    });
  }

  /** テスト用。本番では呼ばない。 */
  async clear(): Promise<void> {
    const snapshot = await this.db.collectionGroup(this.name).get();
    const batch = this.db.batch();
    for (const doc of snapshot.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}

export class FirestoreDatastore implements Datastore {
  private readonly collections = new Map<string, FirestoreCollection<Doc>>();
  private readonly instanceId = `i_${Math.random().toString(36).slice(2, 10)}`;

  constructor(private readonly db: Firestore) {}

  collection<T extends Doc>(name: string): Collection<T> {
    let col = this.collections.get(name);
    if (!col) {
      col = new FirestoreCollection<Doc>(this.db, name);
      this.collections.set(name, col);
    }
    return col as unknown as Collection<T>;
  }

  /**
   * インスタンスを跨いだ排他。
   *
   * in-memory ドライバのロックはプロセス内でしか効かない。Cloud Run で
   * インスタンスが増えた瞬間に番号の二重払い出しが起きるため、
   * Firestore 上のリース付きロック文書で直列化する。
   *
   * 取得者が落ちてもリース期限が切れれば他のインスタンスが奪えるので、
   * デッドロックにはならない。
   */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const ref = this.db.collection(LOCKS).doc(encodeURIComponent(key));
    const owner = `${this.instanceId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const acquired = await this.db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const now = Date.now();

        if (snapshot.exists) {
          const held = snapshot.data() as { owner: string; expiresAt: number };
          // 生きているロックがあれば待つ
          if (held.expiresAt > now) return false;
        }

        tx.set(ref, { owner, expiresAt: now + LOCK_TTL_MS });
        return true;
      });

      if (acquired) {
        try {
          return await fn();
        } finally {
          // 自分が持っているときだけ解放する。リース切れで他へ渡っていた場合に
          // 横取りして消さないため。
          await this.db
            .runTransaction(async (tx) => {
              const snapshot = await tx.get(ref);
              if (!snapshot.exists) return;
              const held = snapshot.data() as { owner: string };
              if (held.owner === owner) tx.delete(ref);
            })
            .catch(() => {
              // 解放に失敗してもリース期限で回収されるので握りつぶす
            });
        }
      }

      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));
    }

    throw new Error(`ロック ${key} を取得できませんでした`);
  }

  async ping(): Promise<boolean> {
    try {
      // 存在しない文書の取得でも往復は発生するので、疎通確認には十分。
      // ID を `__...__` にすると Firestore の予約名に当たって失敗する。
      await this.db.collection(LOCKS).doc('ping').get();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * GCP の外（Vercel など）から繋ぐ場合の認証情報。
 *
 * Cloud Run 上なら Workload Identity で自動的に認証されるため何も要らないが、
 * 外部ホストではサービスアカウント鍵が必要になる。鍵ファイルを置けないので
 * 環境変数に JSON をそのまま入れて渡す。
 */
function credentialsFromEnv(): Pick<Settings, 'credentials'> | Record<string, never> {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) return {};
    return {
      credentials: {
        client_email: parsed.client_email,
        // 環境変数に貼ると改行が \n のまま入ることがあるので戻す
        private_key: parsed.private_key.replace(/\\n/g, '\n'),
      },
    };
  } catch {
    // ここで throw すると起動そのものが落ちる。/ready が error を返して
    // 気付ける方が復旧しやすいので、認証情報なしで進める。
    console.error('GOOGLE_APPLICATION_CREDENTIALS_JSON を JSON として解釈できませんでした');
    return {};
  }
}

export function createFirestoreDatastore(settings: Settings = {}): FirestoreDatastore {
  const projectId = process.env.FIRESTORE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  return new FirestoreDatastore(
    new Firestore({
      ...(projectId ? { projectId } : {}),
      ...credentialsFromEnv(),
      ignoreUndefinedProperties: true,
      ...settings,
    })
  );
}

export { GLOBAL_TENANT };
