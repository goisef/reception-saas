import { apiRoute } from '@/lib/api/handler';
import { Validator } from '@/lib/core/validate';
import { assertStoreAccess, scopeStoreFilter } from '@/lib/security/auth';
import { collections } from '@/lib/store';
import * as reception from '@/lib/services/reception';
import type { ReceptionMethod } from '@/lib/domain/types';

const METHODS: ReceptionMethod[] = [
  'qr',
  'number',
  'face',
  'staff',
  'vendor',
  'event',
  'custom',
];

/** 受付履歴 (PRD 9-2 Checkin GET)。 */
export const GET = apiRoute(
  async (ctx) => {
    const p = ctx.url.searchParams;
    const storeId = p.get('storeId');
    const from = p.get('from');
    const to = p.get('to');
    const allowed = scopeStoreFilter(ctx.principal);

    const rows = await collections.visits().list(ctx.principal.tenantId, (v) => {
      if (!allowed(v.storeId)) return false;
      if (storeId && v.storeId !== storeId) return false;
      if (from && Date.parse(v.checkedInAt) < Date.parse(from)) return false;
      if (to && Date.parse(v.checkedInAt) > Date.parse(to)) return false;
      return true;
    });

    rows.sort((a, b) => Date.parse(b.checkedInAt) - Date.parse(a.checkedInAt));
    return { body: { data: rows } };
  },
  { scope: 'visits:read' }
);

/**
 * 受付 (PRD 9-2 Checkin POST)。
 *
 * 受付端末からも外部システムからも同じエンドポイントを叩く。
 * 端末はビジネスロジックを持たない (PRD 4 Thin Client)。
 */
export const POST = apiRoute(
  async (ctx) => {
    const v = new Validator(ctx.body);
    const storeId = v.string('storeId', { required: true });
    const method = v.enum('method', METHODS, { required: true });
    const qrToken = v.string('qrToken', { max: 200 });
    const accessNumber = v.accessNumber('accessNumber');
    const customerId = v.string('customerId');
    const guestName = v.string('guestName', { max: 100 });
    const clientEventId = v.string('clientEventId', { max: 100 });
    v.throwIfInvalid();

    assertStoreAccess(ctx.principal, storeId!);

    const result = await reception.checkin({
      tenantId: ctx.principal.tenantId,
      storeId: storeId!,
      method: method!,
      qrToken,
      accessNumber,
      customerId,
      guestName,
      deviceId: ctx.deviceId,
      clientEventId,
    });

    return {
      // 冪等に再受付された場合は 200、新規受付は 201
      status: result.duplicate ? 200 : 201,
      body: {
        data: {
          visit: result.visit,
          accessNumber: result.accessNumber,
          message: result.message,
          duplicate: result.duplicate,
        },
      },
    };
  },
  {
    scope: 'visits:write',
    idempotent: true,
    auditAction: 'checkin.completed',
    auditResourceType: 'visit',
  }
);
