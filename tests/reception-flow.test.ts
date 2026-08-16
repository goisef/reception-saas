import { beforeEach, describe, expect, it } from 'vitest';
import { collections, ready } from '@/lib/store';
import {
  DEMO_STORE_OSAKA,
  DEMO_TENANT_ID,
} from '@/lib/store/seed';
import * as reception from '@/lib/services/reception';
import * as reservations from '@/lib/services/reservations';
import * as numbers from '@/lib/services/access-numbers';
import * as notifications from '@/lib/services/notifications';

/**
 * 受付 → 滞在 → 退出 → 番号解放 の一連の流れ。
 *
 * シード済みの in-memory ストアをそのまま使う。テスト間で状態が残るため、
 * 各テストは自前で予約・顧客を作ってから検証する。
 */

const T = DEMO_TENANT_ID;
const S = DEMO_STORE_OSAKA;

function inHours(h: number): string {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

beforeEach(async () => {
  await ready();
});

describe('QR受付', () => {
  it('予約のQRトークンで受付でき、番号が利用中になる', async () => {
    const reservation = await reservations.create({
      tenantId: T,
      storeId: S,
      guestName: 'QRテスト',
      startAt: inHours(0.1),
      endAt: inHours(1),
      reserveNumber: true,
    });
    expect(reservation.accessNumber).toMatch(/^\d{4}$/);

    const result = await reception.checkin({
      tenantId: T,
      storeId: S,
      method: 'qr',
      qrToken: reservation.qrToken,
    });

    expect(result.visit.status).toBe('in_store');
    expect(result.accessNumber).toBe(reservation.accessNumber);
    expect(result.message).toContain(reservation.accessNumber!);

    const numberDoc = await numbers.findByNumber(T, S, reservation.accessNumber!);
    expect(numberDoc?.status).toBe('in_use');

    const updated = await collections.reservations().get(T, reservation.id);
    expect(updated?.status).toBe('checked_in');
  });

  it('期限切れのQRは受け付けない', async () => {
    const reservation = await reservations.create({
      tenantId: T,
      storeId: S,
      guestName: '期限切れ',
      startAt: inHours(-3),
      endAt: inHours(-2),
    });
    // 予約作成時の期限は endAt + 1時間なので、既に過ぎている
    await expect(
      reception.checkin({ tenantId: T, storeId: S, method: 'qr', qrToken: reservation.qrToken })
    ).rejects.toThrowError(expect.objectContaining({ code: 'conflict' }));
  });

  it('同じ予約で二重に受付できない', async () => {
    const reservation = await reservations.create({
      tenantId: T,
      storeId: S,
      guestName: '二重受付',
      startAt: inHours(0.1),
      endAt: inHours(1),
    });

    await reception.checkin({ tenantId: T, storeId: S, method: 'qr', qrToken: reservation.qrToken });
    await expect(
      reception.checkin({ tenantId: T, storeId: S, method: 'qr', qrToken: reservation.qrToken })
    ).rejects.toThrowError(expect.objectContaining({ code: 'conflict' }));
  });
});

describe('4桁番号受付', () => {
  it('確保済みの番号で受付できる', async () => {
    const reservation = await reservations.create({
      tenantId: T,
      storeId: S,
      guestName: '番号受付',
      startAt: inHours(0.1),
      endAt: inHours(1),
      reserveNumber: true,
    });

    const result = await reception.checkin({
      tenantId: T,
      storeId: S,
      method: 'number',
      accessNumber: reservation.accessNumber!,
    });
    expect(result.visit.accessNumber).toBe(reservation.accessNumber);
  });

  it('解放済みの番号では受付できない', async () => {
    const held = await numbers.reserve({ tenantId: T, storeId: S });
    await numbers.releaseManually(T, S, held.number);

    await expect(
      reception.checkin({ tenantId: T, storeId: S, method: 'number', accessNumber: held.number })
    ).rejects.toThrowError(expect.objectContaining({ code: 'conflict' }));
  });
});

describe('オフライン同期の冪等性', () => {
  it('同じ clientEventId の再送は二重受付にならない', async () => {
    const reservation = await reservations.create({
      tenantId: T,
      storeId: S,
      guestName: 'オフライン',
      startAt: inHours(0.1),
      endAt: inHours(1),
    });

    const clientEventId = 'evt_offline_test_1';
    const first = await reception.checkin({
      tenantId: T,
      storeId: S,
      method: 'qr',
      qrToken: reservation.qrToken,
      clientEventId,
    });
    const second = await reception.checkin({
      tenantId: T,
      storeId: S,
      method: 'qr',
      qrToken: reservation.qrToken,
      clientEventId,
    });

    expect(second.duplicate).toBe(true);
    expect(second.visit.id).toBe(first.visit.id);

    const visits = await collections.visits().list(T, (v) => v.clientEventId === clientEventId);
    expect(visits).toHaveLength(1);
  });
});

describe('退出', () => {
  it('番号で退出でき、番号は exited になる（即解放しない）', async () => {
    const reservation = await reservations.create({
      tenantId: T,
      storeId: S,
      guestName: '退出テスト',
      startAt: inHours(-1),
      endAt: inHours(0.5),
      reserveNumber: true,
    });
    await reception.checkin({
      tenantId: T,
      storeId: S,
      method: 'number',
      accessNumber: reservation.accessNumber!,
    });

    const result = await reception.checkout({
      tenantId: T,
      storeId: S,
      accessNumber: reservation.accessNumber!,
    });

    expect(result.visit.status).toBe('exited');
    expect(result.visit.actualExitAt).not.toBeNull();

    // 保持時間があるので released ではなく exited で止まる
    const numberDoc = await numbers.findByNumber(T, S, reservation.accessNumber!);
    expect(numberDoc?.status).toBe('exited');

    const updatedReservation = await collections.reservations().get(T, reservation.id);
    expect(updatedReservation?.status).toBe('completed');
  });

  it('滞在していない番号では退出できない', async () => {
    await expect(
      reception.checkout({ tenantId: T, storeId: S, accessNumber: '9999' })
    ).rejects.toThrowError(expect.objectContaining({ code: 'not_found' }));
  });

  it('退出すると未送信の退出通知が取り消される', async () => {
    const reservation = await reservations.create({
      tenantId: T,
      storeId: S,
      guestName: '通知テスト',
      startAt: inHours(0.1),
      endAt: inHours(2),
      reserveNumber: true,
    });
    const checkin = await reception.checkin({
      tenantId: T,
      storeId: S,
      method: 'number',
      accessNumber: reservation.accessNumber!,
    });

    const scheduled = await collections
      .notifications()
      .list(T, (n) => n.visitId === checkin.visit.id && n.status === 'scheduled');
    expect(scheduled.length).toBeGreaterThan(0);

    await reception.checkout({
      tenantId: T,
      storeId: S,
      accessNumber: reservation.accessNumber!,
    });

    const remaining = await collections
      .notifications()
      .list(T, (n) => n.visitId === checkin.visit.id && n.status === 'scheduled');
    expect(remaining).toHaveLength(0);
  });
});

describe('番号の自動解放スイープ', () => {
  it('保持時間を過ぎた退出済み番号を解放する', async () => {
    const held = await numbers.reserve({ tenantId: T, storeId: S });
    const numberDoc = await numbers.findByNumber(T, S, held.number);

    // 保持時間(大阪店は15分)より前に退出したことにする
    await collections.accessNumbers().update(T, numberDoc!.id, {
      status: 'exited',
      exitedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    });

    const outcome = await numbers.sweepReleases(T, S);
    const released = outcome.released.find((n) => n.number === held.number);
    expect(released?.status).toBe('released');
    expect(outcome.reasons[released!.id]).toBe('exited_hold_elapsed');
  });

  it('固定番号は解放しない', async () => {
    const pinned = await numbers.reserve({
      tenantId: T,
      storeId: S,
      pinned: true,
    });
    const outcome = await numbers.sweepReleases(T, S);
    expect(outcome.released.some((n) => n.number === pinned.number)).toBe(false);
  });

  it('固定番号は退出後に同じ顧客向けへ再確保される', async () => {
    const pinned = await numbers.reserve({
      tenantId: T,
      storeId: S,
      pinned: true,
      customerIds: ['cus_sato'],
    });

    // 受付 → 退出まで進めてから、保持時間を過ぎたことにする
    await reception.checkin({
      tenantId: T,
      storeId: S,
      method: 'number',
      accessNumber: pinned.number,
    });
    await reception.checkout({ tenantId: T, storeId: S, accessNumber: pinned.number });

    const exited = await numbers.findByNumber(T, S, pinned.number);
    await collections.accessNumbers().update(T, exited!.id, {
      exitedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    });

    const outcome = await numbers.sweepReleases(T, S);
    const reheld = outcome.reheld.find((n) => n.number === pinned.number);
    expect(reheld?.status).toBe('reserved');
    expect(reheld?.customerIds).toContain('cus_sato');
    expect(outcome.released.some((n) => n.number === pinned.number)).toBe(false);
  });

  it('固定番号でも管理者は手動で解放できる', async () => {
    const pinned = await numbers.reserve({ tenantId: T, storeId: S, pinned: true });
    const released = await numbers.releaseManually(T, S, pinned.number);
    expect(released.status).toBe('released');
    expect(released.pinned).toBe(false);
  });
});

describe('Shared Number', () => {
  it('1番号に複数の顧客を紐付けられる', async () => {
    const held = await numbers.reserve({
      tenantId: T,
      storeId: S,
      customerIds: ['cus_tanaka'],
    });
    const updated = await numbers.attachCustomers(T, S, held.number, [
      'cus_tanaka_hana',
      'cus_tanaka', // 重複は無視される
    ]);
    expect(updated.customerIds).toEqual(['cus_tanaka', 'cus_tanaka_hana']);
  });
});

describe('端末の疎通監視', () => {
  it('一定時間 heartbeat が無い端末を検知する', async () => {
    const device = await collections.devices().get(T, 'dev_osaka_01');
    await collections.devices().update(T, device!.id, {
      lastSeenAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    });

    const created = await notifications.detectOfflineDevices(T, { thresholdMinutes: 5 });
    const alert = created.find((n) => n.target === 'device:dev_osaka_01');
    expect(alert).toBeDefined();
    expect(alert!.message).toContain('通信できていません');
  });
});

describe('予約', () => {
  it('endAt が startAt より前なら弾く', async () => {
    await expect(
      reservations.create({
        tenantId: T,
        storeId: S,
        guestName: '逆転',
        startAt: inHours(2),
        endAt: inHours(1),
      })
    ).rejects.toThrowError(expect.objectContaining({ code: 'bad_request' }));
  });

  it('滞在中の予約は削除できない', async () => {
    const reservation = await reservations.create({
      tenantId: T,
      storeId: S,
      guestName: '削除不可',
      startAt: inHours(0.1),
      endAt: inHours(1),
      reserveNumber: true,
    });
    await reception.checkin({
      tenantId: T,
      storeId: S,
      method: 'qr',
      qrToken: reservation.qrToken,
    });

    await expect(reservations.remove(T, reservation.id)).rejects.toThrowError(
      expect.objectContaining({ code: 'conflict' })
    );
  });
});

describe('テナント分離', () => {
  it('別テナントからは読めない', async () => {
    const reservation = await reservations.create({
      tenantId: T,
      storeId: S,
      guestName: '分離テスト',
      startAt: inHours(0.1),
      endAt: inHours(1),
    });
    expect(await collections.reservations().get('ten_other', reservation.id)).toBeNull();
    expect(await collections.reservations().list('ten_other')).toHaveLength(0);
  });
});
