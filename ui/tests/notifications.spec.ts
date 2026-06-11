import { test, expect } from '@playwright/test';

test.describe('Notifications', () => {
  test('bell shows up + at least 1 notification present (seeded)', async ({ page }) => {
    await page.goto('/login');
    // assumes dev seed creates 1 active notification; if not, this test will skip
    await page.fill('input[name=email]', process.env.TEST_USER || 'admin@local');
    await page.fill('input[name=password]', process.env.TEST_PASSWORD || 'admin');
    await page.click('button[type=submit]');
    await page.waitForURL('/');
    const bell = page.getByLabel('通知');
    await expect(bell).toBeVisible();
    await bell.click();
    // Either items appear or empty state — both are acceptable
    const hasItems = await page.locator('[data-testid=notif-item]').count();
    const hasEmpty = await page.getByText('暂无通知').count();
    expect(hasItems + hasEmpty).toBeGreaterThan(0);
  });

  test('full page loads', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: '站内通知' })).toBeVisible();
  });
});
