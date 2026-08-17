import { beforeEach, describe, expect, it } from 'vitest';
import { effectiveScopes, extractApiKey, assertStoreAccess, scopeStoreFilter } from '@/lib/security/auth';
import type { Principal } from '@/lib/security/auth';
import { consume, resetRateLimits } from '@/lib/security/rate-limit';
import {
  hashRequest,
  lookup,
  remember,
  resetIdempotency,
  sweepExpired,
} from '@/lib/security/idempotency';
import { ready } from '@/lib/store';
import { isFlagEnabled } from '@/lib/services/remote-config';
import { stableBucket } from '@/lib/core/ids';

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    tenantId: 'ten_a',
    clientId: 'apc_a',
    role: 'TenantAdmin',
    scopes: ['visits:read'],
    storeIds: [],
    areaIds: [],
    rateLimitPerMinute: 60,
    ...overrides,
  };
}

describe('RBAC', () => {
  it('ReceptionOnly には顧客一覧のスコープを与えられない', () => {
    // 端末が盗まれても名簿が抜けないことがこの制約の狙い
    const scopes = effectiveScopes({
      role: 'ReceptionOnly',
      scopes: ['customers:read', 'visits:write'],
    });
    expect(scopes).not.toContain('customers:read');
    expect(scopes).toContain('visits:write');
  });

  it('Viewer は書き込みスコープを持てない', () => {
    const scopes = effectiveScopes({
      role: 'Viewer',
      scopes: ['customers:read', 'customers:write', 'visits:write'],
    });
    expect(scopes).toEqual(['customers:read']);
  });

  it('TenantAdmin は付与されたスコープをそのまま持つ', () => {
    const scopes = effectiveScopes({
      role: 'TenantAdmin',
      scopes: ['customers:write', 'audit:read'],
    });
    expect(scopes).toEqual(['customers:write', 'audit:read']);
  });
});

describe('データ範囲', () => {
  it('storeIds が空なら全店舗に触れる', () => {
    expect(() => assertStoreAccess(principal(), 'sto_any')).not.toThrow();
    expect(scopeStoreFilter(principal())('sto_any')).toBe(true);
  });

  it('storeIds があれば範囲外は 403', () => {
    const p = principal({ storeIds: ['sto_a'] });
    expect(() => assertStoreAccess(p, 'sto_a')).not.toThrow();
    expect(() => assertStoreAccess(p, 'sto_b')).toThrowError(
      expect.objectContaining({ code: 'forbidden' })
    );
    expect(scopeStoreFilter(p)('sto_b')).toBe(false);
  });
});

describe('APIキーの取り出し', () => {
  it('Bearer と X-Api-Key の両方を受ける', () => {
    expect(extractApiKey(new Headers({ authorization: 'Bearer rk_1' }))).toBe('rk_1');
    expect(extractApiKey(new Headers({ 'x-api-key': 'rk_2' }))).toBe('rk_2');
    expect(extractApiKey(new Headers())).toBeNull();
  });
});

