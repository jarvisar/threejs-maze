import { defineConfig } from '@playwright/test';

/**
 * The desktop app's smoke test (`npm run desktop:test` from the repository root). One Electron window, so one worker.
 * Set BACKROOMS_APP to a packaged build's executable to test that instead of the unpackaged app.
 */
export default defineConfig({
    testDir: 'test',
    workers: 1,
    timeout: 120_000,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
