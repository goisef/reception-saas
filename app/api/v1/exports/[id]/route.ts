import { apiRoute } from '@/lib/api/handler';
import * as jobs from '@/lib/export/jobs';

export const GET = apiRoute(
  async (ctx) => ({ body: { data: await jobs.get(ctx.principal.tenantId, ctx.params.id) } }),
  { scope: 'exports:read' }
);
