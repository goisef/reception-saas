import { apiRoute } from '@/lib/api/handler';
import { Validator } from '@/lib/core/validate';
import { assertStoreAccess, scopeStoreFilter } from '@/lib/security/auth';
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
    const p = ctx.url.searchParams;
    const rows = await reservations.list(ctx.principal.tenantId, {
      storeId: p.get('storeId') ?? undefined,
      customerId: p.get('customerId') ?? undefined,
      status: (p.get('status') as ReservationStatus | null) ?? undefined,
      from: p.get('from') ?? undefined,
      to: p.get('to') ?? undefined,
    });

    // API Client のデータ範囲外の店舗は返さない
    const allowed = scopeStoreFilter(ctx.principal);
    return { body: { data: rows.filter((r) => allowed(r.storeId)) } };
  },
  { scope: 'reservations:read' }
);

export const POST = apiRoute(
  async (ctx) => {
    const v = new Validator(ctx.body);
    const storeId = v.string('storeId', { required: true });
    const startAt = v.dateTime('startAt', { required: true });
    const endAt = v.dateTime('endAt', { required: true });
    const customerId = v.string('customerId');
    const guestName = v.string('guestName', { max: 100 });
    const serviceId = v.string('serviceId');
    const accessNumber = v.accessNumber('accessNumber');
    const reserveNumber = v.boolean('reserveNumber');
    const note = v.string('note', { max: 2000 });
    v.enum('status', STATUSES);
    v.throwIfInvalid();

    assertStoreAccess(ctx.principal, storeId!);

    const reservation = await reservations.create({
      tenantId: ctx.principal.tenantId,
      storeId: storeId!,
      startAt: startAt!,
      endAt: endAt!,
      customerId,
      guestName,
      serviceId,
      accessNumber,
      reserveNumber,
      note,
      source: 'api',
    });

    return { status: 201, body: { data: reservation } };
  },
  {
    scope: 'reservations:write',
    idempotent: true,
    auditAction: 'reservation.create',
    auditResourceType: 'reservation',
  }
);
