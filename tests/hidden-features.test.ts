import { beforeAll, describe, expect, it } from 'vitest';
import { buildDataset } from '@/lib/export/datasets';
import { mergeApiFlags, mergeFlags } from '@/lib/services/flag-form';
import {
  FeatureAdminError,
  getOverview,
  setPublished,
  setStoreFlag,
} from '@/lib/services/features';
import { isHiddenFeatureEnabled } from '@/lib/services/hidden-features';
import * as remoteConfig from '@/lib/services/remote-config';
import { collections, ready } from '@/lib/store';
import { DEMO_STORE_OSAKA, DEMO_STORE_UMEDA, DEMO_TENANT_ID } from '@/lib/store/seed';
import type { Actor } from '@/lib/admin/users';
import type { FeatureFlag, Role } from '@/lib/domain/types';

const admin: Actor = {
  tenantId: DEMO_TENANT_ID,
  userId: 'usr_demo_admin',
  role: 'TenantAdmin',
  storeIds: [],
};

const ACK = true;
const DEVICE = 'dev_osaka_01';

async function rejects(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(FeatureAdminError);
  await expect(promise).rejects.toThrow(pattern);
}

async function resolved(storeId = DEMO_STORE_OSAKA, deviceId = DEVICE) {
  return remoteConfig.resolve({ tenantId: DEMO_TENANT_ID, storeId, deviceId });
}

async function setRawFlag(storeId: string, flag: FeatureFlag) {
  const config = await remoteConfig.getRaw(DEMO_TENANT_ID, storeId);
  const flags = config.flags.some((f) => f.key === flag.key)
    ? config.flags.map((f) => (f.key === flag.key ? flag : f))
    : [...config.flags, flag];
  await remoteConfig.updateConfig(DEMO_TENANT_ID, storeId, { flags });
}

async function reset() {
  await ready();
  // 公開スイッチを戻し、店舗の設定を既定に揃える
  await setPublished(admin, 'faceRecognition', false, false);
  for (const storeId of [DEMO_STORE_OSAKA, DEMO_STORE_UMEDA]) {
    await setRawFlag(storeId, { key: 'faceRecognition', enabled: false, rolloutPercent: 0 });
  }
}

/**
 * 同じテストを Firestore エミュレータにも当てられる。
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 npx vitest run tests/hidden-features.test.ts
 * 公開スイッチは入れ子のマップを持つ文書なので、ドライバ間で更新の意味が
 * ずれていないかを確かめる価値がある。
 */
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const { createFirestoreDatastore } = await import('@/lib/store/firestore');
    const { seed } = await import('@/lib/store/seed');
    const datastore = createFirestoreDatastore({ projectId: 'demo-reception' });
    (globalThis as Record<string, unknown>)['__reception_datastore__'] = {
      datastore,
      seeded: seed(datastore),
    };
  }
  await reset();
});

describe('既定は非公開', () => {
  it('シードの店舗設定でも顔認証は無効で、端末へ配られない', async () => {
    await reset();
    const config = await resolved();
    expect(config.features.faceRecognition).toBe(false);
    expect(await isHiddenFeatureEnabled(DEMO_TENANT_ID, 'faceRecognition')).toBe(false);
  });

  it('店舗のフラグを有効・100%にしても、公開スイッチが OFF なら現れない', async () => {
    await reset();
    await setRawFlag(DEMO_STORE_OSAKA, { key: 'faceRecognition', enabled: true, rolloutPercent: 100 });
    // 店舗側の設定を触らずに機能全体を引っ込められる、という仕組みの根拠
    expect((await resolved()).features.faceRecognition).toBe(false);
  });

  it('顔認証のボタンも配られない', async () => {
    await reset();
    const config = await remoteConfig.getRaw(DEMO_TENANT_ID, DEMO_STORE_OSAKA);
    await remoteConfig.updateConfig(DEMO_TENANT_ID, DEMO_STORE_OSAKA, {
      buttons: [
        ...config.buttons.filter((b) => b.action !== 'reception.face'),
        { id: 'face', label: '顔認証で受付', action: 'reception.face', visible: true, order: 9 },
      ],
    });
    await setRawFlag(DEMO_STORE_OSAKA, { key: 'faceRecognition', enabled: true, rolloutPercent: 100 });

    expect((await resolved()).buttons.some((b) => b.action === 'reception.face')).toBe(false);

    await setPublished(admin, 'faceRecognition', true, ACK);
    expect((await resolved()).buttons.some((b) => b.action === 'reception.face')).toBe(true);
    await reset();
  });
});

