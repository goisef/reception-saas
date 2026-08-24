import type { CapacitorConfig } from '@capacitor/cli';

/**
 * ネイティブシェル (PRD 6-2 / 6-3) の設定。
 *
 * 設計原則 P-1「端末をアップデートしなくても仕様変更できる」と
 * P-7「アプリ配布方式に進化速度を依存させない」を守るため、
 * 受付画面そのものはアプリに焼き込まず、サーバーから読み込む。
 * ボタン文言も機能ON/OFFも Remote Config で変わるので、
 * ここでアプリに同梱すると審査のたびに仕様変更が止まる。
 *
 * アプリ側が持つのは
 *   - どのサーバーを見るか (server.url)
 *   - 通信できないときに出す画面 (server.errorPath)
 * の2点だけ。
 *
 * server.url はビルド時に環境変数から埋める。dev / demo / 本番で
 * 別のアプリを作るのではなく、同じソースから向き先だけ変えて出す。
 */
const serverUrl = process.env.RECEPTION_APP_SERVER_URL;

if (!serverUrl) {
  throw new Error(
    'RECEPTION_APP_SERVER_URL を指定してください（例: RECEPTION_APP_SERVER_URL=https://reception-demo.example.com npx cap sync）'
  );
}

if (!serverUrl.startsWith('https://')) {
  // 受付端末は個人情報を運ぶ。平文で載せない (PRD 13)
  throw new Error(`RECEPTION_APP_SERVER_URL は https:// で始まる必要があります: ${serverUrl}`);
}

const config: CapacitorConfig = {
  appId: 'jp.receptionsaas.terminal',
  appName: '受付',
  webDir: 'native/www',

  server: {
    url: serverUrl,
    // 受付画面のオリジンだけをアプリ内に留める。外部リンクは
    // 既定のブラウザへ逃がし、来店客がアプリ内を彷徨えないようにする。
    allowNavigation: [new URL(serverUrl).host],
    androidScheme: 'https',
    iosScheme: 'https',
    // 平文HTTPを禁止する。開発中に localhost を見たい場合も
    // ngrok 等で https を張る。
    cleartext: false,
    // サーバーへ到達できないときに出す同梱ページ。
    // 店舗の回線が落ちても「真っ白なWebViewのエラー」を客に見せない。
    errorPath: 'offline.html',
  },

  android: {
    // 受付端末は店舗に据え置かれる。WebView のデバッグは
    // リリースビルドで無効にする。
    webContentsDebuggingEnabled: false,
  },

  ios: {
    // ホームインジケータ周辺まで描く。CSS 側の safe-area-inset と対。
    contentInset: 'never',
    // 受付画面は自前でスクロール領域を持つ。WebView 全体が
    // 跳ねると据え置き端末で誤操作になる。
    scrollEnabled: false,
    backgroundColor: '#f8fafc',
  },
};

export default config;
