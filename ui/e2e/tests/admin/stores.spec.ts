import { test, expect } from '@playwright/test';
import { StoresPage } from '../../pages/admin/stores.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('page loads with create button', async ({ page }) => {
  const storesPage = new StoresPage(page);
  await storesPage.goto();
  await expect(storesPage.createBtn).toBeVisible();
});
