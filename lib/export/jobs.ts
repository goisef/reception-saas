import { notFound } from '../core/errors';
import { newId, newToken } from '../core/ids';
import { collections } from '../store';
import { toCsv } from './csv';
import { toXlsx } from './xlsx';
import { buildDataset, buildJsonBundle, type ExportFilters } from './datasets';
import type { ExportFormat, ExportJob, ExportResource, Id } from '../domain/types';

/**
 * 非同期エクスポート (PRD 11-2)。
 *
 *   Export Request → Queue → Worker → File → Storage → Signed URL
 *
 * 大量データを同期で返すと、リクエストタイムアウトとメモリ圧迫の両方を招く。
 * ここでは Storage の代わりにメモリ上のオブジェクトストアを使い、
 * 本番では GCS + 署名付きURL に差し替える。
 */

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

export type StoredObject = {
  key: string;
  contentType: string;
  filename: string;
  body: Buffer;
  /** 署名付きURLのトークン。推測できない値にする */
  token: string;
  expiresAt: number;
};

const GLOBAL_KEY = '__reception_object_store__';
type GlobalWithObjects = typeof globalThis & { [GLOBAL_KEY]?: Map<string, StoredObject> };

function objects(): Map<string, StoredObject> {
  const g = globalThis as GlobalWithObjects;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY]!;
}

const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8',
};

export async function request(params: {
  tenantId: Id;
  resource: ExportResource;
  format: ExportFormat;
  filters?: ExportFilters;
  requestedBy?: Id | null;
}): Promise<ExportJob> {
  const now = new Date().toISOString();
  return collections.exportJobs().insert({
    id: newId('exp'),
    tenantId: params.tenantId,
    resource: params.resource,
    format: params.format,
    filters: params.filters ?? {},
    status: 'queued',
    objectKey: null,
    downloadUrl: null,
    downloadUrlExpiresAt: null,
    rowCount: null,
    byteSize: null,
    error: null,
    requestedBy: params.requestedBy ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * キューに溜まったジョブを1件処理する。Cloud Tasks のワーカーから叩かれる想定。
 * 開発中は `POST /api/v1/exports/{id}/run` で手動実行できる。
 */
export async function run(
  tenantId: Id,
  jobId: Id,
  options: { force?: boolean } = {}
): Promise<ExportJob> {
  const job = await collections.exportJobs().get(tenantId, jobId);
  if (!job) throw notFound('エクスポートジョブ');
  // 完了済みは作り直さない。ワーカーが同じジョブを二度拾っても
  // 二重生成にならないようにするため。署名URLの失効時は force で作り直す。
  if (job.status === 'succeeded' && !options.force) return job;

  await collections.exportJobs().update(tenantId, jobId, {
    status: 'running',
    updatedAt: new Date().toISOString(),
  });

  try {
    const { body, rowCount, filename } = await generate(job);
    const key = `exports/${tenantId}/${jobId}/${filename}`;
    const token = newToken(24);
    const expiresAt = Date.now() + SIGNED_URL_TTL_MS;

    objects().set(key, {
      key,
      contentType: CONTENT_TYPE[job.format],
      filename,
      body,
      token,
      expiresAt,
    });

    const updated = await collections.exportJobs().update(tenantId, jobId, {
      status: 'succeeded',
      objectKey: key,
      downloadUrl: `/api/v1/exports/${jobId}/download?token=${token}`,
      downloadUrlExpiresAt: new Date(expiresAt).toISOString(),
      rowCount,
      byteSize: body.byteLength,
      error: null,
      updatedAt: new Date().toISOString(),
    });
    return updated!;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await collections.exportJobs().update(tenantId, jobId, {
      status: 'failed',
      error: message,
      updatedAt: new Date().toISOString(),
    });
    return updated!;
  }
}

async function generate(job: ExportJob): Promise<{
  body: Buffer;
  rowCount: number;
  filename: string;
}> {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  if (job.format === 'json') {
    const bundle = await buildJsonBundle(job.tenantId, job.filters);
    const rowCount =
      bundle.customers.length + bundle.reservations.length + bundle.visits.length;
    return {
      body: Buffer.from(JSON.stringify(bundle, null, 2), 'utf8'),
      rowCount,
      filename: `reception-export-${stamp}.json`,
    };
  }

  const dataset = await buildDataset(job.tenantId, job.resource, job.filters);
  const rows = dataset.rows as never[];

  if (job.format === 'csv') {
    return {
      body: Buffer.from(toCsv(rows, dataset.columns), 'utf8'),
      rowCount: rows.length,
      filename: `${dataset.slug}-${stamp}.csv`,
    };
  }

  return {
    body: toXlsx(rows, dataset.columns, { sheetName: dataset.sheetName }),
    rowCount: rows.length,
    filename: `${dataset.slug}-${stamp}.xlsx`,
  };
}

/** 署名付きURLからの取得。トークン一致と期限内であることを確認する。 */
export function fetchObject(key: string, token: string): StoredObject | null {
  const object = objects().get(key);
  if (!object) return null;
  if (object.token !== token) return null;
  if (Date.now() > object.expiresAt) {
    objects().delete(key);
    return null;
  }
  return object;
}

export async function list(tenantId: Id): Promise<ExportJob[]> {
  const jobs = await collections.exportJobs().list(tenantId);
  return jobs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function get(tenantId: Id, jobId: Id): Promise<ExportJob> {
  const job = await collections.exportJobs().get(tenantId, jobId);
  if (!job) throw notFound('エクスポートジョブ');
  return job;
}
