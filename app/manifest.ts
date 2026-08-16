import type { MetadataRoute } from 'next';

/**
 * 受付端末 PWA のマニフェスト (PRD 6-1)。
 *
 * 審査なしで iPad / Android タブレット / Chromebook のホーム画面へ
 * 追加できるようにするのが目的。start_url は受付画面。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '無人受付端末',
    short_name: '受付',
    description: '店舗の受付・退出を行う端末アプリ',
    start_url: '/reception',
    scope: '/',
    display: 'fullscreen',
    orientation: 'landscape',
    background_color: '#f8fafc',
    theme_color: '#0f172a',
    lang: 'ja',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
