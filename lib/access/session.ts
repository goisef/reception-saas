/**
 * 共有URLのアクセス制御。
 *
 * デモ環境を「URLを知っている人だけ」に留めるための薄い一枚。
 * これはプロダクトの認証ではなく、公開URLの前に立てる目隠しである。
 * 管理Webの本来のログイン (lib/admin/session.ts) とは別物なので混同しないこと。
 *
 * Edge ランタイム (proxy.ts) から呼ぶため、Node の crypto ではなく
 * Web Crypto API を使う。Secret Manager の SDK も Edge では動かないので、
 * パスワードは Cloud Run が環境変数として注入したものを読む。
 */

export const ACCESS_COOKIE = 'reception_access';

/** セッションの有効期間。デモを見せている最中に切れない程度に長く取る。 */
const TTL_SECONDS = 12 * 60 * 60;

function encoder() {
  return new TextEncoder();
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  // ArrayBuffer を明示的に確保する。長さだけ渡すと ArrayBufferLike 扱いになり、
  // crypto.subtle が要求する BufferSource として受け付けられない。
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

/**
 * Cookie に載せるトークン。中身は有効期限だけで、秘密情報は入れない。
 * 署名鍵を知らないと期限を延ばせないので、改ざんは検出できる。
 */
export async function issueToken(secret: string, now = Date.now()): Promise<string> {
  const payload = String(Math.floor(now / 1000) + TTL_SECONDS);
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyToken(
  secret: string,
  token: string | undefined,
  now = Date.now()
): Promise<boolean> {
  if (!token) return false;
  const [payload, signature] = token.split('.', 2);
  if (!payload || !signature) return false;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < now) return false;

  const key = await hmacKey(secret);
  return crypto.subtle.verify(
    'HMAC',
    key,
    fromBase64Url(signature),
    encoder().encode(payload)
  );
}

/** タイミング差で正解パスワードを推測されないよう、長さに依らず一定時間で比較する。 */
export async function passwordMatches(expected: string, given: string): Promise<boolean> {
  // 長さの違いも隠すため、生の比較ではなくハッシュ同士を突き合わせる
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder().encode(expected)),
    crypto.subtle.digest('SHA-256', encoder().encode(given)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

export type AccessConfig = {
  /** 未設定ならアクセス制御そのものを行わない（ローカル開発） */
  password: string | null;
  secret: string;
  /** 環境名。ログイン画面に出して dev と demo を取り違えないようにする */
  label: string;
};

export function accessConfig(): AccessConfig {
  const disabled = process.env.RECEPTION_AUTH_DISABLED === '1';
  const password = disabled ? null : process.env.RECEPTION_ACCESS_PASSWORD || null;
  return {
    password,
    // 鍵が未設定でも動くようにするが、その場合はパスワード自体を鍵に流用する。
    // 鍵が漏れてもパスワードを変えれば全セッションが失効する。
    secret: process.env.RECEPTION_SESSION_SECRET || password || 'insecure-dev-secret',
    label: process.env.RECEPTION_ENV_LABEL || 'local',
  };
}
