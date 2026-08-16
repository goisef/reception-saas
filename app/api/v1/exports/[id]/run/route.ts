import { apiRoute } from '@/lib/api/handler';
import * as jobs from '@/lib/export/jobs';

/**
 * エクスポートジョブの実行 (PRD 11-2 の Worker 相当)。
 *
 * 本番では Cloud Tasks のワーカーがこれを叩く。開発中は管理画面から
 * 手動で実行できるようにしておき、キュー基盤なしでも一連の流れを検証できる。
 */
export const POST = apiRoute(
  async (ctx) => {
    const job = await jobs.run(ctx.principal.tenantId, ctx.params.id);
    return { status: job.status === 'failed' ? 500 : 200, body: { data: job } };
  },
  {
    scope: 'exports:write',
    auditAction: 'export.run',
    auditResourceType: 'export_job',
  }
);
