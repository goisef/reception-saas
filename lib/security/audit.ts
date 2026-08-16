import { newId } from '../core/ids';
import { collections } from '../store';
import type { AuditLog, Id } from '../domain/types';

/**
 * 監査ログ (PRD 18-1 P0 / 8-5 顔認証のアクセスログ)。
 *
 * 「誰が・いつ・何に対して・何をしたか」を残す。
 * 個人情報そのもの（氏名・電話番号など）は summary に書かない。
 * 漏洩時の被害を監査ログまで広げないため。
 */

export type AuditInput = {
  tenantId: Id;
  requestId: string;
  actorType: AuditLog['actorType'];
  actorId: Id | null;
  action: string;
  resourceType: string;
  resourceId: Id | null;
  storeId?: Id | null;
  method: string;
  path: string;
  statusCode: number;
  ip?: string | null;
  userAgent?: string | null;
  summary?: string | null;
};

export async function record(input: AuditInput): Promise<void> {
  const log: AuditLog = {
    id: newId('aud'),
    tenantId: input.tenantId,
    requestId: input.requestId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    storeId: input.storeId ?? null,
    method: input.method,
    path: input.path,
    statusCode: input.statusCode,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    summary: input.summary ?? null,
    createdAt: new Date().toISOString(),
  };
  await collections.auditLogs().insert(log);
}

/**
 * 読み取り系まで全部残すとログが膨れるので、状態を変える操作だけを記録する。
 * 顔認証データへのアクセスは読み取りでも残す必要があるため、
 * 呼び出し側が明示的に record() すること。
 */
export function shouldAudit(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}
