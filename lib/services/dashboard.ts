import { collections } from '../store';
import type { Id, Store, Visit } from '../domain/types';

/**
 * ダッシュボード集計 (PRD 14-1)。
 *
 * 今日の来店 / 現在滞在中 / 未退出 / 予約 / 稼働率 / エラー。
 * 件数が増えたら BigQuery 側へ寄せる (PRD 13-6) が、
 * 集計の定義そのものはここを正とする。
 */

export type StoreSummary = {
  store: Store;
  todayVisits: number;
  inStore: number;
  /** 退出予定を過ぎているのに退出していない人数 */
  notExited: number;
  upcomingReservations: number;
  /** 滞在中 ÷ 収容数 */
  utilizationPercent: number;
  averageStayMinutes: number | null;
};

export type DashboardData = {
  generatedAt: string;
  totals: {
    todayVisits: number;
    inStore: number;
    notExited: number;
    todayReservations: number;
    offlineDevices: number;
    failedWebhooks: number;
    failedExports: number;
  };
  stores: StoreSummary[];
  /** 対応が必要なもの。ダッシュボードの「エラー」欄 */
  alerts: { level: 'warning' | 'critical'; message: string }[];
};

function startOfToday(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function stayMinutes(visit: Visit, now: number): number {
  const end = visit.actualExitAt ? Date.parse(visit.actualExitAt) : now;
  return Math.max(0, Math.round((end - Date.parse(visit.checkedInAt)) / 60_000));
}

export async function build(
  tenantId: Id,
  options: { now?: Date; storeIds?: Id[] } = {}
): Promise<DashboardData> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const dayStart = startOfToday(now);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  const allowed = options.storeIds?.length ? new Set(options.storeIds) : null;
  const inScope = (storeId: Id) => !allowed || allowed.has(storeId);

  const [stores, visits, reservations, devices, deliveries, exports] = await Promise.all([
    collections.stores().list(tenantId, (s) => inScope(s.id)),
    collections.visits().list(tenantId, (v) => inScope(v.storeId)),
    collections.reservations().list(tenantId, (r) => inScope(r.storeId)),
    collections.devices().list(tenantId, (d) => inScope(d.storeId)),
    collections.webhookDeliveries().list(tenantId),
    collections.exportJobs().list(tenantId),
  ]);

  const alerts: DashboardData['alerts'] = [];

  const summaries: StoreSummary[] = stores.map((store) => {
    const storeVisits = visits.filter((v) => v.storeId === store.id);
    const today = storeVisits.filter((v) => {
      const ms = Date.parse(v.checkedInAt);
      return ms >= dayStart && ms < dayEnd;
    });
    const inStore = storeVisits.filter((v) => v.status === 'in_store');
    const notExited = inStore.filter(
      (v) => v.scheduledExitAt && Date.parse(v.scheduledExitAt) < nowMs
    );

    const finishedToday = today.filter((v) => v.actualExitAt);
    const average = finishedToday.length
      ? Math.round(
          finishedToday.reduce((sum, v) => sum + stayMinutes(v, nowMs), 0) / finishedToday.length
        )
      : null;

    if (notExited.length > 0) {
      alerts.push({
        level: 'warning',
        message: `${store.name}: 退出予定を過ぎている来店が ${notExited.length} 件あります`,
      });
    }

    return {
      store,
      todayVisits: today.length,
      inStore: inStore.length,
      notExited: notExited.length,
      upcomingReservations: reservations.filter(
        (r) =>
          r.storeId === store.id &&
          r.status === 'booked' &&
          Date.parse(r.startAt) >= nowMs &&
          Date.parse(r.startAt) < dayEnd
      ).length,
      utilizationPercent: store.capacity
        ? Math.min(100, Math.round((inStore.length / store.capacity) * 100))
        : 0,
      averageStayMinutes: average,
    };
  });

  const offlineDevices = devices.filter(
    (d) => !d.lastSeenAt || nowMs - Date.parse(d.lastSeenAt) >= 5 * 60_000
  );
  for (const device of offlineDevices) {
    const store = stores.find((s) => s.id === device.storeId);
    const minutes = device.lastSeenAt
      ? Math.floor((nowMs - Date.parse(device.lastSeenAt)) / 60_000)
      : null;
    alerts.push({
      level: 'critical',
      message: `${store?.name ?? device.storeId}の受付端末「${device.name}」が${
        minutes === null ? '一度も' : `${minutes}分間`
      }サーバーと通信できていません`,
    });
  }

  const deadDeliveries = deliveries.filter((d) => d.status === 'dead');
  if (deadDeliveries.length > 0) {
    alerts.push({
      level: 'warning',
      message: `Webhook の配信に失敗し再試行を打ち切った通知が ${deadDeliveries.length} 件あります`,
    });
  }

  const failedExports = exports.filter((e) => e.status === 'failed');
  if (failedExports.length > 0) {
    alerts.push({
      level: 'warning',
      message: `失敗したエクスポートが ${failedExports.length} 件あります`,
    });
  }

  return {
    generatedAt: now.toISOString(),
    totals: {
      todayVisits: summaries.reduce((sum, s) => sum + s.todayVisits, 0),
      inStore: summaries.reduce((sum, s) => sum + s.inStore, 0),
      notExited: summaries.reduce((sum, s) => sum + s.notExited, 0),
      todayReservations: reservations.filter((r) => {
        const ms = Date.parse(r.startAt);
        return ms >= dayStart && ms < dayEnd;
      }).length,
      offlineDevices: offlineDevices.length,
      failedWebhooks: deadDeliveries.length,
      failedExports: failedExports.length,
    },
    stores: summaries,
    alerts,
  };
}
