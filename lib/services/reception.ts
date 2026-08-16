import { badRequest, conflict, notFound } from '../core/errors';
import { newId } from '../core/ids';
import { collections } from '../store';
import type {
  Id,
  ReceptionMethod,
  Reservation,
  Store,
  Visit,
} from '../domain/types';
import * as numbers from './access-numbers';
import * as notifications from './notifications';
import * as webhooks from './webhooks';

/**
 * 受付 → 滞在 → 退出のユースケース。
 *
 * ビジネスロジックはすべてここに置き、端末は画面表示と入力だけを担当する
 * （PRD 4 Thin Client）。端末を更新せずに受付フローを変えられるのが目的。
 */

export type CheckinInput = {
  tenantId: Id;
  storeId: Id;
  method: ReceptionMethod;
  /** QR受付。reservation.qrToken と突き合わせる */
  qrToken?: string;
  /** 4桁番号受付 */
  accessNumber?: string;
  /** スタッフ受付・イベント受付など、顧客を直接指定する場合 */
  customerId?: Id;
  guestName?: string;
  deviceId?: Id | null;
  /** オフライン受付の重複排除キー (PRD Q-6) */
  clientEventId?: string | null;
  now?: Date;
};

export type CheckinResult = {
  visit: Visit;
  reservation: Reservation | null;
  accessNumber: string | null;
  /** 端末に表示するメッセージ。文言もサーバー側で決める */
  message: string;
  /** 同じ clientEventId で既に受付済みだった場合 true */
  duplicate: boolean;
};

