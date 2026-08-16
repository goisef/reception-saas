import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "無人受付・来店管理SaaS",
    template: "%s | Reception",
  },
  description: "予約から受付・滞在・退出・通知までを一気通貫で管理する店舗向けプラットフォーム",
};

export const viewport: Viewport = {
  // 受付端末での誤ズームを防ぐ。横向きタブレットに固定表示する前提
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
