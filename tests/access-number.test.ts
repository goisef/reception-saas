import { describe, expect, it } from 'vitest';
import {
  canTransition,
  evaluateRelease,
  formatNumber,
  InvalidNumberTransition,
  isAssignable,
  pickAvailableNumber,
  shouldRehold,
  transition,
} from '@/lib/domain/access-number';
import type { AccessNumber } from '@/lib/domain/types';

const BASE_TIME = new Date('2026-08-16T10:00:00.000Z');

function number(overrides: Partial<AccessNumber> = {}): AccessNumber {
  return {
    id: 'acn_test',
    tenantId: 'ten_test',
    storeId: 'sto_test',
    number: '1234',
    status: 'available',
    customerIds: [],
    reservationId: null,
    visitId: null,
    pinned: false,
    holdFrom: null,
    holdUntil: null,
    exitedAt: null,
    createdAt: BASE_TIME.toISOString(),
    updatedAt: BASE_TIME.toISOString(),
    ...overrides,
  };
}

describe('状態遷移', () => {
  it('受付から利用中、退出、解放まで進める', () => {
    expect(canTransition('available', 'reserved')).toBe(true);
    expect(canTransition('reserved', 'checked_in')).toBe(true);
    expect(canTransition('checked_in', 'in_use')).toBe(true);
    expect(canTransition('in_use', 'exited')).toBe(true);
    expect(canTransition('exited', 'released')).toBe(true);
    expect(canTransition('released', 'reserved')).toBe(true);
  });

  it('退出済みから利用中へ戻すことはできない', () => {
    expect(canTransition('exited', 'in_use')).toBe(false);
    expect(() => transition(number({ status: 'exited' }), 'in_use', BASE_TIME.toISOString())).toThrow(
      InvalidNumberTransition
    );
  });

  it('停止中(locked)の番号は受付に使えない', () => {
    expect(canTransition('locked', 'in_use')).toBe(false);
    expect(canTransition('locked', 'checked_in')).toBe(false);
    // 解除して再確保するか、解放するかのどちらか
    expect(canTransition('locked', 'available')).toBe(true);
    expect(canTransition('locked', 'released')).toBe(true);
  });

  it('退出済みから reserved へ戻せるのは固定番号の再確保のため', () => {
    expect(canTransition('exited', 'reserved')).toBe(true);
    expect(canTransition('exited', 'checked_in')).toBe(false);
  });

  it('exited への遷移でのみ exitedAt が入る', () => {
    const now = '2026-08-16T11:00:00.000Z';
    const exited = transition(number({ status: 'in_use' }), 'exited', now);
    expect(exited.exitedAt).toBe(now);

    const released = transition(exited, 'released', '2026-08-16T11:30:00.000Z');
    // 解放しても退出時刻は保持する。監査で「いつ退出したか」を追えなくなるため
    expect(released.exitedAt).toBe(now);
  });

  it('払い出し可能なのは available と released のみ', () => {
    expect(isAssignable(number({ status: 'available' }))).toBe(true);
    expect(isAssignable(number({ status: 'released' }))).toBe(true);
    expect(isAssignable(number({ status: 'exited' }))).toBe(false);
    expect(isAssignable(number({ status: 'locked' }))).toBe(false);
  });
});