export async function checkin(input: CheckinInput): Promise<CheckinResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  const store = await collections.stores().get(input.tenantId, input.storeId);
  if (!store) throw notFound('店舗');

  // オフライン同期でも二重受付にならないよう、まず重複を確認する
  if (input.clientEventId) {
    const existing = await collections
      .visits()
      .list(input.tenantId, (v) => v.clientEventId === input.clientEventId);
    if (existing[0]) {
      const reservation = existing[0].reservationId
        ? await collections.reservations().get(input.tenantId, existing[0].reservationId)
        : null;
      return {
        visit: existing[0],
        reservation,
        accessNumber: existing[0].accessNumber,
        message: '受付済みです',
        duplicate: true,
      };
    }
  }

  const resolved = await resolveTarget(input, now);

  // 同じ予約で二重に受付できないようにする
  if (resolved.reservation) {
    const active = await collections
      .visits()
      .list(
        input.tenantId,
        (v) => v.reservationId === resolved.reservation!.id && v.status === 'in_store'
      );
    if (active[0]) {
      throw conflict('この予約は既に受付済みです');
    }
  }

  const scheduledExitAt = resolved.reservation
    ? resolved.reservation.endAt
    : new Date(now.getTime() + store.defaultStayMinutes * 60_000).toISOString();

  const visitId = newId('vis');

  // 番号を確定する。予約に番号が無ければここで払い出す
  let assignedNumber = resolved.accessNumber;
  if (!assignedNumber) {
    const issued = await numbers.reserve({
      tenantId: input.tenantId,
      storeId: input.storeId,
      customerIds: resolved.customerId ? [resolved.customerId] : [],
      reservationId: resolved.reservation?.id ?? null,
    });
    assignedNumber = issued.number;
  }

  const numberDoc = await numbers.findByNumber(input.tenantId, input.storeId, assignedNumber);
  if (numberDoc) {
    await numbers.markInUse(input.tenantId, numberDoc, {
      visitId,
      reservationId: resolved.reservation?.id ?? numberDoc.reservationId,
      customerIds: resolved.customerId
        ? [...new Set([...numberDoc.customerIds, resolved.customerId])]
        : numberDoc.customerIds,
    });
  }

  const visit = await collections.visits().insert({
    id: visitId,
    tenantId: input.tenantId,
    storeId: input.storeId,
    reservationId: resolved.reservation?.id ?? null,
    customerId: resolved.customerId ?? null,
    guestName: resolved.guestName ?? null,
    accessNumber: assignedNumber,
    method: input.method,
    status: 'in_store',
    checkedInAt: nowIso,
    scheduledExitAt,
    actualExitAt: null,
    deviceId: input.deviceId ?? null,
    clientEventId: input.clientEventId ?? null,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  if (resolved.reservation) {
    await collections.reservations().update(input.tenantId, resolved.reservation.id, {
      status: 'checked_in',
      accessNumber: assignedNumber,
      updatedAt: nowIso,
    });
  }

  await notifications.scheduleExitReminders(visit, store);

  await webhooks.emit({
    tenantId: input.tenantId,
    type: 'checkin.completed',
    data: { visit, reservationId: resolved.reservation?.id ?? null },
  });

  return {
    visit,
    reservation: resolved.reservation,
    accessNumber: assignedNumber,
    message: buildWelcomeMessage(resolved.displayName, assignedNumber, scheduledExitAt),
    duplicate: false,
  };
}

type ResolvedTarget = {
  reservation: Reservation | null;
  customerId: Id | null;
  guestName: string | null;
  displayName: string | null;
  accessNumber: string | null;
};

async function resolveTarget(input: CheckinInput, now: Date): Promise<ResolvedTarget> {
  if (input.method === 'qr') {
    if (!input.qrToken) throw badRequest('qrToken が必要です');
    const matches = await collections
      .reservations()
      .list(input.tenantId, (r) => r.qrToken === input.qrToken);
    const reservation = matches[0];
    if (!reservation) throw notFound('予約');
    if (Date.parse(reservation.qrTokenExpiresAt) < now.getTime()) {
      throw conflict('QRコードの有効期限が切れています');
    }
    if (reservation.status === 'cancelled') throw conflict('この予約はキャンセルされています');
    return {
      reservation,
      customerId: reservation.customerId,
      guestName: reservation.guestName,
      displayName: await displayName(input.tenantId, reservation),
      accessNumber: reservation.accessNumber,
    };
  }

  if (input.method === 'number') {
    if (!input.accessNumber) throw badRequest('accessNumber が必要です');
    const numberDoc = await numbers.findByNumber(
      input.tenantId,
      input.storeId,
      input.accessNumber
    );
    if (!numberDoc) throw notFound('アクセス番号');
    if (numberDoc.status === 'released' || numberDoc.status === 'available') {
      throw conflict('この番号は現在使用できません');
    }

    const reservation = numberDoc.reservationId
      ? await collections.reservations().get(input.tenantId, numberDoc.reservationId)
      : null;
    const customerId = reservation?.customerId ?? numberDoc.customerIds[0] ?? null;

    return {
      reservation,
      customerId,
      guestName: reservation?.guestName ?? null,
      displayName: reservation
        ? await displayName(input.tenantId, reservation)
        : await customerName(input.tenantId, customerId),
      accessNumber: numberDoc.number,
    };
  }

  // staff / vendor / event / custom / face: 顧客IDかゲスト名を直接受け取る
  if (!input.customerId && !input.guestName) {
    throw badRequest('customerId または guestName が必要です');
  }
  return {
    reservation: null,
    customerId: input.customerId ?? null,
    guestName: input.guestName ?? null,
    displayName: input.guestName ?? (await customerName(input.tenantId, input.customerId ?? null)),
    accessNumber: null,
  };
}

async function displayName(tenantId: Id, reservation: Reservation): Promise<string | null> {
  if (reservation.guestName) return reservation.guestName;
  return customerName(tenantId, reservation.customerId);
}

async function customerName(tenantId: Id, customerId: Id | null): Promise<string | null> {
  if (!customerId) return null;
  const customer = await collections.customers().get(tenantId, customerId);
  return customer?.name ?? null;
}

function buildWelcomeMessage(
  name: string | null,
  accessNumber: string | null,
  scheduledExitAt: string
): string {
  const exit = new Date(scheduledExitAt);
  const hh = String(exit.getHours()).padStart(2, '0');
  const mm = String(exit.getMinutes()).padStart(2, '0');
  const who = name ? `${name} 様、` : '';
  return `${who}受付が完了しました。番号は ${accessNumber ?? '—'} です。ご利用予定は ${hh}:${mm} までです。`;
}

// ---------------------------------------------------------------------------
// 退出
// ---------------------------------------------------------------------------

export type CheckoutInput = {
  tenantId: Id;
  storeId: Id;
  visitId?: Id;
  accessNumber?: string;
  now?: Date;
};

export type CheckoutResult = {
  visit: Visit;
  stayMinutes: number;
  /** 予定を超過していた場合の分数 */
  overdueMinutes: number;
  message: string;
};

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  const visit = await findActiveVisit(input);
  if (!visit) throw notFound('滞在中の来店');
  if (visit.status === 'exited') throw conflict('この来店は既に退出済みです');

  const updated = await collections.visits().update(input.tenantId, visit.id, {
    status: 'exited',
    actualExitAt: nowIso,
    updatedAt: nowIso,
  });
  if (!updated) throw notFound('来店');

  // 番号は即座には解放しない。保持時間を挟んでから released にする (PRD 7-3)
  if (visit.accessNumber) {
    const numberDoc = await numbers.findByNumber(
      input.tenantId,
      visit.storeId,
      visit.accessNumber
    );
    if (numberDoc) await numbers.setStatus(input.tenantId, numberDoc, 'exited');
  }

  if (visit.reservationId) {
    await collections.reservations().update(input.tenantId, visit.reservationId, {
      status: 'completed',
      updatedAt: nowIso,
    });
  }

  await notifications.cancelPendingFor(input.tenantId, visit.id);

  const stayMinutes = Math.max(
    0,
    Math.round((now.getTime() - Date.parse(visit.checkedInAt)) / 60_000)
  );
  const overdueMinutes = visit.scheduledExitAt
    ? Math.max(0, Math.round((now.getTime() - Date.parse(visit.scheduledExitAt)) / 60_000))
    : 0;

  await webhooks.emit({
    tenantId: input.tenantId,
    type: 'checkout.completed',
    data: { visit: updated, stayMinutes, overdueMinutes },
  });

  return {
    visit: updated,
    stayMinutes,
    overdueMinutes,
    message: `退出を受け付けました。ご利用時間は ${stayMinutes} 分でした。`,
  };
}

