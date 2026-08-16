import { badRequest, conflict, notFound } from '../core/errors';
import { newId, newToken } from '../core/ids';
import { collections } from '../store';
import type { Id, Reservation, ReservationStatus } from '../domain/types';
import * as numbers from './access-numbers';
import * as webhooks from './webhooks';

/**
 * 予約 (PRD 9-2)。外部の予約システム・CRM から API で作られることを前提にする。
 */

export type CreateInput = {
  tenantId: Id;
  storeId: Id;
  customerId?: Id | null;
  guestName?: string | null;
  serviceId?: Id | null;
  startAt: string;
  endAt: string;
  /** 指定すればその番号を確保する。VIP・特定会員向け */
  accessNumber?: string | null;
  /** true なら予約時点で番号を確保する (PRD 7-3「通常」) */
  reserveNumber?: boolean;
  source?: Reservation['source'];
  note?: string | null;
};

export async function create(input: CreateInput): Promise<Reservation> {
  const store = await collections.stores().get(input.tenantId, input.storeId);
  if (!store) throw notFound('店舗');

  if (Date.parse(input.endAt) <= Date.parse(input.startAt)) {
    throw badRequest('endAt は startAt より後である必要があります');
  }
  if (!input.customerId && !input.guestName) {
    throw badRequest('customerId または guestName が必要です');
  }
  if (input.customerId) {
    const customer = await collections.customers().get(input.tenantId, input.customerId);
    if (!customer) throw notFound('顧客');
  }

  const now = new Date().toISOString();
  const id = newId('res');

  let accessNumber: string | null = null;
  if (input.accessNumber || input.reserveNumber) {
    const held = await numbers.reserve({
      tenantId: input.tenantId,
      storeId: input.storeId,
      number: input.accessNumber ?? undefined,
      customerIds: input.customerId ? [input.customerId] : [],
      reservationId: id,
      // 予約枠に合わせて時間指定確保する (PRD 7-3「時間指定」)
      holdFrom: input.startAt,
      holdUntil: input.endAt,
    });
    accessNumber = held.number;
  }

  const reservation = await collections.reservations().insert({
    id,
    tenantId: input.tenantId,
    storeId: input.storeId,
    customerId: input.customerId ?? null,
    guestName: input.guestName ?? null,
    serviceId: input.serviceId ?? null,
    status: 'booked',
    startAt: input.startAt,
    endAt: input.endAt,
    accessNumber,
    // QRには個人情報を入れず、参照トークンだけを載せる (PRD 7-2)
    qrToken: newToken(),
    qrTokenExpiresAt: new Date(Date.parse(input.endAt) + 60 * 60 * 1000).toISOString(),
    source: input.source ?? 'api',
    note: input.note ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await webhooks.emit({
    tenantId: input.tenantId,
    type: 'reservation.created',
    data: { reservation },
  });

  return reservation;
}

export type UpdateInput = {
  startAt?: string;
  endAt?: string;
  status?: ReservationStatus;
  serviceId?: Id | null;
  note?: string | null;
  accessNumber?: string | null;
};

export async function update(
  tenantId: Id,
  id: Id,
  patch: UpdateInput
): Promise<Reservation> {
  const current = await collections.reservations().get(tenantId, id);
  if (!current) throw notFound('予約');

  const startAt = patch.startAt ?? current.startAt;
  const endAt = patch.endAt ?? current.endAt;
  if (Date.parse(endAt) <= Date.parse(startAt)) {
    throw badRequest('endAt は startAt より後である必要があります');
  }

  const now = new Date().toISOString();
  const updated = await collections.reservations().update(tenantId, id, {
    ...patch,
    startAt,
    endAt,
    updatedAt: now,
  });
  if (!updated) throw notFound('予約');

  // キャンセル・No-show になった番号はスイープの解放対象になる
  await webhooks.emit({
    tenantId,
    type: 'reservation.updated',
    data: { reservation: updated },
  });

  return updated;
}

export async function remove(tenantId: Id, id: Id): Promise<void> {
  const current = await collections.reservations().get(tenantId, id);
  if (!current) throw notFound('予約');

  const visits = await collections
    .visits()
    .list(tenantId, (v) => v.reservationId === id && v.status === 'in_store');
  if (visits.length > 0) {
    throw conflict('受付済みで滞在中の予約は削除できません。先に退出処理を行ってください');
  }

  await collections.reservations().remove(tenantId, id);

  if (current.accessNumber) {
    await numbers
      .releaseManually(tenantId, current.storeId, current.accessNumber)
      .catch(() => undefined);
  }

  await webhooks.emit({
    tenantId,
    type: 'reservation.deleted',
    data: { reservationId: id, storeId: current.storeId },
  });
}

export type ListFilter = {
  storeId?: Id;
  customerId?: Id;
  status?: ReservationStatus;
  from?: string;
  to?: string;
};

export async function list(tenantId: Id, filter: ListFilter = {}): Promise<Reservation[]> {
  const fromMs = filter.from ? Date.parse(filter.from) : null;
  const toMs = filter.to ? Date.parse(filter.to) : null;

  const results = await collections.reservations().list(tenantId, (r) => {
    if (filter.storeId && r.storeId !== filter.storeId) return false;
    if (filter.customerId && r.customerId !== filter.customerId) return false;
    if (filter.status && r.status !== filter.status) return false;
    if (fromMs !== null && Date.parse(r.endAt) < fromMs) return false;
    if (toMs !== null && Date.parse(r.startAt) > toMs) return false;
    return true;
  });

  return results.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}
