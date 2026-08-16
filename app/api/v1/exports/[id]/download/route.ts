import { apiRoute } from '@/lib/api/handler';
import { badRequest, notFound } from '@/lib/core/errors';
import * as jobs from '@/lib/export/jobs';

/**
 * 帳票のダウンロード (PRD 11-2 「Signed URL」)。
 *
 * オブジェクトキーとトークンの両方が一致し、かつ期限内のときだけ返す。
 * 本番では GCS の署名付きURLへリダイレクトし、アプリはファイル本体を配らない。
 */
export const GET = apiRoute(
  async (ctx) => {
    const token = ctx.url.searchParams.get('token');
    if (!token) throw badRequest('token が必要です');

    const job = await jobs.get(ctx.principal.tenantId, ctx.params.id);
    if (job.status !== 'succeeded' || !job.objectKey) {
      throw notFound('ダウンロード可能なファイル');
    }

    const object = jobs.fetchObject(job.objectKey, token);
    if (!object) throw notFound('ダウンロードリンク（期限切れの可能性があります）');

    return new Response(new Uint8Array(object.body), {
      status: 200,
      headers: {
        'Content-Type': object.contentType,
        'Content-Length': String(object.body.byteLength),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(object.filename)}`,
      },
    });
  },
  { scope: 'exports:read' }
);
