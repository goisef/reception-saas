import Link from 'next/link';

/**
 * トップページ。
 *
 * このプロダクトの主役は受付画面ではなく API なので、トップは
 * 「どこに何があるか」を示す入口に徹する。営業用のランディングは別途作る。
 */

const ENTRIES = [
  {
    href: '/reception',
    title: '受付端末',
    description: 'QR / 4桁番号での受付と退出。横向きタブレットで全画面表示します。',
    tag: 'PWA',
  },
  {
    href: '/admin',
    title: '管理画面',
    description: '来店状況・予約・顧客・番号・帳票・端末設定を管理します。',
    tag: 'Web',
  },
  {
    href: '/api/v1/openapi',
    title: 'API 仕様',
    description: 'OpenAPI 3.1。外部の予約システムやCRMからの連携はここを参照します。',
    tag: 'OpenAPI',
  },
];

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-xs font-medium tracking-widest text-slate-500">RECEPTION SAAS</p>
      <h1 className="mt-3 text-3xl font-semibold text-slate-900">店舗の来店体験OS</h1>
      <p className="mt-3 text-slate-600">
        予約 → 受付 → 本人確認 → 滞在 → 退出 → 通知 → 顧客管理 → 外部システム連携。
        受付画面ではなく、受付APIと来店データ基盤を資産として作っています。
      </p>

      <div className="mt-10 space-y-3">
        {ENTRIES.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className="block rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:ring-slate-400"
          >
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold text-slate-900">{entry.title}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {entry.tag}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{entry.description}</p>
          </Link>
        ))}
      </div>

      <div className="mt-10 flex gap-4 text-xs text-slate-500">
        <Link href="/health" className="underline">
          /health
        </Link>
        <Link href="/ready" className="underline">
          /ready
        </Link>
      </div>
    </div>
  );
}
