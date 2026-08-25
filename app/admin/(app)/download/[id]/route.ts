import { canExport, currentSession } from '@/lib/admin/session';
import * as jobs from '@/lib/export/jobs';
import { ready } from '@/lib/store';

/**
 * 管理画面からの帳票ダウンロード。
 *
 * API v1 のダウンロードは API キー認証だが、ブラウザはキーを持たない。
 * 管理セッションで認可し、同じ署名付きオブジェクトを返す。
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  await ready();
  const session = await currentSession();
  if (!canExport(session)) {
    return new Response('forbidden', { status: 403 });
  }

  const { id } = await ctx.params;
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return new Response('token required', { status: 400 });

  const job = await jobs.get(session.tenantId, id);
  if (job.status !== 'succeeded' || !job.objectKey) {
    return new Response('not ready', { status: 404 });
  }

  const object = jobs.fetchObject(job.objectKey, token);
  if (!object) return new Response('expired', { status: 404 });

  return new Response(new Uint8Array(object.body), {
    status: 200,
    headers: {
      'Content-Type': object.contentType,
      'Content-Length': String(object.body.byteLength),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(object.filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
