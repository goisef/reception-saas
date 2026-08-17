import { conflict, notFound } from '../core/errors';
import { newId } from '../core/ids';
import { collections, datastore } from '../store';
import {
  evaluateRelease,
  InvalidNumberTransition,
  isFree,
  pickAvailableNumber,
  releasePath,
  shouldRehold,
  transition as applyTransition,
  type ReleaseReason,
} from '../domain/access-number';
import type { AccessNumber, AccessNumberStatus, Id, Store } from '../domain/types';
import * as webhooks from './webhooks';

/**
 * 4桁アクセス番号のリポジトリ + ユースケース (PRD 7-3)。
 *
 * 払い出しと解放は read-modify-write なので、必ず店舗単位のロックで直列化する。
 * 同じ番号が2人に払い出されると、受付が別人に紐付く事故になる。
 */

function lockKey(storeId: Id): string {
  return `access_numbers:${storeId}`;
}

/**
 * ドメイン層の遷移エラーを HTTP の 409 に翻訳する。
 * 状態機械は HTTP を知らないので、変換はサービス層で行う。
 */
function transition(
  ...args: Parameters<typeof applyTransition>
): ReturnType<typeof applyTransition> {
  try {
    return applyTransition(...args);
  } catch (error) {
    if (error instanceof InvalidNumberTransition) throw conflict(error.message);
    throw error;
  }
}

export async function listByStore(tenantId: Id, storeId: Id): Promise<AccessNumber[]> {
  const all = await collections.accessNumbers().list(tenantId, (n) => n.storeId === storeId);
  return all.sort((a, b) => a.number.localeCompare(b.number));
}

export async function findByNumber(
  tenantId: Id,
  storeId: Id,
  number: string
): Promise<AccessNumber | null> {
  const matches = await collections
    .accessNumbers()
    .list(tenantId, (n) => n.storeId === storeId && n.number === number);
  return matches[0] ?? null;
}

/**
 * 番号を確保する (PRD 7-3「番号確保」)。
 *
 * `number` を指定すればその番号を、省略すれば空き番号を払い出す。
 */
export async function reserve(params: {
  tenantId: Id;
  storeId: Id;
  number?: string;
  customerIds?: Id[];
  reservationId?: Id | null;
  pinned?: boolean;
  holdFrom?: string | null;
  holdUntil?: string | null;
}): Promise<AccessNumber> {
  const { tenantId, storeId } = params;

  return datastore().withLock(lockKey(storeId), async () => {
    const existing = await listByStore(tenantId, storeId);
    const now = new Date().toISOString();

    let target = params.number
      ? existing.find((n) => n.number === params.number) ?? null
      : null;

    if (params.number && target && !canReuse(target)) {
      throw conflict(`番号 ${params.number} は現在使用中です`);
    }

    const numberValue =
      params.number ?? pickAvailableNumber(existing);
    if (!numberValue) {
      throw conflict('割り当て可能な番号が残っていません');
    }
    target = existing.find((n) => n.number === numberValue) ?? null;

    const patch = {
      customerIds: params.customerIds ?? [],
      reservationId: params.reservationId ?? null,
      visitId: null,
      pinned: params.pinned ?? false,
      holdFrom: params.holdFrom ?? null,
      holdUntil: params.holdUntil ?? null,
      exitedAt: null,
    };

    // pinned は「自動解放しない」という属性であって状態ではない。
    // 固定番号も受付には使うので、状態は通常どおり reserved にする。
    let saved: AccessNumber;
    if (target) {
      const next = transition(target, 'reserved', now, patch);
      saved =
        (await collections.accessNumbers().update(tenantId, target.id, next)) ??
        (await collections.accessNumbers().insert(next));
    } else {
      saved = await collections.accessNumbers().insert({
        id: newId('acn'),
        tenantId,
        storeId,
        number: numberValue,
        status: 'reserved',
        createdAt: now,
        updatedAt: now,
        ...patch,
      });
    }

    await webhooks.emit({
      tenantId,
      type: 'access_number.reserved',
      data: { accessNumber: saved },
    });

    return saved;
  });
}

function canReuse(n: AccessNumber): boolean {
  return n.status === 'available' || n.status === 'released';
}

/** 状態遷移を1件だけ行う。受付・退出のユースケースから呼ばれる。 */
export async function setStatus(
  tenantId: Id,
  numberDoc: AccessNumber,
  status: AccessNumberStatus,
  patch: Partial<AccessNumber> = {}
): Promise<AccessNumber> {
  const now = new Date().toISOString();
  const next = transition(numberDoc, status, now, patch);
  const saved = await collections.accessNumbers().update(tenantId, numberDoc.id, next);
  if (!saved) throw notFound('アクセス番号');
  return saved;
}

/**
 * 受付完了 → 滞在中。
 *
 * PRD は checked_in（受付完了）と in_use（滞在中）を別状態として持つ。
 * 現行の受付フローでは受付と同時に滞在が始まるので、2段の遷移を続けて適用する。
 * 「受付だけして後から入場する」フローが出てきたときに分離できるよう、
 * 状態機械側は2状態のまま残してある。
 */
