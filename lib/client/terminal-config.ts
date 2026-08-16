import { DEMO_RECEPTION_KEY, DEMO_STORE_OSAKA, DEMO_TENANT_ID } from '../store/seed';

/**
 * 受付端末のプロビジョニング設定。
 *
 * 実運用では、端末の初回セットアップ時に管理画面が発行したペアリングコードを
 * 入力し、端末ローカル（Android/iOS は Keystore、PWA は IndexedDB）へ
 * API キーを保存する。キオスク端末が API キーを持つのは設計どおりで、
 * だからこそキーは ReceptionOnly ロール（顧客一覧を引けない）に絞ってある。
 *
 * ここでは開発用に環境変数から読み、無ければシードのデモキーを使う。
 */

export type TerminalProvisioning = {
  apiKey: string;
  tenantId: string;
  storeId: string;
  deviceId: string;
};

export function terminalProvisioning(): TerminalProvisioning {
  return {
    apiKey: process.env.RECEPTION_DEVICE_API_KEY ?? DEMO_RECEPTION_KEY,
    tenantId: process.env.RECEPTION_TENANT_ID ?? DEMO_TENANT_ID,
    storeId: process.env.RECEPTION_STORE_ID ?? DEMO_STORE_OSAKA,
    deviceId: process.env.RECEPTION_DEVICE_ID ?? 'dev_osaka_01',
  };
}
