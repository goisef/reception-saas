import { apiRoute } from '@/lib/api/handler';
import { notFound } from '@/lib/core/errors';
import { Validator } from '@/lib/core/validate';
import { assertStoreAccess } from '@/lib/security/auth';
import { collections } from '@/lib/store';
import * as reception from '@/lib/services/reception';

export const GET = apiRoute(
  async (ctx) => {
    const visit = await collections.visits().get(ctx.principal.tenantId, ctx.params.id);
    if (!visit) throw notFound('来店');
    assertStoreAccess(ctx.principal, visit.storeId);
    return { body: { data: visit } };
  },
  { scope: 'visits:read' }
);

/** 退出予定時刻の変更 (PRD 7-4「管理画面から変更可能」)。 */
export const PATCH = apiRoute(
  async (ctx) => {
    const visit = await collections.visits().get(ctx.principal.tenantId, ctx.params.id);
    if (!visit) throw notFound('来店');
    assertStoreAccess(ctx.principal, visit.storeId);

    const v = new Validator(ctx.body);
    const scheduledExitAt = v.dateTime('scheduledExitAt', { required: true });
    v.throwIfInvalid();

    const updated = await reception.updateScheduledExit(
      ctx.principal.tenantId,
      ctx.params.id,
      scheduledExitAt!
    );
    return { body: { data: updated } };
  },
  {
    scope: 'visits:write',
    auditAction: 'visit.scheduled_exit.update',
    auditResourceType: 'visit',
  }
);
