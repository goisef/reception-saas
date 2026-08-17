import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ACCESS_COOKIE, accessConfig, verifyToken } from '@/lib/access/session';

/**
 * 共有URLの目隠し (Next.js 16 では middleware は proxy という名前)。
 *
 * デモ環境を「URLを知っている人だけ」に留めるためのもの。
 * URLは転送・履歴・拡張機能から漏れるので、URLの秘匿だけには頼らない。
 *
 * 除外するもの:
 *   /health /ready  監視が通らなくなるため。Cloud Run の死活監視もここを見る
 *   /api/*          API キー認証が既にある。塞ぐと外部連携先が繋げなくなる
 *   /access         ログイン画面そのもの
 *   /robots.txt     ログイン画面へ飛ばすとクローラが disallow を読めない
 */
export async function proxy(request: NextRequest) {
  const { password, secret } = accessConfig();

  // パスワード未設定＝ローカル開発。素通しする。
  if (!password) return NextResponse.next();

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (await verifyToken(secret, token)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/access';
  // ログイン後に元のページへ戻す。オープンリダイレクトにならないよう
  // パス部分だけを持ち回り、ホストは受け取らない。
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/((?!api|health|ready|access|_next/static|_next/image|icons|sw\\.js|robots\\.txt|manifest\\.webmanifest|favicon\\.ico).*)',
  ],
};
