import { MemoryDatastore, type Collection, type Datastore } from './datastore';
import type {
  AccessNumber,
  ApiClient,
  AppRelease,
  AuditLog,
  Customer,
  Device,
  ExportJob,
  NotificationRecord,
  RemoteConfig,
  Reservation,
  Store,
  Tenant,
  Visit,
  WebhookDelivery,
  WebhookEndpoint,
} from '../domain/types';
import { seed } from './seed';

/**
 * データストアのシングルトン。
 *
 * Next.js の dev サーバーはモジュールを再評価するので、globalThis に保持しないと
 * 編集のたびにデータが消える。本番の Firestore ドライバでは接続プールを持つ。
 */

const GLOBAL_KEY = '__reception_datastore__';

type GlobalWithStore = typeof globalThis & {
  [GLOBAL_KEY]?: { datastore: Datastore; seeded: Promise<void> };
};

function createDatastore(): Datastore {
  // NOTE: Firestore ドライバに切り替える場合はここだけ差し替える。
  // 環境変数 RECEPTION_DATASTORE=firestore で分岐させる想定。
  return new MemoryDatastore();
}

function bootstrap() {
  const g = globalThis as GlobalWithStore;
  if (!g[GLOBAL_KEY]) {
    const datastore = createDatastore();
    g[GLOBAL_KEY] = { datastore, seeded: seed(datastore) };
  }
  return g[GLOBAL_KEY]!;
}

export function datastore(): Datastore {
  return bootstrap().datastore;
}

/** 全リポジトリ操作の前に呼ぶ。シード完了を待つ。 */
export async function ready(): Promise<void> {
  await bootstrap().seeded;
}

export const collections = {
  tenants: () => datastore().collection<Tenant>('tenants'),
  stores: () => datastore().collection<Store>('stores'),
  customers: () => datastore().collection<Customer>('customers'),
  reservations: () => datastore().collection<Reservation>('reservations'),
  visits: () => datastore().collection<Visit>('visits'),
  accessNumbers: () => datastore().collection<AccessNumber>('access_numbers'),
  devices: () => datastore().collection<Device>('devices'),
  remoteConfigs: () =>
    datastore().collection<RemoteConfig & { id: string }>('remote_configs'),
  appReleases: () => datastore().collection<AppRelease & { tenantId: string }>('app_releases'),
  apiClients: () => datastore().collection<ApiClient>('api_clients'),
  auditLogs: () => datastore().collection<AuditLog>('audit_logs'),
  webhookEndpoints: () => datastore().collection<WebhookEndpoint>('webhook_endpoints'),
  webhookDeliveries: () => datastore().collection<WebhookDelivery>('webhook_deliveries'),
  exportJobs: () => datastore().collection<ExportJob>('export_jobs'),
  notifications: () => datastore().collection<NotificationRecord>('notifications'),
};

export { GLOBAL_TENANT } from './datastore';
export type { Datastore, Collection };
