import { currentSession } from '@/lib/admin/session';
import { ready } from '@/lib/store';
import * as customers from '@/lib/services/customers';
import { Badge, PageHeading, Table, formatDateTime } from '../ui';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await ready();
  const session = await currentSession();
  const { q } = await searchParams;

  const rows = await customers.list(session.tenantId, { query: q });
  const histories = await Promise.all(
    rows.map((c) => customers.history(session.tenantId, c.id))
  );

  return (
    <>
      <PageHeading
        title="顧客"
        description="来店・予約・滞在の履歴と、顔認証の登録状態を管理します。"
      />

      <form className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="氏名 / フリガナ / 会員番号 / メール"
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          検索
        </button>
      </form>

      <Table
        headers={['会員番号', '氏名', 'フリガナ', '来店回数', '平均滞在', '最終来店', '顔認証']}
        empty={rows.length === 0 ? '該当する顧客がいません' : undefined}
      >
        {rows.map((c, i) => {
          const stats = histories[i].stats;
          return (
            <tr key={c.id}>
              <td className="px-4 py-3 font-mono">{c.memberCode ?? '—'}</td>
              <td className="px-4 py-3 font-medium">{c.name}</td>
              <td className="px-4 py-3 text-slate-500">{c.nameKana ?? '—'}</td>
              <td className="px-4 py-3">{stats.visitCount}</td>
              <td className="px-4 py-3">
                {stats.averageStayMinutes === null ? '—' : `${stats.averageStayMinutes}分`}
              </td>
              <td className="px-4 py-3">{formatDateTime(stats.lastVisitAt)}</td>
              <td className="px-4 py-3">
                {c.faceRecognition.enrolled ? (
                  <Badge tone="success">登録済み</Badge>
                ) : (
                  <Badge>未登録</Badge>
                )}
              </td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
