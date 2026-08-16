import { randomBytes, randomUUID, createHash } from 'node:crypto';

/**
 * ID 生成。プレフィックス付きにして、ログ上でどのリソースか一目で分かるようにする。
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '')}`;
}

export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * 0-99 の安定したバケット値。段階リリース (PRD 4-4) で
 * 「同じ端末は毎回同じ判定になる」ことを保証するために使う。
 */
export function stableBucket(key: string, salt: string): number {
  const digest = createHash('sha256').update(`${salt}:${key}`).digest();
  return digest.readUInt32BE(0) % 100;
}
