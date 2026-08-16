import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { publicRoute } from '@/lib/api/handler';

/**
 * OpenAPI 仕様の配信 (PRD 10-7)。
 *
 * 仕様書は openapi/reception-v1.yaml を単一の正とし、Git 管理する。
 * ここから SDK / 型 / ドキュメントを生成する。
 */
export const GET = publicRoute(async () => {
  const file = path.join(process.cwd(), 'openapi', 'reception-v1.yaml');
  const yaml = await readFile(file, 'utf8');
  return new Response(yaml, {
    status: 200,
    headers: {
      'Content-Type': 'application/yaml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
});
