import { ApiError } from '../core/errors';
import { sha256Hex } from '../core/ids';

/**
 * Idempotency-Key (PRD 10-4)。
 *
 * 予約登録のような作成系APIで、ネットワーク再送によって二重に予約が入るのを防ぐ。
 * 同一キー・同一リクエストなら初回レスポンスをそのまま返し、
 * 同一キーで中身が違えば 409 で弾く（キーの使い回しは事故なので黙って通さない）。
 */

export type StoredResponse = {
  status: number;
  body: string;
  requestHash: string;
  createdAt: number;
};

const TTL_MS = 24 * 60 * 60 * 1000;

const GLOBAL_KEY = '__reception_idempotency__';
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: Map<string, StoredResponse> };

function store(): Map<string, StoredResponse> {
  const g = globalThis as GlobalWithStore;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY]!;
}

function compositeKey(tenantId: string, path: string, key: string): string {
  // テナントを跨いでキーが衝突しないようにする
  return `${tenantId}:${path}:${key}`;
}

export function hashRequest(method: string, path: string, body: string): string {
  return sha256Hex(`${method}\n${path}\n${body}`);
}

export function lookup(
  tenantId: string,
  path: string,
  key: string,
  requestHash: string
): StoredResponse | null {
  const map = store();
  const entry = map.get(compositeKey(tenantId, path, key));
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    map.delete(compositeKey(tenantId, path, key));
    return null;
  }
  if (entry.requestHash !== requestHash) {
    throw new ApiError(
      'idempotency_key_reused',
      '同じ Idempotency-Key が異なる内容のリクエストで使われています'
    );
  }
  return entry;
}

export function remember(
  tenantId: string,
  path: string,
  key: string,
  requestHash: string,
  status: number,
  body: string
): void {
  store().set(compositeKey(tenantId, path, key), {
    status,
    body,
    requestHash,
    createdAt: Date.now(),
  });
}

/** テスト用。 */
export function resetIdempotency(): void {
  store().clear();
}
