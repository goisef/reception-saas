import { forbidden } from '../core/errors';
import { isHiddenFeatureKey } from './hidden-features';
import type { FeatureFlag } from '../domain/types';

/**
 * 端末設定フォームの内容を Feature Flag に反映する。
 *
 * フォームに項目を出していない隠し機能は、そのまま返す。入力が無いのを
 * 「チェックなし = OFF、公開率の指定なし = 0」と読んでしまうと、機能管理画面で
 * 決めた店舗の設定を、端末設定を保存するたびに黙って消してしまう。
 */
export function mergeFlags(
  current: FeatureFlag[],
  read: (name: string) => string | null
): FeatureFlag[] {
  return current.map((flag) => {
    if (isHiddenFeatureKey(flag.key)) return flag;
    return {
      ...flag,
      enabled: read(`flag.${flag.key}.enabled`) === 'on',
      rolloutPercent: clampPercent(Number(read(`flag.${flag.key}.rollout`) ?? flag.rolloutPercent)),
    };
  });
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * API (PATCH /api/v1/device/config) から渡された flags を、現在の設定へ反映する。
 *
 * この API は flags 配列を丸ごと置き換える。そのままだと
 *   - 配列に含めなかった隠し機能の設定が、黙って消える
 *   - stores:write を持つキーなら誰でも、機能管理画面の権限（管理者のみ）と
 *     監査ログを経ずに、隠し機能の店舗設定を書き換えられる
 * ので、隠し機能は常に現在の値を保つ。値を変えようとした場合は拒否する。
 * クライアントが取得した配列をそのまま送り返す（変更なし）のは通す。
 */
export function mergeApiFlags(current: FeatureFlag[], incoming: unknown[]): FeatureFlag[] {
  const flags = incoming.filter(
    (f): f is FeatureFlag =>
      typeof f === 'object' && f !== null && typeof (f as FeatureFlag).key === 'string'
  );

  for (const flag of flags) {
    if (!isHiddenFeatureKey(flag.key)) continue;
    const existing = current.find((c) => c.key === flag.key);
    const unchanged =
      existing !== undefined &&
      existing.enabled === flag.enabled &&
      existing.rolloutPercent === flag.rolloutPercent;
    if (!unchanged) {
      throw forbidden(
        `${flag.key} は隠し機能のため、この API では変更できません。機能管理画面から切り替えてください。`
      );
    }
  }

  return [
    ...flags.filter((f) => !isHiddenFeatureKey(f.key)),
    ...current.filter((c) => isHiddenFeatureKey(c.key)),
  ];
}
