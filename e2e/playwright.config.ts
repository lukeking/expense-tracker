import { defineConfig, devices } from '@playwright/test';

const PWA_PORT = 5300; // WSL2 blocks 5144–5243; Vite default 5173 is inside that range
const API_PORT = 8787;
const BASE_URL = `http://localhost:${PWA_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './tests',
  // Per-test DB reset truncates a shared database, so tests must not run concurrently.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'html',
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Backend Worker against the local Supabase stack.
      command: `pnpm exec wrangler dev --env e2e --port ${API_PORT}`,
      cwd: '../backend',
      // /pwa/categories returns 401 without auth — a 401 still means the server is up.
      url: `${API_URL}/pwa/categories`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // PWA dev server pointed at the local backend.
      command: `pnpm dev --port ${PWA_PORT}`,
      cwd: '../pwa',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_API_BASE: API_URL },
    },
  ],
});
