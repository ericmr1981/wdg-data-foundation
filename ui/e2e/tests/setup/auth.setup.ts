import { test as setup, expect } from '@playwright/test';

const adminAuthFile = 'e2e/storage-states/admin.json';
const operatorAuthFile = 'e2e/storage-states/operator.json';

setup('create admin auth state', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL('/pipeline');
  await page.context().storageState({ path: adminAuthFile });
});

setup('create operator auth state', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('operator');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL('/pipeline');
  await page.context().storageState({ path: operatorAuthFile });
});
