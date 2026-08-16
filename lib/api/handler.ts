import { ApiError } from '../core/errors';
import { newRequestId } from '../core/ids';
import { ready } from '../store';
import { authenticate, requireScope, type Principal } from '../security/auth';
import * as rateLimit from '../security/rate-limit';
import * as idempotency from '../security/idempotency';
import * as audit from '../security/audit';
import type { Scope } from '../domain/types';

/**
 * API v1 のルートハンドラ共通処理。
 *
 * 認証 → スコープ検査 → Rate Limit → Idempotency → 実処理 → 監査ログ
 * の順で、全エンドポイントに同じ規律を強制する。
 * ここを通さないルートを作らないこと。
 */

/** 現在提供している API バージョン (PRD 10-5 / 10-6)。 */
export const CURRENT_API_VERSION = '2026-01-01';
/** 受理し続ける過去バージョン。古いクライアントを突然壊さないため。 */
export const SUPPORTED_API_VERSIONS = ['2025-10-01', CURRENT_API_VERSION];

export type RequestContext = {
  requestId: string;
  principal: Principal;
  /** クライアントが申告した API バージョン */
  apiVersion: string;
  /** クライアントが申告したアプリ版数 (PRD 10-6) */
  appVersion: string | null;
  configVersion: number | null;
  deviceId: string | null;
  ip: string | null;
  userAgent: string | null;
  /** 生のボディ。署名検証と Idempotency ハッシュに使う */
  rawBody: string;
  body: Record<string, unknown>;
  url: URL;
  params: Record<string, string>;
};

export type HandlerResult =
  | { status?: number; body: unknown; headers?: Record<string, string> }
  | Response;

export type Options = {
  /** 必要なスコープ。指定すると認証後に検査する。 */
  scope?: Scope;
  /** Idempotency-Key を受け付けるか。作成系で true にする。 */
  idempotent?: boolean;
  /** 監査ログに残す action 名。省略時は `${method} ${path}` */
  auditAction?: string;
  auditResourceType?: string;
  /**
   * 監査ログを明示的に無効化する。heartbeat のような高頻度で
   * かつ状態変化の意味が薄い書き込みにだけ使う。
   */
  audit?: false;
};

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip');
}

function baseHeaders(requestId: string): Record<string, string> {
  return {
    'X-Request-Id': requestId,
    'X-Api-Version': CURRENT_API_VERSION,
    'Cache-Control': 'no-store',
  };
}

function toResponse(result: HandlerResult, requestId: string, extra: Record<string, string>) {
  if (result instanceof Response) {
    for (const [k, v] of Object.entries({ ...baseHeaders(requestId), ...extra })) {
      if (!result.headers.has(k)) result.headers.set(k, v);
    }
    return result;
  }
  return Response.json(result.body, {
    status: result.status ?? 200,
    headers: { ...baseHeaders(requestId), ...extra, ...(result.headers ?? {}) },
  });
}

function errorResponse(error: unknown, requestId: string, extra: Record<string, string> = {}) {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = { ...baseHeaders(requestId), ...extra };
    if (error.retryAfterSeconds !== undefined) {
      headers['Retry-After'] = String(error.retryAfterSeconds);
    }
    return Response.json(error.toJSON(), { status: error.status, headers });
  }

  // 想定外の例外。詳細はサーバーログにだけ出し、クライアントには requestId を返す。
  console.error(`[${requestId}] unhandled error`, error);
  return Response.json(
    { error: { code: 'internal_error', message: 'サーバー内部エラーが発生しました', requestId } },
    { status: 500, headers: baseHeaders(requestId) }
  );
}

export function apiRoute(
  handler: (ctx: RequestContext) => Promise<HandlerResult>,
  options: Options = {}
) {
  return async (
    request: Request,
    routeContext?: { params?: Promise<Record<string, string>> }
  ): Promise<Response> => {
    const requestId = request.headers.get('x-request-id') ?? newRequestId();
    let extraHeaders: Record<string, string> = {};

    try {
      const url = new URL(request.url);

      const apiVersion = request.headers.get('x-api-version') ?? CURRENT_API_VERSION;
      if (!SUPPORTED_API_VERSIONS.includes(apiVersion)) {
        throw new ApiError(
          'unsupported_api_version',
          `API バージョン ${apiVersion} はサポートされていません（対応: ${SUPPORTED_API_VERSIONS.join(', ')}）`
        );
      }

      await ready();
      const principal = await authenticate(request.headers);
      if (options.scope) requireScope(principal, options.scope);

      // Rate Limit はテナント単位。1テナントの暴走が他テナントに波及しない (P-6)
      const limit = rateLimit.consume(`tenant:${principal.tenantId}`, principal.rateLimitPerMinute);
      extraHeaders = rateLimit.rateLimitHeaders(limit);
      if (!limit.allowed) throw rateLimit.rateLimitError(limit);

      const rawBody =
        request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
      const body = parseBody(rawBody);

      const idempotencyKey = options.idempotent
        ? request.headers.get('idempotency-key')
        : null;
      const requestHash = idempotencyKey
        ? idempotency.hashRequest(request.method, url.pathname, rawBody)
        : '';

      if (idempotencyKey) {
        const cached = idempotency.lookup(
          principal.tenantId,
          url.pathname,
          idempotencyKey,
          requestHash
        );
        if (cached) {
          return new Response(cached.body, {
            status: cached.status,
            headers: {
              ...baseHeaders(requestId),
              ...extraHeaders,
              'Content-Type': 'application/json',
              'Idempotency-Replayed': 'true',
            },
          });
        }
      }

      const params = (await routeContext?.params) ?? {};

      const ctx: RequestContext = {
        requestId,
        principal,
        apiVersion,
        appVersion: request.headers.get('x-app-version'),
        configVersion: numberOrNull(request.headers.get('x-config-version')),
        deviceId: request.headers.get('x-device-id'),
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent'),
        rawBody,
        body,
        url,
        params,
      };

      const result = await handler(ctx);
      const response = toResponse(result, requestId, extraHeaders);

      if (idempotencyKey && response.status < 500) {
        // レスポンスは一度しか読めないので複製してから保存する
        const clonedBody = await response.clone().text();
        idempotency.remember(
          principal.tenantId,
          url.pathname,
          idempotencyKey,
          requestHash,
          response.status,
          clonedBody
        );
      }

      if (options.audit !== false && audit.shouldAudit(request.method)) {
        await audit.record({
          tenantId: principal.tenantId,
          requestId,
          actorType: ctx.deviceId ? 'device' : 'api_client',
          actorId: ctx.deviceId ?? principal.clientId,
          action: options.auditAction ?? `${request.method} ${url.pathname}`,
          resourceType: options.auditResourceType ?? 'unknown',
          resourceId: typeof params.id === 'string' ? params.id : null,
          method: request.method,
          path: url.pathname,
          statusCode: response.status,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }

      return response;
    } catch (error) {
      return errorResponse(error, requestId, extraHeaders);
    }
  };
}

function parseBody(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError('bad_request', 'リクエストボディをJSONとして解釈できません');
  }
}

function numberOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 認証不要な公開エンドポイント（/health など）用の軽量ラッパ。 */
export function publicRoute(handler: (request: Request) => Promise<HandlerResult>) {
  return async (request: Request): Promise<Response> => {
    const requestId = request.headers.get('x-request-id') ?? newRequestId();
    try {
      return toResponse(await handler(request), requestId, {});
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}
