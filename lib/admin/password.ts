/**
 * 管理Webのパスワード保管。
 *
 * 平文もその SHA-256 も保存しない。SHA-256 は速すぎて、漏れた瞬間に
 * 総当たりが現実的な時間で終わる。伸長関数を通した派生鍵だけを持つ。
 *
 * Node の crypto ではなく Web Crypto を使う。ログイン処理は Edge でも
 * 動かせるようにしておきたいのと、ランタイム間で結果が変わらないため。
 */

/**
 * OWASP の PBKDF2-SHA256 推奨値。
 * 上げるほど安全になるが、そのぶんログインが遅くなる。
 * 変更しても既存のハッシュは自身の iterations を持っているので検証できる。
 */
const ITERATIONS = 210_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

const ALGORITHM = 'pbkdf2-sha256';

function encoder() {
  return new TextEncoder();
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  // crypto.subtle が要求する BufferSource にするため ArrayBuffer を明示する
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

/**
 * 保存形式: `pbkdf2-sha256$<iterations>$<salt>$<derived>`
 *
 * iterations をハッシュに埋める。将来この値を上げても、
 * 既存ユーザーがログインできなくなることがない。
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(new ArrayBuffer(SALT_BYTES));
  crypto.getRandomValues(salt);
  const derived = await derive(password, salt, ITERATIONS);
  return `${ALGORITHM}$${ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

/**
 * 検証。ハッシュが壊れている場合も false を返し、例外にしない。
 * ログイン画面に内部エラーを出す口を作らないため。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const [algorithm, iterationsText, saltText, expectedText] = parts;
  if (algorithm !== ALGORITHM) return false;

  const iterations = Number.parseInt(iterationsText, 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array<ArrayBuffer>;
  try {
    salt = fromBase64(saltText);
    expected = fromBase64(expectedText);
  } catch {
    return false;
  }

  const actual = await derive(password, salt, iterations);
  if (actual.length !== expected.length) return false;

  // 一致する先頭バイト数から正解を絞られないよう、最後まで比較する
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
