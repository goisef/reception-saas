import { timingSafeEqual } from 'node:crypto';
import { newId, newRequestId, newToken, sha256Hex } from '../core/ids';
import { collections, datastore, ready } from '../store';
import * as audit from '../security/audit';
import { AdminActionError } from './errors';
import { hashPassword, verifyPassword } from './password';
import {
  INVITE_TTL_MS,
  RESET_TTL_MS,
  canAssignRole,
  canManageUsers,
  canModifyUser,
  isAdminRole,
  roleNeedsStores,
  validatePassword,
} from './policy';
import type { AdminInvitation, AdminUser, Id, Role } from '../domain/types';

/**
 * 管理ユーザーの運用 (招待 / パスワード設定 / 停止 / ロール変更)。
 *
 * 画面からは必ずここを通す。権限の判定・テナント分離・監査ログを
 * 1か所に集め、画面ごとに判定が漏れるのを防ぐ (Zero Trust / PRD 16)。
 */

/** 画面にそのまま出してよい文言を持つエラー。内部の事情は含めない。 */
export class UserAdminError extends AdminActionError {
  constructor(display: string) {
    super(display);
    this.name = 'UserAdminError';
  }
}

/** 操作する人。AdminSession と同じ形のうち必要なものだけ。 */
export type Actor = {
  tenantId: Id;
  userId: Id;
  role: Role;
  storeIds: Id[];
};

export type RequestContext = {
  ip?: string | null;
  userAgent?: string | null;
};

/** パスワードハッシュを含めない。画面へ渡すのはこの形だけ。 */
export type AdminUserView = Omit<AdminUser, 'passwordHash'> & {
  pendingInvitation: { kind: AdminInvitation['kind']; expiresAt: string } | null;
};

function view(user: AdminUser, pending: AdminInvitation | undefined): AdminUserView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = user;
  return {
    ...rest,
    pendingInvitation: pending ? { kind: pending.kind, expiresAt: pending.expiresAt } : null,
  };
}

function requireManager(actor: Actor): void {
  if (!canManageUsers(actor.role)) {
    throw new UserAdminError('利用者を管理する権限がありません。');
  }
}

async function logEvent(
  actor: { tenantId: Id; userId: Id | null },
  ctx: RequestContext,
  event: {
    action: string;
    resourceId: Id | null;
    path: string;
    statusCode?: number;
    summary?: string | null;
  }
) {
  // メールアドレスは個人情報なので summary に書かない (lib/security/audit.ts)。
  await audit.record({
    tenantId: actor.tenantId,
    requestId: newRequestId(),
    actorType: 'user',
    actorId: actor.userId,
    action: event.action,
    resourceType: 'admin_user',
    resourceId: event.resourceId,
    method: 'POST',
    path: event.path,
    statusCode: event.statusCode ?? 200,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    summary: event.summary ?? null,
  });
}

function lockKey(tenantId: Id): string {
  return `admin_users:${tenantId}`;
}

// ---------------------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------------------

export async function listUsers(actor: Actor): Promise<AdminUserView[]> {
  requireManager(actor);
  await ready();
  const [users, invitations] = await Promise.all([
    collections.adminUsers().list(actor.tenantId),
    collections.adminInvitations().list(actor.tenantId, (i) => i.status === 'pending'),
  ]);
  const now = Date.now();
  const pendingByUser = new Map<Id, AdminInvitation>();
  for (const inv of invitations) {
    // 期限切れは「リンクが無い」ものとして扱う。再発行を促すため
    if (Date.parse(inv.expiresAt) < now) continue;
    pendingByUser.set(inv.userId, inv);
  }
  return users
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((u) => view(u, pendingByUser.get(u.id)));
}

// ---------------------------------------------------------------------------
// 入力の検証
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new UserAdminError('メールアドレスの形式が正しくありません。');
  }
  return email;
}

function normalizeName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) throw new UserAdminError('表示名を入力してください。');
  if (name.length > 50) throw new UserAdminError('表示名は50文字以内にしてください。');
  return name;
}

/**
 * 店舗の範囲を検証する。
 *
 * 範囲が空なのは「全店舗」を意味する。店舗を限定された管理者が
 * 範囲を空にして招待できると、自分に無い全店舗の権限を他人へ渡せてしまう。
 */
async function validateStores(
  actor: Actor,
  role: Role,
  storeIds: Id[]
): Promise<Id[]> {
  const unique = [...new Set(storeIds)];

  if (roleNeedsStores(role) && unique.length === 0) {
    throw new UserAdminError('このロールでは担当店舗を1つ以上選んでください。');
  }
  if (actor.storeIds.length > 0) {
    if (unique.length === 0 || unique.some((id) => !actor.storeIds.includes(id))) {
      throw new UserAdminError('ご自身の担当範囲を超える店舗は指定できません。');
    }
  }
  if (unique.length > 0) {
    const stores = await collections.stores().list(actor.tenantId);
    const known = new Set(stores.map((s) => s.id));
    if (unique.some((id) => !known.has(id))) {
      throw new UserAdminError('存在しない店舗が指定されています。');
    }
  }
  return unique;
}

