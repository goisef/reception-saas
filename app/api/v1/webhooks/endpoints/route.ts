import { apiRoute } from '@/lib/api/handler';
import { newId, newToken } from '@/lib/core/ids';
import { Validator } from '@/lib/core/validate';
import { badRequest } from '@/lib/core/errors';
import { collections } from '@/lib/store';
import type { WebhookEventType } from '@/lib/domain/types';

const EVENT_TYPES: WebhookEventType[] = [
  'reservation.created',
  'reservation.updated',
  'reservation.deleted',
  'checkin.completed',
  'checkout.completed',
  'customer.created',
  'customer.updated',
  'access_number.reserved',
  'access_number.released',
];

export const GET = apiRoute(
  async (ctx) => {
    const endpoints = await collections.webhookEndpoints().list(ctx.principal.tenantId);
    // secret は返さない。作成時のレスポンスでしか見せない
    return {
      body: {
        data: endpoints.map(({ secret, ...rest }) => {
          void secret;
          return rest;
        }),
        availableEvents: EVENT_TYPES,
      },
    };
  },
  { scope: 'webhooks:read' }
);

export const POST = apiRoute(
  async (ctx) => {
    const v = new Validator(ctx.body);
    const url = v.string('url', { required: true, max: 500 });
    const events = v.stringArray('events', { required: true });
    v.throwIfInvalid();

    let parsed: URL;
    try {
      parsed = new URL(url!);
    } catch {
      throw badRequest('url が不正です');
    }
    // 平文HTTPは許可しない (PRD 10-1 TLS必須)。localhost は開発用に例外扱い。
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !isLocal) {
      throw badRequest('Webhook の宛先は https である必要があります');
    }

    const unknown = events!.filter((e) => !EVENT_TYPES.includes(e as WebhookEventType));
    if (unknown.length > 0) {
      throw badRequest(`未知のイベントです: ${unknown.join(', ')}`);
    }

    // 署名鍵はここで生成し、このレスポンスでしか返さない。
    // 本番では Secret Manager に保管する (PRD 13-4)。
    const secret = newToken(32);
    const endpoint = await collections.webhookEndpoints().insert({
      id: newId('whe'),
      tenantId: ctx.principal.tenantId,
      url: url!,
      secret,
      events: events as WebhookEventType[],
      disabled: false,
      createdAt: new Date().toISOString(),
    });

    return {
      status: 201,
      body: {
        data: endpoint,
        notice: 'secret はこの応答でのみ返されます。安全な場所に保管してください。',
      },
    };
  },
  {
    scope: 'webhooks:write',
    auditAction: 'webhook_endpoint.create',
    auditResourceType: 'webhook_endpoint',
  }
);
