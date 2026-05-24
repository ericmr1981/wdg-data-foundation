import { test, expect } from '@playwright/test';
import { BrandsPage } from '../../pages/admin/brands.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('page loads with create button', async ({ page }) => {
  const brandsPage = new BrandsPage(page);
  await brandsPage.goto();
  await expect(brandsPage.createBtn).toBeVisible();
});
