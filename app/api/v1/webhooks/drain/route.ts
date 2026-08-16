import { apiRoute } from '@/lib/api/handler';
import { collections } from '@/lib/store';
import * as webhooks from '@/lib/services/webhooks';

/**
 * Webhook 配信ワーカー (PRD 13-2)。
 *
 * 本番では Cloud Tasks / Pub/Sub が各配信を個別に叩く。ここでは
 * 溜まった配信をまとめて処理するエンドポイントとして持っておき、
 * キュー基盤なしでも配信・リトライの挙動を確認できるようにする。
 */
export const POST = apiRoute(
  async (ctx) => {
    const result = await webhooks.drain(ctx.principal.tenantId);
    return { body: { data: result } };
  },
  {
    scope: 'webhooks:write',
    auditAction: 'webhook.drain',
    auditResourceType: 'webhook_delivery',
  }
);

/** 配信状況の確認。失敗が続いていないかを管理画面から見る。 */
export const GET = apiRoute(
  async (ctx) => {
    const deliveries = await collections.webhookDeliveries().list(ctx.principal.tenantId);
    deliveries.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const summary = {
      pending: deliveries.filter((d) => d.status === 'pending').length,
      succeeded: deliveries.filter((d) => d.status === 'succeeded').length,
      failed: deliveries.filter((d) => d.status === 'failed').length,
      dead: deliveries.filter((d) => d.status === 'dead').length,
    };

    return { body: { data: deliveries.slice(0, 100), summary } };
  },
  { scope: 'webhooks:read' }
);
