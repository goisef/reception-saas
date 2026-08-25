import { currentSession } from '@/lib/admin/session';
import { collections, ready } from '@/lib/store';
import * as jobs from '@/lib/export/jobs';
import { Badge, Card, PageHeading, Table, formatDateTime } from '../ui';
import { requestExportAction, runExportAction } from './actions';
import type { ExportJobStatus } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

const RESOURCE_LABEL: Record<string, string> = {
  customers: '顧客',
  reservations: '予約',
  visits: '来店・退出・滞在',
  access_numbers: '番号',
  notifications: '通知',
  api_logs: 'APIログ',
};

const STATUS: Record<ExportJobStatus, { label: string; tone: 'default' | 'success' | 'warning' | 'danger' }> = {
  queued: { label: '待機中', tone: 'default' },
  running: { label: '生成中', tone: 'warning' },
  succeeded: { label: '完了', tone: 'success' },
  failed: { label: '失敗', tone: 'danger' },
};

/**
 * 署名URLの失効判定は現在時刻に依存するので、レンダー外で済ませておく。
 */
async function loadJobs(tenantId: string) {
  const now = Date.now();
  const jobList = await jobs.list(tenantId);
  return jobList.map((job) => ({
    job,
    token: job.downloadUrl?.split('token=')[1],
    expired: job.downloadUrlExpiresAt !== null && Date.parse(job.downloadUrlExpiresAt) < now,
  }));
}

export default async function ExportsPage() {
  await ready();
  const session = await currentSession();

  const [rows, stores] = await Promise.all([
    loadJobs(session.tenantId),
    collections.stores().list(session.tenantId),
  ]);

  return (
    <>
      <PageHeading
        title="帳票"
        description="CSV は UTF-8 BOM 付きで出力されるため、Excel でそのまま開けます。JSON は外部システムへの移行用です。"
      />

      <Card className="mb-8">
        <form action={requestExportAction} className="grid gap-4 md:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">対象</span>
            <select name="resource" className="w-full rounded-lg border border-slate-300 px-3 py-2">
              {Object.entries(RESOURCE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">形式</span>
            <select name="format" className="w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="csv">CSV</option>
              <option value="xlsx">Excel</option>
              <option value="json">JSON</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">店舗</span>
            <select name="storeId" className="w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="">すべて</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">開始日</span>
            <input
              type="date"
              name="from"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">終了日</span>
            <input
              type="date"
              name="to"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <div className="md:col-span-5">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white"
            >
              エクスポートを作成
            </button>
          </div>
        </form>
      </Card>

      <Table
        headers={['作成', '対象', '形式', '状態', '件数', 'サイズ', 'ダウンロード']}
        empty={rows.length === 0 ? 'エクスポート履歴がありません' : undefined}
      >
        {rows.map(({ job, token, expired }) => {
          const status = STATUS[job.status];
          return (
            <tr key={job.id}>
              <td className="px-4 py-3">{formatDateTime(job.createdAt)}</td>
              <td className="px-4 py-3">{RESOURCE_LABEL[job.resource] ?? job.resource}</td>
              <td className="px-4 py-3 uppercase">{job.format}</td>
              <td className="px-4 py-3">
                <Badge tone={status.tone}>{status.label}</Badge>
                {job.error && <p className="mt-1 text-xs text-rose-600">{job.error}</p>}
              </td>
              <td className="px-4 py-3">{job.rowCount ?? '—'}</td>
              <td className="px-4 py-3">
                {job.byteSize === null ? '—' : `${Math.ceil(job.byteSize / 1024)} KB`}
              </td>
              <td className="px-4 py-3">
                {job.status === 'succeeded' && token && !expired ? (
                  <a
                    href={`/admin/download/${job.id}?token=${token}`}
                    className="text-slate-900 underline"
                  >
                    ダウンロード
                  </a>
                ) : job.status === 'succeeded' && expired ? (
                  <form action={runExportAction}>
                    <input type="hidden" name="jobId" value={job.id} />
                    <button type="submit" className="text-slate-600 underline">
                      再生成
                    </button>
                  </form>
                ) : job.status === 'queued' || job.status === 'failed' ? (
                  <form action={runExportAction}>
                    <input type="hidden" name="jobId" value={job.id} />
                    <button type="submit" className="text-slate-600 underline">
                      実行
                    </button>
                  </form>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          );
        })}
      </Table>

      <p className="mt-6 text-xs text-slate-400">
        ダウンロードURLは15分で失効します（PRD 11-2）。期限切れの場合は再生成してください。
      </p>
    </>
  );
}
