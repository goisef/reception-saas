import { currentSession } from '@/lib/admin/session';
import { collections, ready } from '@/lib/store';
import { Badge, PageHeading, Table, formatDateTime } from '../ui';
import type { ReceptionMethod } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

const METHOD_LABEL: Record<ReceptionMethod, string> = {
  qr: 'QR',
  number: '4桁番号',
  face: '顔認証',
  staff: 'スタッフ',
  vendor: '業者',
  event: 'イベント',
  custom: 'カスタム',
};

type VisitRow = {
  id: string;
  storeName: string;
  customerName: string;
  accessNumber: string | null;
  method: ReceptionMethod;
  checkedInAt: string;
  scheduledExitAt: string | null;
  actualExitAt: string | null;
  stayMinutes: number;
  exited: boolean;
  overdue: boolean;
};

/**
 * 現在時刻に依存する導出はレンダー外で行う。
 * サーバーコンポーネントの本体は同じ入力に対して同じ結果を返すようにしておく。
 */
async function loadRows(tenantId: string): Promise<VisitRow[]> {
  const now = Date.now();
  const [visits, stores, customers] = await Promise.all([
    collections.visits().list(tenantId),
    collections.stores().list(tenantId),
    collections.customers().list(tenantId),
  ]);

  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const customerName = new Map(customers.map((c) => [c.id, c.name]));

  return visits
    .sort((a, b) => Date.parse(b.checkedInAt) - Date.parse(a.checkedInAt))
    .map((v) => {
      const end = v.actualExitAt ? Date.parse(v.actualExitAt) : now;
      return {
        id: v.id,
        storeName: storeName.get(v.storeId) ?? v.storeId,
        customerName: v.guestName ?? customerName.get(v.customerId ?? '') ?? '—',
        accessNumber: v.accessNumber,
        method: v.method,
        checkedInAt: v.checkedInAt,
        scheduledExitAt: v.scheduledExitAt,
        actualExitAt: v.actualExitAt,
        stayMinutes: Math.max(0, Math.round((end - Date.parse(v.checkedInAt)) / 60_000)),
        exited: v.status === 'exited',
        overdue:
          v.status === 'in_store' &&
          v.scheduledExitAt !== null &&
          Date.parse(v.scheduledExitAt) < now,
      };
    });
}

export default async function VisitsPage() {
  await ready();
  const session = await currentSession();
  const rows = await loadRows(session.tenantId);

  return (
    <>
      <PageHeading
        title="来店・退出"
        description="退出予定を過ぎた滞在は「超過」として表示されます。退出予定時刻は API から変更できます。"
      />
      <Table
        headers={['受付', '店舗', '顧客', '番号', '受付方法', '退出予定', '退出', '滞在', '状態']}
        empty={rows.length === 0 ? '来店記録がありません' : undefined}
      >
        {rows.map((v) => (
          <tr key={v.id}>
            <td className="px-4 py-3">{formatDateTime(v.checkedInAt)}</td>
            <td className="px-4 py-3">{v.storeName}</td>
            <td className="px-4 py-3">{v.customerName}</td>
            <td className="px-4 py-3 font-mono">{v.accessNumber ?? '—'}</td>
            <td className="px-4 py-3">{METHOD_LABEL[v.method]}</td>
            <td className="px-4 py-3">{formatDateTime(v.scheduledExitAt)}</td>
            <td className="px-4 py-3">{formatDateTime(v.actualExitAt)}</td>
            <td className="px-4 py-3">{v.stayMinutes}分</td>
            <td className="px-4 py-3">
              {v.exited ? (
                <Badge>退出済み</Badge>
              ) : v.overdue ? (
                <Badge tone="warning">超過</Badge>
              ) : (
                <Badge tone="success">滞在中</Badge>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
