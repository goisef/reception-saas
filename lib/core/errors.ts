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
  /**
   * 受付端末が来店客に見せる文言。
   *
   * `message` は外部連携先の開発者向けなので、そのまま画面に出すと
   * 「アクセス番号 が見つかりません」のような内部用語が客に見える。
   * 端末に文言を持たせない方針 (PRD 4 Thin Client) なので、
   * 客向けの言い換えもサーバーが決めて配る。
   */
  readonly display?: string;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: {
      details?: FieldError[];
      retryAfterSeconds?: number;
      display?: string;
    } = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details ?? [];
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.display = options.display;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.display ? { display: this.display } : {}),
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

/**
 * 受付端末に見せる文言を添えたエラー。
 *
 * 来店客は原因を直せないので、原因の説明ではなく次にとる行動を伝える。
 * 詳細な理由は message 側に残し、監査ログと連携先からは追える状態を保つ。
 */
export function withDisplay(error: ApiError, display: string): ApiError {
  return new ApiError(error.code, error.message, {
    details: error.details,
    retryAfterSeconds: error.retryAfterSeconds,
    display,
  });
}

/** 受付端末向けの定型文言。 */
export const TERMINAL_MESSAGE = {
  numberUnknown: 'この番号は受付できません。番号をお確かめのうえ、もう一度お試しください。',
  numberUnavailable: 'この番号は現在ご利用いただけません。スタッフにお声がけください。',
  qrExpired: 'QRコードの有効期限が切れています。スタッフにお声がけください。',
  qrUnknown: 'このQRコードは読み取れませんでした。スタッフにお声がけください。',
  alreadyCheckedIn: 'すでに受付が完了しています。そのままお進みください。',
  reservationCancelled: 'このご予約はキャンセルされています。スタッフにお声がけください。',
  notInStore: 'ご滞在中の記録が見つかりません。スタッフにお声がけください。',
  alreadyExited: 'すでに退出処理が完了しています。',
} as const;
