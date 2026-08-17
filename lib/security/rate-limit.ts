import { ApiError } from '../core/errors';

/**
 * Rate Limit (PRD 10-1)。
 *
 * テナント単位でカウントする。原則 P-6「一つの顧客の障害が他顧客へ波及しない」より、
 * あるテナントの暴走が他テナントの枠を食い潰してはならない。
 *
 * 実装は fixed window counter で、状態はプロセス内に持つ。
 *
 * ## なぜ Firestore に載せていないか
 *
 * Idempotency は Datastore へ移したが、こちらは意図的に残している。
 * レート制限は「全リクエスト」で読み書きが発生するため、Firestore に載せると
 * 無料枠の書き込み上限(2万/日)がリクエスト数の上限そのものになってしまう。
 * 1リクエストごとに往復が増えて遅くもなる。
 *
 * ## いま何が守れていて、何が守れていないか
 *
 * 守れる:   1インスタンスに閉じた暴走の抑制。単一インスタンス構成では正しく効く。
 * 守れない: インスタンスがN個に増えると実効上限もN倍になる。
 *
 * 本気で守るなら前段(Cloud Armor / API Gateway)で制限をかけるか、
 * Memorystore(Redis) の実装へ差し替える。アプリ側のこれは多層防御の内側であり、
 * 単独で頼るものではない。
 */

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** エポック秒。X-RateLimit-Reset に載せる */
  resetAt: number;
  retryAfterSeconds: number;
};

type Bucket = { windowStart: number; count: number };

const WINDOW_MS = 60_000;

const GLOBAL_KEY = '__reception_rate_limit__';
type GlobalWithBuckets = typeof globalThis & { [GLOBAL_KEY]?: Map<string, Bucket> };

function buckets(): Map<string, Bucket> {
  const g = globalThis as GlobalWithBuckets;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY]!;
}

export function consume(key: string, limitPerMinute: number, now = Date.now()): RateLimitResult {
  const map = buckets();
  const bucket = map.get(key);
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;

  if (!bucket || bucket.windowStart !== windowStart) {
    map.set(key, { windowStart, count: 1 });
    return {
      allowed: true,
      limit: limitPerMinute,
      remaining: Math.max(0, limitPerMinute - 1),
      resetAt: Math.floor((windowStart + WINDOW_MS) / 1000),
      retryAfterSeconds: Math.ceil((windowStart + WINDOW_MS - now) / 1000),
    };
  }

  bucket.count += 1;
  const resetAt = Math.floor((windowStart + WINDOW_MS) / 1000);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000));

  return {
    allowed: bucket.count <= limitPerMinute,
    limit: limitPerMinute,
    remaining: Math.max(0, limitPerMinute - bucket.count),
    resetAt,
    retryAfterSeconds,
  };
}

export function rateLimitError(result: RateLimitResult): ApiError {
  return new ApiError('rate_limited', 'リクエストが多すぎます。しばらく待って再試行してください', {
    retryAfterSeconds: result.retryAfterSeconds,
  });
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
  };
}

/** テスト用。 */
export function resetRateLimits(): void {
  buckets().clear();
}
