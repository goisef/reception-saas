import type { AccessNumber, AccessNumberStatus, IsoDateTime, Store } from './types';

/**
 * 4桁アクセス番号のライフサイクル (PRD 7-3)。
 *
 * ここには I/O を書かない。純粋関数だけにして、状態遷移の正しさを
 * データストア抜きでテストできるようにしている。
 */

/** 各状態から遷移してよい先。ここに無い遷移は不正として弾く。 */
const ALLOWED: Record<AccessNumberStatus, AccessNumberStatus[]> = {
  available: ['reserved', 'checked_in', 'locked'],
  // 予約したが来なかった場合に expired / released へ落ちる
  reserved: ['checked_in', 'expired', 'released', 'locked'],
  checked_in: ['in_use', 'exited', 'released', 'locked'],
  in_use: ['exited', 'expired', 'locked'],
  // 退出直後は保持時間があるため、released へ落ちるまで再利用しない。
  // reserved へ戻るのは固定番号(pinned)の再確保だけ (rehold 参照)。
  exited: ['released', 'reserved', 'locked'],
  expired: ['released', 'available', 'locked'],
  // 解放後は再度払い出し可能
  released: ['available', 'reserved', 'checked_in', 'locked'],
  // 管理者が明示的に停止した番号。解除するまで受付には使えない
  locked: ['available', 'reserved', 'released'],
};

export function canTransition(from: AccessNumberStatus, to: AccessNumberStatus): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

/** 既に誰にも割り当てられていない状態か。解放操作は不要。 */
export function isFree(status: AccessNumberStatus): boolean {
  return status === 'available' || status === 'released';
}

/**
 * released へ到達するまでに踏むべき状態の列を返す。
 *
 * 退出せずに放置された番号（`in_use` のまま予定終了+猶予を過ぎたもの）は
 * `released` へ直接遷移できない。一度 `expired` を挟むことで、
 * 「退出して解放された」のか「放置されて期限切れになった」のかを
 * 履歴と帳票から区別できるようにしている。
 *
 * 空配列は「解放の必要がない（既に空き）」を意味する。
 * 解放できない状態は存在しない — locked も管理者操作で released にできる。
 */
export function releasePath(from: AccessNumberStatus): AccessNumberStatus[] {
  if (isFree(from)) return [];
  if (canTransition(from, 'released')) return ['released'];
  if (canTransition(from, 'expired') && canTransition('expired', 'released')) {
    return ['expired', 'released'];
  }
  return [];
}

export class InvalidNumberTransition extends Error {
  constructor(
    readonly from: AccessNumberStatus,
    readonly to: AccessNumberStatus
  ) {
    super(`番号の状態を ${from} から ${to} へ変更できません`);
    this.name = 'InvalidNumberTransition';
  }
}

export function transition(
  number: AccessNumber,
  to: AccessNumberStatus,
  now: IsoDateTime,
  patch: Partial<AccessNumber> = {}
): AccessNumber {
  if (!canTransition(number.status, to)) {
    throw new InvalidNumberTransition(number.status, to);
  }
  return {
    ...number,
    ...patch,
    status: to,
    // 退出時刻は保持時間の起点になるので、exited への遷移でのみ更新する
    exitedAt: to === 'exited' ? now : patch.exitedAt ?? number.exitedAt,
    updatedAt: now,
  };
}

/** 受付に使える状態か。払い出し候補の判定に使う。 */
export function isAssignable(n: AccessNumber): boolean {
  return n.status === 'available' || n.status === 'released';
}

/** 現在滞在中を意味する状態か。 */
export function isOccupied(n: AccessNumber): boolean {
  return n.status === 'reserved' || n.status === 'checked_in' || n.status === 'in_use';
}

// ---------------------------------------------------------------------------
// 解放判定 (PRD 7-3「番号解放条件」)
// ---------------------------------------------------------------------------

export type ReleaseReason =
  | 'exited_hold_elapsed'
  | 'cancelled'
  | 'no_show'
  | 'scheduled_end_timeout'
  | 'manual';

export type ReleaseDecision = { release: false } | { release: true; reason: ReleaseReason };

/**
 * 自動解放してよいかを判定する。
 *
 * 退出済みを最優先しつつ、保持時間を必ず挟む。固定番号(pinned)と locked は
 * 自動解放の対象外。手動解放だけが例外。
 */
