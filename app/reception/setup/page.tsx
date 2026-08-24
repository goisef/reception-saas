import Link from 'next/link';
import type { Metadata } from 'next';
import { terminalProvisioning } from '@/lib/client/terminal-config';
import { collections, ready } from '@/lib/store';
import { InstallGuide } from './InstallGuide';

/**
 * 受付端末の設置ページ。
 *
 * 店舗スタッフが自分で端末を据える。ホーム画面へ追加してもらわないと
 * ブラウザのUIが残ったままになり、来店客がタブを閉じたり別サイトへ
 * 移動できてしまうため、ここに手順を集約する。
 */

export const metadata: Metadata = {
  title: '端末の設置',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  await ready();
  const provisioning = terminalProvisioning();
  const store = await collections.stores().get(provisioning.tenantId, provisioning.storeId);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-xs font-medium tracking-widest text-slate-500">SETUP</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">受付端末の設置</h1>
      <p className="mt-2 text-sm text-slate-600">
        この端末は <span className="font-medium">{store?.name ?? '—'}</span> の受付として
        設定されています。
      </p>

      <div className="mt-8 space-y-4">
        <InstallGuide />

        <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold text-slate-900">端末情報</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">店舗</dt>
              <dd className="font-medium">{store?.name ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">端末ID</dt>
              <dd className="font-mono text-xs">{provisioning.deviceId}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            端末IDは管理画面の死活監視に使われます。通信が5分途絶えると管理者へ通知されます。
          </p>
        </div>
      </div>

      <Link
        href="/reception"
        className="mt-8 block rounded-xl bg-slate-900 py-4 text-center text-base font-medium text-white"
      >
        受付画面を開く
      </Link>
    </div>
  );
}
