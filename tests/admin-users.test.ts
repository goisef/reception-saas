import { beforeAll, describe, expect, it } from 'vitest';
import { authenticate } from '@/lib/admin/session';
import {
  UserAdminError,
  acceptInvitation,
  changeOwnPassword,
  changeRole,
  inviteUser,
  issueLink,
  listUsers,
  previewInvitation,
  setUserStatus,
  type Actor,
} from '@/lib/admin/users';
import { hashPassword } from '@/lib/admin/password';
import { collections, ready } from '@/lib/store';
import {
  DEMO_ADMIN_EMAIL,
  DEMO_ADMIN_PASSWORD,
  DEMO_STORE_OSAKA,
  DEMO_STORE_UMEDA,
  DEMO_TENANT_ID,
} from '@/lib/store/seed';
import type { AdminUser, Role } from '@/lib/domain/types';

const GOOD_PASSWORD = 'correct horse battery staple';

/**
 * 同じテストを Firestore エミュレータにも当てられる。
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 npx vitest run tests/admin-users.test.ts
 *
 * ロック・同時実行・テナント分離は、ドライバによって効き方が変わりうる。
 * 実行のたびに状態が残るので、作る値には実行ごとの印を付けて衝突を避ける。
 */
const RUN = Date.now().toString(36);

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) return;
  const { createFirestoreDatastore } = await import('@/lib/store/firestore');
  const { seed } = await import('@/lib/store/seed');
  const datastore = createFirestoreDatastore({ projectId: 'demo-reception' });
  // lib/store/index.ts が参照するシングルトンを先に差し込む
  (globalThis as Record<string, unknown>)['__reception_datastore__'] = {
    datastore,
    seeded: seed(datastore),
  };
});

const admin: Actor = {
  tenantId: DEMO_TENANT_ID,
  userId: 'usr_demo_admin',
  role: 'TenantAdmin',
  storeIds: [],
};

let seq = 0;
function email(label: string): string {
  seq += 1;
  return `${label}-${RUN}-${seq}@example.com`;
}

async function rejects(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(UserAdminError);
  await expect(promise).rejects.toThrow(pattern);
}

/** 招待してパスワードを設定するまでを済ませる。 */
async function createActiveUser(role: Role = 'Viewer', storeIds: string[] = []) {
  const address = email('active');
  const { user, token } = await inviteUser(admin, {
    email: address,
    displayName: 'テスト利用者',
    role,
    storeIds,
  });
  await acceptInvitation(token, GOOD_PASSWORD);
  return { id: user.id, email: address };
}

