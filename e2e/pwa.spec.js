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

test('Install link in the pause menu opens the browser install prompt', async ({ page }) => {
    await page.goto('./?seed=1&debug');
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    const install = page.locator('[data-action="install"]');

    await page.evaluate(() => {
        window.prompted = 0;
        window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: async () => { window.prompted++; } }));
    });
    // Not on the title screen, only when paused.
    await expect(install).toBeHidden();
    await page.evaluate(() => window.__backrooms.menu.setState('paused'));
    await expect(install).toBeVisible();

    await install.click();
    expect(await page.evaluate(() => window.prompted)).toBe(1);
    // The browser's prompt can only be used once.
    await expect(install).toBeHidden();
    await expect(page.locator('#start')).toBeFocused();
});

test('title screen offers the install once', async ({ page }) => {
    await page.goto('./?seed=1');
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    const offer = page.locator('#install-offer');
    const offerInstall = () => page.evaluate(() => {
        window.prompted = 0;
        window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: async () => { window.prompted++; } }));
    });

    await expect(offer).toBeHidden();
    await offerInstall();
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: 'Install' }).click();
    expect(await page.evaluate(() => window.prompted)).toBe(1);
    await expect(offer).toBeHidden();

    // Not again on the next visit, even though the browser offers it again.
    await page.reload();
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    await offerInstall();
    await expect(offer).toBeHidden();
});

test('install offer can be turned down', async ({ page }) => {
    await page.goto('./?seed=1&debug');
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    const offer = page.locator('#install-offer');
    await page.evaluate(() => {
        window.prompted = 0;
        window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: async () => { window.prompted++; } }));
    });
    await expect(offer).toBeVisible();

    // Stays out of the way of the settings page, and comes back after it.
    await page.locator('[data-action="settings"]').click();
    await expect(offer).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(offer).toBeVisible();

    await offer.getByRole('button', { name: 'Not now' }).click();
    await expect(offer).toBeHidden();
    expect(await page.evaluate(() => window.prompted)).toBe(0);
    // Still available from the pause menu.
    await page.evaluate(() => window.__backrooms.menu.setState('paused'));
    await expect(page.locator('[data-action="install"]')).toBeVisible();
});
