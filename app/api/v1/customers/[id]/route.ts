import { apiRoute } from '@/lib/api/handler';
import { notFound } from '@/lib/core/errors';
import { Validator } from '@/lib/core/validate';
import { collections } from '@/lib/store';
import * as customers from '@/lib/services/customers';

export const GET = apiRoute(
  async (ctx) => {
    const customer = await collections.customers().get(ctx.principal.tenantId, ctx.params.id);
    if (!customer) throw notFound('顧客');

    // ?include=history で来店・予約履歴を同梱する (PRD 14-2)
    if (ctx.url.searchParams.get('include') === 'history') {
      const history = await customers.history(ctx.principal.tenantId, ctx.params.id);
      return { body: { data: customer, history } };
    }
    return { body: { data: customer } };
  },
  { scope: 'customers:read' }
);

export const PATCH = apiRoute(
  async (ctx) => {
    const v = new Validator(ctx.body);
    const name = v.string('name', { max: 100 });
    const memberCode = v.string('memberCode', { max: 50 });
    const nameKana = v.string('nameKana', { max: 100 });
    const email = v.string('email', { max: 254 });
    const phone = v.string('phone', { max: 30 });
    const note = v.string('note', { max: 2000 });
    v.throwIfInvalid();

    const patch: Parameters<typeof customers.update>[2] = {};
    if (name !== undefined) patch.name = name;
    if (memberCode !== undefined) patch.memberCode = memberCode;
    if (nameKana !== undefined) patch.nameKana = nameKana;
    if (email !== undefined) patch.email = email;
    if (phone !== undefined) patch.phone = phone;
    if (note !== undefined) patch.note = note;
    if (ctx.body.externalIds) {
      patch.externalIds = ctx.body.externalIds as Record<string, string>;
    }

    const customer = await customers.update(ctx.principal.tenantId, ctx.params.id, patch);
    return { body: { data: customer } };
  },
  {
    scope: 'customers:write',
    auditAction: 'customer.update',
    auditResourceType: 'customer',
  }
);

/**
 * 顔認証データの利用停止 (PRD 8-5「削除」「利用停止」)。
 * 顧客レコード自体は来店履歴のために残す。
 */
export const DELETE = apiRoute(
  async (ctx) => {
    if (ctx.url.searchParams.get('target') !== 'face_recognition') {
      throw notFound('削除対象');
    }
    const customer = await customers.revokeFaceRecognition(
      ctx.principal.tenantId,
      ctx.params.id
    );
    return { body: { data: customer } };
  },
  {
    scope: 'customers:write',
    auditAction: 'customer.face_recognition.revoke',
    auditResourceType: 'customer',
  }
);
