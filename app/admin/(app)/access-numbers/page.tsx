import { currentSession } from '@/lib/admin/session';
import { collections, ready } from '@/lib/store';
import * as numbers from '@/lib/services/access-numbers';
import { evaluateRelease } from '@/lib/domain/access-number';
import { Badge, PageHeading, Table, formatDateTime } from '../ui';
import { releaseNumberAction, sweepAction } from './actions';
import type { AccessNumberStatus } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

const STATUS: Record<
  AccessNumberStatus,
  { label: string; tone: 'default' | 'success' | 'warning' | 'danger' }
> = {
  available: { label: '未使用', tone: 'default' },
  reserved: { label: '確保済み', tone: 'warning' },
  checked_in: { label: '受付済み', tone: 'success' },
  in_use: { label: '利用中', tone: 'success' },
  exited: { label: '退出済み', tone: 'warning' },
  expired: { label: '期限切れ', tone: 'danger' },
  released: { label: '解放済み', tone: 'default' },
  locked: { label: '停止中', tone: 'danger' },
};

export default async function AccessNumbersPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  await ready();
  const session = await currentSession();
  const { storeId } = await searchParams;

  const stores = await collections.stores().list(session.tenantId);
  const selected = storeId ?? stores[0]?.id;
  if (!selected) {
    return <PageHeading title="番号" description="店舗が登録されていません。" />;
  }

  const store = stores.find((s) => s.id === selected)!;
  const [rows, customers] = await Promise.all([
    numbers.listByStore(session.tenantId, selected),
    collections.customers().list(session.tenantId),
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const now = new Date();

  return (
    <>
      <PageHeading
        title="番号"
        description={`退出済みの番号は保持時間（${store.numberHoldMinutes}分）を過ぎてから解放されます。固定番号は自動解放の対象外です。`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {stores.map((s) => (
          <a
            key={s.id}
            href={`/admin/access-numbers?storeId=${s.id}`}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              s.id === selected ? 'bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-200'
            }`}
          >
            {s.name}
          </a>
        ))}
        <form action={sweepAction} className="ml-auto">
          <input type="hidden" name="storeId" value={selected} />
          <button
            type="submit"
            className="rounded-lg bg-white px-4 py-1.5 text-sm ring-1 ring-slate-300 hover:bg-slate-50"
          >
            解放スイープを実行
          </button>
        </form>
      </div>

      <Table
        headers={['番号', '状態', '紐付け顧客', '退出日時', '自動解放', '更新', '']}
        empty={rows.length === 0 ? 'この店舗で発行された番号はまだありません' : undefined}
      >
        {rows.map((n) => {
          const status = STATUS[n.status];
          const decision = evaluateRelease(n, store, { now });
          return (
            <tr key={n.id}>
              <td className="px-4 py-3 font-mono text-lg">{n.number}</td>
              <td className="px-4 py-3">
                <Badge tone={status.tone}>{status.label}</Badge>
                {n.pinned && <span className="ml-2 text-xs text-slate-400">固定</span>}
              </td>
              <td className="px-4 py-3">
                {n.customerIds.length === 0
                  ? '—'
                  : n.customerIds.map((id) => customerName.get(id) ?? id).join(' / ')}
              </td>
              <td className="px-4 py-3">{formatDateTime(n.exitedAt)}</td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {decision.release ? `対象（${decision.reason}）` : '対象外'}
              </td>
              <td className="px-4 py-3">{formatDateTime(n.updatedAt)}</td>
              <td className="px-4 py-3 text-right">
                <form action={releaseNumberAction}>
                  <input type="hidden" name="storeId" value={selected} />
                  <input type="hidden" name="number" value={n.number} />
                  <button
                    type="submit"
                    className="rounded-lg px-3 py-1 text-xs text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
                  >
                    手動解放
                  </button>
                </form>
              </td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
