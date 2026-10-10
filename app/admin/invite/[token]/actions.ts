'use server';

import { redirect } from 'next/navigation';
import { startSession } from '@/lib/admin/session';
import { acceptInvitation } from '@/lib/admin/users';
import { guarded, requestContext, type ActionState } from '@/lib/admin/action-state';
import { collections } from '@/lib/store';

/**
 * 招待・再設定リンクからのパスワード設定。
 *
 * ログイン前に呼ばれるので、認可の根拠はリンクの秘密そのもの。
 * 成功したらそのままログインさせる。パスワードを決めた直後に
 * もう一度打たせても安全性は上がらず、離脱が増えるだけ。
 */
export async function acceptInvitationAction(
  token: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const result = await guarded(async () => {
    const password = String(formData.get('password') ?? '');
    const confirm = String(formData.get('confirm') ?? '');
    if (password !== confirm) {
      return { ok: false, error: 'パスワードが確認用と一致しません。' };
    }

    const user = await acceptInvitation(token, password, await requestContext());
    await startSession(user);
    await collections
      .adminUsers()
      .update(user.tenantId, user.id, { lastLoginAt: new Date().toISOString() });
    return { ok: true };
  });

  if (result.ok) redirect('/admin');
  return result;
}
