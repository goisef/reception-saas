import { apiRoute } from '@/lib/api/handler';
import { Validator } from '@/lib/core/validate';
import * as jobs from '@/lib/export/jobs';
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

export const GET = apiRoute(
  async (ctx) => ({ body: { data: await jobs.list(ctx.principal.tenantId) } }),
  { scope: 'exports:read' }
);

/**
 * エクスポート要求 (PRD 11-2)。
 *
 * 同期では返さない。件数が読めないので、必ずキュー経由にして
 * 完了後に署名付きURLを渡す。
 */
export const POST = apiRoute(
  async (ctx) => {
    const v = new Validator(ctx.body);
    const resource = v.enum('resource', RESOURCES, { required: true });
    const format = v.enum('format', FORMATS, { required: true });
    const storeId = v.string('storeId');
    const from = v.dateTime('from');
    const to = v.dateTime('to');
    v.throwIfInvalid();

    const job = await jobs.request({
      tenantId: ctx.principal.tenantId,
      resource: resource!,
      format: format!,
      filters: { storeId, from, to },
      requestedBy: ctx.principal.clientId,
    });

    return {
      status: 202,
      body: {
        data: job,
        // 開発中はワーカーが常駐していないので、実行エンドポイントを案内する
        runUrl: `/api/v1/exports/${job.id}/run`,
      },
    };
  },
  {
    scope: 'exports:write',
    idempotent: true,
    auditAction: 'export.request',
    auditResourceType: 'export_job',
  }
);