/** 別テナントに利用者を直接入れる。テナント分離の確認用。 */
async function insertUser(tenantId: string, role: Role, status: AdminUser['status'] = 'active') {
  await ready();
  seq += 1;
  const now = new Date().toISOString();
  const user: AdminUser = {
    id: `usr_fixture_${RUN}_${seq}`,
    tenantId,
    email: `fixture-${RUN}-${seq}@example.com`,
    displayName: 'フィクスチャ',
    role,
    storeIds: [],
    passwordHash: await hashPassword(GOOD_PASSWORD),
    status,
    passwordChangedAt: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await collections.adminUsers().insert(user);
  return user;
}

describe('招待', () => {
  it('招待中の利用者はログインできない', async () => {
    const address = email('invitee');
    const { user } = await inviteUser(admin, {
      email: address,
      displayName: '新人',
      role: 'Viewer',
      storeIds: [],
    });
    expect(user.status).toBe('invited');

    const stored = await collections.adminUsers().get(DEMO_TENANT_ID, user.id);
    expect(stored?.passwordHash).toBe('');
    // 空のハッシュで何を入れても通らない
    for (const attempt of ['', GOOD_PASSWORD, DEMO_ADMIN_PASSWORD]) {
      expect(await authenticate(DEMO_TENANT_ID, address, attempt)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
  });

  it('リンクの秘密を保存しない（ハッシュだけ）', async () => {
    const { user, token } = await inviteUser(admin, {
      email: email('hash'),
      displayName: '確認用',
      role: 'Viewer',
      storeIds: [],
    });
    const secret = token.split('~')[2];
    const invitations = await collections
      .adminInvitations()
      .list(DEMO_TENANT_ID, (i) => i.userId === user.id);
    expect(invitations).toHaveLength(1);
    expect(JSON.stringify(invitations[0])).not.toContain(secret);
    expect(invitations[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('メールアドレスは大文字小文字を区別せず重複を許さない', async () => {
    const address = email('dup');
    await inviteUser(admin, { email: address, displayName: 'A', role: 'Viewer', storeIds: [] });
    await rejects(
      inviteUser(admin, {
        email: address.toUpperCase(),
        displayName: 'B',
        role: 'Viewer',
        storeIds: [],
      }),
      /既に登録/
    );
  });

  it('同時に同じアドレスを招待しても1人しか作らない', async () => {
    const address = email('race');
    const results = await Promise.allSettled([
      inviteUser(admin, { email: address, displayName: 'A', role: 'Viewer', storeIds: [] }),
      inviteUser(admin, { email: address, displayName: 'B', role: 'Viewer', storeIds: [] }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const users = await collections
      .adminUsers()
      .list(DEMO_TENANT_ID, (u) => u.email === address);
    expect(users).toHaveLength(1);
  });

  it('管理者以外は招待できない', async () => {
    for (const role of ['AreaManager', 'StoreManager', 'Staff', 'ReceptionOnly', 'Viewer'] as Role[]) {
      await rejects(
        inviteUser(
          { ...admin, userId: 'usr_x', role },
          { email: email('nope'), displayName: 'X', role: 'Viewer', storeIds: [] }
        ),
        /権限がありません/
      );
    }
  });

  it('SuperAdmin を作る招待は TenantAdmin からは通らない', async () => {
    await rejects(
      inviteUser(admin, {
        email: email('root'),
        displayName: '権限昇格',
        role: 'SuperAdmin',
        storeIds: [],
      }),
      /付与できません/
    );
  });

  it('店長・スタッフは担当店舗が必須（空だと全店舗になるため）', async () => {
    await rejects(
      inviteUser(admin, {
        email: email('mgr'),
        displayName: '店長',
        role: 'StoreManager',
        storeIds: [],
      }),
      /1つ以上/
    );
    const { user } = await inviteUser(admin, {
      email: email('mgr'),
      displayName: '店長',
      role: 'StoreManager',
      storeIds: [DEMO_STORE_OSAKA],
    });
    expect(user.storeIds).toEqual([DEMO_STORE_OSAKA]);
  });

  it('存在しない店舗は指定できない', async () => {
    await rejects(
      inviteUser(admin, {
        email: email('ghost'),
        displayName: '店長',
        role: 'StoreManager',
        storeIds: ['sto_does_not_exist'],
      }),
      /存在しない店舗/
    );
  });

  it('店舗を限定された管理者は、自分に無い範囲を渡せない', async () => {
    const scoped: Actor = { ...admin, storeIds: [DEMO_STORE_OSAKA] };

    // 範囲を空にすると全店舗になってしまう
    await rejects(
      inviteUser(scoped, { email: email('s'), displayName: 'A', role: 'Viewer', storeIds: [] }),
      /担当範囲/
    );
    await rejects(
      inviteUser(scoped, {
        email: email('s'),
        displayName: 'A',
        role: 'Viewer',
        storeIds: [DEMO_STORE_UMEDA],
      }),
      /担当範囲/
    );
    const ok = await inviteUser(scoped, {
      email: email('s'),
      displayName: 'A',
      role: 'Viewer',
      storeIds: [DEMO_STORE_OSAKA],
    });
    expect(ok.user.storeIds).toEqual([DEMO_STORE_OSAKA]);
  });

  it('不正なメールアドレス・空の名前は弾く', async () => {
    await rejects(
      inviteUser(admin, { email: 'not-an-email', displayName: 'A', role: 'Viewer', storeIds: [] }),
      /形式/
    );
    await rejects(
      inviteUser(admin, { email: email('n'), displayName: '   ', role: 'Viewer', storeIds: [] }),
      /表示名/
    );
  });

  it('監査ログに残り、メールアドレスは書かれない', async () => {
    const address = email('audit');
    const { user } = await inviteUser(admin, {
      email: address,
      displayName: '監査',
      role: 'Viewer',
      storeIds: [],
    });
    const logs = await collections
      .auditLogs()
      .list(DEMO_TENANT_ID, (l) => l.action === 'admin_user.invite' && l.resourceId === user.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].actorId).toBe(admin.userId);
    expect(JSON.stringify(logs[0])).not.toContain(address);
  });
});

describe('リンクからのパスワード設定', () => {
  it('設定するとログインでき、リンクは1回しか使えない', async () => {
    const address = email('accept');
    const { token } = await inviteUser(admin, {
      email: address,
      displayName: '受諾',
      role: 'Viewer',
      storeIds: [],
    });

    const preview = await previewInvitation(token);
    expect(preview).toMatchObject({ kind: 'invite', email: address, displayName: '受諾' });

    await acceptInvitation(token, GOOD_PASSWORD);
    const login = await authenticate(DEMO_TENANT_ID, address, GOOD_PASSWORD);
    expect(login.ok).toBe(true);

    // 使用済み
    expect(await previewInvitation(token)).toBeNull();
    await rejects(acceptInvitation(token, 'another long passphrase'), /無効か/);
    // 先に設定したパスワードが生きている
    expect((await authenticate(DEMO_TENANT_ID, address, GOOD_PASSWORD)).ok).toBe(true);
  });

  it('同じリンクを同時に使っても1回しか通らない', async () => {
    const { token } = await inviteUser(admin, {
      email: email('twice'),
      displayName: '同時',
      role: 'Viewer',
      storeIds: [],
    });
    const results = await Promise.allSettled([
      acceptInvitation(token, 'first long passphrase'),
      acceptInvitation(token, 'second long passphrase'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('弱いパスワードは弾き、リンクは使える状態のまま残る', async () => {
    const { token } = await inviteUser(admin, {
      email: email('weak'),
      displayName: '弱い',
      role: 'Viewer',
      storeIds: [],
    });
    await rejects(acceptInvitation(token, 'short'), /文字以上/);
    // 打ち間違いでリンクを失わない
    expect(await previewInvitation(token)).not.toBeNull();
    await acceptInvitation(token, GOOD_PASSWORD);
  });

  it('壊れた・改ざんしたリンクは区別なく無効', async () => {
    const { token } = await inviteUser(admin, {
      email: email('tamper'),
      displayName: '改ざん',
      role: 'Viewer',
      storeIds: [],
    });
    const [tenant, id, secret] = token.split('~');

    const bad = [
      '',
      'garbage',
      'a~b',
      `${tenant}~${id}~`,
      `${tenant}~${id}~${secret}x`,
      `${tenant}~${id}~${secret.slice(1)}`,
      `ten_other~${id}~${secret}`, // 別テナントとして引く
      `${tenant}~inv_unknown~${secret}`,
    ];
    for (const candidate of bad) {
      expect(await previewInvitation(candidate)).toBeNull();
      await expect(acceptInvitation(candidate, GOOD_PASSWORD)).rejects.toBeInstanceOf(
        UserAdminError
      );
    }
    expect(await previewInvitation(token)).not.toBeNull();
  });

  it('期限切れのリンクは使えない', async () => {
    const { user, token } = await inviteUser(admin, {
      email: email('expire'),
      displayName: '期限',
      role: 'Viewer',
      storeIds: [],
    });
    const [invitation] = await collections
      .adminInvitations()
      .list(DEMO_TENANT_ID, (i) => i.userId === user.id);
    await collections.adminInvitations().update(DEMO_TENANT_ID, invitation.id, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await previewInvitation(token)).toBeNull();
    await rejects(acceptInvitation(token, GOOD_PASSWORD), /無効か/);
  });

  it('再発行すると前のリンクは使えなくなる', async () => {
    const { user, token: first } = await inviteUser(admin, {
      email: email('reissue'),
      displayName: '再発行',
      role: 'Viewer',
      storeIds: [],
    });
    const { token: second, kind } = await issueLink(admin, user.id);
    expect(kind).toBe('invite');
    expect(await previewInvitation(first)).toBeNull();
    expect(await previewInvitation(second)).not.toBeNull();
  });

  it('利用中の人にはパスワード再設定リンクになり、設定すると既存のパスワードは使えない', async () => {
    const target = await createActiveUser();
    const { token, kind } = await issueLink(admin, target.id);
    expect(kind).toBe('reset');

    await acceptInvitation(token, 'a brand new passphrase');
    expect((await authenticate(DEMO_TENANT_ID, target.email, GOOD_PASSWORD)).ok).toBe(false);
    expect((await authenticate(DEMO_TENANT_ID, target.email, 'a brand new passphrase')).ok).toBe(
      true
    );
  });

  it('再設定するとパスワード変更時刻が進み、古いセッションが無効になる根拠が残る', async () => {
    const target = await createActiveUser();
    const before = await collections.adminUsers().get(DEMO_TENANT_ID, target.id);
    await new Promise((r) => setTimeout(r, 15));
    const { token } = await issueLink(admin, target.id);
    await acceptInvitation(token, 'a brand new passphrase');
    const after = await collections.adminUsers().get(DEMO_TENANT_ID, target.id);
    expect(Date.parse(after!.passwordChangedAt!)).toBeGreaterThan(
      Date.parse(before!.passwordChangedAt!)
    );
  });
});

describe('停止・再開', () => {
  it('停止するとログインできず、未使用のリンクも使えなくなる', async () => {
    const { user, token } = await inviteUser(admin, {
      email: email('suspend'),
      displayName: '停止',
      role: 'Viewer',
      storeIds: [],
    });
    await setUserStatus(admin, user.id, 'suspended');
    // 手元のリンクで復帰できてはいけない
    expect(await previewInvitation(token)).toBeNull();
    await rejects(issueLink(admin, user.id), /停止中/);

    await setUserStatus(admin, user.id, 'active');
    const restored = await collections.adminUsers().get(DEMO_TENANT_ID, user.id);
    // パスワード未設定のまま停止した人は、解除後も招待中に戻る
    expect(restored?.status).toBe('invited');
  });

  it('停止した利用中の人は suspended としてログインを拒否される', async () => {
    const target = await createActiveUser();
    await setUserStatus(admin, target.id, 'suspended');
    expect(await authenticate(DEMO_TENANT_ID, target.email, GOOD_PASSWORD)).toEqual({
      ok: false,
      reason: 'suspended',
    });
    await setUserStatus(admin, target.id, 'active');
    expect((await authenticate(DEMO_TENANT_ID, target.email, GOOD_PASSWORD)).ok).toBe(true);
  });

  it('自分自身は停止・ロール変更・再設定リンク発行ができない', async () => {
    await rejects(setUserStatus(admin, admin.userId, 'suspended'), /ご自身/);
    await rejects(changeRole(admin, admin.userId, 'Viewer', []), /ご自身/);
    await rejects(issueLink(admin, admin.userId), /アカウント/);
  });

  it('最後の管理者は停止・降格できない', async () => {
    const tenant = `ten_last_admin_${RUN}`;
    const only = await insertUser(tenant, 'TenantAdmin');
    // 運営側 (SuperAdmin) は利用者テーブルに居ないので、管理者が0人になりうる
    const platform: Actor = { tenantId: tenant, userId: 'usr_platform', role: 'SuperAdmin', storeIds: [] };

    await rejects(setUserStatus(platform, only.id, 'suspended'), /最後の管理者/);
    await rejects(changeRole(platform, only.id, 'Viewer', []), /最後の管理者/);

    // 2人目がいれば外せる
    await insertUser(tenant, 'TenantAdmin');
    await setUserStatus(platform, only.id, 'suspended');
  });

  it('TenantAdmin は SuperAdmin に触れない', async () => {
    const tenant = `ten_super_${RUN}`;
    const root = await insertUser(tenant, 'SuperAdmin');
    const tenantAdmin: Actor = { tenantId: tenant, userId: 'usr_ta', role: 'TenantAdmin', storeIds: [] };
    await rejects(setUserStatus(tenantAdmin, root.id, 'suspended'), /権限がありません/);
    await rejects(issueLink(tenantAdmin, root.id), /権限がありません/);
    await rejects(changeRole(tenantAdmin, root.id, 'Viewer', []), /権限がありません/);
  });
});

describe('ロール変更', () => {
  it('ロールと担当店舗を変えられる', async () => {
    const target = await createActiveUser('Viewer');
    await changeRole(admin, target.id, 'StoreManager', [DEMO_STORE_UMEDA]);
    const after = await collections.adminUsers().get(DEMO_TENANT_ID, target.id);
    expect(after).toMatchObject({ role: 'StoreManager', storeIds: [DEMO_STORE_UMEDA] });
  });

  it('SuperAdmin への変更・店舗なしの店長への変更は弾く', async () => {
    const target = await createActiveUser('Viewer');
    await rejects(changeRole(admin, target.id, 'SuperAdmin', []), /付与できません/);
    await rejects(changeRole(admin, target.id, 'StoreManager', []), /1つ以上/);
  });

  it('管理者でない人は変更できない', async () => {
    const target = await createActiveUser('Viewer');
    const manager: Actor = { ...admin, userId: 'usr_m', role: 'StoreManager' };
    await rejects(changeRole(manager, target.id, 'Staff', [DEMO_STORE_OSAKA]), /権限がありません/);
  });
});

describe('テナント分離', () => {
  it('他テナントの利用者を引けない・操作できない', async () => {
    const other = await insertUser(`ten_other_${RUN}`, 'Viewer');
    await rejects(setUserStatus(admin, other.id, 'suspended'), /見つかりません/);
    await rejects(issueLink(admin, other.id), /見つかりません/);
    await rejects(changeRole(admin, other.id, 'Staff', [DEMO_STORE_OSAKA]), /見つかりません/);

    const untouched = await collections.adminUsers().get(`ten_other_${RUN}`, other.id);
    expect(untouched?.status).toBe('active');
  });

  it('一覧に他テナントの利用者もパスワードハッシュも出ない', async () => {
    await insertUser(`ten_other_${RUN}`, 'Viewer');
    const users = await listUsers(admin);
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      expect(u.tenantId).toBe(DEMO_TENANT_ID);
      expect(u).not.toHaveProperty('passwordHash');
    }
  });

  it('管理者以外は一覧を見られない', async () => {
    await rejects(listUsers({ ...admin, role: 'Viewer' }), /権限がありません/);
  });
});

describe('自分のパスワード変更', () => {
  it('現在のパスワードが違うと変更できず、元のパスワードのまま', async () => {
    const target = await createActiveUser();
    const actor: Actor = { ...admin, userId: target.id, role: 'Viewer' };
    await rejects(changeOwnPassword(actor, 'wrong password!', 'a brand new passphrase'), /現在のパスワード/);
    expect((await authenticate(DEMO_TENANT_ID, target.email, GOOD_PASSWORD)).ok).toBe(true);

    const failed = await collections
      .auditLogs()
      .list(DEMO_TENANT_ID, (l) => l.action === 'admin_user.password_change_failed' && l.actorId === target.id);
    expect(failed).toHaveLength(1);
  });

  it('変更すると新しいパスワードだけが通り、変更時刻が残る', async () => {
    const target = await createActiveUser();
    const actor: Actor = { ...admin, userId: target.id, role: 'Viewer' };
    const updated = await changeOwnPassword(actor, GOOD_PASSWORD, 'a brand new passphrase');
    expect(updated.passwordChangedAt).toBeTruthy();

    expect((await authenticate(DEMO_TENANT_ID, target.email, GOOD_PASSWORD)).ok).toBe(false);
    expect((await authenticate(DEMO_TENANT_ID, target.email, 'a brand new passphrase')).ok).toBe(true);
  });

  it('同じパスワード・弱いパスワードへは変更できない', async () => {
    const target = await createActiveUser();
    const actor: Actor = { ...admin, userId: target.id, role: 'Viewer' };
    await rejects(changeOwnPassword(actor, GOOD_PASSWORD, GOOD_PASSWORD), /現在と同じ/);
    await rejects(changeOwnPassword(actor, GOOD_PASSWORD, 'short'), /文字以上/);
  });

  it('変更すると未使用の再設定リンクも使えなくなる', async () => {
    const target = await createActiveUser();
    const { token } = await issueLink(admin, target.id);
    const actor: Actor = { ...admin, userId: target.id, role: 'Viewer' };
    await changeOwnPassword(actor, GOOD_PASSWORD, 'a brand new passphrase');
    // 変更前に発行されたリンクでパスワードを上書きされない
    expect(await previewInvitation(token)).toBeNull();
  });

  it('シードの管理者は引き続き既定のパスワードでログインできる', async () => {
    expect((await authenticate(DEMO_TENANT_ID, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD)).ok).toBe(true);
  });
});
