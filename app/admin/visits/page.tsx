import { currentSession } from '@/lib/admin/session';
import { collections, ready } from '@/lib/store';
import { Badge, Card, PageHeading, Table, formatDateTime } from '../ui';
import { extendStayAction, manualCheckoutAction } from './actions';
import type { ReceptionMethod } from '@/lib/domain/types';

/**
 * 滞在・退出管理。
 *
 * 店舗スタッフが1日に何度も開く画面。「いま誰が店内にいるか」と
 * 「誰が予定を過ぎているか」が一目で分かることを最優先にする。
 *
 * 退出ボタンの押し忘れは毎日起きるので、一覧からその場で退出させられる
 * ようにしてある。放置すると番号が解放されず次の受付が詰まる。
 */

export const dynamic = 'force-dynamic';

const METHOD_LABEL: Record<ReceptionMethod, string> = {
  qr: 'QR',
  number: '番号',
  face: '顔認証',
  staff: '総合受付',
  vendor: '業者',
  event: 'イベント',
  custom: 'カスタム',
};

type Row = {
  id: string;
  storeName: string;
  customerName: string;
  accessNumber: string | null;
  method: ReceptionMethod;
  checkedInAt: string;
  scheduledExitAt: string | null;
  actualExitAt: string | null;
  stayMinutes: number;
  /** 予定に対する経過率。0-100 に丸める */
  progressPercent: number;
  overdueMinutes: number;
  exited: boolean;
};

/** 現在時刻に依存する導出はレンダー外で行う。 */
async function loadRows(tenantId: string, storeIds: string[]) {
  const now = Date.now();
  const [visits, stores, customers] = await Promise.all([
    collections.visits().list(tenantId),
    collections.stores().list(tenantId),
    collections.customers().list(tenantId),
  ]);

  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const allowed = storeIds.length ? new Set(storeIds) : null;

  const rows: Row[] = visits
    .filter((v) => !allowed || allowed.has(v.storeId))
    .sort((a, b) => Date.parse(b.checkedInAt) - Date.parse(a.checkedInAt))
    .map((v) => {
      const start = Date.parse(v.checkedInAt);
      const end = v.actualExitAt ? Date.parse(v.actualExitAt) : now;
      const planned = v.scheduledExitAt ? Date.parse(v.scheduledExitAt) : null;
      const stayMinutes = Math.max(0, Math.round((end - start) / 60_000));
      const overdueMinutes =
        !v.actualExitAt && planned ? Math.max(0, Math.round((now - planned) / 60_000)) : 0;

      // 超過していれば満杯。予定を過ぎてから受付した場合 total が負になり、
      // 「+30分超過」なのにバーが空、という食い違いが出る。
      const total = planned ? planned - start : 0;
      const progressPercent =
        overdueMinutes > 0
          ? 100
          : total > 0
            ? Math.min(100, Math.max(0, Math.round(((end - start) / total) * 100)))
            : 0;

      return {
        id: v.id,
        storeName: storeName.get(v.storeId) ?? v.storeId,
        customerName: v.guestName ?? customerName.get(v.customerId ?? '') ?? '—',
        accessNumber: v.accessNumber,
        method: v.method,
        checkedInAt: v.checkedInAt,
        scheduledExitAt: v.scheduledExitAt,
        actualExitAt: v.actualExitAt,
        stayMinutes,
        progressPercent,
        overdueMinutes,
        exited: v.status === 'exited',
      };
    });

  return {
    inStore: rows.filter((r) => !r.exited),
    exited: rows.filter((r) => r.exited).slice(0, 30),
    overdueCount: rows.filter((r) => !r.exited && r.overdueMinutes > 0).length,
  };
}

export default async function VisitsPage() {
  await ready();
  const session = await currentSession();
  const { inStore, exited, overdueCount } = await loadRows(session.tenantId, session.storeIds);

  return (
    <>
      <PageHeading
        title="滞在・退出管理"
        description="店内の利用状況と退出処理。退出の押し忘れはここから代理で処理できます。"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-slate-500">現在滞在中</p>
          <p className="mt-1 text-3xl font-semibold">{inStore.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">超過</p>
          <p
            className={`mt-1 text-3xl font-semibold ${
              overdueCount > 0 ? 'text-rose-600' : 'text-slate-900'
            }`}
          >
            {overdueCount}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">本日の退出済み</p>
          <p className="mt-1 text-3xl font-semibold">{exited.length}</p>
        </Card>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-600">滞在中</h2>
        <Table
          headers={['顧客', '番号', '受付方法', '受付 → 終了予定', '経過', '', '']}
          empty={inStore.length === 0 ? '滞在中の来店はありません' : undefined}
        >
          {inStore.map((r) => (
            <tr key={r.id} className={r.overdueMinutes > 0 ? 'bg-rose-50/40' : undefined}>
              <td className="px-4 py-3">
                <p className="font-medium">{r.customerName}</p>
                <p className="mt-0.5 text-xs text-slate-500">{r.storeName}</p>
              </td>
              <td className="px-4 py-3 font-mono text-lg">{r.accessNumber ?? '—'}</td>
              <td className="px-4 py-3 text-slate-600">{METHOD_LABEL[r.method]}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                <span className="text-slate-500">{formatDateTime(r.checkedInAt)}</span>
                <span className="mx-2 text-slate-400">→</span>
                <span
                  className={
                    r.overdueMinutes > 0 ? 'font-bold text-rose-600' : 'font-medium text-slate-900'
                  }
                >
                  {formatDateTime(r.scheduledExitAt)}
                </span>
              </td>
              <td className="px-4 py-3">
                {/* 予定に対する進み具合。超過は赤で満杯にして目を引かせる */}
                <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${
                      r.overdueMinutes > 0 ? 'bg-rose-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${r.progressPercent}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {r.overdueMinutes > 0 ? (
                    <span className="font-bold text-rose-600">+{r.overdueMinutes}分超過</span>
                  ) : (
                    `${r.stayMinutes}分経過`
                  )}
                </p>
              </td>
              <td className="px-4 py-3">
                {r.overdueMinutes > 0 && <Badge tone="warning">超過</Badge>}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <form action={extendStayAction}>
                    <input type="hidden" name="visitId" value={r.id} />
                    <input type="hidden" name="minutes" value="30" />
                    <button
                      type="submit"
                      className="rounded-lg bg-white px-3 py-1.5 text-xs text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                    >
                      +30分
                    </button>
                  </form>
                  <form action={manualCheckoutAction}>
                    <input type="hidden" name="visitId" value={r.id} />
                    <button
                      type="submit"
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                    >
                      手動退出
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-600">退出済み（直近30件）</h2>
        <Table
          headers={['顧客', '番号', '受付', '退出', '滞在']}
          empty={exited.length === 0 ? '退出済みの来店はありません' : undefined}
        >
          {exited.map((r) => (
            <tr key={r.id} className="text-slate-600">
              <td className="px-4 py-3">
                {r.customerName}
                <span className="ml-2 text-xs text-slate-400">{r.storeName}</span>
              </td>
              <td className="px-4 py-3 font-mono">{r.accessNumber ?? '—'}</td>
              <td className="px-4 py-3">{formatDateTime(r.checkedInAt)}</td>
              <td className="px-4 py-3">{formatDateTime(r.actualExitAt)}</td>
              <td className="px-4 py-3">{r.stayMinutes}分</td>
            </tr>
          ))}
        </Table>
      </section>
    </>
  );
}
