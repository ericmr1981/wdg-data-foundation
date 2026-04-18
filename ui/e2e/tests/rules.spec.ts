import { test, expect } from '@playwright/test';
import { RulesPage } from '../../pages/rules.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('page loads and shows keyword filter', async ({ page }) => {
  const rulesPage = new RulesPage(page);
  await rulesPage.goto();
  await expect(rulesPage.keywordInput).toBeVisible();
  await expect(rulesPage.addRuleBtn).toBeVisible();
});

test('filter by keyword', async ({ page }) => {
  const rulesPage = new RulesPage(page);
  await rulesPage.goto();
  await rulesPage.filterByKeyword('测试');
  await rulesPage.clearFilters();
});

test('open add rule modal', async ({ page }) => {
  const rulesPage = new RulesPage(page);
  await rulesPage.goto();
  await rulesPage.openAddRuleModal();
  await expect(page.locator('button:has-text("保存")').last()).toBeVisible();
  await rulesPage.closeModal();
});

test('open import rules modal', async ({ page }) => {
  const rulesPage = new RulesPage(page);
  await rulesPage.goto();
  await rulesPage.openImportModal();
  await expect(page.locator('button:has-text("开始导入")')).toBeVisible();
  await rulesPage.closeModal();
});
