import { apiRoute } from '@/lib/api/handler';
import { badRequest } from '@/lib/core/errors';
import { Validator } from '@/lib/core/validate';
import { assertStoreAccess } from '@/lib/security/auth';
import { collections } from '@/lib/store';

/**
 * 端末の死活通知 (PRD 12-4「店舗端末障害」)。
 *
 * 端末が数十秒おきにこれを送る。途絶を検知して
 * 「大阪店の受付端末が5分間サーバーと通信できていません」を管理者へ通知する。
 * 端末側から「落ちました」を送るのは不可能なので、無通信を異常とみなす。
 */
export const POST = apiRoute(
  async (ctx) => {
    const v = new Validator(ctx.body);
    const storeId = v.string('storeId', { required: true });
    const name = v.string('name', { max: 100 });
    const platform = v.enum('platform', ['pwa', 'android', 'ios'] as const);
    const appVersion = v.string('appVersion', { max: 30 });
    const configVersion = v.integer('configVersion', { min: 0 });
    v.throwIfInvalid();

    assertStoreAccess(ctx.principal, storeId!);

    const deviceId = ctx.deviceId;
    if (!deviceId) throw badRequest('X-Device-Id ヘッダが必要です');

    const now = new Date().toISOString();
    const existing = await collections.devices().get(ctx.principal.tenantId, deviceId);

    const device = existing
      ? await collections.devices().update(ctx.principal.tenantId, deviceId, {
          lastSeenAt: now,
          appVersion: appVersion ?? existing.appVersion,
          configVersion: configVersion ?? existing.configVersion,
          updatedAt: now,
        })
      : // 未登録の端末は初回の heartbeat で自動登録する。
        // 店舗導入時に管理画面で先に登録する手間をなくすため。
        await collections.devices().insert({
          id: deviceId,
          tenantId: ctx.principal.tenantId,
          storeId: storeId!,
          name: name ?? `未命名端末 (${deviceId.slice(0, 8)})`,
          platform: platform ?? 'pwa',
          appVersion: appVersion ?? null,
          configVersion: configVersion ?? null,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        });

    return { body: { data: { deviceId, acknowledgedAt: now, device } } };
  },
  {
    scope: 'devices:read',
    // heartbeat は数十秒おきに来る。監査ログに残すとログが埋まって
    // 本当に見たい操作が見えなくなるので除外する。
    audit: false,
  }
);

/** 疎通が途絶えた端末の一覧 (管理画面のダッシュボード用)。 */
export const GET = apiRoute(
  async (ctx) => {
    const thresholdMinutes = Number(ctx.url.searchParams.get('thresholdMinutes') ?? '5');
    const now = Date.now();

    const devices = await collections.devices().list(ctx.principal.tenantId);
    const offline = devices.filter(
      (d) => !d.lastSeenAt || now - Date.parse(d.lastSeenAt) >= thresholdMinutes * 60_000
    );

    return { body: { data: { devices, offline, thresholdMinutes } } };
  },
  { scope: 'devices:read' }
);
