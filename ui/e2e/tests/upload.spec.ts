import { test, expect } from '@playwright/test';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('upload page renders form', async ({ page }) => {
  await page.goto('/upload');
  await expect(page.locator('h1:has-text("文件上传")')).toBeVisible();
  await expect(page.locator('button:has-text("上传并保存")')).toBeVisible();
  await expect(page.locator('input[type="file"]')).toBeAttached();
});

test('checkbox triggers import option visible', async ({ page }) => {
  await page.goto('/upload');
  await expect(page.locator('label:has-text("触发导入")')).toBeVisible();
  const checkbox = page.locator('input[type="checkbox"]#triggerImport');
  await checkbox.check();
  await expect(checkbox).toBeChecked();
});