describe('公開スイッチ', () => {
  it('公開するには確認事項へのチェックが要る', async () => {
    await reset();
    await rejects(setPublished(admin, 'faceRecognition', true, false), /確認事項/);
    expect(await isHiddenFeatureEnabled(DEMO_TENANT_ID, 'faceRecognition')).toBe(false);
  });

  it('非公開に戻すのは確認なしでできる', async () => {
    await reset();
    await setPublished(admin, 'faceRecognition', true, ACK);
    await setPublished(admin, 'faceRecognition', false, false);
    expect(await isHiddenFeatureEnabled(DEMO_TENANT_ID, 'faceRecognition')).toBe(false);
  });

  it('管理者以外は切り替えられない', async () => {
    await reset();
    for (const role of ['AreaManager', 'StoreManager', 'Staff', 'ReceptionOnly', 'Viewer'] as Role[]) {
      await rejects(
        setPublished({ ...admin, userId: 'usr_x', role }, 'faceRecognition', true, ACK),
        /権限がありません/
      );
    }
    expect(await isHiddenFeatureEnabled(DEMO_TENANT_ID, 'faceRecognition')).toBe(false);
  });

  it('担当店舗が限定された管理者は、全店舗に効くスイッチを触れない', async () => {
    await reset();
    await rejects(
      setPublished({ ...admin, storeIds: [DEMO_STORE_OSAKA] }, 'faceRecognition', true, ACK),
      /全店舗/
    );
  });

  it('隠し機能ではないキーは受け付けない', async () => {
    await rejects(setPublished(admin, 'qrReception', false, true), /正しくありません/);
    await rejects(setPublished(admin, 'toString', true, true), /正しくありません/);
    await rejects(setPublished(admin, '__proto__', true, true), /正しくありません/);
  });

  it('公開すると、店舗の設定に従って端末へ配られる', async () => {
    await reset();
    await setPublished(admin, 'faceRecognition', true, ACK);

    // 店舗側は既定で無効。公開しただけでは配られない
    expect((await resolved()).features.faceRecognition).toBe(false);

    await setStoreFlag(admin, 'faceRecognition', DEMO_STORE_OSAKA, true, 100);
    expect((await resolved(DEMO_STORE_OSAKA)).features.faceRecognition).toBe(true);
    // 別の店舗は有効にしていないので出ない
    expect((await resolved(DEMO_STORE_UMEDA, 'dev_umeda_01')).features.faceRecognition).toBe(false);

    // 公開率 0 は出ない
    await setStoreFlag(admin, 'faceRecognition', DEMO_STORE_OSAKA, true, 0);
    expect((await resolved()).features.faceRecognition).toBe(false);
    await reset();
  });

  it('非公開に戻しても店舗の設定は消えず、公開し直すと元に戻る', async () => {
    await reset();
    await setPublished(admin, 'faceRecognition', true, ACK);
    await setStoreFlag(admin, 'faceRecognition', DEMO_STORE_OSAKA, true, 100);
    expect((await resolved()).features.faceRecognition).toBe(true);

    await setPublished(admin, 'faceRecognition', false, false);
    expect((await resolved()).features.faceRecognition).toBe(false);
    const kept = (await remoteConfig.getRaw(DEMO_TENANT_ID, DEMO_STORE_OSAKA)).flags.find(
      (f) => f.key === 'faceRecognition'
    );
    expect(kept).toMatchObject({ enabled: true, rolloutPercent: 100 });

    await setPublished(admin, 'faceRecognition', true, ACK);
    expect((await resolved()).features.faceRecognition).toBe(true);
    await reset();
  });

  it('切り替えると全店舗の configVersion が上がり、同じ状態への切り替えでは上がらない', async () => {
    await reset();
    const before = async () =>
      Promise.all(
        [DEMO_STORE_OSAKA, DEMO_STORE_UMEDA].map(
          async (s) => (await remoteConfig.getRaw(DEMO_TENANT_ID, s)).configVersion
        )
      );
    const v0 = await before();
    await setPublished(admin, 'faceRecognition', true, ACK);
    const v1 = await before();
    v1.forEach((v, i) => expect(v).toBe(v0[i] + 1));

    // すでに公開中。端末に無駄な再取得をさせない
    await setPublished(admin, 'faceRecognition', true, ACK);
    expect(await before()).toEqual(v1);
    await reset();
  });

  it('監査ログに残る', async () => {
    await reset();
    await setPublished(admin, 'faceRecognition', true, ACK);
    await setStoreFlag(admin, 'faceRecognition', DEMO_STORE_OSAKA, true, 25);
    const logs = await collections
      .auditLogs()
      .list(DEMO_TENANT_ID, (l) => l.resourceType === 'feature' && l.resourceId === 'faceRecognition');
    const actions = logs.map((l) => l.action);
    expect(actions).toContain('feature.publish');
    expect(actions).toContain('feature.store_flag');
    expect(logs.every((l) => l.actorId === admin.userId)).toBe(true);
    await reset();
  });
});

