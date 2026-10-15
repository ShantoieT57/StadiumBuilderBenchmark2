/**
 * Playwright global setup: starts the stateless Node-side mock back-end
 * (e2e/fixtures/mock-backend.ts) that the Next.js server's own back-end calls hit
 * during E2E — playwright.config.ts points the web server's BACKEND_URL at it.
 * The returned function is Playwright's teardown and stops the server.
 */
import { startMockBackend } from './fixtures/mock-backend';

export default async function globalSetup(): Promise<() => Promise<void>> {
  return startMockBackend();
}
