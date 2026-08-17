'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ACCESS_COOKIE,
  accessConfig,
  issueToken,
  passwordMatches,
} from '@/lib/access/session';

/**
 * 共有URLのログイン。
 *
 * 総当たりを完全には防げないが、デモ環境の目隠しとしては
 * 「失敗時に一定時間待たせる」程度で実用上は足りる。
 * 本格的な保護が要る段階になったら Cloud Armor 側でレート制限する。
 */
export async function signInAction(formData: FormData) {
  const { password, secret } = accessConfig();
  const given = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');

  if (!password) redirect(safePath(next));

  if (!(await passwordMatches(password, given))) {
    // 総当たりの試行速度を落とす。正解時は待たせない。
    await new Promise((resolve) => setTimeout(resolve, 800));
    redirect(`/access?next=${encodeURIComponent(safePath(next))}&error=1`);
  }

  const store = await cookies();
  store.set(ACCESS_COOKIE, await issueToken(secret), {
    httpOnly: true,
    sameSite: 'lax',
    // ローカルの http でも動くよう、本番だけ secure にする
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60,
  });

  redirect(safePath(next));
}

export async function signOutAction() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  redirect('/access');
}

/**
 * 戻り先を自サイト内のパスに限定する。
 * `//evil.example.com` のような値を渡されると外部へ飛ばされるため。
 */
function safePath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
