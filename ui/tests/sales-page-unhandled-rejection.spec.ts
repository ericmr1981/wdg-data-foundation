import { test, expect } from '@playwright/test';

// Regression for: /u/sales page crashes ("挂掉") when a sales API fetch rejects mid-effect.
// Root cause: page.tsx useEffect kicks off fetchOverview/fetchProducts/fetchChannels/fetchTrend
// without .catch(). When a fetch rejects (HMR connection reset, dev-server blip), the rejection
// surfaces as console errors ("Failed to load resource: ERR_EMPTY_RESPONSE / ERR_CONNECTION_RESET")
// and React 18's commitPassiveMountOnFiber may bubble them up as unhandled runtime errors.
//
// This test forces the sales fetches to reject and asserts:
//   1. Page still renders the brand heading.
//   2. No "Failed to fetch" type console errors from the sales API paths.

const baseURL = process.env.PLAYWRIGHT_BASE_URL || process.env.SMOKE_BASE_URL || 'http://localhost:4300';

const login = async (page: import('@playwright/test').Page) => {
  const res = await page.request.post('/api/auth/login', {
    data: { username: 'admin', password: 'admin123' },
  });
  const cookies = res.headers()['set-cookie'];
  if (cookies) {
    const match = cookies.match(/wdg_session=([^;]+)/);
    if (match) {
      const cookieUrl = new URL(baseURL);
      await page.context().addCookies([{
        name: 'wdg_session',
        value: match[1],
        domain: cookieUrl.hostname,
        path: '/',
      }]);
    }
  }
};

test.beforeEach(async ({ page }) => { await login(page); });

test('/u/sales catches sales API failures (no unhandled fetch rejection)', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    if (/Failed to fetch/i.test(err.message)) {
      consoleErrors.push(`PAGEERROR: ${err.message}`);
    }
  });

  // Abort all sales fetches (mimics dev-server HMR connection reset on every API call).
  let abortedCount = 0;
  await page.route(/\/api\/(gelatomiiix|bonjur|tamkoko)\/sales\//, (route) => {
    abortedCount++;
    route.abort('failed');
  });

  await page.goto(`${baseURL}/u/sales`);
  await expect(page.getByRole('heading', { name: /销售报表/ })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2000);

  // Sanity: at least one sales fetch was actually aborted (the test is exercising the path).
  expect(abortedCount, 'no sales fetches were intercepted').toBeGreaterThan(0);

  // No unhandled fetch rejection should surface.
  const fetchFailures = consoleErrors.filter((m) =>
    /Failed to fetch|ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET/i.test(m)
  );
  expect(
    fetchFailures,
    `expected no fetch failures, got ${fetchFailures.length}: ${JSON.stringify(fetchFailures.slice(0, 5))}`
  ).toEqual([]);
});