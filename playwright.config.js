import { defineConfig, devices } from '@playwright/test';

/**
 * Layout and accessibility checks in real browsers, at the screen sizes people actually play on.
 * Runs against the production build (`npm run build` first, or let `webServer` below do it).
 */
const desktop = (width, height) => ({ ...devices['Desktop Chrome'], viewport: { width, height } });
// Phones and tablets run in Chromium even for iOS sizes: Playwright's WebKit doesn't emulate a touch-only pointer,
// so the game (rightly) treats it as a mouse. Safari's layout engine gets its own desktop run below.
// Pixel density 1: layout is the same in CSS pixels, and software WebGL at 3x density is painfully slow.
const touch = (device) => ({ ...devices[device], browserName: 'chromium', defaultBrowserType: 'chromium', deviceScaleFactor: 1 });

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: true,
    // Headless browsers draw WebGL on the CPU (no GPU), so each page running the game is heavy. Keep it to two at once.
    workers: 2,
    timeout: 60_000,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: 'http://localhost:4173/',
        // Tracing records every frame of the WebGL canvas and slows the tests several times over.
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        // Phones and tablets.
        { name: 'iphone-se', use: touch('iPhone SE') },
        { name: 'iphone', use: touch('iPhone 13') },
        { name: 'iphone-landscape', use: touch('iPhone 13 landscape') },
        { name: 'android-small', use: touch('Galaxy S9+') },
        { name: 'android', use: touch('Pixel 7') },
        { name: 'ipad', use: touch('iPad Mini') },
        { name: 'ipad-landscape', use: touch('iPad Mini landscape') },
        // Keyboard and mouse.
        { name: 'laptop-small', use: desktop(1024, 768) },
        { name: 'laptop', use: desktop(1366, 768) },
        { name: 'desktop', use: desktop(1920, 1080) },
        { name: 'desktop-1440p', use: desktop(2560, 1440) },
        { name: 'safari', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    ],
    webServer: {
        command: 'npm run build && npm run preview -- --port 4173 --strictPort',
        url: 'http://localhost:4173/',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
