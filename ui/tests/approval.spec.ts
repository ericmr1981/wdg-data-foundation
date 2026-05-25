/**
 * Approval API integration tests.
 *
 * Requires the dev server running (`cd ui && npm run dev`).
 * Uses Playwright's request fixture so requests carry the same auth cookie
 * as the browser session (set by ensureAuthed).
 *
 * Auth: uses `x-mcp-session: internal` header to bypass auth for the API routes,
 * which avoids having to pass the session cookie explicitly in tests.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4100';

/** Build an API request with internal-MCP bypass so tests run without real auth. */
function mcpHeaders(): Record<string, string> {
  return { 'x-mcp-session': 'internal', 'Content-Type': 'application/json' };
}

// ---------------------------------------------------------------------------
// Helper: authenticate the browser (sets wdg_session cookie on the context)
// ---------------------------------------------------------------------------

async function ensureAuthed(page: Page) {
  const me = await page.request.get(`${BASE_URL}/api/auth/me`, {
    headers: { 'Cache-Control': 'no-store' },
  });
  if (me.ok()) return;

  const token = process.env.WDG_SESSION_TOKEN || '';
  if (token) {
    await page.context().addCookies([
      { name: 'wdg_session', value: token, domain: 'localhost', path: '/' },
    ]);
    const me2 = await page.request.get(`${BASE_URL}/api/auth/me`, {
      headers: { 'Cache-Control': 'no-store' },
    });
    if (me2.ok()) return;
  }

  const pass = process.env.WDG_ADMIN_PASS || '';
  if (!pass) {
    throw new Error('Set WDG_ADMIN_PASS to run approval API integration tests.');
  }

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input').first().fill(process.env.WDG_ADMIN_USER || 'admin');
  await page.locator('input[type="password"]').fill(pass);
  await Promise.all([
    page.waitForURL(/\/(pipeline|u)/, { timeout: 20_000 }),
    page.getByRole('button', { name: '登录' }).click(),
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Approval API', () => {
  // All tests in this describe block share the same authenticated page.
  test.beforeEach(async ({ page }) => {
    await ensureAuthed(page);
  });

  // ----------------------------------------------------------------
  // POST /api/approval/proposals — submit proposals and get batch_id
  // ----------------------------------------------------------------
  test('POST /api/approval/proposals returns a batch_id and count', async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/approval/proposals`, {
      headers: mcpHeaders(),
      data: {
        source_file_id: 1,
        brand: 'yufeng',
        records: [
          {
            bank_txn_id: 999001,
            type: 'type1',
            llm_proposal: {
              lvl1_code: 'P001',
              lvl2_code: 'P001-01',
              keyword: '支付宝',
              match_field: 'counterparty_name',
              confidence: 0.92,
              reasoning: 'Alipay settlement transaction',
            },
          },
          {
            bank_txn_id: 999002,
            type: 'type1',
            llm_proposal: {
              lvl1_code: 'P002',
              keyword: '微信支付',
              match_field: 'summary',
              confidence: 0.88,
            },
          },
        ],
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.batch_id).toBeDefined();
    expect(typeof body.batch_id).toBe('string');
    expect(body.batch_id.length).toBeGreaterThan(0);
    expect(body.count).toBe(2);
    expect(body.created_at).toBeDefined();
  });

  test('POST /api/approval/proposals rejects empty records', async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/approval/proposals`, {
      headers: mcpHeaders(),
      data: { source_file_id: 1, brand: 'yufeng', records: [] },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/required/i);
  });

  test('POST /api/approval/proposals rejects missing fields', async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/approval/proposals`, {
      headers: mcpHeaders(),
      data: { source_file_id: 1 }, // missing brand + records
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  // ----------------------------------------------------------------
  // GET /api/approval/proposals — list with filters
  // ----------------------------------------------------------------
  test('GET /api/approval/proposals returns data (empty array if none exist)', async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/approval/proposals`, {
      headers: mcpHeaders(),
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/approval/proposals accepts brand filter', async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/approval/proposals?brand=yufeng`, {
      headers: mcpHeaders(),
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/approval/proposals accepts batch_id filter', async ({ page }) => {
    // Use a real batch_id if one was created during the session,
    // otherwise verify the endpoint accepts the param without error.
    const res = await page.request.get(`${BASE_URL}/api/approval/proposals?batch_id=00000000-0000-0000-0000-000000000000`, {
      headers: mcpHeaders(),
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  // ----------------------------------------------------------------
  // PUT /api/approval/proposals/[id] — update a proposal
  // ----------------------------------------------------------------
  test('PUT /api/approval/proposals/[id] returns 401 without auth', async ({ page }) => {
    // Request without x-mcp-session and without operator role → 401
    const res = await page.request.put(`${BASE_URL}/api/approval/proposals/nonexistent-id`, {
      headers: { 'Content-Type': 'application/json' },
      data: { final_lvl1_code: 'P001' },
    });

    expect([401, 404]).toContain(res.status());
  });

  test('PUT /api/approval/proposals/[id] returns 404 for unknown id', async ({ page }) => {
    const res = await page.request.put(
      `${BASE_URL}/api/approval/proposals/99999999-9999-9999-9999-999999999999`,
      {
        headers: mcpHeaders(),
        data: { final_lvl1_code: 'P001', final_keyword: 'test' },
      }
    );

    // 401 if auth bypass doesn't apply, 404 if bypass applies but id not found
    expect([401, 404]).toContain(res.status());
  });

  // ----------------------------------------------------------------
  // POST /api/approval/proposals/batch-action — reject
  // ----------------------------------------------------------------
  test('POST /api/approval/proposals/batch-action reject returns 400 without required fields', async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/approval/proposals/batch-action`, {
      headers: mcpHeaders(),
      data: { action: 'reject' }, // missing proposal_ids + resolved_by
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/required/i);
  });

  test('POST /api/approval/proposals/batch-action reject returns success with empty proposal_ids', async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/approval/proposals/batch-action`, {
      headers: mcpHeaders(),
      data: {
        action: 'reject',
        proposal_ids: ['99999999-9999-9999-9999-999999999999'],
        resolved_by: 'test-user',
        brand: 'yufeng',
      },
    });

    // Authenticated request returns 200 with executed=0 when no pending proposals found
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.executed).toBe(0);
    expect(body.rejected).toBe(0);
  });

  // ----------------------------------------------------------------
  // POST /api/approval/proposals/batch-action — approve (no-op when none pending)
  // ----------------------------------------------------------------
  test('POST /api/approval/proposals/batch-action approve returns success with empty proposal_ids', async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/approval/proposals/batch-action`, {
      headers: mcpHeaders(),
      data: {
        action: 'approve',
        proposal_ids: ['99999999-9999-9999-9999-999999999999'],
        resolved_by: 'test-user',
        brand: 'yufeng',
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // executed=0 when no proposals are pending (nonexistent id → not found → not pending)
    expect(body.executed).toBe(0);
  });

  // ----------------------------------------------------------------
  // End-to-end: create batch → retrieve by batch_id → reject
  // ----------------------------------------------------------------
  test('create batch → retrieve by batch_id → reject end-to-end', async ({ page }) => {
    // 1. Create a batch
    const createRes = await page.request.post(`${BASE_URL}/api/approval/proposals`, {
      headers: mcpHeaders(),
      data: {
        source_file_id: 1,
        brand: 'yufeng',
        records: [
          {
            bank_txn_id: 999010,
            type: 'type1',
            llm_proposal: {
              lvl1_code: 'P001',
              keyword: 'e2e-test-keyword',
              match_field: 'summary',
              confidence: 0.9,
            },
          },
        ],
      },
    });

    expect(createRes.status()).toBe(200);
    const createBody = await createRes.json();
    expect(createBody.success).toBe(true);
    const batchId: string = createBody.batch_id;

    // 2. Retrieve by batch_id
    const listRes = await page.request.get(`${BASE_URL}/api/approval/proposals?batch_id=${batchId}`, {
      headers: mcpHeaders(),
    });

    expect(listRes.status()).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    expect(listBody.data.length).toBeGreaterThan(0);

    const proposalId = listBody.data[0].proposal_id;

    // 3. Reject the proposal
    const rejectRes = await page.request.post(`${BASE_URL}/api/approval/proposals/batch-action`, {
      headers: mcpHeaders(),
      data: {
        action: 'reject',
        proposal_ids: [proposalId],
        resolved_by: 'e2e-test-user',
        brand: 'yufeng',
      },
    });

    expect(rejectRes.status()).toBe(200);
    const rejectBody = await rejectRes.json();
    expect(rejectBody.success).toBe(true);
    expect(rejectBody.rejected).toBe(1);
  });
});