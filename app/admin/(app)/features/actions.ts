'use server';

import { revalidatePath } from 'next/cache';
import { currentSession } from '@/lib/admin/session';
import { guarded, requestContext, type ActionState } from '@/lib/admin/action-state';
import { setPublished, setStoreFlag } from '@/lib/services/features';

/**
 * 機能管理（マスタ画面）。
 *
 * Server Action は画面を経由せず直接呼べる。毎回セッションを取り直し、
 * 権限・店舗の範囲・確認の有無はサービス層 (lib/services/features.ts) が判定する。
 */

function refresh() {
  revalidatePath('/admin/features');
  // 公開 / 非公開は、これらの画面の表示にも効く
  revalidatePath('/admin/customers');
  revalidatePath('/admin/settings');
  revalidatePath('/reception');
}

export async function setPublishedAction(
  key: string,
  enabled: boolean,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return guarded(async () => {
    const session = await currentSession();
    await setPublished(
      session,
      key,
      enabled,
      formData.get('acknowledged') === 'on',
      await requestContext()
    );
    refresh();
    return { ok: true, message: enabled ? '公開しました。' : '非公開に戻しました。' };
  });
}

export async function setStoreFlagAction(
  key: string,
  storeId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return guarded(async () => {
    const session = await currentSession();
    await setStoreFlag(
      session,
      key,
      storeId,
      formData.get('enabled') === 'on',
      Number(formData.get('rollout') ?? 0),
      await requestContext()
    );
    refresh();
    return { ok: true, message: '保存しました。端末の次の更新で反映されます。' };
  });
}
