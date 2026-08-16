import { currentSession } from '@/lib/admin/session';
import { collections, ready } from '@/lib/store';
import * as reservations from '@/lib/services/reservations';
import { Badge, PageHeading, Table, formatDateTime } from '../ui';
import type { ReservationStatus } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<ReservationStatus, { label: string; tone: 'default' | 'success' | 'warning' | 'danger' }> = {
  booked: { label: '予約済み', tone: 'default' },
  checked_in: { label: '受付済み', tone: 'success' },
  completed: { label: '完了', tone: 'default' },
  cancelled: { label: 'キャンセル', tone: 'danger' },
  no_show: { label: '無断キャンセル', tone: 'danger' },
};

export default async function ReservationsPage() {
  await ready();
  const session = await currentSession();

  const [rows, stores, customers] = await Promise.all([
    reservations.list(session.tenantId),
    collections.stores().list(session.tenantId),
    collections.customers().list(session.tenantId),
  ]);

  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const customerName = new Map(customers.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeading
        title="予約"
        description="外部の予約システムやCRMからAPI経由で登録された予約もここに集約されます。"
      />
      <Table
        headers={['開始', '終了', '店舗', '顧客', '番号', '状態', '登録経路']}
        empty={rows.length === 0 ? '予約がありません' : undefined}
      >
        {rows.map((r) => {
          const status = STATUS_LABEL[r.status];
          return (
            <tr key={r.id}>
              <td className="px-4 py-3">{formatDateTime(r.startAt)}</td>
              <td className="px-4 py-3">{formatDateTime(r.endAt)}</td>
              <td className="px-4 py-3">{storeName.get(r.storeId) ?? r.storeId}</td>
              <td className="px-4 py-3">
                {r.guestName ?? customerName.get(r.customerId ?? '') ?? '—'}
              </td>
              <td className="px-4 py-3 font-mono">{r.accessNumber ?? '—'}</td>
              <td className="px-4 py-3">
                <Badge tone={status.tone}>{status.label}</Badge>
              </td>
              <td className="px-4 py-3 text-slate-500">{r.source}</td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
