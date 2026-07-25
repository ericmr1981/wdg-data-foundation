import { test, expect } from '@playwright/test';

// Regression for: /u/sales on tamkoko brand incorrectly routed API calls to
// /api/bonjur/sales/* (ternary `brand === 'gelatomiiix' ? 'gelatomiiix' : 'bonjur'`),
// producing empty data and wrong page for the brand.
//
// Fix expectation: when brand === 'tamkoko', /u/sales redirects to /u/sales/tamkoko
// so the user lands on the brand-dedicated sales page with correct API calls.

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

test('/u/sales on tamkoko brand redirects to /u/sales/tamkoko', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('wdg.brand', 'tamkoko');
  });

  await page.goto(`${baseURL}/u/sales`, { waitUntil: 'domcontentloaded' });

  // Wait up to 30s for the URL to reflect the redirect (dev server can be slow on first compile).
  await page.waitForURL(/\/u\/sales\/tamkoko($|\/)/, { timeout: 30_000 });
  expect(page.url()).toMatch(/\/u\/sales\/tamkoko($|\/)/);
});