async function findActiveVisit(input: CheckoutInput): Promise<Visit | null> {
  if (input.visitId) {
    return collections.visits().get(input.tenantId, input.visitId);
  }
  if (input.accessNumber) {
    const matches = await collections
      .visits()
      .list(
        input.tenantId,
        (v) =>
          v.storeId === input.storeId &&
          v.accessNumber === input.accessNumber &&
          v.status === 'in_store'
      );
    return matches[0] ?? null;
  }
  throw badRequest('visitId または accessNumber が必要です');
}

/** 退出予定時刻の変更 (PRD 7-4)。管理画面から使う。 */
export async function updateScheduledExit(
  tenantId: Id,
  visitId: Id,
  scheduledExitAt: string
): Promise<Visit> {
  const visit = await collections.visits().get(tenantId, visitId);
  if (!visit) throw notFound('来店');

  const store = await collections.stores().get(tenantId, visit.storeId);
  if (!store) throw notFound('店舗');

  const updated = await collections.visits().update(tenantId, visitId, {
    scheduledExitAt,
    updatedAt: new Date().toISOString(),
  });
  if (!updated) throw notFound('来店');

  // 予定が動いたらリマインドも組み直す
  await notifications.cancelPendingFor(tenantId, visitId);
  await notifications.scheduleExitReminders(updated, store);

  return updated;
}

export type { Store };
