import { notFound } from '../core/errors';
import { stableBucket } from '../core/ids';
import { collections } from '../store';
import type { FeatureFlag, FeatureFlagKey, Id, RemoteConfig } from '../domain/types';

/**
 * Remote Configuration と Feature Flag (PRD 4-2 / 4-3 / 4-4)。
 *
 * 原則 P-1「端末をアップデートしなくても仕様変更できる」の実装本体。
 * 受付ボタンの文言・並び・表示可否はすべてここから配る。
 */

export type ResolvedConfig = {
  configVersion: number;
  logo: string | null;
  theme: string;
  language: string;
  notificationSound: string;
  buttons: { id: string; label: string; action: string; order: number }[];
  /** 端末に配るのは解決済みの真偽値だけ。ロールアウト率は見せない */
  features: Record<string, boolean>;
  updatedAt: string;
};

export async function getRaw(tenantId: Id, storeId: Id): Promise<RemoteConfig & { id: string }> {
  const config = await collections.remoteConfigs().get(tenantId, storeId);
  if (!config) throw notFound('端末設定');
  return config;
}

/**
 * 端末向けに解決した設定を返す。
 *
 * 段階リリースは deviceId のハッシュで判定するので、同じ端末は
 * 何度取得しても同じ結果になる。取得のたびに機能が出たり消えたりしない。
 */
export async function resolve(params: {
  tenantId: Id;
  storeId: Id;
  deviceId?: string | null;
}): Promise<ResolvedConfig> {
  const config = await getRaw(params.tenantId, params.storeId);

  const features: Record<string, boolean> = {};
  for (const flag of config.flags) {
    features[flag.key] = isFlagEnabled(flag, {
      storeId: params.storeId,
      deviceId: params.deviceId ?? null,
    });
  }

  // 機能が OFF のボタンは配らない。端末側に判定を持たせない
  const buttons = config.buttons
    .filter((b) => b.visible)
    .filter((b) => isButtonAvailable(b.action, features))
    .sort((a, b) => a.order - b.order)
    .map(({ id, label, action, order }) => ({ id, label, action, order }));

  return {
    configVersion: config.configVersion,
    logo: config.logo,
    theme: config.theme,
    language: config.language,
    notificationSound: config.notificationSound,
    buttons,
    features,
    updatedAt: config.updatedAt,
  };
}

export function isFlagEnabled(
  flag: FeatureFlag,
  target: { storeId?: Id | null; deviceId?: string | null }
): boolean {
  if (!flag.enabled) return false;

  // 明示指定は率より優先。テスト店舗への先行公開に使う
  if (flag.allowStoreIds?.length && target.storeId && flag.allowStoreIds.includes(target.storeId)) {
    return true;
  }
  if (
    flag.allowDeviceIds?.length &&
    target.deviceId &&
    flag.allowDeviceIds.includes(target.deviceId)
  ) {
    return true;
  }
  // 明示リストに載っていなくても率で当たれば有効。リストは「先行公開」であって
  // 「これ以外禁止」ではない。限定公開したい場合は rolloutPercent を 0 にする。
  if (flag.rolloutPercent >= 100) return true;
  if (flag.rolloutPercent <= 0) return false;

  const key = target.deviceId ?? target.storeId ?? 'anonymous';
  return stableBucket(key, flag.key) < flag.rolloutPercent;
}

const BUTTON_REQUIRED_FLAG: Record<string, FeatureFlagKey> = {
  'reception.qr': 'qrReception',
  'reception.number': 'numberReception',
  'reception.face': 'faceRecognition',
  'reception.staff': 'staffReception',
  'reception.event': 'eventReception',
};

function isButtonAvailable(action: string, features: Record<string, boolean>): boolean {
  const required = BUTTON_REQUIRED_FLAG[action];
  if (!required) return true;
  return features[required] === true;
}

/**
 * 設定を更新する。更新のたびに configVersion を上げ、
 * 端末が「自分の設定が古い」ことを判定できるようにする (PRD 4-5)。
 */
export async function updateConfig(
  tenantId: Id,
  storeId: Id,
  patch: Partial<Pick<RemoteConfig, 'logo' | 'theme' | 'language' | 'notificationSound' | 'buttons' | 'flags'>>
): Promise<RemoteConfig & { id: string }> {
  const current = await getRaw(tenantId, storeId);
  const updated = await collections.remoteConfigs().update(tenantId, storeId, {
    ...patch,
    configVersion: current.configVersion + 1,
    updatedAt: new Date().toISOString(),
  });
  if (!updated) throw notFound('端末設定');
  return updated;
}

/**
 * 設定のロールバック (PRD 4-5)。
 * 履歴は持っていないので、いまは指定バージョンへ戻す代わりに
 * 呼び出し側が渡したスナップショットを適用する形にしている。
 */
export async function rollback(
  tenantId: Id,
  storeId: Id,
  snapshot: Pick<RemoteConfig, 'logo' | 'theme' | 'language' | 'notificationSound' | 'buttons' | 'flags'>
): Promise<RemoteConfig & { id: string }> {
  return updateConfig(tenantId, storeId, snapshot);
}
