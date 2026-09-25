import { test, expect } from '@playwright/test';
import { pressButton } from './controller.js';

// A pretend controller: the page reads it through navigator.getGamepads() like a real one.
test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Only needs one browser');
    await page.addInitScript(() => {
        const pad = {
            id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
            index: 0,
            connected: true,
            mapping: 'standard',
            timestamp: 0,
            axes: [0, 0, 0, 0],
            buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        navigator.getGamepads = () => [pad];
        window.__pad = {
            connect() {
                window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
            },
            set(button, down) {
                pad.buttons[button] = { pressed: down, touched: down, value: down ? 1 : 0 };
                pad.timestamp = performance.now();
            },
            axes(values) {
                pad.axes = values;
                pad.timestamp = performance.now();
            },
        };
    });
});

const A = 0;
const B = 1;
const X = 2;
const MENU = 9;
const DOWN = 13;

/** Waits for the game to read the press and release. */
async function press(page, button) {
    await page.evaluate(pressButton, button);
}

test('plays from start to pause with only a controller', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('backrooms-simulator:settings:v1', JSON.stringify({ version: 3, graphics: { resolutionScale: 30, dynamicLights: false } })));
    await page.goto('./?seed=1&debug');
    await page.addStyleTag({ content: '.menu { backdrop-filter: none !important; }' });
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    await page.evaluate(() => window.__pad.connect());
    await expect(page.locator('html')).toHaveAttribute('data-controller', 'connected');

    // The controls page uses the controller's own names for its buttons.
    await expect(page.locator('.keys-controller [data-pad="x"]').first()).toHaveText('Square');

    // Using it switches the menu's wording over.
    await press(page, DOWN);
    await expect(page.locator('html')).toHaveAttribute('data-controller', 'active');
    await expect(page.locator('#start')).toHaveText('Press Cross to Start');

    // Down from Start reaches Settings; A opens it, B comes back.
    await press(page, DOWN);
    await expect(page.locator('[data-action="settings"]')).toBeFocused();
    await press(page, A);
    await expect(page.locator('#settings')).toBeVisible();
    await expect(page.locator('#settings .panel-hint')).toContainText('L1 and R1');
    await press(page, B);
    await expect(page.locator('#settings')).toBeHidden();

    // Options starts the game without capturing the mouse.
    await press(page, MENU);
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();

    // The left stick walks and the right stick looks around.
    const start = await page.evaluate(() => window.__backrooms.player.position.clone());
    await page.evaluate(() => window.__pad.axes([0, -1, 0.8, 0]));
    await expect.poll(() => page.evaluate((s) => window.__backrooms.player.position.distanceTo(s), start)).toBeGreaterThan(0.05);
    await expect.poll(() => page.evaluate(() => window.__backrooms.look.yaw)).toBeLessThan(-0.1);
    await page.evaluate(() => window.__pad.axes([0, 0, 0, 0]));
    const moved = await page.evaluate((s) => window.__backrooms.player.position.distanceTo(s), start);
    expect(moved).toBeGreaterThan(0.05);
    expect(await page.evaluate(() => window.__backrooms.look.yaw)).toBeLessThan(-0.1);

    await press(page, X);
    expect(await page.evaluate(() => window.__backrooms.lighting.flashlightOn)).toBe(true);

    await press(page, MENU);
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'paused');
    await expect(page.locator('#start')).toHaveText('Press Cross to Resume');

    // Touching the keyboard switches the wording back.
    await page.keyboard.press('Shift');
    await expect(page.locator('#start')).toHaveText('Click to Resume');
});
