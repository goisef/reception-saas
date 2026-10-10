'use client';

import { useActionState } from 'react';
import { changePasswordAction } from './actions';
import type { ActionState } from '@/lib/admin/action-state';

const initial: ActionState = {};

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';

export function PasswordForm({ minLength }: { minLength: number }) {
  const [state, action, pending] = useActionState(changePasswordAction, initial);

  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm">
        <span className="font-medium text-slate-700">現在のパスワード</span>
        <input
          name="current"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">新しいパスワード</span>
        <input
          name="next"
          type="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          className={inputClass}
        />
        <span className="mt-1 block text-xs text-slate-500">
          {minLength}文字以上。長い文章（パスフレーズ）のほうが安全で覚えやすくなります。
        </span>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">新しいパスワード（確認）</span>
        <input
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          className={inputClass}
        />
      </label>

      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      {state.ok && state.message && <p className="text-sm text-emerald-700">{state.message}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? '変更中…' : 'パスワードを変更'}
      </button>
    </form>
  );
}
