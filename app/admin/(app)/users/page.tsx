import { currentSession } from '@/lib/admin/session';
import {
  ROLE_LABEL,
  assignableRoles,
  canManageUsers,
  canModifyUser,
} from '@/lib/admin/policy';
import { listUsers } from '@/lib/admin/users';
import { collections, ready } from '@/lib/store';
import { Badge, Card, PageHeading, Table, formatDateTime } from '../ui';
import { InviteForm } from './InviteForm';
import { UserActions } from './UserActions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  active: { label: '利用中', tone: 'success' },
  invited: { label: '招待中', tone: 'warning' },
  suspended: { label: '停止中', tone: 'danger' },
};

export default async function UsersPage() {
  await ready();
  const session = await currentSession();

  // メニューからは隠すが、URLを直接開かれても中身は見せない
  if (!canManageUsers(session.role)) {
    return (
      <>
        <PageHeading title="利用者" />
        <Card>
          <p className="text-sm text-slate-600">利用者を管理する権限がありません。</p>
        </Card>
      </>
    );
  }

  const [users, stores] = await Promise.all([
    listUsers(session),
    collections.stores().list(session.tenantId),
  ]);
  const roles = assignableRoles(session.role).map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  const storeOptions = stores.map((s) => ({ value: s.id, label: s.name }));
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  return (
    <>
      <PageHeading
        title="利用者"
        description="管理画面にログインする人の招待・停止・ロール変更を行います。"
      />

      <Card className="mb-6">
        <h2 className="mb-4 text-base font-semibold">利用者を招待</h2>
        <InviteForm roles={roles} stores={storeOptions} />
      </Card>

      <Table headers={['名前', 'ロール', '担当店舗', '状態', '最終ログイン', '操作']}>
        {users.map((u) => {
          const status = STATUS[u.status] ?? STATUS.active;
          const isSelf = u.id === session.userId;
          const editable = !isSelf && canModifyUser(session.role, u.role);
          return (
            <tr key={u.id} className="align-top">
              <td className="px-4 py-3">
                <p className="font-medium">
                  {u.displayName}
                  {isSelf && <span className="ml-2 text-xs text-slate-400">（あなた）</span>}
                </p>
                <p className="text-xs text-slate-500">{u.email}</p>
              </td>
              <td className="px-4 py-3">{ROLE_LABEL[u.role]}</td>
              <td className="px-4 py-3 text-xs text-slate-600">
                {u.storeIds.length === 0
                  ? '全店舗'
                  : u.storeIds.map((id) => storeName.get(id) ?? id).join('、')}
              </td>
              <td className="px-4 py-3">
                <Badge tone={status.tone}>{status.label}</Badge>
                {u.pendingInvitation && (
                  <p className="mt-1 text-xs text-slate-500">
                    リンク有効〜{formatDateTime(u.pendingInvitation.expiresAt)}
                  </p>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">{formatDateTime(u.lastLoginAt)}</td>
              <td className="min-w-[260px] px-4 py-3">
                {editable ? (
                  <UserActions
                    userId={u.id}
                    status={u.status}
                    role={u.role}
                    storeIds={u.storeIds}
                    roles={roles}
                    stores={storeOptions}
                  />
                ) : (
                  <span className="text-xs text-slate-400">
                    {isSelf ? '「アカウント」から変更できます' : '操作できません'}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
