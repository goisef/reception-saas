import { apiRoute } from '@/lib/api/handler';
import { Validator } from '@/lib/core/validate';
import { assertStoreAccess } from '@/lib/security/auth';
import * as numbers from '@/lib/services/access-numbers';

/**
 * 番号の自動解放スイープ (PRD 7-3「番号解放条件」)。
 *
 * Cloud Scheduler → Cloud Tasks から数分おきに叩く想定。
 * 退出済み + 保持時間経過 / キャンセル / No-show / 予定終了+timeout が対象。
 */
export const POST = apiRoute(
  async (ctx) => {
    const v = new Validator(ctx.body);
    const storeId = v.string('storeId', { required: true });
    v.throwIfInvalid();

    assertStoreAccess(ctx.principal, storeId!);

    const outcome = await numbers.sweepReleases(ctx.principal.tenantId, storeId!);

    return {
      body: {
        data: {
          releasedCount: outcome.released.length,
          released: outcome.released.map((n) => ({
            number: n.number,
            reason: outcome.reasons[n.id],
          })),
        },
      },
    };
  },
  {
    scope: 'access_numbers:write',
    auditAction: 'access_number.sweep',
    auditResourceType: 'access_number',
  }
);
