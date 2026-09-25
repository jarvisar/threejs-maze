import { test, expect } from '@playwright/test';
import { pressButton } from './controller.js';

const B = 1;
const MENU = 9;
const RIGHT_STICK = 11;
const ASK = 'Click or press a key to go full\u00a0screen.';
const UNAVAILABLE = 'Full screen isn\'t available here.';

// The pretend controller from gamepad.spec.js, and a count of the game's requests to go full screen.
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const pad = {
            id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
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
        };
        window.__fullscreenRequests = 0;
        const request = Element.prototype.requestFullscreen;
        Element.prototype.requestFullscreen = function (...args) {
            window.__fullscreenRequests++;
            return request.apply(this, args);
        };
    });
});

/**
 * Reaches into the page without the browser taking it as the player clicking or typing, as with a real
 * controller. Whatever Playwright's own page.evaluate and locators do counts as that for a few seconds, which
 * would let the game go full screen when a real controller couldn't.
 * @param {import('@playwright/test').Page} page
 */
async function withoutGestures(page) {
    const cdp = await page.context().newCDPSession(page);
    const run = async (expression) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    return {
        run,
        /** Waits for the game to read both edges, once nothing counts as a click any more. */
        async press(button) {
            await expect.poll(() => run('navigator.userActivation.isActive'), { timeout: 10_000 }).toBe(false);
            await run(`(${pressButton.toString()})(${button})`);
        },
    };
}

/** @param {import('@playwright/test').Page} page */
async function openGame(page) {
    await page.addInitScript(() => localStorage.setItem('backrooms-simulator:settings:v1', JSON.stringify({ version: 3, graphics: { resolutionScale: 30, dynamicLights: false } })));
    await page.goto('./?mode=explore&seed=1&debug');
    await page.addStyleTag({ content: '.menu { backdrop-filter: none !important; }' });
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    await page.evaluate(() => window.__pad.connect());
    return withoutGestures(page);
}

/** @param {import('@playwright/test').Page} page */
const fullscreenElement = (page) => page.evaluate(() => document.fullscreenElement?.tagName ?? null);

test.describe('with a mouse and keyboard', () => {
    test.beforeEach(({}, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'Only needs one browser');
    });

    test('in the menus, the next key press finishes going full screen', async ({ page }) => {
        const pad = await openGame(page);
        await page.locator('[data-action="controls"]').click();

        // A controller button isn't enough for the browser on its own; the game says what is. The controls
        // page covers the menu's note, so it says it in the toast there.
        await pad.press(RIGHT_STICK);
        await expect.poll(() => pad.run('document.querySelector("#toast.visible")?.textContent')).toBe(ASK);
        expect(await pad.run('window.__fullscreenRequests')).toBe(1);
        expect(await pad.run('document.fullscreenElement')).toBeNull();

        // Back to Start, and again: still waiting, now with the note.
        await pad.press(B);
        await pad.press(RIGHT_STICK);
        await expect.poll(() => pad.run('document.getElementById("menu-note").textContent')).toBe(ASK);
        expect(await pad.run('window.__fullscreenRequests')).toBe(2);
        expect(await pad.run('document.activeElement.id')).toBe('start');

        // Escape doesn't count.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        expect(await pad.run('document.fullscreenElement')).toBeNull();
        expect(await pad.run('document.getElementById("menu-note").hidden')).toBe(false);

        // Space on Start does, and still starts the game with the mouse captured.
        await page.keyboard.press('Space');
        await expect.poll(() => fullscreenElement(page)).toBe('HTML');
        await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');
        expect(await page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
        await expect(page.locator('#menu-note')).toBeHidden();
        await expect.poll(() => page.evaluate(() => document.querySelector('#toast.visible')?.textContent ?? '')).not.toBe(ASK);

        // Leaving needs no click.
        await pad.press(RIGHT_STICK);
        await expect.poll(() => fullscreenElement(page)).toBeNull();
        await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');

        // Straight back in when the player has just pressed a key.
        await page.keyboard.press('KeyK');
        await pad.run(`window.__pad.set(${RIGHT_STICK}, true)`);
        await expect.poll(() => fullscreenElement(page)).toBe('HTML');
        await pad.run(`window.__pad.set(${RIGHT_STICK}, false)`);
        expect(await pad.run('document.querySelector("#toast.visible")?.textContent ?? ""')).not.toBe(ASK);
    });

    test('in play, clicking the view both captures the mouse and finishes going full screen', async ({ page }) => {
        const pad = await openGame(page);
        await pad.press(MENU); // playing with the controller: the mouse is left free
        await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');

        await pad.press(RIGHT_STICK);
        await expect.poll(() => pad.run('document.querySelector("#toast.visible")?.textContent')).toBe(ASK);
        expect(await pad.run('window.__fullscreenRequests')).toBe(1);
        expect(await pad.run('document.fullscreenElement')).toBeNull();

        const { width, height } = page.viewportSize();
        await page.mouse.click(width / 2, height / 2);
        await expect.poll(() => fullscreenElement(page)).toBe('HTML');
        expect(await page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
        // The message goes with it.
        await expect.poll(() => page.evaluate(() => document.querySelector('#toast.visible')?.textContent ?? '')).not.toBe(ASK);

        await pad.press(RIGHT_STICK);
        await expect.poll(() => fullscreenElement(page)).toBeNull();
        await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');
    });

    test('says so where there is no full screen', async ({ page }) => {
        await page.addInitScript(() => Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false }));
        const pad = await openGame(page);
        await pad.press(RIGHT_STICK);
        await expect(page.locator('#menu-note')).toHaveText(UNAVAILABLE);
        expect(await page.evaluate(() => window.__fullscreenRequests)).toBe(0);

        await pad.press(MENU);
        await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');
        await pad.press(RIGHT_STICK);
        await expect(page.locator('#toast.visible')).toHaveText(UNAVAILABLE);
    });
});

test.describe('on a touch screen', () => {
    test.beforeEach(({}, testInfo) => {
        test.skip(testInfo.project.name !== 'android', 'Only needs one phone');
    });

    test('a tap finishes going full screen', async ({ page }) => {
        const pad = await openGame(page);
        await pad.press(RIGHT_STICK);
        await expect.poll(() => pad.run('document.getElementById("menu-note").textContent')).toBe('Tap the screen to go full\u00a0screen.');
        await page.touchscreen.tap(8, 8);
        await expect.poll(() => fullscreenElement(page)).toBe('HTML');
        await expect(page.locator('#menu-note')).toBeHidden();
        await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title');
    });
});
