import { currentSession } from '@/lib/admin/session';
import { ready } from '@/lib/store';
import * as dashboard from '@/lib/services/dashboard';
import { Badge, Card, PageHeading, Stat, Table } from './ui';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await ready();
  const session = await currentSession();
  const data = await dashboard.build(session.tenantId, { storeIds: session.storeIds });

  return (
    <>
      <PageHeading
        title="ダッシュボード"
        description={`${new Date(data.generatedAt).toLocaleString('ja-JP')} 時点`}
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="今日の来店" value={data.totals.todayVisits} />
        <Stat label="現在滞在中" value={data.totals.inStore} />
        <Stat
          label="未退出"
          value={data.totals.notExited}
          tone={data.totals.notExited > 0 ? 'warning' : 'default'}
          hint="退出予定を過ぎている来店"
        />
        <Stat label="今日の予約" value={data.totals.todayReservations} />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-600">店舗別</h2>
        <Table
          headers={['店舗', '今日の来店', '滞在中', '未退出', '稼働率', '平均滞在', '本日の残り予約']}
          empty={data.stores.length === 0 ? '店舗が登録されていません' : undefined}
        >
          {data.stores.map((s) => (
            <tr key={s.store.id}>
              <td className="px-4 py-3 font-medium">{s.store.name}</td>
              <td className="px-4 py-3">{s.todayVisits}</td>
              <td className="px-4 py-3">{s.inStore}</td>
              <td className="px-4 py-3">
                {s.notExited > 0 ? <Badge tone="warning">{s.notExited}</Badge> : s.notExited}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-800"
                      style={{ width: `${s.utilizationPercent}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500">{s.utilizationPercent}%</span>
                </div>
              </td>
              <td className="px-4 py-3">
                {s.averageStayMinutes === null ? '—' : `${s.averageStayMinutes}分`}
              </td>
              <td className="px-4 py-3">{s.upcomingReservations}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-600">
          エラー・要対応（{data.alerts.length}）
        </h2>
        {data.alerts.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-500">対応が必要な事象はありません。</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {data.alerts.map((alert, i) => (
              <Card key={i} className="flex items-start gap-3">
                <Badge tone={alert.level === 'critical' ? 'danger' : 'warning'}>
                  {alert.level === 'critical' ? 'Critical' : 'Warning'}
                </Badge>
                <p className="text-sm">{alert.message}</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <p className="mt-8 text-xs text-slate-400">
        監視対象: API / DB / Storage / Queue / 認証 / 通知 / 外部API / 受付端末（PRD 12-4）。
        外形監視とアラート通知先の設定は運用基盤側で行います。
      </p>
    </>
  );
}
