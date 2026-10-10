import { collections } from '../store';
import type { FeatureFlagKey, Id } from '../domain/types';

/**
 * 隠し機能の定義と、公開スイッチの参照。
 *
 * 「隠し機能」とは、既定で存在を見せない機能のこと。テナントの管理者が
 * 機能管理画面 (/admin/features) で公開スイッチを入れるまで、
 *   - 端末への配信 (Remote Config の features)
 *   - 管理画面の表示（顧客一覧の列・端末設定の項目）
 *   - 帳票の列
 * のどこにも現れない。
 *
 * このファイルは参照だけを持つ。切り替えの操作と権限は
 * lib/services/features.ts にある（Remote Config から循環参照しないため分けている）。
 */

export const HIDDEN_FEATURES = {
  faceRecognition: {
    label: '顔認証',
    summary:
      '会員の顔で本人確認を行う機能（P1）。顔の特徴量は生体情報にあたるため、公開前に利用目的の表示・同意の取得・保存期間と削除の手順を整えます。',
    /** ON にするときに確認させる文言 (PRD 8-5 の必須要件) */
    acknowledgement:
      '利用目的の表示、同意の取得、保存期間と削除の手順を整えたうえで公開することを確認しました。',
  },
} as const satisfies Partial<
  Record<FeatureFlagKey, { label: string; summary: string; acknowledgement: string }>
>;

export type HiddenFeatureKey = keyof typeof HIDDEN_FEATURES;

export const HIDDEN_FEATURE_KEYS = Object.keys(HIDDEN_FEATURES) as HiddenFeatureKey[];

export function isHiddenFeatureKey(key: string): key is HiddenFeatureKey {
  // `'toString' in obj` のようにプロトタイプのキーを拾わない
  return Object.prototype.hasOwnProperty.call(HIDDEN_FEATURES, key);
}

/** 公開中の隠し機能。文書が無い・キーが無いものは非公開。 */
export async function enabledHiddenFeatures(tenantId: Id): Promise<Set<HiddenFeatureKey>> {
  const gate = await collections.tenantFeatures().get(tenantId, tenantId);
  const enabled = new Set<HiddenFeatureKey>();
  if (!gate) return enabled;
  for (const key of HIDDEN_FEATURE_KEYS) {
    if (gate.hidden?.[key]?.enabled === true) enabled.add(key);
  }
  return enabled;
}

export async function isHiddenFeatureEnabled(
  tenantId: Id,
  key: HiddenFeatureKey
): Promise<boolean> {
  return (await enabledHiddenFeatures(tenantId)).has(key);
}