describe('店舗ごとの段階リリース', () => {
  it('公開スイッチが OFF のうちは設定できない', async () => {
    await reset();
    await rejects(setStoreFlag(admin, 'faceRecognition', DEMO_STORE_OSAKA, true, 50), /先に公開スイッチ/);
  });

  it('担当外の店舗は変更できない', async () => {
    await reset();
    await setPublished(admin, 'faceRecognition', true, ACK);
    const scoped: Actor = { ...admin, storeIds: [DEMO_STORE_OSAKA] };
    await setStoreFlag(scoped, 'faceRecognition', DEMO_STORE_OSAKA, true, 10);
    await rejects(
      setStoreFlag(scoped, 'faceRecognition', DEMO_STORE_UMEDA, true, 10),
      /権限がありません/
    );
    await reset();
  });

  it('公開率は0〜100に丸め、数字でなければ弾く', async () => {
    await reset();
    await setPublished(admin, 'faceRecognition', true, ACK);
    await setStoreFlag(admin, 'faceRecognition', DEMO_STORE_OSAKA, true, 250);
    const read = async () =>
      (await remoteConfig.getRaw(DEMO_TENANT_ID, DEMO_STORE_OSAKA)).flags.find(
        (f) => f.key === 'faceRecognition'
      )!.rolloutPercent;
    expect(await read()).toBe(100);
    await setStoreFlag(admin, 'faceRecognition', DEMO_STORE_OSAKA, true, -5);
    expect(await read()).toBe(0);
    await rejects(setStoreFlag(admin, 'faceRecognition', DEMO_STORE_OSAKA, true, Number.NaN), /0〜100/);
    await reset();
  });

  it('存在しない店舗・他テナントの店舗は設定できない', async () => {
    await reset();
    await setPublished(admin, 'faceRecognition', true, ACK);
    await rejects(setStoreFlag(admin, 'faceRecognition', 'sto_ghost', true, 10), /見つかりません/);
    await reset();
  });

  it('概要に店舗ごとの状態と、担当外の店舗の編集不可が出る', async () => {
    await reset();
    await setPublished(admin, 'faceRecognition', true, ACK);
    await setStoreFlag(admin, 'faceRecognition', DEMO_STORE_OSAKA, true, 40);
    const [face] = await getOverview({ ...admin, storeIds: [DEMO_STORE_OSAKA] });
    expect(face.published).toBe(true);
    const osaka = face.stores.find((s) => s.storeId === DEMO_STORE_OSAKA)!;
    const umeda = face.stores.find((s) => s.storeId === DEMO_STORE_UMEDA)!;
    expect(osaka).toMatchObject({ enabled: true, rolloutPercent: 40, editable: true });
    expect(umeda.editable).toBe(false);
    await reset();
  });

  it('管理者以外は概要も見られない', async () => {
    await rejects(getOverview({ ...admin, role: 'Viewer' }), /権限がありません/);
  });
});

