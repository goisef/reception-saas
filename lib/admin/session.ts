import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { collections, ready } from '../store';
import { verifyPassword } from './password';
import { ADMIN_COOKIE, adminSessionSecret, issueAdminToken, verifyAdminToken } from './token';
import type { AdminUser, Id, Role } from '../domain/types';

/**
 * 管理Webのセッション。
 *
 * 画面側はこの関数の戻り値しか見ない。認証方式を差し替えても
 * 各ページを触らずに済むようにしてある。
 *
 * トークンには userId と有効期限しか入れず、ロールと店舗範囲は
 * 毎回データストアから引く。権限を落としたのに古いCookieで操作できる、
 * 停止したはずの人がログインしたままになる、という穴を残さないため。
 */

export type AdminSession = {
  tenantId: Id;
  userId: Id;
  displayName: string;
  role: Role;
  /** 空なら全店舗。AreaManager / StoreManager では絞られる */
  storeIds: Id[];
};

function toSession(user: AdminUser): AdminSession {
  return {
    tenantId: user.tenantId,
    userId: user.id,
    displayName: user.displayName,
    role: user.role,
    storeIds: user.storeIds,
  };
}

/** Cookie を検証し、実在して有効な利用者だけを返す。 */
export async function findSession(): Promise<AdminSession | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  const payload = await verifyAdminToken(adminSessionSecret(), token);
  if (!payload) return null;

  await ready();
  const user = await collections.adminUsers().get(payload.tenantId, payload.userId);
  if (!user || user.status !== 'active') return null;
  return toSession(user);
}

/**
 * 認証済み前提のページから呼ぶ。未認証ならログイン画面へ送る。
 *
 * proxy.ts でも同じ判定をしているが、ここでも確かめる。
 * 管理画面から呼ばれるから安全、という前提を置かない (Zero Trust / PRD 16)。
 */
export async function currentSession(): Promise<AdminSession> {
  const session = await findSession();
  if (!session) redirect('/admin/login');
  return session;
}

export type AuthResult =
  | { ok: true; user: AdminUser }
  | { ok: false; reason: 'invalid' | 'suspended' };

export type LoginResult =
  | { ok: true; session: AdminSession }
  | { ok: false; reason: 'invalid' | 'suspended' };

/**
 * 形式は正しいが、どのパスワードとも一致しないハッシュ。
 * 存在しない利用者でも同じだけ時間を使うために噛ませる。
 */
const DUMMY_HASH =
  'pbkdf2-sha256$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/**
 * 資格情報の検証。Cookie には触らない。
 *
 * 利用者が見つからない場合もパスワードの検証を走らせる。
 * 応答時間の差から「そのメールアドレスは存在する」と分かってしまうため。
 */
export async function authenticate(
  tenantId: Id,
  email: string,
  password: string
): Promise<AuthResult> {
  await ready();
  const normalized = email.trim().toLowerCase();
  const users = await collections
    .adminUsers()
    .list(tenantId, (u) => u.email.toLowerCase() === normalized);
  const user = users[0];

  const matched = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !matched) return { ok: false, reason: 'invalid' };
  if (user.status !== 'active') return { ok: false, reason: 'suspended' };
  return { ok: true, user };
}

/** ログイン。検証に通ったらセッション Cookie を発行する。 */
export async function login(
  tenantId: Id,
  email: string,
  password: string
): Promise<LoginResult> {
  const result = await authenticate(tenantId, email, password);
  if (!result.ok) return result;
  const { user } = result;

  const token = await issueAdminToken(adminSessionSecret(), {
    userId: user.id,
    tenantId: user.tenantId,
  });
  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // ローカル開発は http なので、本番だけ secure を付ける
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60,
  });

  await collections
    .adminUsers()
    .update(user.tenantId, user.id, { lastLoginAt: new Date().toISOString() });

  return { ok: true, session: toSession(user) };
}

export async function logout(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}

/** 画面 × 操作の可否 (PRD 15)。ページ側はこれで出し分ける。 */
const WRITE_ROLES: Role[] = ['SuperAdmin', 'TenantAdmin', 'AreaManager', 'StoreManager'];

export function canWrite(session: AdminSession): boolean {
  return WRITE_ROLES.includes(session.role);
}

export function canExport(session: AdminSession): boolean {
  return session.role !== 'ReceptionOnly';
}
