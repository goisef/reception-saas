import { apiRoute } from '@/lib/api/handler';
import { badRequest } from '@/lib/core/errors';
import { collections, GLOBAL_TENANT } from '@/lib/store';
import type { AppRelease, DevicePlatform } from '@/lib/domain/types';

/**
 * バージョン確認 (PRD 6-2)。
 *
 *   現在 1.0.0 / 最新 1.1.0 → 「新しいバージョンがあります」
 *
 * requiredUpdate が立っている版が現在より新しければ強制アップデートを指示する。
 * 重大なセキュリティ更新を店舗任せにしないため。
 */

const PLATFORMS: DevicePlatform[] = ['pwa', 'android', 'ios'];

/** セマンティックバージョンの比較。a > b なら正。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export const GET = apiRoute(
  async (ctx) => {
    const platform = ctx.url.searchParams.get('platform') as DevicePlatform | null;
    if (!platform || !PLATFORMS.includes(platform)) {
      throw badRequest(`platform は ${PLATFORMS.join(' / ')} のいずれかを指定してください`);
    }
    const current = ctx.url.searchParams.get('version') ?? ctx.appVersion;

    const releases = await collections
      .appReleases()
      .list(GLOBAL_TENANT, (r) => r.platform === platform);

    const sorted = releases.sort((a, b) => compareVersions(b.version, a.version));
    const latest: (AppRelease & { tenantId: string }) | undefined = sorted[0];

    if (!latest) {
      return { body: { data: { platform, latest: null, updateAvailable: false } } };
    }

    const updateAvailable = current ? compareVersions(latest.version, current) > 0 : false;

    // 現在より新しい版のどれかが requiredUpdate なら強制アップデート
    const forceUpdate = current
      ? sorted.some((r) => r.requiredUpdate && compareVersions(r.version, current) > 0)
      : false;

    return {
      body: {
        data: {
          platform,
          currentVersion: current,
          latest: {
            version: latest.version,
            buildNumber: latest.buildNumber,
            releaseDate: latest.releaseDate,
            sha256: latest.sha256,
            signingProfile: latest.signingProfile,
            minimumOs: latest.minimumOs,
            supportedDevices: latest.supportedDevices,
            downloadUrl: latest.downloadUrl,
            releaseNotes: latest.releaseNotes,
          },
          updateAvailable,
          forceUpdate,
          message: forceUpdate
            ? 'セキュリティ更新のため、アップデートが必要です'
            : updateAvailable
              ? '新しいバージョンがあります'
              : '最新版です',
        },
      },
    };
  },
  { scope: 'devices:read' }
);
