import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || '4173';
const TARGET_URL = process.env.SMOKE_BASE_URL || process.env.CLARITY_BASE_URL;
const BASE_URL = TARGET_URL || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css'
    }
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 980 }
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] }
    }
  ],
  webServer: TARGET_URL
    ? undefined
    : {
        command: process.env.PLAYWRIGHT_WEB_SERVER_COMMAND || 'node tests/serve.mjs',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
      }
});
