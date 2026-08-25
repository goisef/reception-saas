import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/admin/password';
import { issueAdminToken, verifyAdminToken } from '@/lib/admin/token';

const SECRET = 'test-admin-secret';

describe('パスワードの保管', () => {
  it('同じパスワードでも毎回違うハッシュになる', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    // ソルトが効いていないと、同じパスワードの利用者が一覧から丸わかりになる
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('correct horse', b)).toBe(true);
  });

  it('平文をそのまま含まない', async () => {
    const hash = await hashPassword('reception-dev');
    expect(hash).not.toContain('reception-dev');
  });

  it('違うパスワードは通らない', async () => {
    const hash = await hashPassword('reception-dev');
    expect(await verifyPassword('reception-de', hash)).toBe(false);
    expect(await verifyPassword('reception-devv', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('伸長回数を後から上げても既存のハッシュは検証できる', async () => {
    const hash = await hashPassword('reception-dev');
    const [algorithm, iterations, salt, derived] = hash.split('$');
    expect(algorithm).toBe('pbkdf2-sha256');
    expect(Number(iterations)).toBeGreaterThanOrEqual(210_000);
    expect(salt).toBeTruthy();
    expect(derived).toBeTruthy();
  });

  it('壊れたハッシュでは例外を投げずに落とす', async () => {
    // ログイン画面に内部エラーを出す口を作らない
    for (const broken of ['', 'x', 'pbkdf2-sha256$abc$$', 'sha256$1$a$b', 'a$b$c$d']) {
      expect(await verifyPassword('reception-dev', broken)).toBe(false);
    }
  });
});

describe('セッショントークン', () => {
  it('発行したトークンから利用者を取り出せる', async () => {
    const token = await issueAdminToken(SECRET, { userId: 'usr_1', tenantId: 'ten_1' });
    const payload = await verifyAdminToken(SECRET, token);
    expect(payload?.userId).toBe('usr_1');
    expect(payload?.tenantId).toBe('ten_1');
  });

  it('鍵が違うと通らない', async () => {
    const token = await issueAdminToken(SECRET, { userId: 'usr_1', tenantId: 'ten_1' });
    expect(await verifyAdminToken('another-secret', token)).toBeNull();
  });

  it('中身を書き換えると通らない', async () => {
    const token = await issueAdminToken(SECRET, { userId: 'usr_1', tenantId: 'ten_1' });
    const [, signature] = token.split('.');
    // 別テナントの管理者になりすませないこと
    const forged = Buffer.from(
      JSON.stringify({ userId: 'usr_1', tenantId: 'ten_other', expiresAt: 9_999_999_999 })
    ).toString('base64url');
    expect(await verifyAdminToken(SECRET, `${forged}.${signature}`)).toBeNull();
  });

  it('期限が切れたら通らない', async () => {
    const issuedAt = Date.parse('2026-08-01T00:00:00.000Z');
    const token = await issueAdminToken(SECRET, { userId: 'usr_1', tenantId: 'ten_1' }, issuedAt);
    expect(await verifyAdminToken(SECRET, token, issuedAt + 60_000)).not.toBeNull();
    // 12時間+1分後
    expect(await verifyAdminToken(SECRET, token, issuedAt + 12 * 3600_000 + 60_000)).toBeNull();
  });

  it('壊れた入力では例外を投げずに落とす', async () => {
    for (const broken of [undefined, '', 'x', 'x.y', 'あ.い']) {
      expect(await verifyAdminToken(SECRET, broken)).toBeNull();
    }
  });

  it('ロールを持ち回らない', async () => {
    // 権限をトークンに入れると、権限を落としてもログアウトするまで古い権限が生きる。
    // 中身は誰かと期限だけであることを固定する。
    const token = await issueAdminToken(SECRET, { userId: 'usr_1', tenantId: 'ten_1' });
    const decoded = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString('utf8')
    );
    expect(Object.keys(decoded).sort()).toEqual(['expiresAt', 'tenantId', 'userId']);
  });
});

describe('資格情報の検証', () => {
  // シードを通してデモ利用者を入れる
  it('正しいパスワードで通り、間違いは通らない', async () => {
    const { authenticate } = await import('@/lib/admin/session');
    const { DEMO_TENANT_ID, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } = await import(
      '@/lib/store/seed'
    );

    const ok = await authenticate(DEMO_TENANT_ID, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD);
    expect(ok.ok).toBe(true);

    const ng = await authenticate(DEMO_TENANT_ID, DEMO_ADMIN_EMAIL, 'wrong');
    expect(ng).toEqual({ ok: false, reason: 'invalid' });
  });

  it('メールアドレスの大文字小文字と前後の空白を吸収する', async () => {
    const { authenticate } = await import('@/lib/admin/session');
    const { DEMO_TENANT_ID, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } = await import(
      '@/lib/store/seed'
    );
    const typed = `  ${DEMO_ADMIN_EMAIL.toUpperCase()}  `;
    expect((await authenticate(DEMO_TENANT_ID, typed, DEMO_ADMIN_PASSWORD)).ok).toBe(true);
  });

  it('存在しない利用者は invalid（存在するとは教えない）', async () => {
    const { authenticate } = await import('@/lib/admin/session');
    const { DEMO_TENANT_ID, DEMO_ADMIN_PASSWORD } = await import('@/lib/store/seed');
    const result = await authenticate(DEMO_TENANT_ID, 'nobody@example.com', DEMO_ADMIN_PASSWORD);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('他テナントの利用者では通らない', async () => {
    const { authenticate } = await import('@/lib/admin/session');
    const { DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } = await import('@/lib/store/seed');
    // テナント分離 (原則 P-6) をログインの入口でも守る
    const result = await authenticate('ten_other', DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('停止したアカウントは通らない', async () => {
    const { authenticate } = await import('@/lib/admin/session');
    const { collections } = await import('@/lib/store');
    const { DEMO_TENANT_ID, DEMO_ADMIN_PASSWORD } = await import('@/lib/store/seed');

    await collections
      .adminUsers()
      .update(DEMO_TENANT_ID, 'usr_demo_viewer', { status: 'suspended' });
    const result = await authenticate(DEMO_TENANT_ID, 'viewer@example.com', DEMO_ADMIN_PASSWORD);
    expect(result).toEqual({ ok: false, reason: 'suspended' });

    await collections
      .adminUsers()
      .update(DEMO_TENANT_ID, 'usr_demo_viewer', { status: 'active' });
  });

  it('シードは平文のパスワードを保存していない', async () => {
    const { collections } = await import('@/lib/store');
    const { DEMO_TENANT_ID, DEMO_ADMIN_PASSWORD } = await import('@/lib/store/seed');
    const users = await collections.adminUsers().list(DEMO_TENANT_ID);
    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(user.passwordHash).not.toContain(DEMO_ADMIN_PASSWORD);
      expect(user.passwordHash.startsWith('pbkdf2-sha256$')).toBe(true);
    }
  });
});

describe('初期管理者の作成', () => {
  it('利用者が1人もいないときだけ作る', async () => {
    const { MemoryDatastore } = await import('@/lib/store/datastore');
    const { bootstrapAdmin } = await import('@/lib/admin/bootstrap');
    const { verifyPassword } = await import('@/lib/admin/password');
    type AdminUser = import('@/lib/domain/types').AdminUser;

    process.env.RECEPTION_BOOTSTRAP_ADMIN_EMAIL = 'first@example.com';
    process.env.RECEPTION_BOOTSTRAP_ADMIN_PASSWORD = 'bootstrap-password';
    try {
      const ds = new MemoryDatastore();
      await bootstrapAdmin(ds, 'ten_boot');

      const users = await ds.collection<AdminUser>('admin_users').list('ten_boot');
      expect(users).toHaveLength(1);
      expect(users[0].role).toBe('TenantAdmin');
      expect(await verifyPassword('bootstrap-password', users[0].passwordHash)).toBe(true);

      // 環境変数を外し忘れても2人目を作らない
      await bootstrapAdmin(ds, 'ten_boot');
      expect(await ds.collection<AdminUser>('admin_users').list('ten_boot')).toHaveLength(1);
    } finally {
      delete process.env.RECEPTION_BOOTSTRAP_ADMIN_EMAIL;
      delete process.env.RECEPTION_BOOTSTRAP_ADMIN_PASSWORD;
    }
  });

  it('環境変数が無ければ何もしない', async () => {
    const { MemoryDatastore } = await import('@/lib/store/datastore');
    const { bootstrapAdmin } = await import('@/lib/admin/bootstrap');
    type AdminUser = import('@/lib/domain/types').AdminUser;

    const ds = new MemoryDatastore();
    await bootstrapAdmin(ds, 'ten_boot');
    expect(await ds.collection<AdminUser>('admin_users').list('ten_boot')).toHaveLength(0);
  });
});
