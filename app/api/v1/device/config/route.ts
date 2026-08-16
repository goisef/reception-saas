import { apiRoute } from '@/lib/api/handler';
import { badRequest } from '@/lib/core/errors';
import { Validator } from '@/lib/core/validate';
import { assertStoreAccess } from '@/lib/security/auth';
import * as remoteConfig from '@/lib/services/remote-config';

type ConfigPatch = Parameters<typeof remoteConfig.updateConfig>[2];

/**
 * Remote Configuration (PRD 4-2)。
 *
 * 端末はこれを起動時と定期取得で読み、画面を組み立てる。
 * ボタン文言・並び・機能ON/OFFはすべてサーバー側が決めるので、
 * 「受付ボタンを変えて」という要望にアプリ更新なしで応えられる (原則 P-1)。
 */
export const GET = apiRoute(
  async (ctx) => {
    const storeId = ctx.url.searchParams.get('storeId');
    if (!storeId) throw badRequest('storeId が必要です');
    assertStoreAccess(ctx.principal, storeId);

    const config = await remoteConfig.resolve({
      tenantId: ctx.principal.tenantId,
      storeId,
      deviceId: ctx.deviceId,
    });

    return { body: { data: config } };
  },
  { scope: 'devices:read' }
);

/** 管理画面からの設定更新。更新のたびに configVersion が上がる。 */
export const PATCH = apiRoute(
  async (ctx) => {
    const v = new Validator(ctx.body);
    const storeId = v.string('storeId', { required: true });
    const theme = v.string('theme', { max: 50 });
    const language = v.string('language', { max: 10 });
    const notificationSound = v.string('notificationSound', { max: 50 });
    const logo = v.string('logo', { max: 500 });
    v.throwIfInvalid();

    assertStoreAccess(ctx.principal, storeId!);

    const updated = await remoteConfig.updateConfig(ctx.principal.tenantId, storeId!, {
      ...(theme !== undefined ? { theme } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(notificationSound !== undefined ? { notificationSound } : {}),
      ...(logo !== undefined ? { logo } : {}),
      ...(Array.isArray(ctx.body.buttons)
        ? { buttons: ctx.body.buttons as ConfigPatch['buttons'] }
        : {}),
      ...(Array.isArray(ctx.body.flags)
        ? { flags: ctx.body.flags as ConfigPatch['flags'] }
        : {}),
    });

    return { body: { data: updated } };
  },
  {
    scope: 'stores:write',
    auditAction: 'remote_config.update',
    auditResourceType: 'remote_config',
  }
);
