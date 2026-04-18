import { test, expect } from '@playwright/test';
import { CategoryDictionaryPage } from '../../pages/admin/category-dictionary.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('three tabs visible', async ({ page }) => {
  const dictPage = new CategoryDictionaryPage(page);
  await dictPage.goto();
  await expect(dictPage.lvl1Tab).toBeVisible();
  await expect(dictPage.lvl2Tab).toBeVisible();
  await expect(dictPage.syncTab).toBeVisible();
});

test('switch between tabs', async ({ page }) => {
  const dictPage = new CategoryDictionaryPage(page);
  await dictPage.goto();
  await dictPage.switchToLvl2();
  await dictPage.switchToSync();
  await dictPage.switchToLvl1();
});
