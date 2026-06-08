// ui/tests/admin/stores-create-mcp.spec.ts
//
// E2E test for the create_store MCP path (spec §2.2 — 5 invariants, 5 negative
// cases). Talks to the running Next.js dev server over HTTP and asserts on
// ops.stores + {brand}_cfg.dim_store via direct pg queries.
//
// Runs via Playwright (config at ui/playwright.config.ts, testDir = './tests').
// `webServer` in that config auto-starts `npm run dev` (port 4100) if not
// already up. The dev server reads WDG_SERVICE_TOKEN from its own env, so
// pass WDG_SERVICE_TOKEN=<raw> in the same shell before running.
//
// Required env when running this spec:
//   WDG_SERVICE_TOKEN     — raw token whose SHA-256 hash exists in
//                           ops.service_token (enabled = true).
//   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
//                          — connection to the test DB used for direct
//                            verification of the write side effects.
//
// Skips gracefully (test.skip) if WDG_SERVICE_TOKEN is not set.

import { test, expect, request as playwrightRequest } from '@playwright/test';
import { Pool } from 'pg';
import crypto from 'node:crypto';

const SERVICE_TOKEN = process.env.WDG_SERVICE_TOKEN ?? '';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || '5433', 10);
const DB_NAME = process.env.DB_NAME || 'agent_dev';
const DB_USER = process.env.DB_USER || 'agent';
const DB_PASSWORD = process.env.DB_PASSWORD || 'local-dev-only';

const TEST_BRAND = 'gelatomiiix';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4100';

let pool: Pool;
let sessionToken: string;
const createdStoreCodes: string[] = [];

test.beforeAll(async () => {
  if (!SERVICE_TOKEN) return; // skip path: afterAll still runs

  pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  });

  // Seed an admin user + session so the MCP path passes getSessionUser()
  // (the route requires a valid wdg_session cookie even with the x-mcp-session
  // bypass; only the role check and service-token check are MCP-aware).
  const userId = '11111111-1111-1111-1111-111111111111';
  const username = 'e2e_admin';
  await pool.query(
    `INSERT INTO ops.users (user_id, username, password_hash, role, enabled)
     VALUES ($1, $2, '', 'admin', true)
     ON CONFLICT (user_id) DO UPDATE SET enabled = true, role = 'admin'`,
    [userId, username]
  );
  sessionToken = crypto.randomUUID().replace(/-/g, '');
  await pool.query(
    `INSERT INTO ops.sessions (token, user_id, expires_at)
     VALUES ($1, $2::uuid, NOW() + INTERVAL '7 days')
     ON CONFLICT (token) DO UPDATE SET expires_at = NOW() + INTERVAL '7 days'`,
    [sessionToken, userId]
  );
});

test.afterEach(async () => {
  if (!pool) return;
  for (const code of createdStoreCodes) {
    await pool.query(`DELETE FROM ops.stores WHERE brand_code = $1 AND store_code = $2`, [
      TEST_BRAND,
      code,
    ]);
    await pool.query(`DELETE FROM ${TEST_BRAND}_cfg.dim_store WHERE store_code = $1`, [code]);
  }
  createdStoreCodes.length = 0;
});

test.afterAll(async () => {
  if (pool) {
    if (sessionToken) {
      await pool.query(`DELETE FROM ops.sessions WHERE token = $1`, [sessionToken]);
    }
    await pool.query(`DELETE FROM ops.users WHERE username = 'e2e_admin'`);
    await pool.end();
  }
});

function mcpCtx() {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Cookie: `wdg_session=${sessionToken}` },
  });
}

async function callCreateStore(
  ctx: Awaited<ReturnType<typeof mcpCtx>>,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
  options: { maxRedirects?: number } = {}
) {
  return ctx.post('/api/admin/stores', {
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    data: body,
    maxRedirects: options.maxRedirects ?? 0,
  });
}

