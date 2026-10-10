'use client';

import { useActionState } from 'react';
import { inviteUserAction } from './actions';
import { LinkResult } from './LinkResult';
import { StoreChecklist } from './StoreChecklist';
import type { ActionState } from '@/lib/admin/action-state';

type Option = { value: string; label: string };

const initial: ActionState = {};

/**
 * 失敗のたびに React はフォームを初期値へ戻す。input は defaultValue の更新に
 * 追随するが、select は追随せず最初の値へ戻ってしまう。ロールだけ別のものに
 * なって送信されると権限の取り違えになるため、入力値をキーにして作り直す。
 */
function snapshotKey(values: ActionState['values']): string {
  return values ? JSON.stringify(values) : 'clean';
}

export function InviteForm({
  roles,
  stores,
}: {
  roles: Option[];
  stores: Option[];
}) {
  const [state, action, pending] = useActionState(inviteUserAction, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">メールアドレス</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            defaultValue={state.values?.email}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">表示名</span>
          <input
            name="displayName"
            required
            maxLength={50}
            autoComplete="off"
            defaultValue={state.values?.displayName}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
      </div>

      <label className="block text-sm sm:max-w-xs">
        <span className="font-medium text-slate-700">ロール</span>
        <select
          key={snapshotKey(state.values)}
          name="role"
          defaultValue={state.values?.role ?? roles[roles.length - 1]?.value}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
        >
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <StoreChecklist
        key={snapshotKey(state.values)}
        stores={stores}
        selected={state.values?.storeIds}
      />

      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      {state.ok && state.message && <p className="text-sm text-emerald-700">{state.message}</p>}
      {state.link && <LinkResult {...state.link} />}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? '招待を作成中…' : '招待リンクを作成'}
      </button>
    </form>
  );
}
