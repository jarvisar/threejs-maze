import { test, expect } from '@playwright/test';

/** Pretends a headset is (or isn't) connected; asking for a session fails, as it does with nothing on. */
async function fakeHeadset(page, available) {
    await page.addInitScript((supported) => {
        const xr = new EventTarget();
        xr.isSessionSupported = async (mode) => supported && mode === 'immersive-vr';
        xr.requestSession = async () => {
            throw new DOMException('No headset', 'NotSupportedError');
        };
        Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
    }, available);
}

test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Only needs one browser');
});

test('no VR button without a headset', async ({ page }) => {
    await fakeHeadset(page, false);
    await page.goto('./?seed=1');
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    await expect(page.locator('#enter-vr')).toBeHidden();
    await page.getByRole('button', { name: 'Controls' }).click();
    await expect(page.locator('.keys-vr')).toBeHidden();
});

test('offers VR when a headset is there, and says so if it won\'t start', async ({ page }) => {
    await fakeHeadset(page, true);
    await page.goto('./?seed=1');
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    await expect(page.locator('#enter-vr')).toBeVisible();

    await page.locator('#enter-vr').click();
    await expect(page.locator('#menu-note')).toHaveText(/Couldn't start VR/);
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title');

    await page.getByRole('button', { name: 'Controls' }).click();
    await expect(page.locator('.keys-vr')).toBeVisible();
});
