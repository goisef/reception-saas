import { conflict, notFound } from '../core/errors';
import { newId } from '../core/ids';
import { collections } from '../store';
import type { Customer, Id } from '../domain/types';
import * as webhooks from './webhooks';

/**
 * 顧客 (PRD 14-2 / 9-2)。
 *
 * 顔認証の同意・保存期間もここで持つ。個人情報を扱うため、
 * 一覧APIは customers:read スコープ必須（受付端末には付与しない）。
 */

export type CreateInput = {
  tenantId: Id;
  name: string;
  memberCode?: string | null;
  nameKana?: string | null;
  email?: string | null;
  phone?: string | null;
  externalIds?: Record<string, string>;
  note?: string | null;
};

export async function create(input: CreateInput): Promise<Customer> {
  if (input.memberCode) {
    const dup = await findByMemberCode(input.tenantId, input.memberCode);
    if (dup) throw conflict(`会員番号 ${input.memberCode} は既に使われています`);
  }

  const now = new Date().toISOString();
  const customer = await collections.customers().insert({
    id: newId('cus'),
    tenantId: input.tenantId,
    memberCode: input.memberCode ?? null,
    name: input.name,
    nameKana: input.nameKana ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    externalIds: input.externalIds ?? {},
    faceRecognition: { enrolled: false, consentAt: null, retentionUntil: null },
    note: input.note ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await webhooks.emit({ tenantId: input.tenantId, type: 'customer.created', data: { customer } });
  return customer;
}

export async function update(
  tenantId: Id,
  id: Id,
  patch: Partial<Omit<Customer, 'id' | 'tenantId' | 'createdAt'>>
): Promise<Customer> {
  const current = await collections.customers().get(tenantId, id);
  if (!current) throw notFound('顧客');

  if (patch.memberCode && patch.memberCode !== current.memberCode) {
    const dup = await findByMemberCode(tenantId, patch.memberCode);
    if (dup) throw conflict(`会員番号 ${patch.memberCode} は既に使われています`);
  }

  const updated = await collections.customers().update(tenantId, id, {
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  if (!updated) throw notFound('顧客');

  await webhooks.emit({ tenantId, type: 'customer.updated', data: { customer: updated } });
  return updated;
}

export async function findByMemberCode(tenantId: Id, memberCode: string): Promise<Customer | null> {
  const matches = await collections.customers().list(tenantId, (c) => c.memberCode === memberCode);
  return matches[0] ?? null;
}

export type ListFilter = { query?: string; memberCode?: string };

export async function list(tenantId: Id, filter: ListFilter = {}): Promise<Customer[]> {
  const q = filter.query?.trim().toLowerCase();
  const results = await collections.customers().list(tenantId, (c) => {
    if (filter.memberCode && c.memberCode !== filter.memberCode) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.nameKana?.toLowerCase().includes(q) ?? false) ||
      (c.memberCode?.toLowerCase().includes(q) ?? false) ||
      (c.email?.toLowerCase().includes(q) ?? false)
    );
  });
  return results.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/** 来店・予約・滞在の履歴 (PRD 14-2)。 */
export async function history(tenantId: Id, customerId: Id) {
  const [visits, reservations] = await Promise.all([
    collections.visits().list(tenantId, (v) => v.customerId === customerId),
    collections.reservations().list(tenantId, (r) => r.customerId === customerId),
  ]);

  const stays = visits
    .filter((v) => v.actualExitAt)
    .map((v) => Math.round((Date.parse(v.actualExitAt!) - Date.parse(v.checkedInAt)) / 60_000));

  return {
    visits: visits.sort((a, b) => Date.parse(b.checkedInAt) - Date.parse(a.checkedInAt)),
    reservations: reservations.sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt)),
    stats: {
      visitCount: visits.length,
      averageStayMinutes: stays.length
        ? Math.round(stays.reduce((sum, m) => sum + m, 0) / stays.length)
        : null,
      lastVisitAt: visits[0]?.checkedInAt ?? null,
    },
  };
}

/**
 * 顔認証データの削除・利用停止 (PRD 8-5)。
 * 特徴量そのものは別ストレージなので、ここでは同意状態を落として
 * 削除ジョブに引き渡すフラグとして扱う。
 */
export async function revokeFaceRecognition(tenantId: Id, id: Id): Promise<Customer> {
  return update(tenantId, id, {
    faceRecognition: { enrolled: false, consentAt: null, retentionUntil: null },
  });
}
