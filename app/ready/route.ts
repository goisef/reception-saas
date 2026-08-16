import { publicRoute } from '@/lib/api/handler';
import { datastore, ready as storeReady } from '@/lib/store';

/**
 * Readiness (PRD 12-4)。依存リソース込みでリクエストを受けられるかを返す。
 * ロードバランサはこれを見て振り分けを止める。
 */
export const GET = publicRoute(async () => {
  const checks: Record<string, 'ok' | 'error'> = {};

  try {
    await storeReady();
    checks.datastore = (await datastore().ping()) ? 'ok' : 'error';
  } catch {
    checks.datastore = 'error';
  }

  const healthy = Object.values(checks).every((v) => v === 'ok');
  return {
    status: healthy ? 200 : 503,
    body: { status: healthy ? 'ready' : 'unavailable', checks, time: new Date().toISOString() },
  };
});
