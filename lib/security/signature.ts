import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../core/errors';

/**
 * Webhook 署名 (PRD 10-2 / 10-3)。
 *
 * HMAC-SHA256 + Timestamp + Nonce + Request ID。
 * 署名対象は `<timestamp>.<nonce>.<raw body>`。生のボディを使うのが重要で、
 * JSON を再シリアライズすると鍵の順序差で署名が壊れる。
 */

export const SIGNATURE_HEADER = 'X-Reception-Signature';
export const NONCE_HEADER = 'X-Reception-Nonce';
export const EVENT_ID_HEADER = 'X-Reception-Event-Id';
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** 5分以上古いリクエストは拒否する (PRD 10-3)。 */
export const REPLAY_TOLERANCE_SECONDS = 300;

export function signPayload(params: {
  secret: string;
  body: string;
  timestampSeconds: number;
  nonce: string;
}): string {
  const signed = `${params.timestampSeconds}.${params.nonce}.${params.body}`;
  return createHmac('sha256', params.secret).update(signed, 'utf8').digest('hex');
}

export function buildSignatureHeader(params: {
  secret: string;
  body: string;
  timestampSeconds?: number;
  nonce?: string;
}): { signature: string; nonce: string; timestampSeconds: number } {
  const timestampSeconds = params.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const nonce = params.nonce ?? randomBytes(16).toString('hex');
  const mac = signPayload({ secret: params.secret, body: params.body, timestampSeconds, nonce });
  return { signature: `t=${timestampSeconds},v1=${mac}`, nonce, timestampSeconds };
}

export function parseSignatureHeader(header: string): { t: number; v1: string } | null {
  const parts = header.split(',').map((p) => p.trim());
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of parts) {
    const [k, v] = part.split('=', 2);
    if (k === 't') t = Number(v);
    if (k === 'v1') v1 = v;
  }
  if (t === null || Number.isNaN(t) || !v1) return null;
  return { t, v1 };
}

// ---------------------------------------------------------------------------
// 受信側の検証（外部システムから本サービスへ送られてくる Webhook 用）
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__reception_seen_nonces__';
type GlobalWithNonces = typeof globalThis & { [GLOBAL_KEY]?: Map<string, number> };

function seenNonces(): Map<string, number> {
  const g = globalThis as GlobalWithNonces;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY]!;
}

function rememberNonce(nonce: string, nowSeconds: number): boolean {
  const map = seenNonces();
  // 許容時間を過ぎたものを掃除する。窓の外に出た nonce は再利用されても
  // タイムスタンプ検査で弾かれるので、保持し続ける必要がない。
  for (const [key, ts] of map) {
    if (nowSeconds - ts > REPLAY_TOLERANCE_SECONDS) map.delete(key);
  }
  if (map.has(nonce)) return false;
  map.set(nonce, nowSeconds);
  return true;
}

export function verifySignature(params: {
  secret: string;
  body: string;
  signatureHeader: string | null;
  nonce: string | null;
  nowSeconds?: number;
}): void {
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!params.signatureHeader) {
    throw new ApiError('signature_invalid', '署名ヘッダがありません');
  }
  if (!params.nonce) {
    throw new ApiError('signature_invalid', 'nonce がありません');
  }

  const parsed = parseSignatureHeader(params.signatureHeader);
  if (!parsed) throw new ApiError('signature_invalid', '署名ヘッダの形式が不正です');

  if (Math.abs(now - parsed.t) > REPLAY_TOLERANCE_SECONDS) {
    throw new ApiError('replay_detected', 'リクエストのタイムスタンプが古すぎます');
  }

  const expected = signPayload({
    secret: params.secret,
    body: params.body,
    timestampSeconds: parsed.t,
    nonce: params.nonce,
  });

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parsed.v1, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError('signature_invalid', '署名が一致しません');
  }

  // タイムスタンプが有効でも、同じ nonce の再送は replay とみなす
  if (!rememberNonce(params.nonce, now)) {
    throw new ApiError('replay_detected', 'このリクエストは既に処理済みです');
  }
}

/** テスト用。 */
export function resetNonces(): void {
  seenNonces().clear();
}
