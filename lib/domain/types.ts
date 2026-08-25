/**
 * ドメインモデル — 無人受付・来店管理SaaS
 *
 * PRD: docs/PRD.md
 *
 * 全エンティティは `tenantId` を持つ。テナント分離(P-6)はリポジトリ層で強制する。
 */

export type Id = string;
/** ISO 8601 文字列。DBドライバに依存しないよう Date ではなく文字列で保持する。 */
export type IsoDateTime = string;

// ---------------------------------------------------------------------------
// テナント / 店舗
// ---------------------------------------------------------------------------

export type Tenant = {
  id: Id;
  /** Datastore が要求する分離キー。テナント自身は id と同値になる。 */
  tenantId: Id;
  name: string;
  /** 受付画面左上に表示するロゴ (PNG / SVG / JPG) */
  logoUrl: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type Store = {
  id: Id;
  tenantId: Id;
  name: string;
  /** エリアマネージャーの担当範囲判定に使う */
  areaId: Id | null;
  timezone: string;
  /** 退出済み番号を再利用可能にするまでの保持時間（PRD 7-3 / Q-5 初期値15分） */
  numberHoldMinutes: number;
  /** 予約が無い場合の既定滞在時間（分） */
  defaultStayMinutes: number;
  /** 同時受け入れ可能枠数。稼働率の分母に使う */
  capacity: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

// ---------------------------------------------------------------------------
// 顧客
// ---------------------------------------------------------------------------

export type Customer = {
  id: Id;
  tenantId: Id;
  /** 会員番号。テナント内で一意 */
  memberCode: string | null;
  name: string;
  nameKana: string | null;
  email: string | null;
  phone: string | null;
  /** 外部システム(CRM/カルテ)のID。連携時の突き合わせに使う */
  externalIds: Record<string, string>;
  /** 顔認証の登録・同意状態 (PRD 8-5) */
  faceRecognition: {
    enrolled: boolean;
    consentAt: IsoDateTime | null;
    /** 保存期間の満了日。過ぎたら特徴量を削除する */
    retentionUntil: IsoDateTime | null;
  };
  note: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

// ---------------------------------------------------------------------------
// 予約
// ---------------------------------------------------------------------------

export type ReservationStatus =
  | 'booked'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type Reservation = {
  id: Id;
  tenantId: Id;
  storeId: Id;
  customerId: Id | null;
  /** 顧客未登録でも受け付けられるようにする（イベント受付など） */
  guestName: string | null;
  serviceId: Id | null;
  status: ReservationStatus;
  startAt: IsoDateTime;
  endAt: IsoDateTime;
  /** 確保済みの4桁番号。null なら受付時に払い出す */
  accessNumber: string | null;
  /** QR受付用トークン。QRには個人情報を入れない (PRD 7-2) */
  qrToken: string;
  qrTokenExpiresAt: IsoDateTime;
  source: 'admin' | 'api' | 'calendar' | 'reception';
  note: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

// ---------------------------------------------------------------------------
// 来店（受付〜退出）
// ---------------------------------------------------------------------------

export type ReceptionMethod =
  | 'qr'
  | 'number'
  | 'face'
  | 'staff'
  | 'vendor'
  | 'event'
  | 'custom';

export type VisitStatus = 'in_store' | 'exited';

export type Visit = {
  id: Id;
  tenantId: Id;
  storeId: Id;
  reservationId: Id | null;
  customerId: Id | null;
  guestName: string | null;
  accessNumber: string | null;
  method: ReceptionMethod;
  status: VisitStatus;
  checkedInAt: IsoDateTime;
  scheduledExitAt: IsoDateTime | null;
  actualExitAt: IsoDateTime | null;
  /** 受付を行った端末。障害調査と端末別統計に使う */
  deviceId: Id | null;
  /** オフライン受付の重複排除キー (PRD Q-6) */
  clientEventId: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

// ---------------------------------------------------------------------------
// 4桁アクセス番号
// ---------------------------------------------------------------------------

export type AccessNumberStatus =
  | 'available'
  | 'reserved'
  | 'checked_in'
  | 'in_use'
  | 'exited'
  | 'expired'
  | 'released'
  | 'locked';

export type AccessNumber = {
  id: Id;
  tenantId: Id;
  storeId: Id;
  /** 4桁。文字列で保持する（先頭ゼロを落とさないため） */
  number: string;
  status: AccessNumberStatus;
  /** 1番号に複数人を紐付けられる (PRD 7-3 Shared Number) */
  customerIds: Id[];
  reservationId: Id | null;
  visitId: Id | null;
  /** VIP・特定会員向けの固定番号。解放対象から除外される */
  pinned: boolean;
  /** 時間指定確保の範囲 */
  holdFrom: IsoDateTime | null;
  holdUntil: IsoDateTime | null;
  /** exited になった時刻。保持時間の起点 */
  exitedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

// ---------------------------------------------------------------------------
// 端末 / Remote Config
// ---------------------------------------------------------------------------

export type DevicePlatform = 'pwa' | 'android' | 'ios';

export type Device = {
  id: Id;
  tenantId: Id;
  storeId: Id;
  name: string;
  platform: DevicePlatform;
  appVersion: string | null;
  configVersion: number | null;
  lastSeenAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type ReceptionButton = {
  id: string;
  label: string;
  action: string;
  visible: boolean;
  order: number;
};

export type FeatureFlagKey =
  | 'faceRecognition'
  | 'calendar'
  | 'staffReception'
  | 'eventReception'
  | 'exitNotification'
  | 'offlineMode'
  | 'numberReception'
  | 'qrReception';

export type FeatureFlag = {
  key: FeatureFlagKey;
  enabled: boolean;
  /** 0-100。段階リリース (PRD 4-4)。deviceId のハッシュで安定振り分け */
  rolloutPercent: number;
  /** 明示的に有効化する対象。rolloutPercent より優先 */
  allowStoreIds?: Id[];
  allowDeviceIds?: Id[];
};

export type RemoteConfig = {
  tenantId: Id;
  storeId: Id;
  /** ロールバック可能にするための版数 (PRD 4-5) */
  configVersion: number;
  logo: string | null;
  theme: string;
  language: string;
  notificationSound: string;
  buttons: ReceptionButton[];
  flags: FeatureFlag[];
  updatedAt: IsoDateTime;
};

/** APK / IPA のリリースレジストリ (PRD 6-2 / 6-3) */
export type AppRelease = {
  id: Id;
  platform: DevicePlatform;
  version: string;
  buildNumber: number;
  releaseDate: IsoDateTime;
  /** APK の SHA-256。iOS では null */
  sha256: string | null;
  /** iOS の署名プロファイル。Android では null */
  signingProfile: string | null;
  commitSha: string | null;
  minimumOs: string;
  requiredUpdate: boolean;
  supportedDevices: string[];
  downloadUrl: string | null;
  releaseNotes: string;
};

// ---------------------------------------------------------------------------
// 認証 / 権限
// ---------------------------------------------------------------------------

export type Role =
  | 'SuperAdmin'
  | 'TenantAdmin'
  | 'AreaManager'
  | 'StoreManager'
  | 'Staff'
  | 'ReceptionOnly'
  | 'Viewer';

/**
 * 管理Webにログインする人 (PRD 15)。
 *
 * API を叩く外部システム (ApiClient) とは別に持つ。
 * 片方を止めてももう片方が生きていてほしい——連携先のキーを失効させた瞬間に
 * 店舗スタッフがログインできなくなる、という事故を構造的に避ける。
 */
export type AdminUser = {
  id: Id;
  tenantId: Id;
  /** ログインID。テナント内で一意 */
  email: string;
  displayName: string;
  role: Role;
  /** 空なら全店舗。AreaManager / StoreManager では絞られる */
  storeIds: Id[];
  /** 平文もハッシュ元も保存しない。PBKDF2 の派生鍵のみ (PRD 13-4) */
  passwordHash: string;
  status: 'active' | 'suspended';
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Scope =
  | 'customers:read'
  | 'customers:write'
  | 'reservations:read'
  | 'reservations:write'
  | 'visits:read'
  | 'visits:write'
  | 'access_numbers:read'
  | 'access_numbers:write'
  | 'stores:read'
  | 'stores:write'
  | 'devices:read'
  | 'exports:read'
  | 'exports:write'
  | 'webhooks:read'
  | 'webhooks:write'
  | 'audit:read';

export type ApiClient = {
  id: Id;
  tenantId: Id;
  name: string;
  /** 平文は保存しない。SHA-256 ハッシュのみ (PRD 13-4) */
  keyHash: string;
  keyPrefix: string;
  role: Role;
  scopes: Scope[];
  /** データ範囲の絞り込み。空なら role のデフォルト範囲 */
  storeIds: Id[];
  areaIds: Id[];
  rateLimitPerMinute: number;
  disabled: boolean;
  createdAt: IsoDateTime;
  lastUsedAt: IsoDateTime | null;
};

// ---------------------------------------------------------------------------
// 監査ログ
// ---------------------------------------------------------------------------

export type AuditLog = {
  id: Id;
  tenantId: Id;
  requestId: string;
  actorType: 'api_client' | 'user' | 'device' | 'system';
  actorId: Id | null;
  action: string;
  resourceType: string;
  resourceId: Id | null;
  storeId: Id | null;
  method: string;
  path: string;
  statusCode: number;
  ip: string | null;
  userAgent: string | null;
  /** 変更内容の要約。個人情報そのものは入れない */
  summary: string | null;
  createdAt: IsoDateTime;
};

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export type WebhookEventType =
  | 'reservation.created'
  | 'reservation.updated'
  | 'reservation.deleted'
  | 'checkin.completed'
  | 'checkout.completed'
  | 'customer.created'
  | 'customer.updated'
  | 'access_number.reserved'
  | 'access_number.released';

export type WebhookEndpoint = {
  id: Id;
  tenantId: Id;
  url: string;
  /** HMAC-SHA256 の署名鍵。Secret Manager 管理を想定 */
  secret: string;
  events: WebhookEventType[];
  disabled: boolean;
  createdAt: IsoDateTime;
};

export type WebhookDeliveryStatus = 'pending' | 'succeeded' | 'failed' | 'dead';

export type WebhookDelivery = {
  id: Id;
  tenantId: Id;
  endpointId: Id;
  eventId: Id;
  eventType: WebhookEventType;
  payload: unknown;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: IsoDateTime | null;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

// ---------------------------------------------------------------------------
// 帳票 / エクスポート
// ---------------------------------------------------------------------------

export type ExportResource =
  | 'customers'
  | 'reservations'
  | 'visits'
  | 'access_numbers'
  | 'notifications'
  | 'api_logs';

export type ExportFormat = 'csv' | 'xlsx' | 'json';

export type ExportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type ExportJob = {
  id: Id;
  tenantId: Id;
  resource: ExportResource;
  format: ExportFormat;
  filters: {
    storeId?: Id;
    from?: IsoDateTime;
    to?: IsoDateTime;
  };
  status: ExportJobStatus;
  /** Storage 上のオブジェクトキー */
  objectKey: string | null;
  /** 有効期限付きの署名URL (PRD 11-2) */
  downloadUrl: string | null;
  downloadUrlExpiresAt: IsoDateTime | null;
  rowCount: number | null;
  byteSize: number | null;
  error: string | null;
  requestedBy: Id | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

// ---------------------------------------------------------------------------
// 通知
// ---------------------------------------------------------------------------

export type NotificationChannel = 'push' | 'email' | 'slack' | 'chatwork' | 'google_chat';

export type NotificationKind =
  | 'exit.reminder'
  | 'exit.completed'
  | 'exit.overdue'
  | 'store.not_exited'
  | 'store.long_stay'
  | 'device.offline'
  | 'system.critical';

export type NotificationRecord = {
  id: Id;
  tenantId: Id;
  storeId: Id | null;
  kind: NotificationKind;
  channel: NotificationChannel;
  target: string;
  visitId: Id | null;
  /** 予約送信時刻。退出N分前リマインドで使う */
  scheduledAt: IsoDateTime;
  sentAt: IsoDateTime | null;
  status: 'scheduled' | 'sent' | 'failed' | 'cancelled';
  message: string;
  error: string | null;
  createdAt: IsoDateTime;
};
