import { GLOBAL_TENANT, type Datastore } from './datastore';
import { sha256Hex, newToken } from '../core/ids';
import { hashPassword } from '../admin/password';
import type {
  AccessNumber,
  AdminUser,
  ApiClient,
  AppRelease,
  Customer,
  Device,
  RemoteConfig,
  Reservation,
  Store,
  Tenant,
  Visit,
} from '../domain/types';

/**
 * 開発・デモ用のシードデータ。
 *
 * 本番の Firestore ドライバではシードを走らせない（RECEPTION_SEED=0）。
 * 「動くものを触りながら仕様を確認できる」ことを優先し、1テナント2店舗の
 * 現実的なデータを入れる。
 */

export const DEMO_TENANT_ID = 'ten_demo';
export const DEMO_STORE_OSAKA = 'sto_osaka';
export const DEMO_STORE_UMEDA = 'sto_umeda';

/**
 * 開発用 API キー。ハッシュのみ保存する実装であることを示すため、
 * 平文はここでしか登場しない。本番は Secret Manager から供給する。
 */
export const DEMO_API_KEY = process.env.RECEPTION_DEMO_API_KEY ?? 'rk_dev_demo_tenant_key';

/**
 * 開発用の管理Webログイン。
 *
 * 本番はここを通さない（RECEPTION_SEED=0）。共有環境へ出す場合は
 * 必ず環境変数で上書きし、既定値のまま公開しないこと。
 */
export const DEMO_ADMIN_EMAIL =
  process.env.RECEPTION_DEMO_ADMIN_EMAIL ?? 'admin@example.com';
export const DEMO_ADMIN_PASSWORD =
  process.env.RECEPTION_DEMO_ADMIN_PASSWORD ?? 'reception-dev';
export const DEMO_RECEPTION_KEY =
  process.env.RECEPTION_DEMO_DEVICE_KEY ?? 'rk_dev_reception_terminal_key';

function iso(d: Date): string {
  return d.toISOString();
}

