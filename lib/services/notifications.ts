import { newId } from '../core/ids';
import { collections } from '../store';
import type {
  Id,
  NotificationChannel,
  NotificationKind,
  NotificationRecord,
  Store,
  Visit,
} from '../domain/types';

/**
 * 退出通知・障害通知 (PRD 7-4 / 12-4)。
 *
 * ここでは「いつ・誰に・何を送るか」を予約テーブルに書くところまでを担当する。
 * 実送信は非同期ワーカー (Cloud Tasks) が dispatchDue() を叩いて行う。
 * 受付トランザクションの中で外部送信を待たないのが重要 (原則 P-3)。
 */

/** 利用者へのリマインド (PRD 7-4)。 */
const USER_REMINDER_MINUTES = [30, 15, 10, 5];

export async function scheduleExitReminders(visit: Visit, store: Store): Promise<NotificationRecord[]> {
  if (!visit.scheduledExitAt) return [];

  const exitAt = Date.parse(visit.scheduledExitAt);
  const now = Date.now();
  const created: NotificationRecord[] = [];

  for (const minutes of USER_REMINDER_MINUTES) {
    const sendAt = exitAt - minutes * 60_000;
    // 既に過ぎているリマインドは作らない（短時間利用で全部同時に飛ぶのを防ぐ）
    if (sendAt <= now) continue;
    created.push(
      await create({
        tenantId: visit.tenantId,
        storeId: visit.storeId,
        kind: 'exit.reminder',
        channel: 'push',
        target: visit.customerId ?? visit.accessNumber ?? visit.id,
        visitId: visit.id,
        scheduledAt: new Date(sendAt).toISOString(),
        message: `ご利用終了まであと${minutes}分です。`,
      })
    );
  }

  created.push(
    await create({
      tenantId: visit.tenantId,
      storeId: visit.storeId,
      kind: 'exit.completed',
      channel: 'push',
      target: visit.customerId ?? visit.accessNumber ?? visit.id,
      visitId: visit.id,
      scheduledAt: new Date(exitAt).toISOString(),
      message: 'ご利用時間が終了しました。',
    })
  );

  // 超過。店舗側にも「未退出」として上がる
  created.push(
    await create({
      tenantId: visit.tenantId,
      storeId: visit.storeId,
      kind: 'exit.overdue',
      channel: 'push',
      target: visit.customerId ?? visit.accessNumber ?? visit.id,
      visitId: visit.id,
      scheduledAt: new Date(exitAt + 10 * 60_000).toISOString(),
      message: 'ご利用時間を超過しています。',
    })
  );

  created.push(
    await create({
      tenantId: visit.tenantId,
      storeId: visit.storeId,
      kind: 'store.not_exited',
      channel: 'slack',
      target: `store:${store.id}`,
      visitId: visit.id,
      scheduledAt: new Date(exitAt + 15 * 60_000).toISOString(),
      message: `${store.name}: 番号 ${visit.accessNumber ?? '—'} が退出予定を過ぎても退出していません。`,
    })
  );

  return created;
}

async function create(params: {
  tenantId: Id;
  storeId: Id | null;
  kind: NotificationKind;
  channel: NotificationChannel;
  target: string;
  visitId: Id | null;
  scheduledAt: string;
  message: string;
}): Promise<NotificationRecord> {
  return collections.notifications().insert({
    id: newId('ntf'),
    tenantId: params.tenantId,
    storeId: params.storeId,
    kind: params.kind,
    channel: params.channel,
    target: params.target,
    visitId: params.visitId,
    scheduledAt: params.scheduledAt,
    sentAt: null,
    status: 'scheduled',
    message: params.message,
    error: null,
    createdAt: new Date().toISOString(),
  });
}

/** 退出したら、その来店に紐づく未送信の通知は不要になる。 */
export async function cancelPendingFor(tenantId: Id, visitId: Id): Promise<number> {
  const pending = await collections
    .notifications()
    .list(tenantId, (n) => n.visitId === visitId && n.status === 'scheduled');

  for (const n of pending) {
    await collections.notifications().update(tenantId, n.id, { status: 'cancelled' });
  }
  return pending.length;
}

/** 送信期限が来た通知を返す。ワーカーがこれを取り出して実送信する。 */
export async function due(tenantId: Id, now = new Date()): Promise<NotificationRecord[]> {
  return collections
    .notifications()
    .list(
      tenantId,
      (n) => n.status === 'scheduled' && Date.parse(n.scheduledAt) <= now.getTime()
    );
}

/**
 * 実送信。チャネルごとのアダプタは未実装なので、いまは送信済みとして記録するだけ。
 * Slack / Chatwork / Google Chat / Email のアダプタは Step 4 以降で差し込む。
 */
export async function markSent(
  tenantId: Id,
  id: Id,
  result: { ok: boolean; error?: string }
): Promise<void> {
  await collections.notifications().update(tenantId, id, {
    status: result.ok ? 'sent' : 'failed',
    sentAt: result.ok ? new Date().toISOString() : null,
    error: result.error ?? null,
  });
}

/**
 * 店舗端末の疎通断を検知する (PRD 12-4)。
 * 「大阪店の受付端末が5分間サーバーと通信できていません」を作るのはここ。
 */
export async function detectOfflineDevices(
  tenantId: Id,
  options: { thresholdMinutes?: number; now?: Date } = {}
): Promise<NotificationRecord[]> {
  const threshold = options.thresholdMinutes ?? 5;
  const now = options.now ?? new Date();
  const devices = await collections.devices().list(tenantId);
  const created: NotificationRecord[] = [];

  for (const device of devices) {
    if (!device.lastSeenAt) continue;
    const silentMs = now.getTime() - Date.parse(device.lastSeenAt);
    if (silentMs < threshold * 60_000) continue;

    // 同じ端末で通知が既に立っていれば重複させない
    const existing = await collections
      .notifications()
      .list(
        tenantId,
        (n) =>
          n.kind === 'device.offline' &&
          n.target === `device:${device.id}` &&
          n.status === 'scheduled'
      );
    if (existing.length > 0) continue;

    const store = await collections.stores().get(tenantId, device.storeId);
    const minutes = Math.floor(silentMs / 60_000);
    created.push(
      await create({
        tenantId,
        storeId: device.storeId,
        kind: 'device.offline',
        channel: 'slack',
        target: `device:${device.id}`,
        visitId: null,
        scheduledAt: now.toISOString(),
        message: `${store?.name ?? device.storeId}の受付端末「${device.name}」が${minutes}分間サーバーと通信できていません。`,
      })
    );
  }

  return created;
}
