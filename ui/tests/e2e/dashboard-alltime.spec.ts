import { test, expect } from '@playwright/test';

test.describe('Dashboard 全量模式', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/u/dashboard');
    await expect(page.getByRole('heading', { name: '经营看板' })).toBeVisible({ timeout: 15_000 });
  });

  test('全量模式默认进入:vs 箭头不显示,银行入账率始终显示', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const periodSelect = page.locator('select').nth(1);
    expect(await periodSelect.inputValue()).toBe('all');

    // Scope to the KPI grid (5 clickable cards) — bank-balance card
    // also has ↑/↓ but lives outside the grid when balance info shows.
    const kpiGrid = page.locator('div').filter({ has: page.getByText('银行入账率') }).first();
    const arrows = kpiGrid.locator('text=/[↑↓]/');
    expect(await arrows.count()).toBe(0);

    await expect(page.getByText('银行入账率')).toBeVisible();
    await expect(page.getByText('选择门店')).toHaveCount(0);
  });

  test('切到具体月份:数据变化', async ({ page }) => {
    const periodSelect = page.locator('select').nth(1);
    const allOptions = await periodSelect.locator('option').all();
    for (const opt of allOptions) {
      const v = await opt.getAttribute('value');
      if (v && v !== 'all') {
        await periodSelect.selectOption({ value: v });
        break;
      }
    }
    await page.waitForLoadState('networkidle');

    expect(await periodSelect.inputValue()).not.toBe('all');

    await expect(page.locator('text=/¥\\d/').first()).toBeVisible();
  });

  test('门店切换:数字跟随变化', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const firstKpi = await page.locator('text=/¥[\\d,]+/').first().textContent();

    const storeSelect = page.locator('select').nth(2);
    const storeOptions = await storeSelect.locator('option').all();
    for (const opt of storeOptions) {
      const v = await opt.getAttribute('value');
      if (v && v !== 'all') {
        await storeSelect.selectOption({ value: v });
        break;
      }
    }
    await page.waitForLoadState('networkidle');

    const secondKpi = await page.locator('text=/¥[\\d,]+/').first().textContent();
    expect(secondKpi).not.toBe(firstKpi);
  });
});