import { test, expect } from '@playwright/test';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('KPI cards render', async ({ page }) => {
  await page.goto('/pipeline');
  await expect(page.locator('text=未分类笔数')).toBeVisible();
  await expect(page.locator('text=未分类金额')).toBeVisible();
});

test('coverage table renders', async ({ page }) => {
  await page.goto('/pipeline');
  await expect(page.locator('th:has-text("文件名")')).toBeVisible();
  await expect(page.locator('th:has-text("覆盖率")')).toBeVisible();
});

test('expand file row shows unclassified details', async ({ page }) => {
  await page.goto('/pipeline');
  const expandBtn = page.locator('button:has-text("查看未分类")').first();
  if (await expandBtn.isVisible()) {
    await expandBtn.click();
    await expect(page.locator('text=未分类 Top 20')).toBeVisible();
  }
});
