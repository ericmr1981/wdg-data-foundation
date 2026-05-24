import { test, expect } from '@playwright/test';

const ADMIN_USER = process.env.WDG_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.WDG_ADMIN_PASS || '';

test('upload page file picker opens when clicking select-file area', async ({ page, context }) => {
  // Login via API to get session cookie (more reliable than UI form)
  const loginRes = await page.request.post('/api/auth/login', {
    data: { username: ADMIN_USER, password: ADMIN_PASS },
  });
  expect(loginRes.ok()).toBeTruthy();

  // Extract the session cookie from the response
  const headers = loginRes.headers();
  const setCookie = headers['set-cookie'];
  expect(setCookie).toBeDefined();

  // Parse the cookie and set it in the browser context
  const cookieMatch = setCookie.match(/([^=]+)=([^;]+)/);
  expect(cookieMatch).not.toBeNull();
  const cookieName = cookieMatch![1];
  const cookieValue = cookieMatch![2];

  await context.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
    },
  ]);

  // Verify we are authenticated
  const meRes = await page.request.get('/api/auth/me', { headers: { 'Cache-Control': 'no-store' } });
  expect(meRes.ok()).toBeTruthy();

  // Track console errors
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Track unhandled page errors
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });

  // Navigate to the upload page
  await page.goto('/admin/upload', { waitUntil: 'networkidle' });

  // Verify the page loaded with the expected heading
  await expect(page.locator('h1')).toContainText('文件上传');

  // Verify no JavaScript errors on the page
  expect(pageErrors).toHaveLength(0);

  // Verify the select-file text is visible
  const selectText = page.locator('text=点击选择文件...');
  await expect(selectText).toBeVisible();

  // Set up a file chooser event listener BEFORE clicking
  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 5_000 });

  // Click the invisible file input directly (it overlays the select area with z-10)
  const fileInput = page.locator('input[type="file"]');
  await fileInput.click();

  // Wait for the file chooser to appear
  const fileChooser = await fileChooserPromise;

  // Verify the file chooser is the right kind (file input)
  expect(fileChooser).toBeDefined();
  expect(fileChooser.element()).toBeDefined();

  // Accept the file chooser by setting a test file to verify the onChange fires
  await fileChooser.setFiles({
    name: 'test-upload.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('test content'),
  });

  // Verify the file name now shows on the page (onChange updated state)
  await expect(page.locator('text=test-upload.xlsx')).toBeVisible();

  // Verify no JS errors triggered by the interaction
  expect(pageErrors).toHaveLength(0);
});
