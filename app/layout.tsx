import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "無人受付・来店管理SaaS",
    template: "%s | Reception",
  },
  description: "予約から受付・滞在・退出・通知までを一気通貫で管理する店舗向けプラットフォーム",

  /**
   * iOS のホーム画面追加まわり。
   *
   * iOS Safari は manifest の icons も display も見ない。
   * これらの meta が無いと、ホーム画面に追加してもブラウザのUIが残ったまま
   * 起動してしまい、受付端末として使い物にならない。
   */
  appleWebApp: {
    capable: true,
    title: "受付",
    // 受付画面はヘッダーが明るいので、ステータスバーの文字は黒にする
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // iOS 専用。manifest ではなくこれを見る
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  // 共有URLは検索結果に出さない (robots.ts と揃える)
  robots: { index: false, follow: false },

  other: {
    /**
     * Next.js 16 の appleWebApp.capable は標準名の mobile-web-app-capable しか
     * 出さない。iPadOS 16 以前はこの旧名しか解釈しないため、古い iPad を
     * 受付端末に流用されてもフルスクリーンで起動するよう自分で足しておく。
     */
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  // 受付端末での誤ズームを防ぐ。横向きタブレットに固定表示する前提
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // ホーム画面から起動したときに画面の端まで描く。
  // これを付けないと iPad のホームインジケータ周辺が白帯になる。
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
