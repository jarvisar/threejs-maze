import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// An emulated Quest 3 and its controllers (Meta's IWER), installed before the game looks for a headset.
const IWER = readFileSync(fileURLToPath(new URL('../node_modules/iwer/build/iwer.min.js', import.meta.url)), 'utf8');

/**
 * Does something with one of the emulated controllers.
 * @param {import('@playwright/test').Page} page
 * @param {'left' | 'right'} hand
 * @param {string} call On the controller `c`, e.g. "c.updateAxes('thumbstick', 0, -1)".
 */
async function controller(page, hand, call) {
    await page.evaluate(([h, code]) => new Function('c', code)(window.__xr.controllers[h]), [hand, call]);
}

/** Presses a button and lets it go, a frame or two apart. */
async function tap(page, hand, button) {
    await controller(page, hand, `c.updateButtonValue('${button}', 1)`);
    await page.waitForTimeout(250);
    await controller(page, hand, `c.updateButtonValue('${button}', 0)`);
    await page.waitForTimeout(250);
}

test('plays in a headset: walks, jumps, edits, and the messages show in it', async ({ page }) => {
    // The emulated headset draws both eyes at the size of the window, whatever the resolution setting. Drawn in
    // software at 1920x1080, that's a frame every couple of seconds.
    await page.setViewportSize({ width: 960, height: 540 });
    await page.addInitScript(IWER);
    await page.addInitScript(() => {
        localStorage.setItem('backrooms-simulator:settings:v1', JSON.stringify({ version: 5, graphics: { resolutionScale: 30, dynamicLights: false, ambientOcclusion: false }, effects: { enabled: false } }));
        const device = new IWER.XRDevice(IWER.metaQuest3);
        device.installRuntime({ forceInstall: true });
        window.__xr = device;
    });
    await page.goto('./?seed=1&mode=explore&debug');
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    const game = (fn) => page.evaluate(fn);
    // Every message the card in front of you shows. Where frames are slow, one can come and go between two looks.
    await game(() => {
        const panel = window.__backrooms.vr.panel;
        const show = panel.show.bind(panel);
        window.__vrMessages = [];
        panel.show = (message) => {
            if (message !== null) window.__vrMessages.push(message);
            show(message);
        };
    });
    const shown = () => game(() => window.__vrMessages);
    await page.locator('#enter-vr').click();
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');
    // (What happens frame by frame in the headset can take a while where WebGL is drawn in software.)
    const slow = { timeout: 20_000 };
    await expect.poll(() => game(() => window.__backrooms.vr.inputKind), slow).toBe('controllers');
    // How to get around, in front of you.
    await expect.poll(shown, slow).toContain('Left stick to walk, right stick to turn.');

    // The left stick walks.
    const start = await game(() => ({ ...window.__backrooms.player.position }));
    await controller(page, 'left', `c.updateAxes('thumbstick', 0, -1)`);
    await expect.poll(async () => {
        const p = await game(() => window.__backrooms.player.position);
        return Math.hypot(p.x - start.x, p.z - start.z);
    }, slow).toBeGreaterThan(0.2);
    await controller(page, 'left', `c.updateAxes('thumbstick', 0, 0)`);

    // Pushing the right stick up jumps.
    const floor = await game(() => window.__backrooms.player.position.y);
    await controller(page, 'right', `c.updateAxes('thumbstick', 0, -1)`);
    await expect.poll(() => game(() => window.__backrooms.player.position.y), slow).toBeGreaterThan(floor + 0.05);
    await controller(page, 'right', `c.updateAxes('thumbstick', 0, 0)`);

    // B: edit mode, with all of its help on the card.
    await tap(page, 'right', 'b-button');
    expect(await game(() => window.__backrooms.editMode)).toBe(true);
    expect(await shown()).toContainEqual(expect.stringContaining('Push the right stick up or down to fly.'));
    await tap(page, 'right', 'b-button');

    // A title and the fade at a way out show in the headset too.
    await game(() => window.__backrooms.hud.showTitle('LEVEL 1'));
    await expect.poll(() => game(() => window.__backrooms.vr.title.message), slow).toBe('LEVEL 1');
    await game(() => window.__backrooms.hud.setFade(true, 'white'));
    await expect.poll(() => game(() => window.__backrooms.vr.fade.mesh.material.opacity), slow).toBeGreaterThan(0.9);
    await game(() => window.__backrooms.hud.setFade(false));

    // Leaving VR pauses, with the menu on the screen.
    await game(() => window.__backrooms.vr.exit());
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'paused');
    expect(await game(() => window.__backrooms.vr.presenting)).toBe(false);
});
