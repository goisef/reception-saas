import { apiRoute } from '@/lib/api/handler';
import { Validator } from '@/lib/core/validate';
import { assertStoreAccess, scopeStoreFilter } from '@/lib/security/auth';
import { collections } from '@/lib/store';
import * as reception from '@/lib/services/reception';

/**
 * 未退出・超過の一覧 (PRD 9-2 Checkout GET / 14-1 Dashboard)。
 * 店舗が「まだ帰っていない人」を把握するための入口。
 */
export const GET = apiRoute(
  async (ctx) => {
    const now = Date.now();
    const storeId = ctx.url.searchParams.get('storeId');
    const allowed = scopeStoreFilter(ctx.principal);

    const inStore = await collections.visits().list(ctx.principal.tenantId, (v) => {
      if (!allowed(v.storeId)) return false;
      if (storeId && v.storeId !== storeId) return false;
      return v.status === 'in_store';
    });

    const withOverdue = inStore.map((visit) => ({
      visit,
      overdueMinutes: visit.scheduledExitAt
        ? Math.max(0, Math.round((now - Date.parse(visit.scheduledExitAt)) / 60_000))
        : 0,
    }));

    return {
      body: {
        data: withOverdue.sort((a, b) => b.overdueMinutes - a.overdueMinutes),
        summary: {
          inStore: withOverdue.length,
          overdue: withOverdue.filter((r) => r.overdueMinutes > 0).length,
        },
      },
    };
  },
  { scope: 'visits:read' }
);

/**
 * 退出 (PRD 9-2 Checkout PATCH)。
 * visitId か accessNumber のどちらかで対象を特定する。
 * 受付端末は番号しか知らないので accessNumber を使う。
 */
export const PATCH = apiRoute(
  async (ctx) => {
    const v = new Validator(ctx.body);
    const storeId = v.string('storeId', { required: true });
    const visitId = v.string('visitId');
    const accessNumber = v.accessNumber('accessNumber');
    if (!visitId && !accessNumber) {
      v.custom('visitId', 'visitId または accessNumber が必要です');
    }
    v.throwIfInvalid();

    assertStoreAccess(ctx.principal, storeId!);

    const result = await reception.checkout({
      tenantId: ctx.principal.tenantId,
      storeId: storeId!,
      visitId,
      accessNumber,
    });

    return {
      body: {
        data: {
          visit: result.visit,
          stayMinutes: result.stayMinutes,
          overdueMinutes: result.overdueMinutes,
          message: result.message,
        },
      },
    };
  },
  {
    scope: 'visits:write',
    idempotent: true,
    auditAction: 'checkout.completed',
    auditResourceType: 'visit',
  }
);
