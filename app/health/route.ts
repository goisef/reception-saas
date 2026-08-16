import { publicRoute } from '@/lib/api/handler';

/**
 * Liveness (PRD 12-4)。プロセスが生きているかだけを返す。
 * 依存リソースは見ない。ここで DB を叩くと、DB 障害時にコンテナが
 * 再起動ループに入って復旧が遅れる。
 */
export const GET = publicRoute(async () => ({
  body: {
    status: 'ok',
    service: 'reception-api',
    time: new Date().toISOString(),
  },
}));
