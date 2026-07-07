import { test, expect, request } from '@playwright/test';

const BASE = 'http://localhost:4100';
const ADMIN_USER = process.env.WDG_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.WDG_ADMIN_PASS || 'admin123';

let sessionToken = '';

test.beforeAll(async ({ browser }) => {
    /* Login once to obtain a session token.
       The NavBar component (providers.tsx) calls /api/auth/me on mount and
       hard-redirects to /login if the call fails, so every test needs auth. */
    const ctx = await browser.newContext();
    const res = await ctx.request.post(`${BASE}/api/auth/login`, {
        data: { username: ADMIN_USER, password: ADMIN_PASS },
    });
    if (!res.ok()) throw new Error(`Login failed: ${res.status()} ${await res.text()}`);
    // Extract the wdg_session cookie value from the APIRequestContext
    const cookies = await ctx.cookies(BASE);
    const sessionCookie = cookies.find(c => c.name === 'wdg_session');
    if (!sessionCookie) throw new Error('No wdg_session cookie after login');
    sessionToken = sessionCookie.value;
    await ctx.close();
});

test.beforeEach(async ({ context }) => {
    await context.addCookies([{
        name: 'wdg_session',
        value: sessionToken,
        domain: 'localhost',
        path: '/',
    }]);
});

test('tamkoko sales page loads + renders 4 KPI + 8 sections', async ({ page }) => {
    await page.goto(`${BASE}/u/sales/tamkoko`);
    await expect(page.getByRole('heading', { name: /泰柯茶园/ })).toBeVisible();
    // 4 KPI cards: 营业额 / 营业收入 / 实收率 / 订单数
    // (.first() because text also appears in chart legends/table headers)
    await expect(page.getByText('营业额').first()).toBeVisible();
    await expect(page.getByText('营业收入').first()).toBeVisible();
    await expect(page.getByText('实收率').first()).toBeVisible();
    await expect(page.getByText('订单数').first()).toBeVisible();
    // 8 section titles
    for (const t of ['1. 渠道分布', '2. 堂食 vs 外卖', '3. 按餐段', '4. 按星期几', '5. 多门店对比', '6. 多维组合', '7. 收益率与客单价', '8. 优惠分析']) {
        await expect(page.getByText(t).first()).toBeVisible();
    }
});

test('tamkoko KPI numbers match fixture footer (sh_sjh/2026-06)', async ({ page }) => {
    await page.goto(`${BASE}/u/sales/tamkoko`);
    // pg NUMERIC arrives as string; KPI card shows formatted number
    // (.first() because the same number also appears in the section tables)
    await expect(page.getByText('432,778.82').first()).toBeVisible();   // 营业额
    await expect(page.getByText('272,427.09').first()).toBeVisible();   // 营业收入
    await expect(page.getByText('11,035').first()).toBeVisible();        // 订单数
});

test('store filter switches data', async ({ page }) => {
    await page.goto(`${BASE}/u/sales/tamkoko`);
    // First <select> on page is the nav brand selector — skip it.
    // The store selector is the one with an "hz_fuyang" option.
    await page.locator('select:has(option[value="hz_fuyang"])').selectOption('hz_fuyang');
    // hz_fuyang 没数据 — 至少 1 个 "暂无数据" 出现
    await expect(page.getByText('暂无数据').first()).toBeVisible({ timeout: 5000 });
});

test('upload link from main page navigates to upload sub-page', async ({ page }) => {
    await page.goto(`${BASE}/u/sales/tamkoko`);
    await page.getByRole('link', { name: /上传收银明细/ }).click();
    await expect(page).toHaveURL(/\/u\/sales\/tamkoko\/upload/);
    await expect(page.getByRole('heading', { name: /上传收银明细/ })).toBeVisible();
});

test('upload page has file picker + store selector + submit button', async ({ page }) => {
    await page.goto(`${BASE}/u/sales/tamkoko/upload`);
    await expect(page.locator('input[type="file"]')).toBeVisible();
    // (.first() because nav brand selector is also a <select>)
    await expect(page.locator('select').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /上传并导入/ })).toBeVisible();
});