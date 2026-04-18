import { test, expect } from '@playwright/test';

test('admin login redirects to /pipeline', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL('/pipeline');
});

test('operator login redirects to /pipeline', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('operator');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL('/pipeline');
});

test('wrong password shows error', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin');
  await page.locator('input[type="password"]').fill('wrongpassword');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.locator('.text-red-600')).toBeVisible();
});
