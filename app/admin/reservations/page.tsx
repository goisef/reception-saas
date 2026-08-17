import Link from 'next/link';
import { currentSession } from '@/lib/admin/session';
import { collections, ready } from '@/lib/store';
import * as reservations from '@/lib/services/reservations';
import { Badge, Card, PageHeading, Table, formatDateTime } from '../ui';
import type { Reservation, ReservationStatus } from '@/lib/domain/types';

/**
 * 予約一覧。
 *
 * スタッフが1日に何度も開く。「今日この後だれが来るか」を確認する用途が
 * 大半なので、既定は今日・時刻順にする。日付を選び直す手間を無くす。
 */

export const dynamic = 'force-dynamic';

const STATUS: Record<
  ReservationStatus,
  { label: string; tone: 'default' | 'success' | 'warning' | 'danger' }
> = {
  booked: { label: '予約済み', tone: 'default' },
  checked_in: { label: '受付済み', tone: 'success' },
  completed: { label: '完了', tone: 'default' },
  cancelled: { label: 'キャンセル', tone: 'danger' },
  no_show: { label: '無断キャンセル', tone: 'danger' },
};

/** YYYY-MM-DD をローカル日付として解釈する。UTC 解釈だと日本時間で1日ずれる。 */
function parseDate(value: string | undefined): Date {
  const now = new Date();
  if (!value) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(y, m - 1, d);
}

function toInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function load(
  tenantId: string,
  storeIds: string[],
  day: Date,
  filters: { storeId?: string; status?: ReservationStatus; q?: string }
) {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

  const [rows, stores, customers] = await Promise.all([
    reservations.list(tenantId, {
      storeId: filters.storeId,
      status: filters.status,
      from: from.toISOString(),
      to: to.toISOString(),
    }),
    collections.stores().list(tenantId),
    collections.customers().list(tenantId),
  ]);

  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const allowed = storeIds.length ? new Set(storeIds) : null;
  const q = filters.q?.trim().toLowerCase();

  const nameOf = (r: Reservation) =>
    r.guestName ?? customerName.get(r.customerId ?? '') ?? '';

  const visible = rows
    .filter((r) => !allowed || allowed.has(r.storeId))
    .filter((r) => {
      if (!q) return true;
      return (
        nameOf(r).toLowerCase().includes(q) ||
        (r.accessNumber ?? '').includes(q)
      );
    });

  return {
    stores,
    rows: visible.map((r) => ({
      id: r.id,
      storeName: storeName.get(r.storeId) ?? r.storeId,
      customerName: nameOf(r) || '—',
      status: r.status,
      startAt: r.startAt,
      endAt: r.endAt,
      accessNumber: r.accessNumber,
      source: r.source,
      note: r.note,
    })),
    summary: {
      total: visible.length,
      booked: visible.filter((r) => r.status === 'booked').length,
      checkedIn: visible.filter((r) => r.status === 'checked_in').length,
      absent: visible.filter((r) => r.status === 'cancelled' || r.status === 'no_show').length,
    },
  };
}

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; storeId?: string; status?: string; q?: string }>;
}) {
  await ready();
  const session = await currentSession();
  const params = await searchParams;

  const day = parseDate(params.date);
  const { stores, rows, summary } = await load(session.tenantId, session.storeIds, day, {
    storeId: params.storeId || undefined,
    status: (params.status as ReservationStatus) || undefined,
    q: params.q,
  });

  const linkFor = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({
      date: toInputValue(day),
      ...(params.storeId ? { storeId: params.storeId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.q ? { q: params.q } : {}),
      ...overrides,
    });
    return `/admin/reservations?${next.toString()}`;
  };

  return (
    <>
      <PageHeading
        title="予約"
        description="外部の予約システムやCRMからAPI経由で登録された予約もここに集約されます。"
      />

      {/* 日付の移動。前日・翌日・今日は1クリックで届くようにする */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={linkFor({ date: toInputValue(shiftDays(day, -1)) })}
          className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50"
        >
          ← 前日
        </Link>
        <form className="flex items-center gap-2">
          {params.storeId && <input type="hidden" name="storeId" value={params.storeId} />}
          {params.status && <input type="hidden" name="status" value={params.status} />}
          {params.q && <input type="hidden" name="q" value={params.q} />}
          <input
            type="date"
            name="date"
            defaultValue={toInputValue(day)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
          >
            表示
          </button>
        </form>
        <Link
          href={linkFor({ date: toInputValue(shiftDays(day, 1)) })}
          className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50"
        >
          翌日 →
        </Link>
        <Link href="/admin/reservations" className="ml-1 text-sm text-slate-600 underline">
          今日に戻る
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-slate-500">この日の予約</p>
          <p className="mt-1 text-2xl font-semibold">{summary.total}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">未受付</p>
          <p className="mt-1 text-2xl font-semibold">{summary.booked}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">受付済み</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-600">{summary.checkedIn}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">キャンセル / No-show</p>
          <p className="mt-1 text-2xl font-semibold text-rose-600">{summary.absent}</p>
        </Card>
      </div>

      <form className="mb-4 flex flex-wrap gap-2">
        <input type="hidden" name="date" value={toInputValue(day)} />
        <input
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="氏名・番号で検索"
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          name="storeId"
          defaultValue={params.storeId ?? ''}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">すべての店舗</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={params.status ?? ''}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">すべての状態</option>
          {Object.entries(STATUS).map(([value, s]) => (
            <option key={value} value={value}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
          絞り込む
        </button>
      </form>

      <Table
        headers={['開始', '終了', '顧客', '番号', '店舗', '状態', '登録経路']}
        empty={rows.length === 0 ? 'この条件の予約はありません' : undefined}
      >
        {rows.map((r) => {
          const status = STATUS[r.status];
          return (
            <tr key={r.id}>
              <td className="px-4 py-3 font-medium">{formatDateTime(r.startAt)}</td>
              <td className="px-4 py-3 text-slate-500">{formatDateTime(r.endAt)}</td>
              <td className="px-4 py-3">
                {r.customerName}
                {r.note && <p className="mt-0.5 text-xs text-slate-400">{r.note}</p>}
              </td>
              <td className="px-4 py-3 font-mono">{r.accessNumber ?? '—'}</td>
              <td className="px-4 py-3 text-slate-600">{r.storeName}</td>
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
