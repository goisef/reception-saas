'use client';

import { useSyncExternalStore } from 'react';

/**
 * ホーム画面への追加手順。
 *
 * iOS Safari には beforeinstallprompt が無く、インストールを促す方法が
 * 「手順を文字で案内する」しかない。店舗のスタッフが自分で設置するので、
 * 迷わず終えられることを優先する。
 *
 * 端末の種別も起動モードもブラウザ側の状態なので、effect で state へ
 * 写すのではなく外部ストアとして購読する。
 */

type Platform = 'ios' | 'android' | 'desktop';

/** 端末種別は起動中に変わらないので購読しない。 */
function subscribeNever(): () => void {
  return () => {};
}

function getPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS 13以降は Mac を名乗るため、タッチ対応の有無で見分ける
  const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (/iPhone|iPod/.test(ua) || isIpad) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** SSR中は判定できない。null を返して案内自体を描かない。 */
function getServerPlatform(): Platform | null {
  return null;
}

function subscribeStandalone(onChange: () => void): () => void {
  const mql = window.matchMedia('(display-mode: standalone)');
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getStandalone(): boolean {
  // iOS は display-mode を報告しないので navigator.standalone も見る
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    nav.standalone === true
  );
}

function getServerStandalone(): boolean {
  return false;
}

const STEPS: Record<Platform, string[]> = {
  ios: [
    'Safari で開いていることを確認します（Chrome など他のブラウザではホーム画面に追加できません）',
    '画面上部または下部の「共有」ボタン（□に↑のアイコン）を押します',
    'メニューを下にたどり「ホーム画面に追加」を選びます',
    '名前を確認して「追加」を押します',
    'ホーム画面に追加されたアイコンから起動します',
  ],
  android: [
    'Chrome の右上のメニュー（⋮）を開きます',
    '「アプリをインストール」または「ホーム画面に追加」を選びます',
    '確認して「インストール」を押します',
    'ホーム画面に追加されたアイコンから起動します',
  ],
  desktop: [
    'アドレスバー右側のインストールアイコンを押します',
    '表示されない場合はメニューから「インストール」を選びます',
  ],
};

export function InstallGuide() {
  const platform = useSyncExternalStore(subscribeNever, getPlatform, getServerPlatform);
  const standalone = useSyncExternalStore(
    subscribeStandalone,
    getStandalone,
    getServerStandalone
  );

  if (platform === null) return null;

  if (standalone) {
    return (
      <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
        ホーム画面から起動しています。この端末の設置は完了です。
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="text-base font-semibold text-slate-900">
        {platform === 'ios' ? 'iPad / iPhone での設置手順' : 'ホーム画面への追加手順'}
      </h2>
      <ol className="mt-3 space-y-2 text-sm text-slate-700">
        {STEPS[platform].map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      {platform === 'ios' && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          追加後は Safari のアドレスバーやタブが消え、全画面で起動します。
          iPad は「設定 → アクセシビリティ → アクセスガイド」を併用すると、
          来店客が他のアプリへ移動できないよう固定できます。
        </p>
      )}
    </div>
  );
}