describe('解放判定', () => {
  const store = { numberHoldMinutes: 15 };

  it('退出済みでも保持時間内は解放しない', () => {
    const n = number({
      status: 'exited',
      exitedAt: '2026-08-16T10:00:00.000Z',
    });
    const decision = evaluateRelease(n, store, {
      now: new Date('2026-08-16T10:10:00.000Z'),
    });
    expect(decision.release).toBe(false);
  });

  it('保持時間を過ぎた退出済みは解放する', () => {
    const n = number({
      status: 'exited',
      exitedAt: '2026-08-16T10:00:00.000Z',
    });
    const decision = evaluateRelease(n, store, {
      now: new Date('2026-08-16T10:15:00.000Z'),
    });
    expect(decision).toEqual({ release: true, reason: 'exited_hold_elapsed' });
  });

  it('退出済みの保持時間中は、予約がキャンセルでも解放しない', () => {
    // 退出済みの優先が保持時間を飛ばす抜け道にならないことの確認
    const n = number({
      status: 'exited',
      exitedAt: '2026-08-16T10:00:00.000Z',
      reservationId: 'res_1',
    });
    const decision = evaluateRelease(n, store, {
      now: new Date('2026-08-16T10:05:00.000Z'),
      reservationStatus: 'cancelled',
    });
    expect(decision.release).toBe(false);
  });

  it('キャンセルと No-show は即解放する', () => {
    const n = number({ status: 'reserved', reservationId: 'res_1' });
    expect(
      evaluateRelease(n, store, { now: BASE_TIME, reservationStatus: 'cancelled' })
    ).toEqual({ release: true, reason: 'cancelled' });
    expect(
      evaluateRelease(n, store, { now: BASE_TIME, reservationStatus: 'no_show' })
    ).toEqual({ release: true, reason: 'no_show' });
  });

  it('予定終了 + timeout で解放する', () => {
    const n = number({ status: 'in_use', reservationId: 'res_1' });
    expect(
      evaluateRelease(n, store, {
        now: new Date('2026-08-16T11:20:00.000Z'),
        reservationStatus: 'checked_in',
        scheduledEndAt: '2026-08-16T11:00:00.000Z',
      })
    ).toEqual({ release: true, reason: 'scheduled_end_timeout' });
  });

  it('予定終了直後は猶予内なので解放しない', () => {
    const n = number({ status: 'in_use', reservationId: 'res_1' });
    expect(
      evaluateRelease(n, store, {
        now: new Date('2026-08-16T11:05:00.000Z'),
        reservationStatus: 'checked_in',
        scheduledEndAt: '2026-08-16T11:00:00.000Z',
      }).release
    ).toBe(false);
  });

  it('固定番号は自動解放の対象外', () => {
    const n = number({
      status: 'exited',
      pinned: true,
      exitedAt: '2026-08-16T09:00:00.000Z',
    });
    expect(evaluateRelease(n, store, { now: BASE_TIME }).release).toBe(false);
  });

  it('locked も自動解放の対象外', () => {
    const n = number({ status: 'locked', reservationId: 'res_1' });
    expect(
      evaluateRelease(n, store, { now: BASE_TIME, reservationStatus: 'cancelled' }).release
    ).toBe(false);
  });

  it('固定番号は保持時間経過後に再確保の対象になる', () => {
    // 解放されない代わりに exited のまま滞留すると次回使えなくなるので、
    // 同じ顧客向けの確保済み状態へ戻す
    const n = number({
      status: 'exited',
      pinned: true,
      customerIds: ['cus_vip'],
      exitedAt: '2026-08-16T09:00:00.000Z',
    });
    expect(shouldRehold(n, store, new Date('2026-08-16T09:20:00.000Z'))).toBe(true);
    expect(shouldRehold(n, store, new Date('2026-08-16T09:05:00.000Z'))).toBe(false);
  });

  it('固定でない番号は再確保の対象にならない', () => {
    const n = number({ status: 'exited', exitedAt: '2026-08-16T09:00:00.000Z' });
    expect(shouldRehold(n, store, new Date('2026-08-16T09:20:00.000Z'))).toBe(false);
  });

  it('時間指定確保の期限切れで解放する', () => {
    const n = number({ status: 'reserved', holdUntil: '2026-08-16T09:00:00.000Z' });
    expect(evaluateRelease(n, store, { now: BASE_TIME })).toEqual({
      release: true,
      reason: 'scheduled_end_timeout',
    });
  });
});

describe('払い出し', () => {
  it('4桁にゼロ埋めする', () => {
    expect(formatNumber(1)).toBe('0001');
    expect(formatNumber(9999)).toBe('9999');
  });

  it('未発行の番号から選ぶ', () => {
    const picked = pickAvailableNumber([number({ number: '1234', status: 'in_use' })], {
      random: () => 0,
    });
    expect(picked).toBe('0000');
  });

  it('未発行がなければ最も長く使われていない解放済みを選ぶ', () => {
    // 全番号を埋めたうえで、2件だけ再利用可能にする
    const all: AccessNumber[] = [];
    for (let i = 0; i <= 9999; i += 1) {
      all.push(number({ id: `acn_${i}`, number: formatNumber(i), status: 'in_use' }));
    }
    all[5000] = number({
      id: 'acn_new',
      number: '5000',
      status: 'released',
      updatedAt: '2026-08-16T09:59:00.000Z',
    });
    all[7000] = number({
      id: 'acn_old',
      number: '7000',
      status: 'released',
      updatedAt: '2026-08-16T08:00:00.000Z',
    });

    expect(pickAvailableNumber(all)).toBe('7000');
  });

  it('空きが無ければ null を返す', () => {
    const all: AccessNumber[] = [];
    for (let i = 0; i <= 9999; i += 1) {
      all.push(number({ id: `acn_${i}`, number: formatNumber(i), status: 'in_use' }));
    }
    expect(pickAvailableNumber(all)).toBeNull();
  });
});
