'use server';

import { currentSession, startSession } from '@/lib/admin/session';
import { changeOwnPassword } from '@/lib/admin/users';
import { guarded, requestContext, type ActionState } from '@/lib/admin/action-state';

/**
 * 自分のパスワード変更。
 *
 * 成功するとパスワード変更より前のセッション（他の端末のものも含む）が
 * 無効になる。この端末だけは、直後にセッションを張り直して継続させる。
 */
export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const result = await guarded(async () => {
    const session = await currentSession();
    const current = String(formData.get('current') ?? '');
    const next = String(formData.get('next') ?? '');
    const confirm = String(formData.get('confirm') ?? '');

    if (next !== confirm) {
      return { ok: false, error: '新しいパスワードが確認用と一致しません。' };
    }

    const user = await changeOwnPassword(session, current, next, await requestContext());
    await startSession(user);
    return {
      ok: true,
      message: 'パスワードを変更しました。他の端末のログインは無効になりました。',
    };
  });

  // 現在のパスワードを間違えたときだけ待たせる。総当たりの速度を落とす
  if (result.error === '現在のパスワードが違います。') {
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return result;
}
