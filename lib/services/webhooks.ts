import { newId } from '../core/ids';
import { collections } from '../store';
import { buildSignatureHeader, EVENT_ID_HEADER, NONCE_HEADER, REQUEST_ID_HEADER, SIGNATURE_HEADER } from '../security/signature';
import type { Id, WebhookDelivery, WebhookEventType } from '../domain/types';

/**
 * Webhook 配信 (PRD 9-4 / 10-2)。
 *
 * 送信は必ず非同期キュー越しに行う (PRD 13-2)。受付トランザクションの中で
 * 外部HTTPを待つと、連携先が落ちているだけで店舗の受付が止まる。
 * これは原則 P-3「APIが落ちても可能な限り店舗受付を止めない」に反する。
 */

/** 指数バックオフ。連携先の一時障害で取りこぼさないため。 */
const RETRY_DELAYS_MS = [
  10_000, // 10秒
  60_000, // 1分
  300_000, // 5分
  1_800_000, // 30分
  7_200_000, // 2時間
];

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export type EmitOptions = {
  tenantId: Id;
  type: WebhookEventType;
  data: unknown;
  requestId?: string;
};

/**
 * イベントを配信キューに積む。購読しているエンドポイントごとに1件作る。
 * 呼び出し側は await するが、実際のHTTP送信は drain() が行う。
 */
export async function emit(options: EmitOptions): Promise<WebhookDelivery[]> {
  const endpoints = await collections
    .webhookEndpoints()
    .list(options.tenantId, (e) => !e.disabled && e.events.includes(options.type));

  if (endpoints.length === 0) return [];

  const now = new Date().toISOString();
  const eventId = newId('evt');
  const deliveries: WebhookDelivery[] = [];

  for (const endpoint of endpoints) {
    const delivery: WebhookDelivery = {
      id: newId('whd'),
      tenantId: options.tenantId,
      endpointId: endpoint.id,
      eventId,
      eventType: options.type,
      payload: {
        id: eventId,
        type: options.type,
        createdAt: now,
        requestId: options.requestId ?? null,
        data: options.data,
      },
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      lastStatusCode: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    deliveries.push(await collections.webhookDeliveries().insert(delivery));
  }

  return deliveries;
}

export type DrainResult = {
  attempted: number;
  succeeded: number;
  failed: number;
};

/**
 * 送信待ちを処理する。Cloud Tasks / Pub/Sub のワーカーから叩かれる想定。
 * 開発中は `POST /api/v1/webhooks/drain` から手動で回せる。
 */
export async function drain(
  tenantId: Id,
  options: { now?: Date; fetchImpl?: typeof fetch; limit?: number } = {}
): Promise<DrainResult> {
  const now = options.now ?? new Date();
  const doFetch = options.fetchImpl ?? fetch;
  const limit = options.limit ?? 50;

  const pending = await collections
    .webhookDeliveries()
    .list(
      tenantId,
      (d) =>
        d.status === 'pending' &&
        (d.nextAttemptAt === null || Date.parse(d.nextAttemptAt) <= now.getTime())
    );

  const batch = pending.slice(0, limit);
  const result: DrainResult = { attempted: 0, succeeded: 0, failed: 0 };

  for (const delivery of batch) {
    const endpoint = await collections.webhookEndpoints().get(tenantId, delivery.endpointId);
    if (!endpoint || endpoint.disabled) {
      await collections.webhookDeliveries().update(tenantId, delivery.id, {
        status: 'dead',
        lastError: '配信先エンドポイントが存在しないか無効です',
        updatedAt: now.toISOString(),
      });
      continue;
    }

    result.attempted += 1;
    const body = JSON.stringify(delivery.payload);
    const { signature, nonce } = buildSignatureHeader({ secret: endpoint.secret, body });
    const attempts = delivery.attempts + 1;

    try {
      const response = await doFetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SIGNATURE_HEADER]: signature,
          [NONCE_HEADER]: nonce,
          [EVENT_ID_HEADER]: delivery.eventId,
          [REQUEST_ID_HEADER]: newId('req'),
        },
        body,
      });

      if (response.ok) {
        await collections.webhookDeliveries().update(tenantId, delivery.id, {
          status: 'succeeded',
          attempts,
          lastStatusCode: response.status,
          lastError: null,
          nextAttemptAt: null,
          updatedAt: now.toISOString(),
        });
        result.succeeded += 1;
        continue;
      }

      await scheduleRetry(tenantId, delivery.id, attempts, now, response.status, `HTTP ${response.status}`);
      result.failed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await scheduleRetry(tenantId, delivery.id, attempts, now, null, message);
      result.failed += 1;
    }
  }

  return result;
}

async function scheduleRetry(
  tenantId: Id,
  deliveryId: Id,
  attempts: number,
  now: Date,
  statusCode: number | null,
  error: string
): Promise<void> {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  const exhausted = delay === undefined;

  await collections.webhookDeliveries().update(tenantId, deliveryId, {
    // 再試行を打ち切ったものは dead にして、管理画面から手動再送できるようにする
    status: exhausted ? 'dead' : 'pending',
    attempts,
    lastStatusCode: statusCode,
    lastError: error,
    nextAttemptAt: exhausted ? null : new Date(now.getTime() + delay).toISOString(),
    updatedAt: now.toISOString(),
  });
}

/**
 * 管理画面からの手動再送。dead を pending に戻す。
 * 試行回数も 0 に戻す。連携先を直してから再送するので、
 * 打ち切り済みの回数を引き継ぐと1回で再び dead になってしまう。
 */
export async function retry(tenantId: Id, deliveryId: Id): Promise<WebhookDelivery | null> {
  const now = new Date().toISOString();
  return collections.webhookDeliveries().update(tenantId, deliveryId, {
    status: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    updatedAt: now,
  });
}
