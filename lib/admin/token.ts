/**
 * 管理Webのセッショントークン。
 *
 * proxy.ts (Edge) からも検証するため、データストアには触らず
 * Web Crypto だけで完結させる。
 *
 * トークンに入れるのは「誰か」と「いつまでか」だけ。ロールや店舗の
 * 範囲は入れない。入れてしまうと、権限を落としたあともログアウトするまで
 * 古い権限が生き続ける。権限は毎回データストアから引く
 * (lib/admin/session.ts の currentSession)。
 */

export const ADMIN_COOKIE = 'reception_admin';

/** 店舗の営業中に切れない程度に取る。共有端末での放置を考えて1日は超えない。 */
const TTL_SECONDS = 12 * 60 * 60;

export type AdminToken = {
  userId: string;
  tenantId: string;
  /** UNIX 秒 */
  expiresAt: number;
};

function encoder() {
  return new TextEncoder();
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 壊れた Cookie で例外を投げない。
 *
 * ここは Edge の proxy から全リクエストで通る。base64 として読めない値で
 * 落ちると、Cookie が1つ壊れただけでサイト全体が 500 になる。
 * 読めなければ null を返し、呼び出し側で「未ログイン」として扱う。
 */
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function issueAdminToken(
  secret: string,
  user: { userId: string; tenantId: string },
  now = Date.now()
): Promise<string> {
  const payload: AdminToken = {
    userId: user.userId,
    tenantId: user.tenantId,
    expiresAt: Math.floor(now / 1000) + TTL_SECONDS,
  };
  const encoded = toBase64Url(encoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder().encode(encoded));
  return `${encoded}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAdminToken(
  secret: string,
  token: string | undefined,
  now = Date.now()
): Promise<AdminToken | null> {
  if (!token) return null;
  const [encoded, signature] = token.split('.', 2);
  if (!encoded || !signature) return null;

  const signatureBytes = fromBase64Url(signature);
  const payloadBytes = fromBase64Url(encoded);
  if (!signatureBytes || !payloadBytes) return null;

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    encoder().encode(encoded)
  );
  // 署名を確かめてから中身を読む。壊れたJSONをパースさせない。
  if (!valid) return null;

  let payload: AdminToken;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }

  if (typeof payload.userId !== 'string' || typeof payload.tenantId !== 'string') return null;
  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt * 1000 < now) return null;
  return payload;
}

/**
 * 署名鍵。本番では Secret Manager から環境変数として注入される (PRD 13-4)。
 *
 * 未設定のまま本番へ出ると、誰でもセッションを偽造できてしまう。
 * ローカル開発だけ固定値で通し、それ以外では起動を止める。
 */
export function adminSessionSecret(): string {
  const secret = process.env.RECEPTION_ADMIN_SESSION_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production' && process.env.RECEPTION_AUTH_DISABLED !== '1') {
    throw new Error(
      'RECEPTION_ADMIN_SESSION_SECRET が未設定です。管理Webのセッションを偽造できる状態のため起動を止めます。'
    );
  }
  return 'insecure-dev-admin-secret';
}