function at(base: Date, hours: number, minutes = 0): Date {
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

export async function seed(ds: Datastore): Promise<void> {
  if (process.env.RECEPTION_SEED === '0') return;

  // 永続ストア(Firestore)ではインスタンスが起動するたびに呼ばれる。
  // そのまま流すと、デモ中に追加した予約や顧客が次のコールドスタートで
  // 初期状態に戻ってしまう。投入済みなら何もしない。
  // 同時起動で二重投入しないようロックを取る。
  await ds.withLock('seed', async () => {
    const existing = await ds.collection<Tenant>('tenants').get(DEMO_TENANT_ID, DEMO_TENANT_ID);
    if (existing) return;
    await insertSeedData(ds);
  });
}

async function insertSeedData(ds: Datastore): Promise<void> {
  const now = new Date();
  const nowIso = iso(now);

  const tenant: Tenant = {
    id: DEMO_TENANT_ID,
    tenantId: DEMO_TENANT_ID,
    name: 'デモ株式会社',
    logoUrl: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await ds.collection<Tenant>('tenants').insert(tenant);

  const stores: Store[] = [
    {
      id: DEMO_STORE_OSAKA,
      tenantId: DEMO_TENANT_ID,
      name: '大阪店',
      areaId: 'area_kansai',
      timezone: 'Asia/Tokyo',
      numberHoldMinutes: 15,
      defaultStayMinutes: 60,
      capacity: 12,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: DEMO_STORE_UMEDA,
      tenantId: DEMO_TENANT_ID,
      name: '梅田店',
      areaId: 'area_kansai',
      timezone: 'Asia/Tokyo',
      numberHoldMinutes: 20,
      defaultStayMinutes: 90,
      capacity: 8,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];
  for (const store of stores) await ds.collection<Store>('stores').insert(store);

  const customers: Customer[] = [
    customer('cus_tanaka', '0001', '田中 太郎', 'たなか たろう', now),
    customer('cus_tanaka_hana', '0002', '田中 花子', 'たなか はなこ', now),
    customer('cus_suzuki', '0003', '鈴木 一郎', 'すずき いちろう', now),
    customer('cus_sato', '0004', '佐藤 美咲', 'さとう みさき', now),
    customer('cus_takahashi', '0005', '高橋 健', 'たかはし けん', now),
  ];
  for (const c of customers) await ds.collection<Customer>('customers').insert(c);

  // 予約: 今日の営業時間内に散らす
  const reservations: Reservation[] = [
    reservation('res_0001', DEMO_STORE_OSAKA, 'cus_tanaka', at(now, 10), at(now, 11), '1234', 'checked_in', now),
    reservation('res_0002', DEMO_STORE_OSAKA, 'cus_suzuki', at(now, 11), at(now, 12), '5555', 'booked', now),
    reservation('res_0003', DEMO_STORE_OSAKA, 'cus_sato', at(now, 14), at(now, 15, 30), null, 'booked', now),
    reservation('res_0004', DEMO_STORE_UMEDA, 'cus_takahashi', at(now, 13), at(now, 14, 30), '7788', 'booked', now),
    reservation('res_0005', DEMO_STORE_UMEDA, 'cus_tanaka_hana', at(now, 16), at(now, 17), null, 'booked', now),
  ];
  for (const r of reservations) await ds.collection<Reservation>('reservations').insert(r);

  // 来店: 1件は滞在中、1件は退出済み
  const visits: Visit[] = [
    {
      id: 'vis_0001',
      tenantId: DEMO_TENANT_ID,
      storeId: DEMO_STORE_OSAKA,
      reservationId: 'res_0001',
      customerId: 'cus_tanaka',
      guestName: null,
      accessNumber: '1234',
      method: 'qr',
      status: 'in_store',
      checkedInAt: iso(at(now, 10, 2)),
      scheduledExitAt: iso(at(now, 11)),
      actualExitAt: null,
      deviceId: 'dev_osaka_01',
      clientEventId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'vis_0002',
      tenantId: DEMO_TENANT_ID,
      storeId: DEMO_STORE_UMEDA,
      reservationId: null,
      customerId: 'cus_takahashi',
      guestName: null,
      accessNumber: '9012',
      method: 'number',
      status: 'exited',
      checkedInAt: iso(at(now, 9)),
      scheduledExitAt: iso(at(now, 10, 30)),
      actualExitAt: iso(at(now, 10, 25)),
      deviceId: 'dev_umeda_01',
      clientEventId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];
  for (const v of visits) await ds.collection<Visit>('visits').insert(v);

  const numbers: AccessNumber[] = [
    accessNumber('acn_1234', DEMO_STORE_OSAKA, '1234', 'in_use', now, {
      customerIds: ['cus_tanaka'],
      reservationId: 'res_0001',
      visitId: 'vis_0001',
    }),
    // Shared Number: 1番号に家族3人を紐付ける (PRD 7-3)
    accessNumber('acn_5555', DEMO_STORE_OSAKA, '5555', 'reserved', now, {
      customerIds: ['cus_suzuki', 'cus_tanaka', 'cus_tanaka_hana'],
      reservationId: 'res_0002',
    }),
    accessNumber('acn_9012', DEMO_STORE_UMEDA, '9012', 'exited', now, {
      customerIds: ['cus_takahashi'],
      visitId: 'vis_0002',
      exitedAt: iso(at(now, 10, 25)),
    }),
    // VIP 固定番号: この顧客のために確保し続ける。自動解放の対象外だが、
    // 受付には使えること（locked は「管理者が停止した番号」で別物）
    accessNumber('acn_0001', DEMO_STORE_OSAKA, '0001', 'reserved', now, {
      customerIds: ['cus_sato'],
      pinned: true,
    }),
    accessNumber('acn_7788', DEMO_STORE_UMEDA, '7788', 'reserved', now, {
      customerIds: ['cus_takahashi'],
      reservationId: 'res_0004',
    }),
  ];
  for (const n of numbers) await ds.collection<AccessNumber>('access_numbers').insert(n);

  const devices: Device[] = [
    device('dev_osaka_01', DEMO_STORE_OSAKA, '大阪店 受付1', 'pwa', now),
    device('dev_umeda_01', DEMO_STORE_UMEDA, '梅田店 受付1', 'android', now),
  ];
  for (const d of devices) await ds.collection<Device>('devices').insert(d);

  for (const store of stores) {
    await ds
      .collection<RemoteConfig & { id: string }>('remote_configs')
      .insert(remoteConfig(store, nowIso));
  }

  const apiClients: ApiClient[] = [
    {
      id: 'apc_demo_admin',
      tenantId: DEMO_TENANT_ID,
      name: 'デモ用 管理APIキー',
      keyHash: sha256Hex(DEMO_API_KEY),
      keyPrefix: DEMO_API_KEY.slice(0, 10),
      role: 'TenantAdmin',
      scopes: [
        'customers:read',
        'customers:write',
        'reservations:read',
        'reservations:write',
        'visits:read',
        'visits:write',
        'access_numbers:read',
        'access_numbers:write',
        'stores:read',
        'stores:write',
        'devices:read',
        'exports:read',
        'exports:write',
        'webhooks:read',
        'webhooks:write',
        'audit:read',
      ],
      storeIds: [],
      areaIds: [],
      rateLimitPerMinute: 600,
      disabled: false,
      createdAt: nowIso,
      lastUsedAt: null,
    },
    {
      id: 'apc_reception_terminal',
      tenantId: DEMO_TENANT_ID,
      name: '受付端末キー（大阪店）',
      keyHash: sha256Hex(DEMO_RECEPTION_KEY),
      keyPrefix: DEMO_RECEPTION_KEY.slice(0, 10),
      role: 'ReceptionOnly',
      // 受付端末は受付と退出しかできない。顧客一覧は引けない。
      scopes: ['reservations:read', 'visits:read', 'visits:write', 'access_numbers:read', 'devices:read'],
      storeIds: [DEMO_STORE_OSAKA, DEMO_STORE_UMEDA],
      areaIds: [],
      rateLimitPerMinute: 300,
      disabled: false,
      createdAt: nowIso,
      lastUsedAt: null,
    },
  ];
  for (const c of apiClients) await ds.collection<ApiClient>('api_clients').insert(c);

  // 管理Webのログイン。役割ごとに1人ずつ入れて、権限の出し分けを
  // ログインし直すだけで確認できるようにする。
  const adminUsers: AdminUser[] = [
    {
      id: 'usr_demo_admin',
      tenantId: DEMO_TENANT_ID,
      email: DEMO_ADMIN_EMAIL,
      displayName: 'デモ管理者',
      role: 'TenantAdmin',
      storeIds: [],
      passwordHash: await hashPassword(DEMO_ADMIN_PASSWORD),
      status: 'active',
      lastLoginAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'usr_demo_store_manager',
      tenantId: DEMO_TENANT_ID,
      email: 'osaka@example.com',
      displayName: '大阪店 店長',
      role: 'StoreManager',
      storeIds: [DEMO_STORE_OSAKA],
      passwordHash: await hashPassword(DEMO_ADMIN_PASSWORD),
      status: 'active',
      lastLoginAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'usr_demo_viewer',
      tenantId: DEMO_TENANT_ID,
      email: 'viewer@example.com',
      displayName: '閲覧のみ',
      role: 'Viewer',
      storeIds: [],
      passwordHash: await hashPassword(DEMO_ADMIN_PASSWORD),
      status: 'active',
      lastLoginAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];
  for (const u of adminUsers) await ds.collection<AdminUser>('admin_users').insert(u);

  const releases: (AppRelease & { tenantId: string })[] = [
    {
      id: 'rel_android_1_1_0',
      tenantId: GLOBAL_TENANT,
      platform: 'android',
      version: '1.1.0',
      buildNumber: 110,
      releaseDate: nowIso,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      signingProfile: null,
      commitSha: null,
      minimumOs: '9.0',
      requiredUpdate: false,
      supportedDevices: ['tablet', 'phone'],
      downloadUrl: 'https://downloads.example.com/Reception-v1.1.0.apk',
      releaseNotes: '4桁番号受付の入力速度改善、退出通知の不具合修正。',
    },
    {
      id: 'rel_ios_1_0_2',
      tenantId: GLOBAL_TENANT,
      platform: 'ios',
      version: '1.0.2',
      buildNumber: 42,
      releaseDate: nowIso,
      sha256: null,
      signingProfile: 'Reception AppStore Distribution',
      commitSha: 'a1b2c3d4',
      minimumOs: '16.0',
      requiredUpdate: false,
      supportedDevices: ['ipad'],
      downloadUrl: null,
      releaseNotes: 'TestFlight 配信。QR読み取りの安定性向上。',
    },
    {
      id: 'rel_pwa_1_5_0',
      tenantId: GLOBAL_TENANT,
      platform: 'pwa',
      version: '1.5.0',
      buildNumber: 150,
      releaseDate: nowIso,
      sha256: null,
      signingProfile: null,
      commitSha: null,
      minimumOs: '-',
      requiredUpdate: false,
      supportedDevices: ['ipad', 'tablet', 'desktop'],
      downloadUrl: null,
      releaseNotes: 'Remote Config 対応。',
    },
  ];
  for (const r of releases) {
    await ds.collection<AppRelease & { tenantId: string }>('app_releases').insert(r);
  }
}

// ---------------------------------------------------------------------------

function customer(
  id: string,
  memberCode: string,
  name: string,
  kana: string,
  now: Date
): Customer {
  const nowIso = iso(now);
  return {
    id,
    tenantId: DEMO_TENANT_ID,
    memberCode,
    name,
    nameKana: kana,
    email: null,
    phone: null,
    externalIds: {},
    faceRecognition: { enrolled: false, consentAt: null, retentionUntil: null },
    note: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function reservation(
  id: string,
  storeId: string,
  customerId: string,
  startAt: Date,
  endAt: Date,
  accessNumber: string | null,
  status: Reservation['status'],
  now: Date
): Reservation {
  const nowIso = iso(now);
  const expires = new Date(endAt.getTime() + 60 * 60 * 1000);
  return {
    id,
    tenantId: DEMO_TENANT_ID,
    storeId,
    customerId,
    guestName: null,
    serviceId: null,
    status,
    startAt: iso(startAt),
    endAt: iso(endAt),
    accessNumber,
    qrToken: newToken(),
    qrTokenExpiresAt: iso(expires),
    source: 'admin',
    note: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function accessNumber(
  id: string,
  storeId: string,
  number: string,
  status: AccessNumber['status'],
  now: Date,
  extra: Partial<AccessNumber> = {}
): AccessNumber {
  const nowIso = iso(now);
  return {
    id,
    tenantId: DEMO_TENANT_ID,
    storeId,
    number,
    status,
    customerIds: [],
    reservationId: null,
    visitId: null,
    pinned: false,
    holdFrom: null,
    holdUntil: null,
    exitedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...extra,
  };
}

function device(
  id: string,
  storeId: string,
  name: string,
  platform: Device['platform'],
  now: Date
): Device {
  const nowIso = iso(now);
  return {
    id,
    tenantId: DEMO_TENANT_ID,
    storeId,
    name,
    platform,
    appVersion: platform === 'android' ? '1.0.0' : '1.5.0',
    configVersion: 1,
    lastSeenAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function remoteConfig(store: Store, nowIso: string): RemoteConfig & { id: string } {
  return {
    id: store.id,
    tenantId: store.tenantId,
    storeId: store.id,
    configVersion: 1,
    logo: null,
    theme: 'light',
    language: 'ja',
    notificationSound: 'chime',
    buttons: [
      { id: 'qr', label: 'QRコードで受付', action: 'reception.qr', visible: true, order: 1 },
      { id: 'number', label: '受付番号を入力', action: 'reception.number', visible: true, order: 2 },
      // 下部の呼び出しボタン。氏名を取らず担当者を呼ぶだけ (PRD 21 業者受付/イベント受付)
      { id: 'staff', label: '総合受付', action: 'reception.staff', visible: true, order: 3 },
      { id: 'vendor', label: '業者・配送', action: 'reception.event', visible: true, order: 4 },
    ],
    flags: [
      { key: 'qrReception', enabled: true, rolloutPercent: 100 },
      { key: 'numberReception', enabled: true, rolloutPercent: 100 },
      { key: 'exitNotification', enabled: true, rolloutPercent: 100 },
      { key: 'staffReception', enabled: true, rolloutPercent: 100 },
      { key: 'eventReception', enabled: true, rolloutPercent: 100 },
      // P1機能。段階リリースの例として 5% で配信中
      { key: 'faceRecognition', enabled: true, rolloutPercent: 5 },
      { key: 'calendar', enabled: false, rolloutPercent: 0 },
      { key: 'offlineMode', enabled: true, rolloutPercent: 25 },
    ],
    updatedAt: nowIso,
  };
}