async function activeAdminCountExcluding(tenantId: Id, excludeUserId: Id): Promise<number> {
  const users = await collections.adminUsers().list(tenantId);
  return users.filter(
    (u) => u.id !== excludeUserId && u.status === 'active' && isAdminRole(u.role)
  ).length;
}

async function loadTarget(actor: Actor, userId: Id): Promise<AdminUser> {
  // テナントを跨いで引けない (原則 P-6)
  const user = await collections.adminUsers().get(actor.tenantId, userId);
  if (!user) throw new UserAdminError('利用者が見つかりません。');
  if (!canModifyUser(actor.role, user.role)) {
    throw new UserAdminError('この利用者を操作する権限がありません。');
  }
  return user;
}

// ---------------------------------------------------------------------------
// リンク (招待 / 再設定)
// ---------------------------------------------------------------------------

/**
 * リンクの形: `<tenantId>~<invitationId>~<秘密>`
 *
 * テナントを含めるのは、ログイン前で「どのテナントか」が分からない状態から
 * テナント横断の走査をせずに1件引くため。秘密の部分は保存せず、
 * SHA-256 ハッシュだけを持つ。
 */
function parseToken(token: string): { tenantId: Id; invitationId: Id; secret: string } | null {
  const parts = token.split('~');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return null;
  return { tenantId: parts[0], invitationId: parts[1], secret: parts[2] };
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

async function createInvitation(
  actor: Actor,
  user: AdminUser,
  kind: AdminInvitation['kind']
): Promise<string> {
  const invitations = collections.adminInvitations();

  // 古いリンクは使えなくする。再発行したのに前のリンクも生きている、
  // という状態を残さない
  const pending = await invitations.list(
    actor.tenantId,
    (i) => i.userId === user.id && i.status === 'pending'
  );
  for (const old of pending) {
    await invitations.update(actor.tenantId, old.id, { status: 'revoked' });
  }

  const secret = newToken(32);
  const now = Date.now();
  const invitation: AdminInvitation = {
    id: newId('inv'),
    tenantId: actor.tenantId,
    userId: user.id,
    kind,
    tokenHash: sha256Hex(secret),
    status: 'pending',
    createdBy: actor.userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (kind === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS)).toISOString(),
    acceptedAt: null,
  };
  await invitations.insert(invitation);
  return `${actor.tenantId}~${invitation.id}~${secret}`;
}

async function revokePending(tenantId: Id, userId: Id): Promise<void> {
  const invitations = collections.adminInvitations();
  const pending = await invitations.list(
    tenantId,
    (i) => i.userId === userId && i.status === 'pending'
  );
  for (const inv of pending) {
    await invitations.update(tenantId, inv.id, { status: 'revoked' });
  }
}

// ---------------------------------------------------------------------------
// 招待
// ---------------------------------------------------------------------------

export type InviteInput = {
  email: string;
  displayName: string;
  role: Role;
  storeIds: Id[];
};

/**
 * 利用者を招待する。メールは送らない（通知の実送信は未実装）。
 * 戻り値のトークンから作ったリンクを、管理者が本人へ伝える。
 * トークンはこの戻り値でしか得られない。
 */
