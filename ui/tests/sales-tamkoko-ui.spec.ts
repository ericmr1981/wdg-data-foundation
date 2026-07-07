import { test, expect } from '@playwright/test';

// login helper
const login = async (page: import('@playwright/test').Page) => {
    const res = await page.request.post('/api/auth/login', {
        data: { username: 'admin', password: 'admin123' },
    });
    const cookies = res.headers()['set-cookie'];
    if (cookies) {
        const match = cookies.match(/wdg_session=([^;]+)/);
        if (match) await page.context().addCookies([{ name: 'wdg_session', value: match[1], url: 'http://localhost:4300' }]);
    }
};

test.beforeEach(async ({ page }) => { await login(page); });

test('tamkoko sales page loads (heading visible)', async ({ page }) => {
    await page.goto('http://localhost:4300/u/sales/tamkoko');
    await expect(page.getByRole('heading', { name: /泰柯茶园/ })).toBeVisible();
});

test('all 7 read APIs return data for sh_sjh/2026-06', async ({ page }) => {
    // Direct API verification (KPI cards populated after client hydration)
    for (const ep of ['overview', 'channel', 'dine-takeaway', 'meal-period', 'weekday', 'multi-store', 'combined']) {
        const r = await page.request.get(`http://localhost:4300/api/tamkoko/sales/${ep}?store=sh_sjh&month=2026-06-01`);
        const j = await r.json();
        expect(j.success, `${ep} success`).toBe(true);
        expect(Array.isArray(j.data), `${ep} data array`).toBe(true);
        expect(j.data.length, `${ep} rows > 0`).toBeGreaterThan(0);
    }
});

test('trend + daily APIs reachable', async ({ page }) => {
    const trend = await page.request.get('http://localhost:4300/api/tamkoko/sales/trend?store=sh_sjh&months=12');
    expect((await trend.json()).success).toBe(true);
    const daily = await page.request.get('http://localhost:4300/api/tamkoko/sales/daily?store=sh_sjh&month=2026-06-01');
    expect((await daily.json()).success).toBe(true);
});

test('KPI numbers match fixture footer (sh_sjh/2026-06)', async ({ page }) => {
    const r = await page.request.get('http://localhost:4300/api/tamkoko/sales/overview?store=sh_sjh&month=2026-06-01');
    const j = await r.json();
    const row = j.data[0];
    expect(row.gross_amt).toBe('432778.82');
    expect(row.revenue_amt).toBe('272427.09');
    expect(row.net_amt).toBe('271083.34');
});

test('store filter switches data (API)', async ({ page }) => {
    // Verify the store filter actually changes API response shape via direct fetch
    const sh = await page.request.get('http://localhost:4300/api/tamkoko/sales/overview?store=sh_sjh&month=2026-06-01');
    const shData = (await sh.json()).data;
    expect(shData.length).toBeGreaterThan(0);

    const hz = await page.request.get('http://localhost:4300/api/tamkoko/sales/overview?store=hz_fuyang&month=2026-06-01');
    const hzData = (await hz.json()).data;
    expect(hzData.length).toBe(0); // hz_fuyang has no 6 月 data
});

test('upload sub-page reachable directly', async ({ page }) => {
    await page.goto('http://localhost:4300/u/sales/tamkoko/upload');
    await expect(page).toHaveURL(/\/u\/sales\/tamkoko\/upload/);
    await expect(page.getByRole('heading', { name: /上传收银明细/ })).toBeVisible();
});

test('upload page has file picker + submit button', async ({ page }) => {
    await page.goto('http://localhost:4300/u/sales/tamkoko/upload');
    await expect(page.locator('input[type="file"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /上传并导入/ })).toBeVisible();
});

test('multi-store: select 全部门店 shows KPI total > any single store', async ({ page }) => {
    // 单店营业额
    const single = await page.request.get('http://localhost:4300/api/tamkoko/sales/overview?store=sh_sjh&month=2026-06-01');
    const singleGross = Number((await single.json()).data[0].gross_amt);
    // 全部门店(不带 store)
    const all = await page.request.get('http://localhost:4300/api/tamkoko/sales/overview?month=2026-06-01');
    const allRows = (await all.json()).data;
    const totalGross = allRows.reduce((a: number, r: any) => a + Number(r.gross_amt), 0);
    expect(totalGross).toBeGreaterThan(singleGross);
    expect(allRows.length).toBeGreaterThan(1); // 多店
});

test('multi-store: UI page shows compare table when 全部门店 selected', async ({ page }) => {
    await page.goto('http://localhost:4300/u/sales/tamkoko');
    // 选全部门店
    await page.locator('select').first().selectOption('all');
    await page.waitForTimeout(1500);
    // 对比表存在(各店对比标题)
    await expect(page.getByText('各店对比')).toBeVisible();
    // KPI 卡仍存在
    await expect(page.getByTestId('kpi-card-营业额')).toBeVisible();
});

test('multi-store: combined section removed', async ({ page }) => {
    await page.goto('http://localhost:4300/u/sales/tamkoko');
    await expect(page.getByText('多维组合')).toHaveCount(0);
});

test('multi-store: trend shows multiple lines (3 stores)', async ({ page }) => {
    await page.goto('http://localhost:4300/u/sales/tamkoko');
    await page.locator('select').first().selectOption('all');
    await page.waitForTimeout(1500);
    // 趋势图 legend 含上海/杭州/温州
    await expect(page.getByText('上海世纪汇店')).toBeVisible();
    await expect(page.getByText('杭州富阳店')).toBeVisible();
});
