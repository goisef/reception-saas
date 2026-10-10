import { AdminActionError } from '../admin/errors';
import { canManageFeatures } from '../admin/policy';
import type { Actor, RequestContext } from '../admin/users';
import { newRequestId } from '../core/ids';
import * as audit from '../security/audit';
import { collections, datastore, ready } from '../store';
import {
  HIDDEN_FEATURES,
  HIDDEN_FEATURE_KEYS,
  enabledHiddenFeatures,
  isHiddenFeatureKey,
  type HiddenFeatureKey,
} from './hidden-features';
import * as remoteConfig from './remote-config';
import type { FeatureFlag, Id } from '../domain/types';

/**
 * 機能管理（マスタ画面）の操作。画面はここだけを呼ぶ。
 *
 * 公開スイッチ（テナント全体）と、店舗ごとの段階リリースの2段構え。
 *   公開スイッチ OFF  → 店舗の設定に関わらず、どこにも現れない
 *   公開スイッチ ON   → 店舗のフラグ（有効 / 公開率）に従って端末へ配られる
 * 公開しただけで全端末へ一斉に出ないよう、店舗側の既定は無効にしてある。
 */

export class FeatureAdminError extends AdminActionError {
  constructor(display: string) {
    super(display);
    this.name = 'FeatureAdminError';
  }
}

function requireManager(actor: Actor): void {
  if (!canManageFeatures(actor.role)) {
    throw new FeatureAdminError('機能を管理する権限がありません。');
  }
}

function requireHidden(key: string): HiddenFeatureKey {
  if (!isHiddenFeatureKey(key)) throw new FeatureAdminError('対象の機能が正しくありません。');
  return key;
}

async function log(
  actor: Actor,
  ctx: RequestContext,
  event: { action: string; key: string; storeId?: Id | null; summary: string }
) {
  await audit.record({
    tenantId: actor.tenantId,
    requestId: newRequestId(),
    actorType: 'user',
    actorId: actor.userId,
    action: event.action,
    resourceType: 'feature',
    resourceId: event.key,
    storeId: event.storeId ?? null,
    method: 'POST',
    path: '/admin/features',
    statusCode: 200,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    summary: event.summary,
  });
}

// ---------------------------------------------------------------------------
// 概要
// ---------------------------------------------------------------------------

export type StoreFlagView = {
  storeId: Id;
  storeName: string;
  enabled: boolean;
  rolloutPercent: number;
  /** この利用者が変更できる店舗か（担当店舗が限定されている場合） */
  editable: boolean;
};

export type HiddenFeatureView = {
  key: HiddenFeatureKey;
  label: string;
  summary: string;
  acknowledgement: string;
  published: boolean;
  updatedAt: string | null;
  stores: StoreFlagView[];
};

export async function getOverview(actor: Actor): Promise<HiddenFeatureView[]> {
  requireManager(actor);
  await ready();

  const [gate, stores, published] = await Promise.all([
    collections.tenantFeatures().get(actor.tenantId, actor.tenantId),
    collections.stores().list(actor.tenantId),
    enabledHiddenFeatures(actor.tenantId),
  ]);
  const configs = await Promise.all(
    stores.map((s) => collections.remoteConfigs().get(actor.tenantId, s.id))
  );

  return HIDDEN_FEATURE_KEYS.map((key) => ({
    key,
    ...HIDDEN_FEATURES[key],
    published: published.has(key),
    updatedAt: gate?.hidden?.[key]?.updatedAt ?? null,
    stores: stores.map((store, i) => {
      const flag = configs[i]?.flags.find((f) => f.key === key);
      return {
        storeId: store.id,
        storeName: store.name,
        enabled: flag?.enabled ?? false,
        rolloutPercent: flag?.rolloutPercent ?? 0,
        editable: actor.storeIds.length === 0 || actor.storeIds.includes(store.id),
      };
    }),
  }));
}

// ---------------------------------------------------------------------------
// 公開スイッチ
// ---------------------------------------------------------------------------