export async function inviteUser(
  actor: Actor,
  input: InviteInput,
  ctx: RequestContext = {}
): Promise<{ user: AdminUserView; token: string }> {
  requireManager(actor);
  await ready();

  const email = normalizeEmail(input.email);
  const displayName = normalizeName(input.displayName);
  if (!canAssignRole(actor.role, input.role)) {
    throw new UserAdminError('このロールは付与できません。');
  }
  const storeIds = await validateStores(actor, input.role, input.storeIds);

  const created = await datastore().withLock(lockKey(actor.tenantId), async () => {
    const existing = await collections
      .adminUsers()
      .list(actor.tenantId, (u) => u.email.toLowerCase() === email);
    if (existing.length > 0) {
      throw new UserAdminError('このメールアドレスは既に登録されています。');
    }

    const now = new Date().toISOString();
    const user: AdminUser = {
      id: newId('usr'),
      tenantId: actor.tenantId,
      email,
      displayName,
      role: input.role,
      storeIds,
      passwordHash: '',
      status: 'invited',
      passwordChangedAt: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await collections.adminUsers().insert(user);
    const token = await createInvitation(actor, user, 'invite');
    return { user, token };
  });

  await logEvent(actor, ctx, {
    action: 'admin_user.invite',
    resourceId: created.user.id,
    path: '/admin/users',
    summary: `role=${input.role} stores=${storeIds.length}`,
  });
  return { user: view(created.user, undefined), token: created.token };
}

/**
 * リンクの再発行。招待中の人には招待を、利用中の人にはパスワード再設定を出す。
 * 停止中の人には出さない（停止を解いてから）。
 */
export async function issueLink(
  actor: Actor,
  userId: Id,
  ctx: RequestContext = {}
): Promise<{ token: string; kind: AdminInvitation['kind'] }> {
  requireManager(actor);
  await ready();

  if (userId === actor.userId) {
    throw new UserAdminError('ご自身のパスワードは「アカウント」から変更してください。');
  }

  const result = await datastore().withLock(lockKey(actor.tenantId), async () => {
    const user = await loadTarget(actor, userId);
    if (user.status === 'suspended') {
      throw new UserAdminError('停止中の利用者には発行できません。先に停止を解除してください。');
    }
    const kind: AdminInvitation['kind'] = user.status === 'invited' ? 'invite' : 'reset';
    const token = await createInvitation(actor, user, kind);
    return { token, kind };
  });

  await logEvent(actor, ctx, {
    action: result.kind === 'invite' ? 'admin_user.invite_reissue' : 'admin_user.reset_issue',
    resourceId: userId,
    path: '/admin/users',
  });
  return result;
}

// ---------------------------------------------------------------------------
// 停止 / 再開 / ロール変更
// ---------------------------------------------------------------------------

export async function setUserStatus(
  actor: Actor,
  userId: Id,
  next: 'active' | 'suspended',
  ctx: RequestContext = {}
): Promise<void> {
  requireManager(actor);
  await ready();

  if (userId === actor.userId) {
    throw new UserAdminError('ご自身は停止できません。');
  }

  await datastore().withLock(lockKey(actor.tenantId), async () => {
    const user = await loadTarget(actor, userId);

    if (next === 'suspended') {
      if (user.status === 'suspended') return;
      // 管理者が0人になると、誰も利用者を管理できなくなる
      if (isAdminRole(user.role) && user.status === 'active') {
        if ((await activeAdminCountExcluding(actor.tenantId, user.id)) === 0) {
          throw new UserAdminError('最後の管理者は停止できません。');
        }
      }
      await collections
        .adminUsers()
        .update(actor.tenantId, user.id, { status: 'suspended', updatedAt: new Date().toISOString() });
      // 停止中の人が、手元のリンクでパスワードを設定して復帰できてはいけない
      await revokePending(actor.tenantId, user.id);
      return;
    }

    if (user.status !== 'suspended') return;
    // パスワード未設定のまま停止された人は、解除後も招待中に戻す
    const restored: AdminUser['status'] = user.passwordHash ? 'active' : 'invited';
    await collections
      .adminUsers()
      .update(actor.tenantId, user.id, { status: restored, updatedAt: new Date().toISOString() });
  });

  await logEvent(actor, ctx, {
    action: next === 'suspended' ? 'admin_user.suspend' : 'admin_user.resume',
    resourceId: userId,
    path: '/admin/users',
  });
}

export async function changeRole(
  actor: Actor,
  userId: Id,
  role: Role,
  storeIds: Id[],
  ctx: RequestContext = {}
): Promise<void> {
  requireManager(actor);
  await ready();

  if (userId === actor.userId) {
    // 自分のロールを下げて操作不能になる事故と、上げて昇格する経路の両方を断つ
    throw new UserAdminError('ご自身のロールは変更できません。');
  }
  if (!canAssignRole(actor.role, role)) {
    throw new UserAdminError('このロールは付与できません。');
  }
  const scoped = await validateStores(actor, role, storeIds);

  await datastore().withLock(lockKey(actor.tenantId), async () => {
    const user = await loadTarget(actor, userId);
    if (isAdminRole(user.role) && !isAdminRole(role) && user.status === 'active') {
      if ((await activeAdminCountExcluding(actor.tenantId, user.id)) === 0) {
        throw new UserAdminError('最後の管理者のロールは変更できません。');
      }
    }
    await collections
      .adminUsers()
      .update(actor.tenantId, user.id, {
        role,
        storeIds: scoped,
        updatedAt: new Date().toISOString(),
      });
  });

  await logEvent(actor, ctx, {
    action: 'admin_user.change_role',
    resourceId: userId,
    path: '/admin/users',
    summary: `role=${role} stores=${scoped.length}`,
  });
}

// ---------------------------------------------------------------------------
// リンクからのパスワード設定
// ---------------------------------------------------------------------------

export type InvitationPreview = {
  kind: AdminInvitation['kind'];
  displayName: string;
  email: string;
  expiresAt: string;
};

/**
 * リンクが有効かを確かめる。無効な理由（存在しない / 期限切れ / 使用済み /
 * 失効 / 停止）は区別せず、全部 null で返す。リンクの状態を探る材料を渡さない。
 */
async function resolveInvitation(
  token: string
): Promise<{ invitation: AdminInvitation; user: AdminUser } | null> {
  const parsed = parseToken(token);
  if (!parsed) return null;

  await ready();
  const invitation = await collections
    .adminInvitations()
    .get(parsed.tenantId, parsed.invitationId);
  if (!invitation) return null;
  if (!safeEqualHex(invitation.tokenHash, sha256Hex(parsed.secret))) return null;
  if (invitation.status !== 'pending') return null;
  if (Date.parse(invitation.expiresAt) < Date.now()) return null;

  const user = await collections.adminUsers().get(invitation.tenantId, invitation.userId);
  if (!user || user.status === 'suspended') return null;
  return { invitation, user };
}

export async function previewInvitation(token: string): Promise<InvitationPreview | null> {
  const found = await resolveInvitation(token);
  if (!found) return null;
  return {
    kind: found.invitation.kind,
    displayName: found.user.displayName,
    email: found.user.email,
    expiresAt: found.invitation.expiresAt,
  };
}

/**
 * パスワードを設定する。成功したら利用者を返す（呼び出し側がセッションを張る）。
 * リンクは1回しか使えない。
 */
export async function acceptInvitation(
  token: string,
  password: string,
  ctx: RequestContext = {}
): Promise<AdminUser> {
  const parsed = parseToken(token);
  if (!parsed) throw new UserAdminError('このリンクは無効か、期限が切れています。');

  const accepted = await datastore().withLock(`admin_invitation:${parsed.invitationId}`, async () => {
    // ロックの内側で引き直す。同じリンクを2か所で同時に使われても1回しか通さない
    const found = await resolveInvitation(token);
    if (!found) throw new UserAdminError('このリンクは無効か、期限が切れています。');

    const problem = validatePassword(password, { email: found.user.email });
    if (problem) throw new UserAdminError(problem);

    const now = new Date().toISOString();
    const updated = await collections.adminUsers().update(found.user.tenantId, found.user.id, {
      passwordHash: await hashPassword(password),
      passwordChangedAt: now,
      status: 'active',
      updatedAt: now,
    });
    await collections
      .adminInvitations()
      .update(found.invitation.tenantId, found.invitation.id, {
        status: 'accepted',
        acceptedAt: now,
      });
    return { user: updated ?? found.user, kind: found.invitation.kind };
  });

  await logEvent({ tenantId: accepted.user.tenantId, userId: accepted.user.id }, ctx, {
    action: accepted.kind === 'invite' ? 'admin_user.invite_accept' : 'admin_user.reset_accept',
    resourceId: accepted.user.id,
    path: `/admin/invite`,
  });
  return accepted.user;
}

// ---------------------------------------------------------------------------
// 自分のパスワード変更
// ---------------------------------------------------------------------------

/**
 * 自分のパスワードを変える。現在のパスワードを必ず確かめる。
 * 席を離れたあとの画面から、他人が勝手にパスワードを変えられないようにするため。
 */
export async function changeOwnPassword(
  actor: Actor,
  current: string,
  next: string,
  ctx: RequestContext = {}
): Promise<AdminUser> {
  await ready();
  const user = await collections.adminUsers().get(actor.tenantId, actor.userId);
  if (!user || user.status !== 'active') {
    throw new UserAdminError('アカウントが利用できません。');
  }

  if (!(await verifyPassword(current, user.passwordHash))) {
    await logEvent(actor, ctx, {
      action: 'admin_user.password_change_failed',
      resourceId: user.id,
      path: '/admin/account',
      statusCode: 401,
    });
    throw new UserAdminError('現在のパスワードが違います。');
  }

  const problem = validatePassword(next, { email: user.email });
  if (problem) throw new UserAdminError(problem);
  if (next === current) {
    throw new UserAdminError('現在と同じパスワードには変更できません。');
  }

  const updated = await collections.adminUsers().update(actor.tenantId, user.id, {
    passwordHash: await hashPassword(next),
    passwordChangedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  // 未使用のリンクも使えなくする。変更前に発行した再設定リンクで
  // パスワードを上書きされないようにする
  await revokePending(actor.tenantId, user.id);

  await logEvent(actor, ctx, {
    action: 'admin_user.password_change',
    resourceId: user.id,
    path: '/admin/account',
  });
  return updated ?? user;
}
