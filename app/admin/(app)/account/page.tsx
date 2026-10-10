import { currentSession } from '@/lib/admin/session';
import { PASSWORD_MIN_LENGTH, ROLE_LABEL } from '@/lib/admin/policy';
import { collections, ready } from '@/lib/store';
import { Card, PageHeading, formatDateTime } from '../ui';
import { PasswordForm } from './PasswordForm';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  await ready();
  const session = await currentSession();
  const user = await collections.adminUsers().get(session.tenantId, session.userId);

  return (
    <>
      <PageHeading title="アカウント" description="ご自身のログイン情報を確認・変更します。" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-base font-semibold">プロフィール</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">表示名</dt>
              <dd className="font-medium">{session.displayName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">メールアドレス</dt>
              <dd>{user?.email ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">ロール</dt>
              <dd>{ROLE_LABEL[session.role]}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">最終ログイン</dt>
              <dd>{formatDateTime(user?.lastLoginAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">パスワード変更</dt>
              <dd>{formatDateTime(user?.passwordChangedAt)}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-4 text-base font-semibold">パスワードを変更</h2>
          <PasswordForm minLength={PASSWORD_MIN_LENGTH} />
        </Card>
      </div>
    </>
  );
}