export function evaluateRelease(
  number: AccessNumber,
  store: Pick<Store, 'numberHoldMinutes'>,
  context: {
    now: Date;
    /** 紐付く予約の状態。No-show / キャンセル判定に使う */
    reservationStatus?: 'booked' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';
    /** 予約の終了予定時刻 */
    scheduledEndAt?: IsoDateTime | null;
    /** 予定終了からこの分数を過ぎたら解放する */
    graceMinutes?: number;
  }
): ReleaseDecision {
  if (number.pinned || number.status === 'locked') return { release: false };
  if (number.status === 'released' || number.status === 'available') return { release: false };

  const nowMs = context.now.getTime();

  // 1. 退出済み + 保持時間経過（最優先）
  if (number.status === 'exited' && number.exitedAt) {
    const elapsedMs = nowMs - Date.parse(number.exitedAt);
    if (elapsedMs >= store.numberHoldMinutes * 60_000) {
      return { release: true, reason: 'exited_hold_elapsed' };
    }
    // 保持時間内は、他の条件に当てはまっても解放しない
    return { release: false };
  }

  // 2. キャンセル / 3. No-show
  if (context.reservationStatus === 'cancelled') return { release: true, reason: 'cancelled' };
  if (context.reservationStatus === 'no_show') return { release: true, reason: 'no_show' };

  // 4. 予定終了 + timeout
  if (context.scheduledEndAt) {
    const graceMs = (context.graceMinutes ?? store.numberHoldMinutes) * 60_000;
    if (nowMs >= Date.parse(context.scheduledEndAt) + graceMs) {
      return { release: true, reason: 'scheduled_end_timeout' };
    }
  }

  // 5. 時間指定確保の期限切れ
  if (number.holdUntil && nowMs >= Date.parse(number.holdUntil)) {
    return { release: true, reason: 'scheduled_end_timeout' };
  }

  return { release: false };
}

/**
 * 固定番号(VIP・特定会員)の再確保判定。
 *
 * 固定番号は解放しない代わりに、退出後は「その人のための予約済み番号」へ
 * 戻す必要がある。戻さないと exited のまま滞留し、次回その人が来店しても
 * 使えなくなる。保持時間は通常の解放と同じ基準で待つ。
 */
export function shouldRehold(
  number: AccessNumber,
  store: Pick<Store, 'numberHoldMinutes'>,
  now: Date
): boolean {
  if (!number.pinned) return false;
  if (number.status !== 'exited' || !number.exitedAt) return false;
  return now.getTime() - Date.parse(number.exitedAt) >= store.numberHoldMinutes * 60_000;
}

// ---------------------------------------------------------------------------
// 払い出し
// ---------------------------------------------------------------------------

export const NUMBER_MIN = 0;
export const NUMBER_MAX = 9999;

/**
 * 自動払い出しは4桁。来店客が読み上げ・入力する回数が最も多く、
 * 桁が増えるほど受付が遅くなるため、通常の予約用途では伸ばさない。
 */
export const GENERATED_NUMBER_LENGTH = 4;

/**
 * 受け付ける桁数の範囲 (PRD v3.0 モックアップ: 4〜6桁)。
 *
 * VIPの固定番号や全店舗共通番号は、他と衝突しにくくするために
 * 5〜6桁を手動で割り当てることがある。入力側はこれを受け入れる必要がある。
 */
export const NUMBER_MIN_LENGTH = 4;
export const NUMBER_MAX_LENGTH = 6;

export function formatNumber(value: number): string {
  return String(value).padStart(GENERATED_NUMBER_LENGTH, '0');
}

export function isValidNumber(value: string): boolean {
  return new RegExp(`^\\d{${NUMBER_MIN_LENGTH},${NUMBER_MAX_LENGTH}}$`).test(value);
}

/**
 * 使用中でない4桁番号を選ぶ。
 *
 * 直近まで使われていた番号を即座に再利用すると、前の利用者が誤って入力して
 * 他人の受付に紐付く事故が起きる。そのため「最後に解放されてから最も時間が
 * 経っている番号」を優先する。
 */
export function pickAvailableNumber(
  existing: AccessNumber[],
  options: { random?: () => number } = {}
): string | null {
  const taken = new Map<string, AccessNumber>();
  for (const n of existing) taken.set(n.number, n);

  const reusable: AccessNumber[] = [];
  const free: string[] = [];

  for (let i = NUMBER_MIN; i <= NUMBER_MAX; i += 1) {
    const candidate = formatNumber(i);
    const record = taken.get(candidate);
    if (!record) {
      free.push(candidate);
      continue;
    }
    if (isAssignable(record)) reusable.push(record);
  }

  // 未発行の番号があればそこから無作為に選ぶ（連番の推測を難しくする）
  if (free.length > 0) {
    const rnd = options.random ?? Math.random;
    return free[Math.floor(rnd() * free.length)];
  }

  if (reusable.length === 0) return null;

  // 解放が古い順（= 最も長く使われていない番号）
  reusable.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  return reusable[0].number;
}
