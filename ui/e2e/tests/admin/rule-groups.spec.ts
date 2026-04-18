import { test, expect } from '@playwright/test';
import { RuleGroupsPage } from '../../pages/admin/rule-groups.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('page loads with add button', async ({ page }) => {
  const rgPage = new RuleGroupsPage(page);
  await rgPage.goto();
  await expect(rgPage.addGroupBtn).toBeVisible();
});
