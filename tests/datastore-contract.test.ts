import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryDatastore, type Datastore, type Doc } from '@/lib/store/datastore';

/**
 * Datastore ポートの契約テスト。
 *
 * in-memory と Firestore の両ドライバに同じテストを当て、
 * 差し替えても振る舞いが変わらないことを保証する。
 * ドライバ間で意味論がずれると、ローカルでは通るのに本番だけ壊れる、
 * という最悪の形で出る。
 *
 * Firestore 側は エミュレータが起動しているときだけ走る:
 *   npx firebase emulators:start --only firestore --project demo-reception
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 npm test
 */

type Sample = Doc & { name: string; count: number; nested?: { a: string; b: string | null } };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

const drivers: { label: string; create: () => Promise<Datastore>; cleanup?: () => Promise<void> }[] =
  [{ label: 'in-memory', create: async () => new MemoryDatastore() }];

if (emulatorHost) {
  drivers.push({
    label: 'Firestore (emulator)',
    create: async () => {
      const { createFirestoreDatastore } = await import('@/lib/store/firestore');
      return createFirestoreDatastore({ projectId: 'demo-reception' });
    },
  });
}

describe.each(drivers)('$label', ({ create }) => {
  let store: Datastore;
  let collectionName: string;

  beforeEach(async () => {
    store = await create();
    // Firestore はテスト間で状態が残るので、毎回別コレクションを使う
    collectionName = `sample_${Math.random().toString(36).slice(2, 10)}`;
  });

  const doc = (overrides: Partial<Sample> = {}): Sample => ({
    id: 'doc_1',
    tenantId: 'ten_a',
    name: 'あ',
    count: 1,
    ...overrides,
  });

  it('入れたものを取り出せる', async () => {
    const col = store.collection<Sample>(collectionName);
    await col.insert(doc());
    expect(await col.get('ten_a', 'doc_1')).toMatchObject({ name: 'あ', count: 1 });
  });

  it('存在しない文書は null', async () => {
    const col = store.collection<Sample>(collectionName);
    expect(await col.get('ten_a', 'missing')).toBeNull();
  });

  it('別テナントからは読めない', async () => {
    const col = store.collection<Sample>(collectionName);
    await col.insert(doc());
    expect(await col.get('ten_b', 'doc_1')).toBeNull();
    expect(await col.list('ten_b')).toHaveLength(0);
  });

  it('一覧はテナント内に限られる', async () => {
    const col = store.collection<Sample>(collectionName);
    await col.insert(doc({ id: 'a1', tenantId: 'ten_a' }));
    await col.insert(doc({ id: 'a2', tenantId: 'ten_a' }));
    await col.insert(doc({ id: 'b1', tenantId: 'ten_b' }));

    expect(await col.list('ten_a')).toHaveLength(2);
    expect(await col.list('ten_b')).toHaveLength(1);
  });

  it('predicate で絞り込める', async () => {
    const col = store.collection<Sample>(collectionName);
    await col.insert(doc({ id: 'a1', count: 1 }));
    await col.insert(doc({ id: 'a2', count: 5 }));

    const found = await col.list('ten_a', (d) => d.count > 3);
    expect(found.map((d) => d.id)).toEqual(['a2']);
  });

  it('テナント横断で読める', async () => {
    const col = store.collection<Sample>(collectionName);
    await col.insert(doc({ id: 'a1', tenantId: 'ten_a' }));
    await col.insert(doc({ id: 'b1', tenantId: 'ten_b' }));

    const all = await col.listAcrossTenants();
    expect(all).toHaveLength(2);
    expect(await col.listAcrossTenants((d) => d.tenantId === 'ten_b')).toHaveLength(1);
  });

  it('更新は浅いマージで、未指定のフィールドは残る', async () => {
    const col = store.collection<Sample>(collectionName);
    await col.insert(doc({ name: 'あ', count: 1 }));

    const updated = await col.update('ten_a', 'doc_1', { count: 9 });
    expect(updated).toMatchObject({ name: 'あ', count: 9 });
  });

  it('入れ子のオブジェクトは丸ごと差し替わる', async () => {
    // merge の意味論がドライバ間でずれやすい箇所。
    // 顔認証の同意状態など「一括で置き換えたい」フィールドがこれに当たる。
    const col = store.collection<Sample>(collectionName);
    await col.insert(doc({ nested: { a: 'keep', b: 'drop' } }));

    const updated = await col.update('ten_a', 'doc_1', { nested: { a: 'new', b: null } });
    expect(updated?.nested).toEqual({ a: 'new', b: null });
  });

  it('id と tenantId は更新で書き換えられない', async () => {
    const col = store.collection<Sample>(collectionName);
    await col.insert(doc());

    const updated = await col.update('ten_a', 'doc_1', {
      id: 'hacked',
      tenantId: 'ten_b',
      count: 2,
    } as Partial<Sample>);

    expect(updated).toMatchObject({ id: 'doc_1', tenantId: 'ten_a', count: 2 });
    expect(await col.get('ten_b', 'doc_1')).toBeNull();
  });

  it('存在しない文書の更新は null', async () => {
    const col = store.collection<Sample>(collectionName);
    expect(await col.update('ten_a', 'missing', { count: 1 })).toBeNull();
  });

  it('削除できる。存在しなければ false', async () => {
    const col = store.collection<Sample>(collectionName);
    await col.insert(doc());

    expect(await col.remove('ten_a', 'doc_1')).toBe(true);
    expect(await col.get('ten_a', 'doc_1')).toBeNull();
    expect(await col.remove('ten_a', 'doc_1')).toBe(false);
  });

  it('取り出した値を変更してもストアは汚れない', async () => {
    const col = store.collection<Sample>(collectionName);
    await col.insert(doc({ name: 'もと' }));

    const fetched = await col.get('ten_a', 'doc_1');
    fetched!.name = '書き換え';

    expect((await col.get('ten_a', 'doc_1'))?.name).toBe('もと');
  });

  it('ping が通る', async () => {
    expect(await store.ping()).toBe(true);
  });

  it('withLock が同一キーの処理を直列化する', async () => {
    // 番号払い出しの read-modify-write が競合しないことの担保。
    // ロックが効いていないとカウンタが飛ぶ。
    const col = store.collection<Sample>(collectionName);
    await col.insert(doc({ count: 0 }));

    await Promise.all(
      Array.from({ length: 5 }, () =>
        store.withLock('counter', async () => {
          const current = await col.get('ten_a', 'doc_1');
          // 読んでから書くまでに隙間を作り、競合しやすくする
          await new Promise((resolve) => setTimeout(resolve, 10));
          await col.update('ten_a', 'doc_1', { count: (current?.count ?? 0) + 1 });
        })
      )
    );

    expect((await col.get('ten_a', 'doc_1'))?.count).toBe(5);
  });

  it('異なるキーのロックは互いを待たない', async () => {
    const order: string[] = [];
    await Promise.all([
      store.withLock('key-a', async () => {
        order.push('a-start');
        await new Promise((resolve) => setTimeout(resolve, 60));
        order.push('a-end');
      }),
      store.withLock('key-b', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('b-done');
      }),
    ]);

    // b は a の完了を待たずに終わる
    expect(order).toEqual(['a-start', 'b-done', 'a-end']);
  });

  it('ロック内で例外が出ても次の待ち手が進める', async () => {
    await expect(
      store.withLock('failing', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(await store.withLock('failing', async () => 'ok')).toBe('ok');
  });
});

afterAll(() => {
  if (!emulatorHost) {
    console.warn(
      'FIRESTORE_EMULATOR_HOST が未設定のため、Firestore ドライバの契約テストは実行されていません。'
    );
  }
});