describe('Rate Limit', () => {
  beforeEach(() => resetRateLimits());

  it('上限までは通し、超えたら拒否する', () => {
    const now = 1_800_000_000_000;
    for (let i = 0; i < 3; i += 1) {
      expect(consume('tenant:a', 3, now).allowed).toBe(true);
    }
    const over = consume('tenant:a', 3, now);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('テナントごとに独立している', () => {
    const now = 1_800_000_000_000;
    consume('tenant:a', 1, now);
    expect(consume('tenant:a', 1, now).allowed).toBe(false);
    // 別テナントは影響を受けない（原則 P-6）
    expect(consume('tenant:b', 1, now).allowed).toBe(true);
  });

  it('次のウィンドウでリセットされる', () => {
    const now = 1_800_000_000_000;
    consume('tenant:a', 1, now);
    expect(consume('tenant:a', 1, now).allowed).toBe(false);
    expect(consume('tenant:a', 1, now + 60_000).allowed).toBe(true);
  });
});

describe('Idempotency', () => {
  // Datastore に載っているため非同期。プロセス内 Map ではなくなった。
  beforeEach(async () => {
    await ready();
    await resetIdempotency('ten_a');
    await resetIdempotency('ten_b');
  });

  it('同じキー・同じ内容なら初回のレスポンスを返す', async () => {
    const hash = hashRequest('POST', '/api/v1/reservations', '{"a":1}');
    await remember('ten_a', '/api/v1/reservations', 'key1', hash, 201, '{"data":{}}');
    const found = await lookup('ten_a', '/api/v1/reservations', 'key1', hash);
    expect(found?.status).toBe(201);
    expect(found?.body).toBe('{"data":{}}');
  });

  it('同じキーで内容が違えば 409', async () => {
    const hash1 = hashRequest('POST', '/api/v1/reservations', '{"a":1}');
    const hash2 = hashRequest('POST', '/api/v1/reservations', '{"a":2}');
    await remember('ten_a', '/api/v1/reservations', 'key1', hash1, 201, '{}');
    await expect(
      lookup('ten_a', '/api/v1/reservations', 'key1', hash2)
    ).rejects.toThrowError(expect.objectContaining({ code: 'idempotency_key_reused' }));
  });

  it('テナントを跨いでキーが衝突しない', async () => {
    const hash = hashRequest('POST', '/api/v1/reservations', '{"a":1}');
    await remember('ten_a', '/api/v1/reservations', 'key1', hash, 201, '{}');
    expect(await lookup('ten_b', '/api/v1/reservations', 'key1', hash)).toBeNull();
  });

  it('パスが違えば別の記録として扱う', async () => {
    const hash = hashRequest('POST', '/api/v1/reservations', '{"a":1}');
    await remember('ten_a', '/api/v1/reservations', 'key1', hash, 201, '{}');
    expect(await lookup('ten_a', '/api/v1/customers', 'key1', hash)).toBeNull();
  });

  it('期限を過ぎた記録は無かったことになる', async () => {
    const now = Date.now();
    const hash = hashRequest('POST', '/api/v1/reservations', '{"a":1}');
    await remember('ten_a', '/api/v1/reservations', 'key1', hash, 201, '{}', now);

    const dayLater = now + 25 * 60 * 60 * 1000;
    expect(await lookup('ten_a', '/api/v1/reservations', 'key1', hash, dayLater)).toBeNull();
    // 期限切れなら中身が違っても 409 にはしない（記録が無いのと同じ扱い）
    const other = hashRequest('POST', '/api/v1/reservations', '{"a":2}');
    expect(await lookup('ten_a', '/api/v1/reservations', 'key1', other, dayLater)).toBeNull();
  });

  it('期限切れを掃除できる', async () => {
    const now = Date.now();
    const hash = hashRequest('POST', '/api/v1/reservations', '{"a":1}');
    await remember('ten_a', '/api/v1/reservations', 'old', hash, 201, '{}', now - 48 * 60 * 60 * 1000);
    await remember('ten_a', '/api/v1/reservations', 'new', hash, 201, '{}', now);

    expect(await sweepExpired('ten_a', now)).toBe(1);
    expect(await lookup('ten_a', '/api/v1/reservations', 'new', hash, now)).not.toBeNull();
  });
});

describe('Feature Flag / 段階リリース', () => {
  it('無効なフラグは率に関わらず false', () => {
    expect(
      isFlagEnabled(
        { key: 'faceRecognition', enabled: false, rolloutPercent: 100 },
        { deviceId: 'dev_1' }
      )
    ).toBe(false);
  });

  it('100% なら全端末で有効', () => {
    expect(
      isFlagEnabled(
        { key: 'qrReception', enabled: true, rolloutPercent: 100 },
        { deviceId: 'dev_1' }
      )
    ).toBe(true);
  });

  it('同じ端末は何度判定しても同じ結果になる', () => {
    const flag = { key: 'offlineMode' as const, enabled: true, rolloutPercent: 50 };
    const first = isFlagEnabled(flag, { deviceId: 'dev_stable' });
    for (let i = 0; i < 20; i += 1) {
      expect(isFlagEnabled(flag, { deviceId: 'dev_stable' })).toBe(first);
    }
  });

  it('明示指定した店舗は率が 0 でも有効', () => {
    expect(
      isFlagEnabled(
        {
          key: 'faceRecognition',
          enabled: true,
          rolloutPercent: 0,
          allowStoreIds: ['sto_pilot'],
        },
        { storeId: 'sto_pilot', deviceId: 'dev_1' }
      )
    ).toBe(true);
  });

  it('ロールアウトの分布が指定率に概ね一致する', () => {
    const flag = { key: 'calendar' as const, enabled: true, rolloutPercent: 25 };
    let enabled = 0;
    const total = 2000;
    for (let i = 0; i < total; i += 1) {
      if (isFlagEnabled(flag, { deviceId: `dev_${i}` })) enabled += 1;
    }
    const ratio = (enabled / total) * 100;
    expect(ratio).toBeGreaterThan(20);
    expect(ratio).toBeLessThan(30);
  });

  it('バケットは 0-99 に収まる', () => {
    for (let i = 0; i < 100; i += 1) {
      const bucket = stableBucket(`dev_${i}`, 'salt');
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });
});
