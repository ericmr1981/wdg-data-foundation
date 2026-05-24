import { test, expect, type Page } from '@playwright/test';

const ADMIN_USER = process.env.WDG_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.WDG_ADMIN_PASS || '';

function shouldIgnoreConsoleError(text: string) {
  // Benign noise we don't want to fail the smoke for.
  const t = text.toLowerCase();

  // Common dev noise
  if (t.includes('favicon.ico') && t.includes('404')) return true;

  // Next.js internal router occasionally logs this during fast automated nav.
  // It falls back to full navigation and does not indicate an app crash.
  if (t.includes('failed to fetch rsc payload') && t.includes('falling back to browser navigation')) return true;

  return false;
}

async function ensureAuthed(page: Page) {
  // If already logged in, /api/auth/me will be 200.
  const me = await page.request.get('/api/auth/me', { headers: { 'Cache-Control': 'no-store' } });
  if (me.ok()) return;

  // Try token-based auth first (best for automation).
  const token = process.env.WDG_SESSION_TOKEN || '';
  if (token) {
    // If token is present, the browser should already have the cookie.
    const me3 = await page.request.get('/api/auth/me', { headers: { 'Cache-Control': 'no-store' } });
    if (me3.ok()) return;
    throw new Error('WDG_SESSION_TOKEN was provided but auth/me is still not OK. Token may be invalid/expired.');
  }

  // Fallback: UI login (requires password).
  if (!ADMIN_PASS) {
    throw new Error(
      'Not logged in. Set env WDG_SESSION_TOKEN (recommended) or WDG_ADMIN_PASS (and optionally WDG_ADMIN_USER) so the smoke can login.'
    );
  }

  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // The current login page does not bind <label htmlFor> to inputs,
  // so use robust input selectors instead of getByLabel().
  const userInput = page.locator('input').first();
  const passInput = page.locator('input[type="password"]');

  await userInput.fill(ADMIN_USER);
  await passInput.fill(ADMIN_PASS);

  await Promise.all([
    page.waitForURL(/\/pipeline/, { timeout: 20_000 }),
    page.getByRole('button', { name: '登录' }).click(),
  ]);

  // Confirm auth really works.
  const me2 = await page.request.get('/api/auth/me', { headers: { 'Cache-Control': 'no-store' } });
  expect(me2.ok()).toBeTruthy();
}

test('WDG browser smoke: key pages load without client-side exception', async ({ page, context }) => {
  // If a session token is provided, set cookie before any navigation.
  const token = process.env.WDG_SESSION_TOKEN || '';
  if (token) {
    await context.addCookies([
      {
        name: 'wdg_session',
        value: token,
        domain: 'localhost',
        path: '/',
      },
    ]);
  }
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text() || '';
    if (shouldIgnoreConsoleError(text)) return;
    consoleErrors.push(text);
  });

  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });

  await ensureAuthed(page);

  const checks: Array<{ path: string; expectText: RegExp }>
    = [
      { path: '/pipeline', expectText: /Pipeline\s*监控/ },
      { path: '/rules', expectText: /规则管理/ },
      { path: '/match', expectText: /人工匹配/ },
      { path: '/upload', expectText: /文件上传/ },
      { path: '/admin/config', expectText: /Admin\s*\/\s*配置/ },
      { path: '/lineage', expectText: /数据流地图/ },
    ];

  for (const c of checks) {
    await page.goto(c.path, { waitUntil: 'networkidle' });

    // Hard fail patterns
    await expect(page.getByText('Application error', { exact: false })).toHaveCount(0);

    // Positive assertion
    await expect(page.locator('body')).toContainText(c.expectText);
  }

  if (pageErrors.length || consoleErrors.length) {
    const detail = [
      pageErrors.length ? `pageerror:\n- ${pageErrors.join('\n- ')}` : '',
      consoleErrors.length ? `console.error:\n- ${consoleErrors.join('\n- ')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    throw new Error(`Browser smoke detected client-side errors:\n\n${detail}`);
  }
});
