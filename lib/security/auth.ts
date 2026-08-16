import { timingSafeEqual } from 'node:crypto';
import { sha256Hex } from '../core/ids';
import { forbidden, unauthorized } from '../core/errors';
import { collections, ready } from '../store';
import type { ApiClient, Id, Role, Scope } from '../domain/types';

/**
 * API Key 認証と RBAC。
 *
 * PRD 10-1 / 15。Zero Trust (PRD 16) の原則により、店舗ネットワークからの
 * リクエストであっても無条件に信用しない。すべてキーとスコープで判定する。
 */

export type Principal = {
  tenantId: Id;
  clientId: Id;
  role: Role;
  scopes: Scope[];
  /** 空なら role のデフォルト範囲（TenantAdmin以上=全店舗） */
  storeIds: Id[];
  areaIds: Id[];
  rateLimitPerMinute: number;
};

/** ロールごとの上限スコープ。API Client に付与されたスコープと AND を取る。 */
const ROLE_MAX_SCOPES: Record<Role, Scope[] | '*'> = {
  SuperAdmin: '*',
  TenantAdmin: '*',
  AreaManager: [
    'customers:read',
    'customers:write',
    'reservations:read',
    'reservations:write',
    'visits:read',
    'visits:write',
    'access_numbers:read',
    'access_numbers:write',
    'stores:read',
    'devices:read',
    'exports:read',
    'exports:write',
  ],
  StoreManager: [
    'customers:read',
    'customers:write',
    'reservations:read',
    'reservations:write',
    'visits:read',
    'visits:write',
    'access_numbers:read',
    'access_numbers:write',
    'stores:read',
    'devices:read',
    'exports:read',
    'exports:write',
  ],
  Staff: [
    'customers:read',
    'reservations:read',
    'reservations:write',
    'visits:read',
    'visits:write',
    'access_numbers:read',
    'stores:read',
  ],
  // 受付端末。顧客一覧を引けないのが重要（端末が盗まれても名簿が抜けない）
  ReceptionOnly: [
    'reservations:read',
    'visits:read',
    'visits:write',
    'access_numbers:read',
    'devices:read',
  ],
  Viewer: [
    'customers:read',
    'reservations:read',
    'visits:read',
    'access_numbers:read',
    'stores:read',
    'exports:read',
  ],
};

export function effectiveScopes(client: Pick<ApiClient, 'role' | 'scopes'>): Scope[] {
  const max = ROLE_MAX_SCOPES[client.role];
  if (max === '*') return client.scopes;
  return client.scopes.filter((s) => max.includes(s));
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Authorization ヘッダから API Key を取り出す。
 * `Authorization: Bearer <key>` と `X-Api-Key: <key>` の両方を受け付ける。
 */
export function extractApiKey(headers: Headers): string | null {
  const auth = headers.get('authorization');
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  const raw = headers.get('x-api-key');
  return raw ? raw.trim() : null;
}

export async function authenticate(headers: Headers): Promise<Principal> {
  const key = extractApiKey(headers);
  if (!key) throw unauthorized('APIキーが指定されていません');

  await ready();
  const hash = sha256Hex(key);
  // 平文キーは保存していないので、ハッシュ一致で引き当てる
  const matches = await collections.apiClients().listAcrossTenants((c) => safeEqualHex(c.keyHash, hash));
  const client = matches[0];
  if (!client) throw unauthorized('APIキーが不正です');
  if (client.disabled) throw unauthorized('このAPIキーは無効化されています');

  void collections
    .apiClients()
    .update(client.tenantId, client.id, { lastUsedAt: new Date().toISOString() });

  return {
    tenantId: client.tenantId,
    clientId: client.id,
    role: client.role,
    scopes: effectiveScopes(client),
    storeIds: client.storeIds,
    areaIds: client.areaIds,
    rateLimitPerMinute: client.rateLimitPerMinute,
  };
}

export function requireScope(principal: Principal, scope: Scope): void {
  if (!principal.scopes.includes(scope)) {
    throw forbidden(`スコープ ${scope} が必要です`);
  }
}

/**
 * データ範囲チェック。storeIds が指定されている API Client は、
 * その店舗のデータにしか触れない (PRD 15「データ範囲」)。
 */
export function assertStoreAccess(principal: Principal, storeId: Id): void {
  if (principal.storeIds.length === 0) return;
  if (!principal.storeIds.includes(storeId)) {
    throw forbidden('この店舗のデータを操作する権限がありません');
  }
}

/** 一覧APIで返す店舗を絞り込む。 */
export function scopeStoreFilter(principal: Principal): ((storeId: Id) => boolean) {
  if (principal.storeIds.length === 0) return () => true;
  const allowed = new Set(principal.storeIds);
  return (storeId) => allowed.has(storeId);
}
