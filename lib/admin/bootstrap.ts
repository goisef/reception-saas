import { newId } from '../core/ids';
import { hashPassword } from './password';
import type { Datastore } from '../store/datastore';
import type { AdminUser } from '../domain/types';

/**
 * 最初の管理ユーザーを作る。
 *
 * 本番は RECEPTION_SEED=0 でシードが走らないため、素の状態では
 * 管理ユーザーが1人もおらず、誰も管理Webにログインできない。
 * かといって既定のログインを焼き込むと、それが本番に残ってしまう。
 *
 * そこで環境変数で1人だけ作れるようにし、
 *   - 管理ユーザーが1人もいないときだけ作る
 *   - 作ったあとは環境変数を外す
 * という運用にする。2人目以降は管理Webから招待する（画面は未実装）。
 *
 * 環境変数を外し忘れても、既に利用者がいれば何もしない。
 * パスワードを変更したあとに古いパスワードで作り直される、という事故は起きない。
 */
export async function bootstrapAdmin(ds: Datastore, tenantId: string): Promise<void> {
  const email = process.env.RECEPTION_BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.RECEPTION_BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;

  // 同時起動した複数インスタンスが2人作らないように直列化する
  await ds.withLock(`bootstrap_admin:${tenantId}`, async () => {
    const users = ds.collection<AdminUser>('admin_users');
    const existing = await users.list(tenantId);
    if (existing.length > 0) return;

    const now = new Date().toISOString();
    await users.insert({
      id: newId('usr'),
      tenantId,
      email: email.trim().toLowerCase(),
      displayName: '初期管理者',
      role: 'TenantAdmin',
      storeIds: [],
      passwordHash: await hashPassword(password),
      status: 'active',
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
    console.info(
      '[bootstrap] 初期管理者を作成しました。RECEPTION_BOOTSTRAP_ADMIN_* を環境変数から外してください。'
    );
  });
}
