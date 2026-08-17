import type { Metadata } from 'next';
import { accessConfig } from '@/lib/access/session';
import { signInAction } from './actions';

export const metadata: Metadata = {
  title: 'アクセス',
  // 共有URLが検索結果に出ないようにする
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const ENV_LABEL: Record<string, { text: string; tone: string }> = {
  dev: { text: '開発環境', tone: 'bg-amber-100 text-amber-900' },
  demo: { text: 'デモ環境', tone: 'bg-emerald-100 text-emerald-900' },
  local: { text: 'ローカル', tone: 'bg-slate-100 text-slate-700' },
};

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const { label } = accessConfig();
  const env = ENV_LABEL[label] ?? ENV_LABEL.local;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-white">
            R
          </div>
          <h1 className="text-lg font-semibold text-slate-900">無人受付・来店管理SaaS</h1>
          {/* dev と demo を取り違えないよう環境を明示する */}
          <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-medium ${env.tone}`}>
            {env.text}
          </span>
        </div>

        <form
          action={signInAction}
          className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
        >
          <input type="hidden" name="next" value={next ?? '/'} />
          <label className="block text-sm font-medium text-slate-700" htmlFor="password">
            アクセスパスワード
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
          />
          {error && (
            <p className="mt-2 text-sm text-rose-600">パスワードが違います。</p>
          )}
          <button
            type="submit"
            className="mt-4 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white"
          >
            開く
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          この環境は関係者への共有用です。URLとパスワードの取り扱いにご注意ください。
        </p>
      </div>
    </div>
  );
}
