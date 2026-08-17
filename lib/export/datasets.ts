import { collections } from '../store';
import type { Column } from './csv';
import type {
  AccessNumber,
  AuditLog,
  Customer,
  ExportResource,
  Id,
  NotificationRecord,
  Reservation,
  Visit,
} from '../domain/types';

/**
 * 帳票の対象データと列定義 (PRD 11-1)。
 *
 * 列見出しは日本語。受け手は店舗スタッフであり、英語のキー名では読めない。
 * 機械可読が必要な場合は JSON エクスポートを使う。
 */

export type ExportFilters = { storeId?: Id; from?: string; to?: string };

export type Dataset = {
  /** ダウンロードファイル名に使う */
  slug: string;
  sheetName: string;
  rows: unknown[];
  columns: Column<never>[];
};

function inRange(value: string | null, from?: string, to?: string): boolean {
  if (!value) return !from && !to;
  const ms = Date.parse(value);
  if (from && ms < Date.parse(from)) return false;
  if (to && ms > Date.parse(to)) return false;
  return true;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  // Excel が日時として認識しやすい形式にする（タイムゾーン付きISOは文字列扱いされる）
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const NUMBER_STATUS_LABEL: Record<AccessNumber['status'], string> = {
  available: '未使用',
  reserved: '確保済み',
  checked_in: '受付済み',
  in_use: '利用中',
  exited: '退出済み',
  expired: '期限切れ',
  released: '解放済み',
  locked: '停止中',
};

const RESERVATION_STATUS_LABEL: Record<Reservation['status'], string> = {
  booked: '予約済み',
  checked_in: '受付済み',
  completed: '完了',
  cancelled: 'キャンセル',
  no_show: '無断キャンセル',
};

const METHOD_LABEL: Record<Visit['method'], string> = {
  qr: 'QR',
  number: '4桁番号',
  face: '顔認証',
  staff: 'スタッフ',
  vendor: '業者',
  event: 'イベント',
  custom: 'カスタム',
};

export async function buildDataset(
  tenantId: Id,
  resource: ExportResource,
  filters: ExportFilters
): Promise<Dataset> {
  const storeNames = new Map<Id, string>();
  for (const store of await collections.stores().list(tenantId)) {
    storeNames.set(store.id, store.name);
  }
  const customerNames = new Map<Id, string>();
  for (const c of await collections.customers().list(tenantId)) {
    customerNames.set(c.id, c.name);
  }

  switch (resource) {
    case 'customers': {
      const rows = await collections.customers().list(tenantId);
      return {
        slug: 'customers',
        sheetName: '顧客',
        rows,
        columns: cols<Customer>([
          ['id', '顧客ID', (r) => r.id],
          ['memberCode', '会員番号', (r) => r.memberCode],
          ['name', '氏名', (r) => r.name],
          ['nameKana', 'フリガナ', (r) => r.nameKana],
          ['email', 'メールアドレス', (r) => r.email],
          ['phone', '電話番号', (r) => r.phone],
          ['faceEnrolled', '顔認証登録', (r) => (r.faceRecognition.enrolled ? 'あり' : 'なし')],
          ['externalIds', '外部ID', (r) => JSON.stringify(r.externalIds)],
          ['createdAt', '登録日時', (r) => formatDateTime(r.createdAt)],
        ]),
      };
    }

    case 'reservations': {
      const rows = (await collections.reservations().list(tenantId)).filter(
        (r) =>
          (!filters.storeId || r.storeId === filters.storeId) &&
          inRange(r.startAt, filters.from, filters.to)
      );
      return {
        slug: 'reservations',
        sheetName: '予約',
        rows,
        columns: cols<Reservation>([
          ['id', '予約ID', (r) => r.id],
          ['storeName', '店舗', (r) => storeNames.get(r.storeId) ?? r.storeId],
          ['customerName', '顧客', (r) => r.guestName ?? customerNames.get(r.customerId ?? '') ?? ''],
          ['status', '状態', (r) => RESERVATION_STATUS_LABEL[r.status]],
          ['startAt', '開始予定', (r) => formatDateTime(r.startAt)],
          ['endAt', '終了予定', (r) => formatDateTime(r.endAt)],
          ['accessNumber', '番号', (r) => r.accessNumber],
          ['source', '登録経路', (r) => r.source],
          ['note', '備考', (r) => r.note],
        ]),
      };
    }

    case 'visits': {
      const rows = (await collections.visits().list(tenantId)).filter(
        (v) =>
          (!filters.storeId || v.storeId === filters.storeId) &&
          inRange(v.checkedInAt, filters.from, filters.to)
      );
      return {
        slug: 'visits',
        sheetName: '来店',
        rows,
        columns: cols<Visit>([
          ['id', '来店ID', (r) => r.id],
          ['storeName', '店舗', (r) => storeNames.get(r.storeId) ?? r.storeId],
          ['customerName', '顧客', (r) => r.guestName ?? customerNames.get(r.customerId ?? '') ?? ''],
          ['accessNumber', '番号', (r) => r.accessNumber],
          ['method', '受付方法', (r) => METHOD_LABEL[r.method]],
          ['status', '状態', (r) => (r.status === 'in_store' ? '滞在中' : '退出済み')],
          ['checkedInAt', '受付日時', (r) => formatDateTime(r.checkedInAt)],
          ['scheduledExitAt', '退出予定', (r) => formatDateTime(r.scheduledExitAt)],
          ['actualExitAt', '退出日時', (r) => formatDateTime(r.actualExitAt)],
          [
            'stayMinutes',
            '滞在分',
            (r) =>
              r.actualExitAt
                ? Math.round((Date.parse(r.actualExitAt) - Date.parse(r.checkedInAt)) / 60_000)
                : null,
          ],
          [
            'overdueMinutes',
            '超過分',
            (r) => {
              if (!r.actualExitAt || !r.scheduledExitAt) return null;
              const over = Math.round(
                (Date.parse(r.actualExitAt) - Date.parse(r.scheduledExitAt)) / 60_000
              );
              return over > 0 ? over : 0;
            },
          ],
          ['deviceId', '端末', (r) => r.deviceId],
        ]),
      };
    }

    case 'access_numbers': {
      const rows = (await collections.accessNumbers().list(tenantId)).filter(
        (n) => !filters.storeId || n.storeId === filters.storeId
      );
      return {
        slug: 'access-numbers',
        sheetName: '番号',
        rows,
        columns: cols<AccessNumber>([
          ['number', '番号', (r) => r.number],
          ['storeName', '店舗', (r) => storeNames.get(r.storeId) ?? r.storeId],
          ['status', '状態', (r) => NUMBER_STATUS_LABEL[r.status]],
          ['pinned', '固定', (r) => (r.pinned ? 'はい' : 'いいえ')],
          [
            'customers',
            '紐付け顧客',
            (r) => r.customerIds.map((id) => customerNames.get(id) ?? id).join(' / '),
          ],
          ['reservationId', '予約ID', (r) => r.reservationId],
          ['exitedAt', '退出日時', (r) => formatDateTime(r.exitedAt)],
          ['updatedAt', '更新日時', (r) => formatDateTime(r.updatedAt)],
        ]),
      };
    }

    case 'notifications': {
      const rows = (await collections.notifications().list(tenantId)).filter(
        (n) =>
          (!filters.storeId || n.storeId === filters.storeId) &&
          inRange(n.scheduledAt, filters.from, filters.to)
      );
      return {
        slug: 'notifications',
        sheetName: '通知',
        rows,
        columns: cols<NotificationRecord>([
          ['id', '通知ID', (r) => r.id],
          ['storeName', '店舗', (r) => storeNames.get(r.storeId ?? '') ?? ''],
          ['kind', '種別', (r) => r.kind],
          ['channel', 'チャネル', (r) => r.channel],
          ['status', '状態', (r) => r.status],
          ['scheduledAt', '送信予定', (r) => formatDateTime(r.scheduledAt)],
          ['sentAt', '送信日時', (r) => formatDateTime(r.sentAt)],
          ['message', '本文', (r) => r.message],
          ['error', 'エラー', (r) => r.error],
        ]),
      };
    }

    case 'api_logs': {
      const rows = (await collections.auditLogs().list(tenantId)).filter((l) =>
        inRange(l.createdAt, filters.from, filters.to)
      );
      return {
        slug: 'api-logs',
        sheetName: 'APIログ',
        rows,
        columns: cols<AuditLog>([
          ['createdAt', '日時', (r) => formatDateTime(r.createdAt)],
          ['requestId', 'リクエストID', (r) => r.requestId],
          ['actorType', '実行者種別', (r) => r.actorType],
          ['actorId', '実行者', (r) => r.actorId],
          ['action', '操作', (r) => r.action],
          ['resourceType', '対象種別', (r) => r.resourceType],
          ['resourceId', '対象ID', (r) => r.resourceId],
          ['method', 'メソッド', (r) => r.method],
          ['path', 'パス', (r) => r.path],
          ['statusCode', 'ステータス', (r) => r.statusCode],
          ['ip', 'IP', (r) => r.ip],
        ]),
      };
    }
  }
}

/** タプルの配列を Column<T>[] に変換する小道具。列定義を1行で書けるようにする。 */
function cols<T>(
  defs: [string, string, (row: T) => string | number | boolean | null | undefined][]
): Column<never>[] {
  return defs.map(([key, header, value]) => ({
    key,
    header,
    value: value as (row: never) => string | number | boolean | null | undefined,
  }));
}

/** JSON エクスポート用のバンドル (PRD 11-4)。外部システムへの移行に使う。 */
export async function buildJsonBundle(tenantId: Id, filters: ExportFilters) {
  const [customers, reservations, visits, accessNumbers] = await Promise.all([
    collections.customers().list(tenantId),
    collections.reservations().list(tenantId),
    collections.visits().list(tenantId),
    collections.accessNumbers().list(tenantId),
  ]);

  const byStore = <T extends { storeId?: Id }>(rows: T[]) =>
    filters.storeId ? rows.filter((r) => r.storeId === filters.storeId) : rows;

  return {
    exportedAt: new Date().toISOString(),
    tenantId,
    filters,
    customers,
    reservations: byStore(reservations).filter((r) => inRange(r.startAt, filters.from, filters.to)),
    visits: byStore(visits).filter((v) => inRange(v.checkedInAt, filters.from, filters.to)),
    accessNumbers: byStore(accessNumbers),
  };
}
