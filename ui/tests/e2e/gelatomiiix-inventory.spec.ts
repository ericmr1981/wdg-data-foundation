// ui/tests/e2e/gelatomiiix-inventory.spec.ts
//
// E2E tests for the gelatomiiix inventory tab and DailyCheck board (Task 9).
//
// Runs via Playwright (config at ui/playwright.config.ts, testDir = './tests').
// `webServer` in that config auto-starts `npm run dev` (port 4100) if not
// already up.
//
// Auth: seeds an admin user + session directly into the DB (same pattern as
// ui/tests/admin/stores-create-mcp.spec.ts). The route at /u/inventory
// requires a valid wdg_session cookie; getSessionUser() returns null for
// unauthenticated requests and the page redirects to /.
//
// Required env:
//   WDG_SERVICE_TOKEN — raw token whose SHA-256 hash exists in
//                       ops.service_token (enabled = true).
//   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
//                       — connection to the test DB for session seeding.
//
// The three tests cover the happy path, the DailyCheck unreachable path, and
// the tamkoko tab (no DailyCheck board):
//   1. gelatomiiix tab + DailyCheck board renders OK with mocked data
//   2. DailyCheck error response → DailyCheckErrorBanner shown
//   3. tamkoko tab → no DailyCheck board heading present

import { test, expect, request as playwrightRequest } from '@playwright/test';
import { Pool } from 'pg';
import crypto from 'node:crypto';

const SERVICE_TOKEN = process.env.WDG_SERVICE_TOKEN ?? '';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || '5433', 10);
const DB_NAME = process.env.DB_NAME || 'agent_dev';
const DB_USER = process.env.DB_USER || 'agent';
const DB_PASSWORD = process.env.DB_PASSWORD || '';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4100';

let pool: Pool;
let sessionToken: string;

test.beforeAll(async () => {
  if (!SERVICE_TOKEN) return; // skip path: tests skip in beforeEach

  pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  });

  // Seed an admin user + session so the page passes getSessionUser().
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

test.afterAll(async () => {
  if (pool) {
    if (sessionToken) {
      await pool.query(`DELETE FROM ops.sessions WHERE token = $1`, [sessionToken]);
    }
    await pool.query(`DELETE FROM ops.users WHERE username = 'e2e_admin'`);
    await pool.end();
  }
});

async function login(page: import('@playwright/test').Page) {
  await page.context().addCookies([
    {
      name: 'wdg_session',
      value: sessionToken,
      domain: 'localhost',
      path: '/',
    },
  ]);
}

// --------------------------------------------------------------------------
// Test 1: gelatomiiix tab renders with a successful DailyCheck response
// --------------------------------------------------------------------------
test.describe('蜜可诗库存页', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!SERVICE_TOKEN, 'WDG_SERVICE_TOKEN env not set; skipping e2e.');
    await login(page);
  });

  test('DailyCheck 看板加载成功', async ({ page }) => {
    await page.route('**/api/inventory/gelatomiiix/dailycheck', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            warehouse_code: 'sh_sc',
            warehouse_name: '供应链仓',
            total_stock: 1234.5,
            categories: [
              { category: '包材', total_stock: 200 },
              { category: '乳制品', total_stock: 800 },
            ],
            top_turnover: [
              {
                rank: 1,
                item_id: 1,
                sku: 'M-001',
                name: '牛奶 1L',
                category: '乳制品',
                unit: '瓶',
                current_stock: 100,
                safety_stock: 20,
                consume_qty: 50,
                consume_days: 20,
                daily_avg: 2.5,
                turnover_rate: 0.5,
                consume_pct: 10,
                first_date: '2026-06-01',
                last_date: '2026-06-30',
              },
            ],
            fetched_at: new Date().toISOString(),
          },
        }),
      });
    });

    await page.goto('/u/inventory?brand=gelatomiiix');
    await expect(page.getByRole('heading', { name: 'DailyCheck 物料看板' })).toBeVisible();
    await expect(page.getByText('当前库存总额(件数)')).toBeVisible();
    await expect(page.getByText('乳制品')).toBeVisible();
    await expect(page.getByText('牛奶 1L')).toBeVisible();
    await expect(page.getByLabel('金额 (¥)')).toBeVisible();
  });

  test('DailyCheck 不可达时显示红色条带', async ({ page }) => {
    await page.route('**/api/inventory/gelatomiiix/dailycheck', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'dailycheck_unreachable',
          message: 'connect ECONNREFUSED 127.0.0.1:5100',
        }),
      });
    });

    await page.goto('/u/inventory?brand=gelatomiiix');
    await expect(page.getByText('DailyCheck 物料看板暂不可用')).toBeVisible();
    // 月度录入表单仍可用
    await expect(page.getByLabel('金额 (¥)')).toBeVisible();
  });

  test('tamkoko tab 不渲染 DailyCheck 看板', async ({ page }) => {
    await page.goto('/u/inventory?brand=tamkoko');
    // tamkoko tab has no DailyCheck board — heading should not be present
    await expect(page.getByRole('heading', { name: 'DailyCheck 物料看板' })).toHaveCount(0);
  });
});
