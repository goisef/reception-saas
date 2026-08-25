import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { findSession } from '@/lib/admin/session';
import { signInAction } from './actions';

export const metadata: Metadata = {
  title: 'ログイン',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const ERROR_TEXT: Record<string, string> = {
  invalid: 'メールアドレスまたはパスワードが違います。',
  suspended: 'このアカウントは停止されています。管理者にお問い合わせください。',
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // ログイン済みの人をログイン画面に留め置かない
  if (await findSession()) redirect('/admin');

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-white">
            R
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Reception 管理</h1>
          <p className="mt-1 text-sm text-slate-500">店舗運営者向けの管理画面です</p>
        </div>

        <form
          action={signInAction}
          className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
        >
          <input type="hidden" name="next" value={next ?? '/admin'} />

          <label className="block text-sm font-medium text-slate-700" htmlFor="email">
            メールアドレス
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="username"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
          />

          <label
            className="mt-4 block text-sm font-medium text-slate-700"
            htmlFor="password"
          >
            パスワード
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
          />

          {error && (
            <p className="mt-3 text-sm text-rose-600">
              {ERROR_TEXT[error] ?? ERROR_TEXT.invalid}
            </p>
          )}

          <button
            type="submit"
            className="mt-5 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white"
          >
            ログイン
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          受付端末はこの画面を使いません。端末は
          <span className="font-mono"> /reception </span>
          を開いてください。
        </p>
      </div>
    </div>
  );
}
