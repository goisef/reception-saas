'use server';

import { revalidatePath } from 'next/cache';
import { currentSession, canWrite } from '@/lib/admin/session';
import { forbidden } from '@/lib/core/errors';
import * as audit from '@/lib/security/audit';
import * as numbers from '@/lib/services/access-numbers';
import { newRequestId } from '@/lib/core/ids';
import { ready } from '@/lib/store';

/**
 * 番号の手動解放と解放スイープ。
 *
 * Server Action は認証を通らないので、ここで必ず権限を確認する。
 * 「管理画面から呼ばれているから安全」という前提は置かない (PRD 16 Zero Trust)。
 */

export async function releaseNumberAction(formData: FormData) {
  await ready();
  const session = await currentSession();
  if (!canWrite(session)) throw forbidden('番号を解放する権限がありません');

  const storeId = String(formData.get('storeId') ?? '');
  const number = String(formData.get('number') ?? '');
  if (!storeId || !number) return;

  if (session.storeIds.length > 0 && !session.storeIds.includes(storeId)) {
    throw forbidden('この店舗を操作する権限がありません');
  }

  await numbers.releaseManually(session.tenantId, storeId, number);

  await audit.record({
    tenantId: session.tenantId,
    requestId: newRequestId(),
    actorType: 'user',
    actorId: session.userId,
    action: 'access_number.release',
    resourceType: 'access_number',
    resourceId: number,
    storeId,
    method: 'POST',
    path: '/admin/access-numbers',
    statusCode: 200,
    summary: `番号 ${number} を手動解放`,
  });

  revalidatePath('/admin/access-numbers');
}

export async function sweepAction(formData: FormData) {
  await ready();
  const session = await currentSession();
  if (!canWrite(session)) throw forbidden('番号を解放する権限がありません');

  const storeId = String(formData.get('storeId') ?? '');
  if (!storeId) return;

  const outcome = await numbers.sweepReleases(session.tenantId, storeId);

  await audit.record({
    tenantId: session.tenantId,
    requestId: newRequestId(),
    actorType: 'user',
    actorId: session.userId,
    action: 'access_number.sweep',
    resourceType: 'access_number',
    resourceId: null,
    storeId,
    method: 'POST',
    path: '/admin/access-numbers',
    statusCode: 200,
    summary: `${outcome.released.length}件を解放`,
  });

  revalidatePath('/admin/access-numbers');
}
