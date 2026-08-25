'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { login, logout } from '@/lib/admin/session';
import { record } from '@/lib/security/audit';
import { newRequestId } from '@/lib/core/ids';
import { DEMO_TENANT_ID } from '@/lib/store/seed';

/**
 * 管理Webのログイン。
 *
 * 「どのテナントか」はいまサブドメインを持っていないため環境変数で決める。
 * SaaS として複数テナントを1つのURLで捌く段階になったら、
 * サブドメインかログインIDのドメイン部から引く形へ変える。
 */
function tenantId(): string {
  return process.env.RECEPTION_TENANT_ID ?? DEMO_TENANT_ID;
}

/** 戻り先を自サイト内の管理画面に限定する。外部へ飛ばす踏み台にしない。 */
function safePath(value: string): string {
  if (!value.startsWith('/admin') || value.startsWith('//')) return '/admin';
  if (value.startsWith('/admin/login')) return '/admin';
  return value;
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = safePath(String(formData.get('next') ?? '/admin'));

  const result = await login(tenantId(), email, password);

  const head = await headers();
  // 誰がいつログインを試みたかは、不正アクセスの調査で必ず必要になる。
  // 失敗も残す。成功だけでは総当たりの痕跡が見えない。
  // メールアドレスは個人情報なので summary には書かない (lib/security/audit.ts)。
  await record({
    tenantId: tenantId(),
    requestId: newRequestId(),
    actorType: 'user',
    actorId: result.ok ? result.session.userId : null,
    action: result.ok ? 'admin.login' : 'admin.login_failed',
    resourceType: 'admin_user',
    resourceId: result.ok ? result.session.userId : null,
    method: 'POST',
    path: '/admin/login',
    statusCode: result.ok ? 200 : 401,
    ip: head.get('x-forwarded-for'),
    userAgent: head.get('user-agent'),
    summary: result.ok ? null : `reason=${result.reason}`,
  });

  if (!result.ok) {
    // 総当たりの試行速度を落とす。成功時は待たせない。
    await new Promise((resolve) => setTimeout(resolve, 800));
    redirect(`/admin/login?next=${encodeURIComponent(next)}&error=${result.reason}`);
  }

  redirect(next);
}

export async function signOutAction() {
  await logout();
  redirect('/admin/login');
}
