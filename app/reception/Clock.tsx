'use client';

import { useEffect, useState } from 'react';

/**
 * 受付画面の時計。
 *
 * サーバーで描くと初期HTMLの時刻が固定されてしまうため、
 * マウント後にクライアントで刻む。SSR とクライアントで
 * 描画がずれないよう、初期値は空にしておく。
 */
export function Clock() {
  const [text, setText] = useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      setText(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="text-xl font-medium tabular-nums tracking-wider text-slate-700">
      {text}
    </span>
  );
}
