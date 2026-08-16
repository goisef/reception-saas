import { apiRoute } from '@/lib/api/handler';
import { Validator } from '@/lib/core/validate';
import * as customers from '@/lib/services/customers';

export const GET = apiRoute(
  async (ctx) => {
    const rows = await customers.list(ctx.principal.tenantId, {
      query: ctx.url.searchParams.get('q') ?? undefined,
      memberCode: ctx.url.searchParams.get('memberCode') ?? undefined,
    });
    return { body: { data: rows } };
  },
  { scope: 'customers:read' }
);

export const POST = apiRoute(
  async (ctx) => {
    const v = new Validator(ctx.body);
    const name = v.string('name', { required: true, max: 100 });
    const memberCode = v.string('memberCode', { max: 50 });
    const nameKana = v.string('nameKana', { max: 100 });
    const email = v.string('email', { max: 254 });
    const phone = v.string('phone', { max: 30 });
    const note = v.string('note', { max: 2000 });
    v.throwIfInvalid();

    const customer = await customers.create({
      tenantId: ctx.principal.tenantId,
      name: name!,
      memberCode,
      nameKana,
      email,
      phone,
      externalIds: (ctx.body.externalIds as Record<string, string>) ?? {},
      note,
    });

    return { status: 201, body: { data: customer } };
  },
  {
    scope: 'customers:write',
    idempotent: true,
    auditAction: 'customer.create',
    auditResourceType: 'customer',
  }
);
