import { test, expect } from '@playwright/test';
import { RulesCopyPage } from '../../pages/admin/rules-copy.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('page loads with both selects', async ({ page }) => {
  const copyPage = new RulesCopyPage(page);
  await copyPage.goto();
  await expect(copyPage.fromBrandSelect).toBeVisible();
  await expect(copyPage.toBrandSelect).toBeVisible();
  await expect(copyPage.copyBtn).toBeVisible();
});
