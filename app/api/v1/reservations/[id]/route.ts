import { apiRoute } from '@/lib/api/handler';
import { notFound } from '@/lib/core/errors';
import { Validator } from '@/lib/core/validate';
import { assertStoreAccess } from '@/lib/security/auth';
import { collections } from '@/lib/store';
import * as reservations from '@/lib/services/reservations';
import type { ReservationStatus } from '@/lib/domain/types';

const STATUSES: ReservationStatus[] = [
  'booked',
  'checked_in',
  'completed',
  'cancelled',
  'no_show',
];

export const GET = apiRoute(
  async (ctx) => {
    const reservation = await collections
      .reservations()
      .get(ctx.principal.tenantId, ctx.params.id);
    if (!reservation) throw notFound('予約');
    assertStoreAccess(ctx.principal, reservation.storeId);
    return { body: { data: reservation } };
  },
  { scope: 'reservations:read' }
);

export const PATCH = apiRoute(
  async (ctx) => {
    const existing = await collections
      .reservations()
      .get(ctx.principal.tenantId, ctx.params.id);
    if (!existing) throw notFound('予約');
    assertStoreAccess(ctx.principal, existing.storeId);

    const v = new Validator(ctx.body);
    const startAt = v.dateTime('startAt');
    const endAt = v.dateTime('endAt');
    const status = v.enum('status', STATUSES);
    const serviceId = v.string('serviceId');
    const note = v.string('note', { max: 2000 });
    const accessNumber = v.accessNumber('accessNumber');
    v.throwIfInvalid();

    const reservation = await reservations.update(ctx.principal.tenantId, ctx.params.id, {
      ...(startAt !== undefined ? { startAt } : {}),
      ...(endAt !== undefined ? { endAt } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(serviceId !== undefined ? { serviceId } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(accessNumber !== undefined ? { accessNumber } : {}),
    });

    return { body: { data: reservation } };
  },
  {
    scope: 'reservations:write',
    auditAction: 'reservation.update',
    auditResourceType: 'reservation',
  }
);

export const DELETE = apiRoute(
  async (ctx) => {
    const existing = await collections
      .reservations()
      .get(ctx.principal.tenantId, ctx.params.id);
    if (!existing) throw notFound('予約');
    assertStoreAccess(ctx.principal, existing.storeId);

    await reservations.remove(ctx.principal.tenantId, ctx.params.id);
    // 204 はボディを持てないので Response を直接返す
    return new Response(null, { status: 204 });
  },
  {
    scope: 'reservations:write',
    auditAction: 'reservation.delete',
    auditResourceType: 'reservation',
  }
);
