'use server';

import { revalidatePath } from 'next/cache';
import { canExport, currentSession } from '@/lib/admin/session';
import { forbidden } from '@/lib/core/errors';
import { newRequestId } from '@/lib/core/ids';
import * as audit from '@/lib/security/audit';
import * as jobs from '@/lib/export/jobs';
import { ready } from '@/lib/store';
import type { ExportFormat, ExportResource } from '@/lib/domain/types';

const RESOURCES: ExportResource[] = [
  'customers',
  'reservations',
  'visits',
  'access_numbers',
  'notifications',
  'api_logs',
];
const FORMATS: ExportFormat[] = ['csv', 'xlsx', 'json'];

export async function requestExportAction(formData: FormData) {
  await ready();
  const session = await currentSession();
  if (!canExport(session)) throw forbidden('帳票を出力する権限がありません');

  const resource = String(formData.get('resource') ?? '') as ExportResource;
  const format = String(formData.get('format') ?? '') as ExportFormat;
  if (!RESOURCES.includes(resource) || !FORMATS.includes(format)) return;

  const storeId = String(formData.get('storeId') ?? '') || undefined;
  const from = String(formData.get('from') ?? '') || undefined;
  const to = String(formData.get('to') ?? '') || undefined;

  const job = await jobs.request({
    tenantId: session.tenantId,
    resource,
    format,
    filters: {
      storeId,
      // date input は日付だけなので、期間の端を含むよう時刻を補う
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
    },
    requestedBy: session.userId,
  });

  // 本番では Cloud Tasks がここでキューに積むだけ。開発ではそのまま実行して
  // 「要求 → 生成 → 署名付きURL」の流れを画面上で確認できるようにする。
  await jobs.run(session.tenantId, job.id);

  await audit.record({
    tenantId: session.tenantId,
    requestId: newRequestId(),
    actorType: 'user',
    actorId: session.userId,
    action: 'export.request',
    resourceType: 'export_job',
    resourceId: job.id,
    method: 'POST',
    path: '/admin/exports',
    statusCode: 202,
    summary: `${resource} / ${format}`,
  });

  revalidatePath('/admin/exports');
}

export async function runExportAction(formData: FormData) {
  await ready();
  const session = await currentSession();
  if (!canExport(session)) throw forbidden('帳票を出力する権限がありません');

  const jobId = String(formData.get('jobId') ?? '');
  if (!jobId) return;

  // 署名URLが失効した完了済みジョブの作り直しにも使うので force を立てる
  await jobs.run(session.tenantId, jobId, { force: true });
  revalidatePath('/admin/exports');
}
