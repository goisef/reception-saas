/**
 * Datastore ポート。
 *
 * PRD 13-5 のとおり本番の第一候補は Firestore だが、アプリケーションコードは
 * このインターフェース越しにしかデータへ触らない。MVP開発中は in-memory ドライバで
 * 動かし、Firestore ドライバは同じ契約を実装して差し替える。
 *
 * テナント分離 (原則 P-6) はここで強制する。tenantId を渡さずに読める API を
 * 生やさないこと。テナント横断で読むのは SuperAdmin 用の `listAcrossTenants` のみ。
 */

export type Doc = { id: string; tenantId: string };

/**
 * テナントに属さないグローバル文書（アプリのリリース情報など）用の擬似テナント。
 *
 * Firestore ドライバではこれがドキュメントIDになる。Firestore は
 * `__...__` 形式のIDを予約しているため、その形にはできない。
 */
export const GLOBAL_TENANT = '_global';

export interface Collection<T extends Doc> {
  get(tenantId: string, id: string): Promise<T | null>;
  list(tenantId: string, predicate?: (doc: T) => boolean): Promise<T[]>;
  listAcrossTenants(predicate?: (doc: T) => boolean): Promise<T[]>;
  insert(doc: T): Promise<T>;
  /** 存在しなければ not found を投げず null を返す。呼び出し側で 404 に変換する。 */
  update(tenantId: string, id: string, patch: Partial<T>): Promise<T | null>;
  remove(tenantId: string, id: string): Promise<boolean>;
  /** 開発・テスト用。ドライバによっては未対応でよい。 */
  clear(): Promise<void>;
}

export interface Datastore {
  collection<T extends Doc>(name: string): Collection<T>;
  /**
   * 同一キーに対する処理を直列化する。番号払い出しのように
   * read-modify-write が競合すると壊れる処理で使う。
   */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** /ready 用。依存リソースに到達できるか。 */
  ping(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// in-memory ドライバ
// ---------------------------------------------------------------------------

class MemoryCollection<T extends Doc> implements Collection<T> {
  /** tenantId -> id -> doc */
  private readonly byTenant = new Map<string, Map<string, T>>();

  private tenantMap(tenantId: string): Map<string, T> {
    let map = this.byTenant.get(tenantId);
    if (!map) {
      map = new Map();
      this.byTenant.set(tenantId, map);
    }
    return map;
  }

  async get(tenantId: string, id: string): Promise<T | null> {
    return clone(this.tenantMap(tenantId).get(id) ?? null);
  }

  async list(tenantId: string, predicate?: (doc: T) => boolean): Promise<T[]> {
    const docs = [...this.tenantMap(tenantId).values()];
    return clone(predicate ? docs.filter(predicate) : docs);
  }

  async listAcrossTenants(predicate?: (doc: T) => boolean): Promise<T[]> {
    const docs: T[] = [];
    for (const map of this.byTenant.values()) docs.push(...map.values());
    return clone(predicate ? docs.filter(predicate) : docs);
  }

  async insert(doc: T): Promise<T> {
    this.tenantMap(doc.tenantId).set(doc.id, clone(doc));
    return clone(doc);
  }

  async update(tenantId: string, id: string, patch: Partial<T>): Promise<T | null> {
    const map = this.tenantMap(tenantId);
    const current = map.get(id);
    if (!current) return null;
    // tenantId と id は不変。patch に紛れ込んでも無視する。
    const next = { ...current, ...patch, id: current.id, tenantId: current.tenantId };
    map.set(id, next);
    return clone(next);
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    return this.tenantMap(tenantId).delete(id);
  }

  async clear(): Promise<void> {
    this.byTenant.clear();
  }
}

/**
 * 返す値は必ず複製する。呼び出し側が受け取ったオブジェクトを変更しても
 * ストアの中身が書き換わらないようにするため（Firestore ドライバの挙動に合わせる）。
 */
function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  return structuredClone(value);
}

export class MemoryDatastore implements Datastore {
  private readonly collections = new Map<string, MemoryCollection<Doc>>();
  /** key -> 現在の待ち行列の末尾。resolve したら次の待ち手が動く。 */
  private readonly locks = new Map<string, Promise<void>>();

  collection<T extends Doc>(name: string): Collection<T> {
    let col = this.collections.get(name);
    if (!col) {
      col = new MemoryCollection<Doc>();
      this.collections.set(name, col);
    }
    return col as unknown as Collection<T>;
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // 待ち行列の末尾を自分に差し替えてから、前の人を待つ
    const chained = previous.then(() => held);
    this.locks.set(key, chained);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      // 自分の後ろに誰も並んでいなければ Map から消す（無限に育つのを防ぐ）
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
