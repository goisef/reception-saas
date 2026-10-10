import type { Metadata } from 'next';
import { PASSWORD_MIN_LENGTH } from '@/lib/admin/policy';
import { previewInvitation } from '@/lib/admin/users';
import { AcceptForm } from './AcceptForm';

export const metadata: Metadata = {
  title: 'パスワードの設定',
  // リンクの秘密を含むURLなので、検索にもリファラにも出さない
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: raw } = await params;
  // URLエンコードされた `~` を戻す
  const token = decodeURIComponent(raw);
  const preview = await previewInvitation(token);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-white">
            R
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Reception 管理</h1>
        </div>

        {preview ? (
          <>
            <p className="mb-4 text-center text-sm text-slate-600">
              {preview.displayName} さん（{preview.email}）
              <br />
              {preview.kind === 'invite'
                ? 'ログイン用のパスワードを設定してください。'
                : '新しいパスワードを設定してください。'}
            </p>
            <AcceptForm
              token={token}
              email={preview.email}
              minLength={PASSWORD_MIN_LENGTH}
              submitLabel={preview.kind === 'invite' ? '設定してログイン' : '変更してログイン'}
            />
          </>
        ) : (
          // 存在しない / 期限切れ / 使用済み / 失効 を区別しない
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
            <p className="text-sm font-medium text-slate-900">このリンクは使えません</p>
            <p className="mt-2 text-sm text-slate-600">
              期限が切れているか、すでに使用された可能性があります。
              <br />
              お手数ですが、管理者に再発行を依頼してください。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
