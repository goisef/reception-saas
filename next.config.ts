import type { NextConfig } from "next";

/**
 * セキュリティヘッダ。
 *
 * Zero Trust (PRD 16) の一部として、受付端末・管理Webのどちらにも
 * 同じ最低限のヘッダを付ける。WAF は前段（Cloud Load Balancer）で別途入る。
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // 顔認証 (P1) でカメラを使うので camera は self に残す
    value: "camera=(self), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // Cloud Run 用。node_modules を含めた最小構成が .next/standalone に出る
  output: "standalone",

  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          // Service Worker は必ず最新を取りに行かせる。古い SW が残ると
          // 端末が古い受付画面のまま動き続けてしまう
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        // API レスポンスは中間キャッシュに残さない
        source: "/api/(.*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
