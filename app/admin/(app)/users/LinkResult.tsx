'use client';

import { useState } from 'react';

/**
 * 発行したリンクの表示。
 *
 * リンクは作成時にしか得られない（保存しているのはハッシュだけ）。
 * 閉じたあとに「もう一度見たい」と思っても出せないので、その旨を明示する。
 */
export function LinkResult({
  label,
  url,
  kind,
}: {
  label: string;
  url: string;
  kind: 'invite' | 'reset';
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // クリップボードが使えない環境では、選択してコピーしてもらう
      setCopied(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
      <p className="text-xs font-medium text-amber-900">
        {label}（{kind === 'invite' ? '7日間' : '24時間'}有効・1回だけ使えます）
      </p>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={label}
          className="min-w-0 flex-1 rounded-md border border-amber-300 bg-white px-2 py-1.5 font-mono text-xs"
        />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
        >
          {copied ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      <p className="mt-2 text-xs text-amber-900">
        この画面を閉じると再表示できません。本人へ安全な方法（社内チャット等）でお伝えください。
        メールは自動送信されません。
      </p>
    </div>
  );
}
