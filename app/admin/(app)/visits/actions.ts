'use server';

import { revalidatePath } from 'next/cache';
import { canWrite, currentSession } from '@/lib/admin/session';
import { forbidden, notFound } from '@/lib/core/errors';
import { newRequestId } from '@/lib/core/ids';
import * as audit from '@/lib/security/audit';
import * as reception from '@/lib/services/reception';
import { collections, ready } from '@/lib/store';

/**
 * 滞在中の来店に対するスタッフ操作。
 *
 * 「退出ボタンを押し忘れた客が帰ってしまった」は毎日起きる。
 * 一覧からその場で退出させられないと、番号が解放されず次の受付が詰まる。
 */

export async function manualCheckoutAction(formData: FormData) {
  await ready();
  const session = await currentSession();
  if (!canWrite(session)) throw forbidden('退出処理を行う権限がありません');

  const visitId = String(formData.get('visitId') ?? '');
  if (!visitId) return;

  const visit = await collections.visits().get(session.tenantId, visitId);
  if (!visit) throw notFound('来店');
  if (session.storeIds.length > 0 && !session.storeIds.includes(visit.storeId)) {
    throw forbidden('この店舗を操作する権限がありません');
  }

  await reception.checkout({
    tenantId: session.tenantId,
    storeId: visit.storeId,
    visitId,
  });

  await audit.record({
    tenantId: session.tenantId,
    requestId: newRequestId(),
    actorType: 'user',
    actorId: session.userId,
    action: 'checkout.manual',
    resourceType: 'visit',
    resourceId: visitId,
    storeId: visit.storeId,
    method: 'POST',
    path: '/admin/visits',
    statusCode: 200,
    // 誰が代理で退出させたかは後から必ず問われる
    summary: `管理画面から手動退出（番号 ${visit.accessNumber ?? '—'}）`,
  });

  revalidatePath('/admin/visits');
  revalidatePath('/admin');
}

/** 退出予定時刻の延長。延長申請の承認に相当する。 */
export async function extendStayAction(formData: FormData) {
  await ready();
  const session = await currentSession();
  if (!canWrite(session)) throw forbidden('滞在時間を変更する権限がありません');

  const visitId = String(formData.get('visitId') ?? '');
  const minutes = Number(formData.get('minutes') ?? '30');
  if (!visitId || !Number.isFinite(minutes)) return;

  const visit = await collections.visits().get(session.tenantId, visitId);
  if (!visit) throw notFound('来店');
  if (session.storeIds.length > 0 && !session.storeIds.includes(visit.storeId)) {
    throw forbidden('この店舗を操作する権限がありません');
  }

  // 予定を過ぎている場合は「今から」延長する。過去の予定に足しても意味がない。
  const base = visit.scheduledExitAt ? Date.parse(visit.scheduledExitAt) : Date.now();
  const from = Math.max(base, Date.now());
  const next = new Date(from + minutes * 60_000).toISOString();

  await reception.updateScheduledExit(session.tenantId, visitId, next);

  await audit.record({
    tenantId: session.tenantId,
    requestId: newRequestId(),
    actorType: 'user',
    actorId: session.userId,
    action: 'visit.extend',
    resourceType: 'visit',
    resourceId: visitId,
    storeId: visit.storeId,
    method: 'POST',
    path: '/admin/visits',
    statusCode: 200,
    summary: `退出予定を${minutes}分延長`,
  });

  revalidatePath('/admin/visits');
  revalidatePath('/admin');
}
