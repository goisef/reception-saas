import { apiRoute } from '@/lib/api/handler';
import { badRequest } from '@/lib/core/errors';
import { Validator } from '@/lib/core/validate';
import { assertStoreAccess } from '@/lib/security/auth';
import * as numbers from '@/lib/services/access-numbers';

export const GET = apiRoute(
  async (ctx) => {
    const storeId = ctx.url.searchParams.get('storeId');
    if (!storeId) throw badRequest('storeId が必要です');
    assertStoreAccess(ctx.principal, storeId);

    const rows = await numbers.listByStore(ctx.principal.tenantId, storeId);
    const status = ctx.url.searchParams.get('status');
    return { body: { data: status ? rows.filter((n) => n.status === status) : rows } };
  },
  { scope: 'access_numbers:read' }
);

/** 番号確保 (PRD 7-3「番号確保」)。number 省略時は空き番号を払い出す。 */
export const POST = apiRoute(
  async (ctx) => {
    const v = new Validator(ctx.body);
    const storeId = v.string('storeId', { required: true });
    const number = v.accessNumber('number');
    const customerIds = v.stringArray('customerIds');
    const reservationId = v.string('reservationId');
    const pinned = v.boolean('pinned');
    const holdFrom = v.dateTime('holdFrom');
    const holdUntil = v.dateTime('holdUntil');
    v.throwIfInvalid();

    assertStoreAccess(ctx.principal, storeId!);

    const created = await numbers.reserve({
      tenantId: ctx.principal.tenantId,
      storeId: storeId!,
      number,
      customerIds,
      reservationId,
      pinned,
      holdFrom,
      holdUntil,
    });

    return { status: 201, body: { data: created } };
  },
  {
    scope: 'access_numbers:write',
    idempotent: true,
    auditAction: 'access_number.reserve',
    auditResourceType: 'access_number',
  }
);
