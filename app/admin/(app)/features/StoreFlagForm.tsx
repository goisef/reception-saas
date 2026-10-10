'use client';

import { useActionState } from 'react';
import { setStoreFlagAction } from './actions';
import type { ActionState } from '@/lib/admin/action-state';

const initial: ActionState = {};

export function StoreFlagForm({
  featureKey,
  storeId,
  storeName,
  enabled,
  rolloutPercent,
  editable,
}: {
  featureKey: string;
  storeId: string;
  storeName: string;
  enabled: boolean;
  rolloutPercent: number;
  editable: boolean;
}) {
  const [state, action, pending] = useActionState(
    setStoreFlagAction.bind(null, featureKey, storeId),
    initial
  );

  return (
    <form
      action={action}
      className="grid items-center gap-3 border-b border-slate-100 py-3 last:border-0 md:grid-cols-[1fr_90px_140px_auto]"
    >
      <span className="text-sm font-medium">{storeName}</span>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
          disabled={!editable}
          className="h-4 w-4"
        />
        有効
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-slate-500">公開率 %</span>
        <input
          type="number"
          name="rollout"
          min={0}
          max={100}
          defaultValue={rolloutPercent}
          disabled={!editable}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 disabled:bg-slate-50"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !editable}
          className="rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
        >
          保存
        </button>
        {!editable && <span className="text-xs text-slate-400">担当外の店舗です</span>}
        {state.error && <span className="text-xs text-rose-600">{state.error}</span>}
        {state.ok && <span className="text-xs text-emerald-700">保存しました</span>}
      </div>
    </form>
  );
}
