'use client';

import { useActionState } from 'react';
import {
  changeRoleAction,
  issueLinkAction,
  setStatusAction,
} from './actions';
import { LinkResult } from './LinkResult';
import { StoreChecklist } from './StoreChecklist';
import type { ActionState } from '@/lib/admin/action-state';

type Option = { value: string; label: string };

const initial: ActionState = {};

const buttonClass =
  'rounded-md px-2.5 py-1.5 text-xs font-medium ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50';

export function UserActions({
  userId,
  status,
  role,
  storeIds,
  roles,
  stores,
}: {
  userId: string;
  status: 'invited' | 'active' | 'suspended';
  role: string;
  storeIds: string[];
  roles: Option[];
  stores: Option[];
}) {
  const [linkState, linkAction, linkPending] = useActionState(
    issueLinkAction.bind(null, userId),
    initial
  );
  const [statusState, suspendAction, suspendPending] = useActionState(
    setStatusAction.bind(null, userId, 'suspended'),
    initial
  );
  const [resumeState, resumeAction, resumePending] = useActionState(
    setStatusAction.bind(null, userId, 'active'),
    initial
  );
  const [roleState, roleAction, rolePending] = useActionState(
    changeRoleAction.bind(null, userId),
    initial
  );

  const error = linkState.error ?? statusState.error ?? resumeState.error ?? roleState.error;
  const notice = roleState.message ?? statusState.message ?? resumeState.message;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status !== 'suspended' && (
          <form action={linkAction}>
            <button type="submit" disabled={linkPending} className={buttonClass}>
              {status === 'invited' ? '招待リンクを再発行' : 'パスワード再設定リンク'}
            </button>
          </form>
        )}

        {status === 'suspended' ? (
          <form action={resumeAction}>
            <button type="submit" disabled={resumePending} className={buttonClass}>
              停止を解除
            </button>
          </form>
        ) : (
          <form
            action={suspendAction}
            onSubmit={(e) => {
              // 誤操作の取り返しはつくが、押した瞬間にその人は締め出される
              if (!window.confirm('この利用者を停止します。ログイン中のセッションも無効になります。')) {
                e.preventDefault();
              }
            }}
          >
            <button
              type="submit"
              disabled={suspendPending}
              className={`${buttonClass} text-rose-700`}
            >
              停止
            </button>
          </form>
        )}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-slate-500">ロール・担当店舗を変更</summary>
        <form action={roleAction} className="mt-2 space-y-3 rounded-lg bg-slate-50 p-3">
          <select
            name="role"
            defaultValue={role}
            aria-label="ロール"
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <StoreChecklist stores={stores} selected={storeIds} idPrefix={userId} />
          <button type="submit" disabled={rolePending} className={buttonClass}>
            変更を保存
          </button>
        </form>
      </details>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {notice && <p className="text-xs text-emerald-700">{notice}</p>}
      {linkState.link && <LinkResult {...linkState.link} />}
    </div>
  );
}
