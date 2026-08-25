'use server';

import { revalidatePath } from 'next/cache';
import { canWrite, currentSession } from '@/lib/admin/session';
import { forbidden } from '@/lib/core/errors';
import { newRequestId } from '@/lib/core/ids';
import * as audit from '@/lib/security/audit';
import * as remoteConfig from '@/lib/services/remote-config';
import { ready } from '@/lib/store';
import type { FeatureFlag, ReceptionButton } from '@/lib/domain/types';

/**
 * 端末設定の更新 (PRD 4-2 / 4-3 / 4-4)。
 *
 * この画面での保存が、アプリ更新なしで店舗の受付画面を変える唯一の経路。
 * 保存のたびに configVersion が上がり、端末が次のポーリングで拾う。
 */
export async function saveConfigAction(formData: FormData) {
  await ready();
  const session = await currentSession();
  if (!canWrite(session)) throw forbidden('端末設定を変更する権限がありません');

  const storeId = String(formData.get('storeId') ?? '');
  if (!storeId) return;
  if (session.storeIds.length > 0 && !session.storeIds.includes(storeId)) {
    throw forbidden('この店舗を操作する権限がありません');
  }

  const current = await remoteConfig.getRaw(session.tenantId, storeId);

  const buttons: ReceptionButton[] = current.buttons.map((button) => ({
    ...button,
    label: String(formData.get(`button.${button.id}.label`) ?? button.label),
    visible: formData.get(`button.${button.id}.visible`) === 'on',
    order: Number(formData.get(`button.${button.id}.order`) ?? button.order),
  }));

  const flags: FeatureFlag[] = current.flags.map((flag) => ({
    ...flag,
    enabled: formData.get(`flag.${flag.key}.enabled`) === 'on',
    rolloutPercent: clampPercent(
      Number(formData.get(`flag.${flag.key}.rollout`) ?? flag.rolloutPercent)
    ),
  }));

  const logo = String(formData.get('logo') ?? '').trim();

  const updated = await remoteConfig.updateConfig(session.tenantId, storeId, {
    buttons: buttons.sort((a, b) => a.order - b.order),
    flags,
    theme: String(formData.get('theme') ?? current.theme),
    language: String(formData.get('language') ?? current.language),
    notificationSound: String(formData.get('notificationSound') ?? current.notificationSound),
    logo: logo || null,
  });

  await audit.record({
    tenantId: session.tenantId,
    requestId: newRequestId(),
    actorType: 'user',
    actorId: session.userId,
    action: 'remote_config.update',
    resourceType: 'remote_config',
    resourceId: storeId,
    storeId,
    method: 'POST',
    path: '/admin/settings',
    statusCode: 200,
    summary: `configVersion ${current.configVersion} → ${updated.configVersion}`,
  });

  revalidatePath('/admin/settings');
  revalidatePath('/reception');
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
