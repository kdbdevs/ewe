import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 45000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { channel: 'chrome', baseURL: 'http://127.0.0.1:8876', viewport: { width: 1440, height: 960 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm start -- --port 8876 --data test-results/workflows.json',
    url: 'http://127.0.0.1:8876', reuseExistingServer: false,
  },
});
