import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
// The epic-end batched run sets E2E_PROD=1 to test a *production build* — every route
// precompiled — instead of the on-demand-compiling dev server. Under parallel workers
// the dev server races its own lazy compiles (ChunkLoadError, slow first renders),
// producing false failures; a prod build removes that class entirely. Ad-hoc
// `npm run test:e2e` keeps the fast dev server.
const e2eProd = !!process.env.E2E_PROD;
const port = e2eProd ? 3100 : 3000;
// Node-side mock back-end (e2e/global-setup.ts). The Next.js server's own back-end
// calls (server layouts, route handlers) go to BACKEND_URL, so point it here —
// Playwright never contacts the live back-end on :5100.
const mockBackendPort = Number(process.env.E2E_MOCK_BACKEND_PORT ?? 5199);

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 1, // one retry locally as a net for genuinely rare flakes
  workers: isCI ? 1 : undefined, // local: Playwright auto-scales workers to the machine
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // e2eProd serves the prebuilt .next with `next start` — no build here; the epic-end
    // quality-check gate already built and gated it. Fast boot, low CPU. Dev uses next dev.
    command: e2eProd ? `npm run start -- -p ${port}` : 'npm run dev',
    url: `http://localhost:${port}`,
    env: { BACKEND_URL: `http://127.0.0.1:${mockBackendPort}/api` },
    // prod-e2e never reuses a stray dev server (which would reintroduce the flakiness);
    // the distinct port also avoids colliding with a dev server still on :3000.
    reuseExistingServer: !isCI && !e2eProd,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
