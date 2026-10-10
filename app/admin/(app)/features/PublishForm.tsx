'use client';

import { useActionState } from 'react';
import { setPublishedAction } from './actions';
import type { ActionState } from '@/lib/admin/action-state';

const initial: ActionState = {};

/**
 * 公開スイッチ。
 *
 * 公開するときだけ確認事項へのチェックを求める。引っ込める方は1回で済ませる。
 * 問題が起きたときに、迷わず・すぐに止められるようにするため。
 */
export function PublishForm({
  featureKey,
  label,
  published,
  acknowledgement,
}: {
  featureKey: string;
  label: string;
  published: boolean;
  acknowledgement: string;
}) {
  const [state, action, pending] = useActionState(
    setPublishedAction.bind(null, featureKey, !published),
    initial
  );

  return (
    <form action={action} className="space-y-3">
      {!published && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="acknowledged" className="mt-1 h-4 w-4" />
          <span>{acknowledgement}</span>
        </label>
      )}

      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      {state.ok && state.message && <p className="text-sm text-emerald-700">{state.message}</p>}

      <button
        type="submit"
        disabled={pending}
        className={
          published
            ? 'rounded-lg px-4 py-2 text-sm font-medium text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50 disabled:opacity-50'
            : 'rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50'
        }
      >
        {published ? `${label}を非公開に戻す` : `${label}を公開する`}
      </button>
    </form>
  );
}
