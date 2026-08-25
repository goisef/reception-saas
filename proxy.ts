import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ACCESS_COOKIE, accessConfig, verifyToken } from '@/lib/access/session';
import { ADMIN_COOKIE, adminSessionSecret, verifyAdminToken } from '@/lib/admin/token';

/**
 * 入口の門番 (Next.js 16 では middleware は proxy という名前)。
 *
 * 2枚ある。
 *   1. 共有URLの目隠し — デモ環境を「URLを知っている人だけ」に留める。
 *      URLは転送・履歴・拡張機能から漏れるので、URLの秘匿だけには頼らない。
 *   2. 管理Webのログイン — 顧客情報とCSV出力に触れるのは運営者だけにする。
 *
 * どちらも署名の検証だけを行い、データストアには触らない。
 * Edge で動くため、権限の判定は各ページ側 (lib/admin/session.ts) で行う。
 *
 * 除外するもの:
 *   /health /ready  監視が通らなくなるため。Cloud Run の死活監視もここを見る
 *   /api/*          API キー認証が既にある。塞ぐと外部連携先が繋げなくなる
 *   /access         ログイン画面そのもの
 *   /robots.txt     ログイン画面へ飛ばすとクローラが disallow を読めない
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // 1枚目: 共有URLの目隠し。環境そのものを関係者に限る。
  const { password, secret } = accessConfig();
  if (password) {
    const token = request.cookies.get(ACCESS_COOKIE)?.value;
    if (!(await verifyToken(secret, token))) return redirectTo(request, '/access');
  }

  // 2枚目: 管理Webのログイン。目隠しを抜けた人でも、顧客情報や
  // CSV出力に触れるのはログインした運営者だけにする。
  // こちらはローカル開発でも塞ぐ。開発中だけ通る道を作ると、
  // 権限の考慮漏れがそのまま本番へ出る。
  if (path.startsWith('/admin') && !path.startsWith('/admin/login')) {
    const adminToken = request.cookies.get(ADMIN_COOKIE)?.value;
    if (!(await verifyAdminToken(adminSessionSecret(), adminToken))) {
      return redirectTo(request, '/admin/login');
    }
  }

  return NextResponse.next();
}

/**
 * ログイン後に元のページへ戻す。オープンリダイレクトにならないよう
 * パス部分だけを持ち回り、ホストは受け取らない。
 */
function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/((?!api|health|ready|access|_next/static|_next/image|icons|sw\\.js|robots\\.txt|manifest\\.webmanifest|favicon\\.ico).*)',
  ],
};
