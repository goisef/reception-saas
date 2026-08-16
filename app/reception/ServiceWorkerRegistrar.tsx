'use client';

import { useEffect } from 'react';

/**
 * Service Worker の登録。
 *
 * 受付端末をホーム画面に追加してキオスクとして使えるようにするのと、
 * 通信が切れても画面自体は開ける（原則 P-3）ようにするのが目的。
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {
        // 登録できなくてもオンラインでは通常どおり動く
      });
  }, []);

  return null;
}
