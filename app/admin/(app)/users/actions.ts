'use server';

import { revalidatePath } from 'next/cache';
import { currentSession } from '@/lib/admin/session';
import {
  UserAdminError,
  changeRole,
  inviteUser,
  issueLink,
  setUserStatus,
} from '@/lib/admin/users';
import {
  guarded,
  inviteUrl,
  publicOrigin,
  requestContext,
  type ActionState,
} from '@/lib/admin/action-state';
import { ROLES_BY_RANK } from '@/lib/admin/policy';
import type { Role } from '@/lib/domain/types';

/**
 * 利用者の管理。
 *
 * Server Action は画面を経由せず直接呼べる。ここで毎回セッションを取り直し、
 * 権限の判定はサービス層 (lib/admin/users.ts) に任せる。
 */

function parseRole(raw: FormDataEntryValue | null): Role {
  const value = String(raw ?? '');
  const role = ROLES_BY_RANK.find((r) => r === value);
  // 想定外の値を既定のロールへ丸めない。丸めた先が意図しない権限になりうる
  if (!role) throw new UserAdminError('ロールの指定が正しくありません。');
  return role;
}

function parseStores(formData: FormData): string[] {
  return formData.getAll('storeIds').map((v) => String(v));
}

export async function inviteUserAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const values = {
    email: String(formData.get('email') ?? ''),
    displayName: String(formData.get('displayName') ?? ''),
    role: String(formData.get('role') ?? ''),
    storeIds: parseStores(formData),
  };
  const result = await guarded(async () => {
    const session = await currentSession();
    const { token, user } = await inviteUser(
      session,
      {
        email: String(formData.get('email') ?? ''),
        displayName: String(formData.get('displayName') ?? ''),
        role: parseRole(formData.get('role')),
        storeIds: parseStores(formData),
      },
      await requestContext()
    );
    revalidatePath('/admin/users');
    return {
      ok: true,
      message: `${user.displayName} さんを招待しました。`,
      link: {
        url: inviteUrl(await publicOrigin(), token),
        kind: 'invite',
        label: '招待リンク',
      },
    };
  });
  // 失敗時だけ入力を返す。成功時は次の招待のためにフォームを空に戻す
  return result.ok ? result : { ...result, values };
}

export async function issueLinkAction(
  userId: string,
  // useActionState が先頭に前回の状態を渡す。この操作では使わない
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: ActionState
): Promise<ActionState> {
  return guarded(async () => {
    const session = await currentSession();
    const { token, kind } = await issueLink(session, userId, await requestContext());
    revalidatePath('/admin/users');
    return {
      ok: true,
      link: {
        url: inviteUrl(await publicOrigin(), token),
        kind,
        label: kind === 'invite' ? '招待リンク' : 'パスワード再設定リンク',
      },
    };
  });
}

export async function setStatusAction(
  userId: string,
  next: 'active' | 'suspended',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: ActionState
): Promise<ActionState> {
  return guarded(async () => {
    const session = await currentSession();
    await setUserStatus(session, userId, next, await requestContext());
    revalidatePath('/admin/users');
    return { ok: true, message: next === 'suspended' ? '停止しました。' : '再開しました。' };
  });
}

export async function changeRoleAction(
  userId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return guarded(async () => {
    const session = await currentSession();
    await changeRole(
      session,
      userId,
      parseRole(formData.get('role')),
      parseStores(formData),
      await requestContext()
    );
    revalidatePath('/admin/users');
    return { ok: true, message: 'ロールを変更しました。' };
  });
}
