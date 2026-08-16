import { apiRoute } from '@/lib/api/handler';
import { scopeStoreFilter } from '@/lib/security/auth';
import { collections } from '@/lib/store';

export const GET = apiRoute(
  async (ctx) => {
    const allowed = scopeStoreFilter(ctx.principal);
    const stores = await collections.stores().list(ctx.principal.tenantId, (s) => allowed(s.id));
    return { body: { data: stores.sort((a, b) => a.name.localeCompare(b.name, 'ja')) } };
  },
  { scope: 'stores:read' }
);
