import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.SMOKE_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4100';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4100',
    reuseExistingServer: !process.env.CI,
  },
});
