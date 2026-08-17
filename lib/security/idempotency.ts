import { ApiError } from '../core/errors';
import { sha256Hex } from '../core/ids';
import { collections } from '../store';

/**
 * Idempotency-Key (PRD 10-4)。
 *
 * 予約登録のような作成系APIで、ネットワーク再送によって二重に予約が入るのを防ぐ。
 * 同一キー・同一リクエストなら初回レスポンスをそのまま返し、
 * 同一キーで中身が違えば 409 で弾く（キーの使い回しは事故なので黙って通さない）。
 *
 * 記録は Datastore に置く。プロセス内に持つと、リクエストごとに別インスタンスが
 * 応答するサーバーレス環境で再送が素通りし、予約が二重に入る。
 * 書き込みは冪等キー付きのリクエストだけなので、件数は多くない。
 */

export type IdempotencyRecord = {
  id: string;
  tenantId: string;
  status: number;
  body: string;
  requestHash: string;
  createdAt: string;
  expiresAt: string;
};

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Datastore のドキュメントIDにする。パスやキーに `/` が入ると
 * Firestore のパス区切りと衝突するため、ハッシュに畳んで使う。
 */
function documentId(path: string, key: string): string {
  return sha256Hex(`${path}\n${key}`);
}

export function hashRequest(method: string, path: string, body: string): string {
  return sha256Hex(`${method}\n${path}\n${body}`);
}

export async function lookup(
  tenantId: string,
  path: string,
  key: string,
  requestHash: string,
  now = Date.now()
): Promise<IdempotencyRecord | null> {
  const id = documentId(path, key);
  const record = await collections.idempotency().get(tenantId, id);
  if (!record) return null;

  // 期限切れは無かったことにする。掃除は下の sweepExpired に任せる。
  if (Date.parse(record.expiresAt) <= now) return null;

  if (record.requestHash !== requestHash) {
    throw new ApiError(
      'idempotency_key_reused',
      '同じ Idempotency-Key が異なる内容のリクエストで使われています'
    );
  }
  return record;
}

export async function remember(
  tenantId: string,
  path: string,
  key: string,
  requestHash: string,
  status: number,
  body: string,
  now = Date.now()
): Promise<void> {
  const id = documentId(path, key);
  await collections.idempotency().insert({
    id,
    tenantId,
    status,
    body,
    requestHash,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
  });
}

/**
 * 期限切れの記録を削除する。
 * Firestore の TTL ポリシーを `expiresAt` に設定すれば不要になるが、
 * 設定していない環境でも溜まり続けないよう手動の掃除口を残す。
 */
export async function sweepExpired(tenantId: string, now = Date.now()): Promise<number> {
  const expired = await collections
    .idempotency()
    .list(tenantId, (r) => Date.parse(r.expiresAt) <= now);

  for (const record of expired) {
    await collections.idempotency().remove(tenantId, record.id);
  }
  return expired.length;
}

/** テスト用。 */
export async function resetIdempotency(tenantId: string): Promise<void> {
  const all = await collections.idempotency().list(tenantId);
  for (const record of all) {
    await collections.idempotency().remove(tenantId, record.id);
  }
}
