/**
 * API エラー表現。
 *
 * 外部連携先が機械的に分岐できるよう、HTTP ステータスに加えて安定した
 * `code` を返す。code は API v1 の契約の一部であり、勝手に変えない。
 */

export type ApiErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'idempotency_key_reused'
  | 'rate_limited'
  | 'unsupported_api_version'
  | 'signature_invalid'
  | 'replay_detected'
  | 'internal_error'
  | 'service_unavailable';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  idempotency_key_reused: 409,
  rate_limited: 429,
  unsupported_api_version: 400,
  signature_invalid: 401,
  replay_detected: 401,
  internal_error: 500,
  service_unavailable: 503,
};

export type FieldError = { field: string; message: string };

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: FieldError[];
  /** 429 のときにクライアントへ返す再試行秒数 */
  readonly retryAfterSeconds?: number;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { details?: FieldError[]; retryAfterSeconds?: number } = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details ?? [];
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details.length > 0 ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (message: string) => new ApiError('bad_request', message);
export const unauthorized = (message = '認証情報が不正です') =>
  new ApiError('unauthorized', message);
export const forbidden = (message = 'この操作を行う権限がありません') =>
  new ApiError('forbidden', message);
export const notFound = (resource: string) =>
  new ApiError('not_found', `${resource} が見つかりません`);
export const conflict = (message: string) => new ApiError('conflict', message);
export const validationFailed = (details: FieldError[]) =>
  new ApiError('validation_failed', '入力値が不正です', { details });
