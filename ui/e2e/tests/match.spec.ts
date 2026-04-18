import { test, expect } from '@playwright/test';
import { MatchPage } from '../../pages/match.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('page loads with month filter', async ({ page }) => {
  const matchPage = new MatchPage(page);
  await matchPage.goto();
  await expect(matchPage.monthFilter).toBeVisible();
  await expect(matchPage.batchMatchBtn).toBeVisible();
});

test('filter by month', async ({ page }) => {
  const matchPage = new MatchPage(page);
  await matchPage.goto();
  await matchPage.filterByMonth('2025-03');
  await matchPage.resetBtn.click();
});