/**
 * 隠し機能を公開 / 非公開にする。
 *
 * 公開するときは、機能ごとの確認（顔認証なら同意・保存期間・削除の手順の整備）に
 * 同意させる。非公開に戻すのは確認なしで即座に行える。引っ込める方を
 * 面倒にしない。
 */
export async function setPublished(
  actor: Actor,
  rawKey: string,
  enabled: boolean,
  acknowledged: boolean,
  ctx: RequestContext = {}
): Promise<void> {
  requireManager(actor);
  const key = requireHidden(rawKey);
  await ready();

  if (actor.storeIds.length > 0) {
    // 公開スイッチは全店舗に効く。担当店舗を限定された人には触らせない
    throw new FeatureAdminError('全店舗に関わる設定のため、担当店舗が限定された方は変更できません。');
  }
  if (enabled && !acknowledged) {
    throw new FeatureAdminError('公開するには、確認事項にチェックを入れてください。');
  }

  const changed = await datastore().withLock(`tenant_features:${actor.tenantId}`, async () => {
    const gates = collections.tenantFeatures();
    const current = await gates.get(actor.tenantId, actor.tenantId);
    const before = current?.hidden?.[key]?.enabled === true;
    if (before === enabled) return false;

    const hidden = {
      ...(current?.hidden ?? {}),
      [key]: { enabled, updatedAt: new Date().toISOString(), updatedBy: actor.userId },
    };
    if (current) {
      await gates.update(actor.tenantId, actor.tenantId, { hidden });
    } else {
      await gates.insert({ id: actor.tenantId, tenantId: actor.tenantId, hidden });
    }
    return true;
  });
  if (!changed) return;

  // 端末は configVersion が上がると設定を取り直す。全店舗ぶん上げて、
  // 次のポーリングで公開 / 非公開が反映されるようにする
  const stores = await collections.stores().list(actor.tenantId);
  for (const store of stores) {
    const config = await collections.remoteConfigs().get(actor.tenantId, store.id);
    if (config) await remoteConfig.updateConfig(actor.tenantId, store.id, {});
  }

  await log(actor, ctx, {
    action: enabled ? 'feature.publish' : 'feature.unpublish',
    key,
    summary: `${key} を${enabled ? '公開' : '非公開に'}`,
  });
}

// ---------------------------------------------------------------------------
// 店舗ごとの段階リリース
// ---------------------------------------------------------------------------

export async function setStoreFlag(
  actor: Actor,
  rawKey: string,
  storeId: Id,
  enabled: boolean,
  rolloutPercent: number,
  ctx: RequestContext = {}
): Promise<void> {
  requireManager(actor);
  const key = requireHidden(rawKey);
  await ready();

  if (actor.storeIds.length > 0 && !actor.storeIds.includes(storeId)) {
    throw new FeatureAdminError('この店舗を操作する権限がありません。');
  }
  if (!(await enabledHiddenFeatures(actor.tenantId)).has(key)) {
    // 非公開のうちに店舗の設定だけ進める、という状態を作らない
    throw new FeatureAdminError('先に公開スイッチをONにしてください。');
  }
  if (!Number.isFinite(rolloutPercent)) {
    throw new FeatureAdminError('公開率は0〜100の数字で入力してください。');
  }
  const percent = Math.min(100, Math.max(0, Math.round(rolloutPercent)));

  const store = await collections.stores().get(actor.tenantId, storeId);
  if (!store) throw new FeatureAdminError('店舗が見つかりません。');

  const config = await remoteConfig.getRaw(actor.tenantId, storeId);
  const next: FeatureFlag = { key, enabled, rolloutPercent: percent };
  const exists = config.flags.some((f) => f.key === key);
  const flags = exists
    ? config.flags.map((f) => (f.key === key ? { ...f, enabled, rolloutPercent: percent } : f))
    : [...config.flags, next];
  await remoteConfig.updateConfig(actor.tenantId, storeId, { flags });

  await log(actor, ctx, {
    action: 'feature.store_flag',
    key,
    storeId,
    summary: `${key} enabled=${enabled} rollout=${percent}`,
  });
}