describe('端末設定フォームからの保存', () => {
  const current: FeatureFlag[] = [
    { key: 'qrReception', enabled: true, rolloutPercent: 100 },
    { key: 'faceRecognition', enabled: true, rolloutPercent: 40, allowStoreIds: ['sto_osaka'] },
  ];

  it('フォームに無い隠し機能の設定を上書きしない', () => {
    // 端末設定には顔認証の項目が無い。入力が無いのを「OFF」と読むと、
    // 機能管理で決めた設定を端末設定の保存のたびに消してしまう
    const form = new Map([['flag.qrReception.enabled', 'on'], ['flag.qrReception.rollout', '100']]);
    const merged = mergeFlags(current, (name) => form.get(name) ?? null);
    expect(merged.find((f) => f.key === 'faceRecognition')).toEqual(current[1]);
  });

  it('通常のフラグはフォームの内容を反映する', () => {
    const form = new Map([['flag.qrReception.rollout', '30']]);
    const merged = mergeFlags(current, (name) => form.get(name) ?? null);
    // チェックなし = OFF、公開率は丸める
    expect(merged.find((f) => f.key === 'qrReception')).toMatchObject({
      enabled: false,
      rolloutPercent: 30,
    });
  });
});

describe('帳票の列', () => {
  const headers = async () =>
    (await buildDataset(DEMO_TENANT_ID, 'customers', {})).columns.map((c) => c.header);

  it('非公開の間は顔認証の列を出さない', async () => {
    await reset();
    expect(await headers()).not.toContain('顔認証登録');
  });

  it('公開すると列が現れる', async () => {
    await reset();
    await setPublished(admin, 'faceRecognition', true, ACK);
    expect(await headers()).toContain('顔認証登録');
    await reset();
  });
});

describe('API からのフラグ更新', () => {
  const current: FeatureFlag[] = [
    { key: 'qrReception', enabled: true, rolloutPercent: 100 },
    { key: 'faceRecognition', enabled: true, rolloutPercent: 40 },
  ];

  it('配列に含めなかった隠し機能の設定を消さない', () => {
    // API は flags を丸ごと置き換える。そのままだと店舗の設定が黙って消える
    const merged = mergeApiFlags(current, [{ key: 'qrReception', enabled: false, rolloutPercent: 50 }]);
    expect(merged.find((f) => f.key === 'faceRecognition')).toEqual(current[1]);
    expect(merged.find((f) => f.key === 'qrReception')).toMatchObject({ enabled: false });
  });

  it('取得した配列をそのまま送り返すのは通す', () => {
    expect(mergeApiFlags(current, current)).toHaveLength(2);
  });

  it('隠し機能の値を変えようとしたら拒否する（権限と監査を迂回させない）', () => {
    expect(() =>
      mergeApiFlags(current, [{ key: 'faceRecognition', enabled: true, rolloutPercent: 100 }])
    ).toThrow(/隠し機能/);
    expect(() =>
      mergeApiFlags(current, [{ key: 'faceRecognition', enabled: false, rolloutPercent: 40 }])
    ).toThrow(/隠し機能/);
    // 現在の設定に無い隠し機能を新しく足すのも同じ
    expect(() =>
      mergeApiFlags([], [{ key: 'faceRecognition', enabled: true, rolloutPercent: 5 }])
    ).toThrow(/隠し機能/);
  });

  it('壊れた要素は読み飛ばす', () => {
    const merged = mergeApiFlags(current, [null, 'x', 1, { enabled: true }, current[0]]);
    expect(merged.map((f) => f.key).sort()).toEqual(['faceRecognition', 'qrReception']);
  });
});
