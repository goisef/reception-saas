'use client';

import { useActionState } from 'react';
import { acceptInvitationAction } from './actions';
import type { ActionState } from '@/lib/admin/action-state';

const initial: ActionState = {};

const inputClass = 'mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base';

export function AcceptForm({
  token,
  email,
  minLength,
  submitLabel,
}: {
  token: string;
  email: string;
  minLength: number;
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState(
    acceptInvitationAction.bind(null, token),
    initial
  );

  return (
    <form
      action={action}
      className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
    >
      {/* パスワードマネージャーが保存先を取り違えないよう、ログインIDを持たせておく */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />

      <label className="block text-sm font-medium text-slate-700" htmlFor="password">
        新しいパスワード
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        minLength={minLength}
        autoFocus
        autoComplete="new-password"
        className={inputClass}
      />
      <p className="mt-1 text-xs text-slate-500">
        {minLength}文字以上。長い文章（パスフレーズ）のほうが安全で覚えやすくなります。
      </p>

      <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="confirm">
        新しいパスワード（確認）
      </label>
      <input
        id="confirm"
        name="confirm"
        type="password"
        required
        autoComplete="new-password"
        className={inputClass}
      />

      {state.error && <p className="mt-3 text-sm text-rose-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-5 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? '設定中…' : submitLabel}
      </button>
    </form>
  );
}