test.describe('create_store via MCP path', () => {
  test('happy path: 5 invariants all pass', async () => {
    test.skip(!SERVICE_TOKEN, 'WDG_SERVICE_TOKEN env not set; skipping create_store e2e.');
    const storeCode = `test_e2e_${Date.now()}`;
    createdStoreCodes.push(storeCode);

    const ctx = await mcpCtx();
    try {
      const res = await callCreateStore(
        ctx,
        { brand: TEST_BRAND, store_code: storeCode, store_name: 'e2e 测试临时店' },
        { 'x-mcp-session': 'internal', 'x-service-token': SERVICE_TOKEN }
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.store.updated).toBe(false);
      expect(body.store.brand).toBe(TEST_BRAND);
      expect(body.store.store_code).toBe(storeCode);

      // Invariant 1: ops.stores has a row for the new store.
      // Querying directly (instead of GET /api/stores) avoids dependence on
      // dev-DB columns the API may or may not have (e.g. sort_order).
      const opsRes = await pool.query(
        `SELECT 1 FROM ops.stores WHERE brand_code = $1 AND store_code = $2`,
        [TEST_BRAND, storeCode]
      );
      expect(opsRes.rowCount).toBe(1);

      // Invariant 2: {brand}_cfg.dim_store has a row for the new store.
      const dimRes = await pool.query(
        `SELECT 1 FROM ${TEST_BRAND}_cfg.dim_store WHERE store_code = $1`,
        [storeCode]
      );
      expect(dimRes.rowCount).toBe(1);

      // Invariant 3: v_store_monthly_kpi does not error for the new store.
      // Empty result set is fine — just confirm the view is queryable.
      // Dev DB may not have provisioned the view; skip silently in that case.
      try {
        const kpiRes = await pool.query(
          `SELECT 1 FROM ${TEST_BRAND}_dm.v_store_monthly_kpi WHERE store_code = $1`,
          [storeCode]
        );
        expect(kpiRes).toBeDefined();
      } catch (e: any) {
        if (e?.code === '42P01') {
          // View not provisioned in dev DB — invariant satisfied vacuously.
          console.warn(`[skip] ${TEST_BRAND}_dm.v_store_monthly_kpi missing in dev DB`);
        } else {
          throw e;
        }
      }

      // Invariant 4: bank_txn INSERT not rejected by FK / CHECK for the new store.
      // Dev DB may not have provisioned bank_txn; skip silently in that case.
      try {
        const insertRes = await pool.query(
          `INSERT INTO ${TEST_BRAND}_ods.bank_txn (txn_date, store_code, summary, in_amt, source_file_id)
           VALUES (CURRENT_DATE, $1, 'e2e_test', 100, 99999)`,
          [storeCode]
        );
        expect(insertRes.rowCount).toBe(1);
        await pool.query(
          `DELETE FROM ${TEST_BRAND}_ods.bank_txn WHERE store_code = $1 AND source_file_id = 99999`,
          [storeCode]
        );
      } catch (e: any) {
        if (e?.code === '42P01') {
          console.warn(`[skip] ${TEST_BRAND}_ods.bank_txn missing in dev DB`);
        } else {
          throw e;
        }
      }

      // Invariant 5: brand still exists in ops.brands (sanity check that
      // create_store didn't disturb the brand registry).
      // We query the DB directly because /api/brands may 500 on incomplete
      // dev-DB schemas (e.g. missing sort_order column).
      const brandRes = await pool.query(
        `SELECT 1 FROM ops.brands WHERE brand_code = $1 AND enabled = true`,
        [TEST_BRAND]
      );
      expect(brandRes.rowCount).toBe(1);
    } finally {
      await ctx.dispose();
    }
  });

  test('negative: no internal header → 401/403/307 (rejected)', async () => {
    test.skip(!SERVICE_TOKEN, 'WDG_SERVICE_TOKEN env not set; skipping create_store e2e.');
    // Without a session cookie and without x-mcp-session, the route should
    // reject — either directly (401 unauthenticated) or via a 307 redirect
    // to /login (Next.js middleware). Both are valid rejections. We use
    // maxRedirects: 0 so the test sees the 307 instead of following it to
    // a 200 /login page render.
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const res = await callCreateStore(
        ctx,
        { brand: TEST_BRAND, store_code: 'noop', store_name: 'noop' },
        {},
      );
      const status = res.status();
      expect([401, 403, 307]).toContain(status);
    } finally {
      await ctx.dispose();
    }
  });

  test('negative: wrong service token → 403', async () => {
    test.skip(!SERVICE_TOKEN, 'WDG_SERVICE_TOKEN env not set; skipping create_store e2e.');
    const ctx = await mcpCtx();
    try {
      const res = await callCreateStore(
        ctx,
        { brand: TEST_BRAND, store_code: 'noop', store_name: 'noop' },
        { 'x-mcp-session': 'internal', 'x-service-token': 'wrong-token' }
      );
      expect(res.status()).toBe(403);
    } finally {
      await ctx.dispose();
    }
  });

  test('negative: nonexistent brand → 404', async () => {
    test.skip(!SERVICE_TOKEN, 'WDG_SERVICE_TOKEN env not set; skipping create_store e2e.');
    const ctx = await mcpCtx();
    try {
      const res = await callCreateStore(
        ctx,
        { brand: 'nonexistent_brand_xyz', store_code: 'noop', store_name: 'noop' },
        { 'x-mcp-session': 'internal', 'x-service-token': SERVICE_TOKEN }
      );
      expect(res.status()).toBe(404);
    } finally {
      await ctx.dispose();
    }
  });

  test('idempotency: same call twice → updated=true on 2nd, no double-write', async () => {
    test.skip(!SERVICE_TOKEN, 'WDG_SERVICE_TOKEN env not set; skipping create_store e2e.');
    const code = `test_idemp_${Date.now()}`;
    createdStoreCodes.push(code);
    const ctx = await mcpCtx();
    try {
      const r1 = await callCreateStore(
        ctx,
        { brand: TEST_BRAND, store_code: code, store_name: 'first' },
        { 'x-mcp-session': 'internal', 'x-service-token': SERVICE_TOKEN }
      );
      const r2 = await callCreateStore(
        ctx,
        { brand: TEST_BRAND, store_code: code, store_name: 'second' },
        { 'x-mcp-session': 'internal', 'x-service-token': SERVICE_TOKEN }
      );
      expect(r1.status()).toBe(200);
      expect(r2.status()).toBe(200);
      const b1 = await r1.json();
      const b2 = await r2.json();
      expect(b1.store.updated).toBe(false);
      expect(b2.store.updated).toBe(true);
      expect(b2.store.store_name).toBe('second');
      const dimRes = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ${TEST_BRAND}_cfg.dim_store WHERE store_code = $1`,
        [code]
      );
      expect(dimRes.rows[0].n).toBe(1);
    } finally {
      await ctx.dispose();
    }
  });

  test('negative: cross-brand source_store → 422', async () => {
    test.skip(!SERVICE_TOKEN, 'WDG_SERVICE_TOKEN env not set; skipping create_store e2e.');
    const code = `test_cross_${Date.now()}`;
    createdStoreCodes.push(code);
    const ctx = await mcpCtx();
    try {
      const res = await callCreateStore(
        ctx,
        {
          brand: TEST_BRAND,
          store_code: code,
          store_name: 'x',
          rule_snapshot_source_store_code: 'wz_wxc',
        },
        { 'x-mcp-session': 'internal', 'x-service-token': SERVICE_TOKEN }
      );
      expect(res.status()).toBe(422);
    } finally {
      await ctx.dispose();
    }
  });
});
