import { apiRoute } from '@/lib/api/handler';
import { badRequest, notFound } from '@/lib/core/errors';
import { Validator } from '@/lib/core/validate';
import { assertStoreAccess } from '@/lib/security/auth';
import * as numbers from '@/lib/services/access-numbers';

function requireStoreId(url: URL): string {
  const storeId = url.searchParams.get('storeId');
  if (!storeId) throw badRequest('storeId が必要です');
  return storeId;
}

export const GET = apiRoute(
  async (ctx) => {
    const storeId = requireStoreId(ctx.url);
    assertStoreAccess(ctx.principal, storeId);

    const number = await numbers.findByNumber(
      ctx.principal.tenantId,
      storeId,
      ctx.params.number
    );
    if (!number) throw notFound('アクセス番号');
    return { body: { data: number } };
  },
  { scope: 'access_numbers:read' }
);

/**
 * Shared Number への顧客追加 (PRD 7-3)。
 * 1番号に家族やグループをまとめて紐付ける用途。
 */
export const PATCH = apiRoute(
  async (ctx) => {
    const v = new Validator(ctx.body);
    const storeId = v.string('storeId', { required: true });
    const customerIds = v.stringArray('customerIds', { required: true });
    v.throwIfInvalid();

    assertStoreAccess(ctx.principal, storeId!);

    const updated = await numbers.attachCustomers(
      ctx.principal.tenantId,
      storeId!,
      ctx.params.number,
      customerIds!
    );
    return { body: { data: updated } };
  },
  {
    scope: 'access_numbers:write',
    auditAction: 'access_number.attach_customers',
    auditResourceType: 'access_number',
  }
);

/** 管理者による手動解放 (PRD 7-3「番号解放条件」5)。固定番号もこれで解放できる。 */
export const DELETE = apiRoute(
  async (ctx) => {
    const storeId = requireStoreId(ctx.url);
    assertStoreAccess(ctx.principal, storeId);

    const released = await numbers.releaseManually(
      ctx.principal.tenantId,
      storeId,
      ctx.params.number
    );
    return { body: { data: released } };
  },
  {
    scope: 'access_numbers:write',
    auditAction: 'access_number.release',
    auditResourceType: 'access_number',
  }
);
