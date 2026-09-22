import { test, expect } from '@playwright/test';

// Nothing here depends on screen size, so one browser is enough.
test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Only needs one browser');
});

test('manifest has what browsers need to offer an install', async ({ page, request }) => {
    await page.goto('./');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = await (await request.get(href)).json();

    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(['fullscreen', 'standalone', 'minimal-ui']).toContain(manifest.display);
    for (const size of ['192x192', '512x512']) {
        for (const purpose of ['any', 'maskable']) {
            const icon = manifest.icons.find((i) => i.sizes === size && i.purpose === purpose);
            expect(icon, `${size} ${purpose} icon`).toBeTruthy();
            expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
        }
    }
});

test('starts with no connection after the first visit', async ({ page, context }) => {
    await page.goto('./?seed=1');
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Wait for the worker to take control, which it does once everything is saved.
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
});