export async function markInUse(
  tenantId: Id,
  numberDoc: AccessNumber,
  patch: Partial<AccessNumber> = {}
): Promise<AccessNumber> {
  const now = new Date().toISOString();
  let next = numberDoc;
  if (next.status !== 'checked_in' && next.status !== 'in_use') {
    next = transition(next, 'checked_in', now, patch);
  }
  next = transition(next, 'in_use', now, patch);

  const saved = await collections.accessNumbers().update(tenantId, numberDoc.id, next);
  if (!saved) throw notFound('アクセス番号');
  return saved;
}

/**
 * 番号を released まで進める。
 *
 * 退出せずに放置された番号は `in_use` のままなので、`released` へ直接は
 * 遷移できない。`expired` を経由させる（PRD 7-3 の状態一覧に `expired` が
 * あるのはこのため）。経路の判断はドメイン層の releasePath に委ねる。
 */
export async function release(
  tenantId: Id,
  numberDoc: AccessNumber,
  patch: Partial<AccessNumber> = {}
): Promise<AccessNumber> {
  const path = releasePath(numberDoc.status);
  if (path.length === 0) {
    // 既に空き。解放は冪等な操作なので、エラーにせずそのまま返す。
    // スイープが同じ番号を二度拾っても失敗扱いにしないため。
    if (isFree(numberDoc.status)) return numberDoc;
    throw conflict(`番号 ${numberDoc.number} は ${numberDoc.status} のため解放できません`);
  }

  const now = new Date().toISOString();
  let next = numberDoc;
  for (const status of path) {
    next = transition(next, status, now, patch);
  }

  const saved = await collections.accessNumbers().update(tenantId, numberDoc.id, next);
  if (!saved) throw notFound('アクセス番号');
  return saved;
}

export type ReleaseOutcome = {
  released: AccessNumber[];
  /** 固定番号を同じ顧客向けに再確保したもの。解放とは区別する */
  reheld: AccessNumber[];
  reasons: Record<Id, ReleaseReason>;
  /** 処理できなかった番号。1件の失敗で全体を止めないため個別に記録する */
  failures: { number: string; error: string }[];
};

/**
 * 自動解放スイープ (PRD 7-3「番号解放条件」)。
 * Cloud Scheduler から定期的に叩く想定。
 */
export async function sweepReleases(
  tenantId: Id,
  storeId: Id,
  options: { now?: Date } = {}
): Promise<ReleaseOutcome> {
  const now = options.now ?? new Date();
  const store = await collections.stores().get(tenantId, storeId);
  if (!store) throw notFound('店舗');

  return datastore().withLock(lockKey(storeId), async () => {
    const numbers = await listByStore(tenantId, storeId);
    const outcome: ReleaseOutcome = { released: [], reheld: [], reasons: {}, failures: [] };

    for (const number of numbers) {
      // 1件の番号でつまずいても残りは処理する。スイープは定期実行の
      // バッチなので、1つの異常データで店舗全体の解放が止まると
      // 番号が枯渇して受付できなくなる。
      try {
        // 固定番号は解放せず、同じ顧客向けの確保済み状態へ戻す
        if (shouldRehold(number, store, now)) {
          outcome.reheld.push(
            await setStatus(tenantId, number, 'reserved', { visitId: null, exitedAt: null })
          );
          continue;
        }

        const reservation = number.reservationId
          ? await collections.reservations().get(tenantId, number.reservationId)
          : null;

        const decision = evaluateRelease(number, store, {
          now,
          reservationStatus: reservation?.status,
          scheduledEndAt: reservation?.endAt ?? null,
        });
        if (!decision.release) continue;

        const released = await release(tenantId, number, {
          customerIds: [],
          reservationId: null,
          visitId: null,
        });
        outcome.released.push(released);
        outcome.reasons[released.id] = decision.reason;

        await webhooks.emit({
          tenantId,
          type: 'access_number.released',
          data: { accessNumber: released, reason: decision.reason },
        });
      } catch (error) {
        outcome.failures.push({
          number: number.number,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return outcome;
  });
}

/** 管理者による手動解放。固定番号でも解放できる唯一の経路。 */
export async function releaseManually(
  tenantId: Id,
  storeId: Id,
  numberValue: string
): Promise<AccessNumber> {
  return datastore().withLock(lockKey(storeId), async () => {
    const number = await findByNumber(tenantId, storeId, numberValue);
    if (!number) throw notFound('アクセス番号');

    // 手動解放は固定番号・停止中の番号も対象にする。管理者の明示操作なので、
    // pinned フラグも落として通常の番号に戻す。
    // 滞在中(in_use)の番号も対象になるため、release() で expired を経由させる。
    const released = await release(tenantId, number, {
      customerIds: [],
      reservationId: null,
      visitId: null,
      pinned: false,
    });

    await webhooks.emit({
      tenantId,
      type: 'access_number.released',
      data: { accessNumber: released, reason: 'manual' },
    });

    return released;
  });
}

/** Shared Number: 1番号に人を追加する (PRD 7-3)。 */
export async function attachCustomers(
  tenantId: Id,
  storeId: Id,
  numberValue: string,
  customerIds: Id[]
): Promise<AccessNumber> {
  const number = await findByNumber(tenantId, storeId, numberValue);
  if (!number) throw notFound('アクセス番号');

  const merged = [...new Set([...number.customerIds, ...customerIds])];
  const saved = await collections.accessNumbers().update(tenantId, number.id, {
    customerIds: merged,
    updatedAt: new Date().toISOString(),
  });
  if (!saved) throw notFound('アクセス番号');
  return saved;
}

export type { Store };
