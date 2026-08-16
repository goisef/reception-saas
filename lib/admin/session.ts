import { DEMO_TENANT_ID } from '../store/seed';
import type { Id, Role } from '../domain/types';

/**
 * 管理Webのセッション。
 *
 * TODO(Step 1): 実際のログイン（IdP + セッションCookie）に差し替える。
 * いまは開発用のスタブで、常にデモテナントの TenantAdmin として振る舞う。
 * 画面側はこの関数の戻り値だけを見るようにしてあるので、
 * 差し替え時に各ページを触る必要はない。
 */

export type AdminSession = {
  tenantId: Id;
  userId: Id;
  displayName: string;
  role: Role;
  /** 空なら全店舗。AreaManager / StoreManager では絞られる */
  storeIds: Id[];
};

export async function currentSession(): Promise<AdminSession> {
  return {
    tenantId: process.env.RECEPTION_TENANT_ID ?? DEMO_TENANT_ID,
    userId: 'usr_dev_admin',
    displayName: '開発用管理者',
    role: 'TenantAdmin',
    storeIds: [],
  };
}

/** 画面 × 操作の可否 (PRD 15)。ページ側はこれで出し分ける。 */
const WRITE_ROLES: Role[] = ['SuperAdmin', 'TenantAdmin', 'AreaManager', 'StoreManager'];

export function canWrite(session: AdminSession): boolean {
  return WRITE_ROLES.includes(session.role);
}

export function canExport(session: AdminSession): boolean {
  return session.role !== 'ReceptionOnly';
}
