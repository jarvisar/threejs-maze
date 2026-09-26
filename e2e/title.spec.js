import { test, expect } from '@playwright/test';
import { pressButton } from './controller.js';

/*
 * The title screen: which mode it offers first, and getting back to it from either mode with nothing left over from
 * playing except the world itself (and in Explore, what was built or knocked down in it).
 */

const SETTINGS_KEY = 'backrooms-simulator:settings:v1';
const isTouch = (testInfo) => !!testInfo.project.use.hasTouch;

/**
 * Opens the game with `?debug`, which puts it on `window.__backrooms`, drawn as cheaply as possible (see layout.spec.js).
 * @param {import('@playwright/test').Page} page
 * @param {string} query
 * @param {object} [settings] Saved settings to start with.
 */
async function openGame(page, query, settings = {}) {
    await page.addInitScript(([key, saved]) => localStorage.setItem(key, JSON.stringify(saved)),
        [SETTINGS_KEY, { version: 3, ...settings, graphics: { resolutionScale: 30, dynamicLights: false }, effects: { enabled: false } }]);
    await page.goto(`./${query}&debug`);
    await page.addStyleTag({ content: '.menu { backdrop-filter: none !important; }' });
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
}

/**
 * Starts (or resumes) the way a player would: a click, or a tap on a touch screen.
 * @returns {Promise<number>} When the click went in (`Date.now()`), to check the clock against.
 */
async function start(page) {
    const clicked = Date.now();
    await page.locator('#start').click();
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');
    return clicked;
}

/** Checks the clock began again at Start: no more play than time since then (a slow machine can take seconds). */
async function expectFreshClock(page, started) {
    const since = (Date.now() - started) / 1000;
    expect(await page.evaluate(() => window.__backrooms.playTime)).toBeLessThanOrEqual(since + 0.5);
}

async function pause(page, testInfo) {
    if (isTouch(testInfo)) await page.locator('.touch-pause').click();
    else await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'paused');
}

/** Waits for the clock to pass a few seconds of play. */
async function play(page, seconds) {
    await expect.poll(() => page.evaluate(() => window.__backrooms.playTime), { timeout: 30_000 }).toBeGreaterThan(seconds);
}

/** What should all be back as it was on the title screen, whatever happened while playing. */
function leftOver(page) {
    return page.evaluate(() => {
        const game = window.__backrooms;
        return {
            state: game.state,
            started: game.started,
            playTime: game.playTime,
            x: game.player.position.x,
            z: game.player.position.z,
            flying: game.player.flying,
            editMode: game.editMode,
            zoom: game.zoom,
            fov: Math.round(game.camera.fov * 1000) / 1000,
            flashlight: game.lighting.flashlightOn,
            blackout: game.lighting.blackout,
            powerCut: game.blackouts.phase,
            soundPaused: game.audio.paused,
            toasts: game.toast.queue.length + (game.toast.current ? 1 : 0),
        };
    });
}

const CLEAN = { state: 'title', started: false, playTime: 0, x: 0, z: 0, flying: false, editMode: false, zoom: 1, fov: 70, flashlight: false, blackout: 0, powerCut: 'idle', soundPaused: true, toasts: 0 };

/** Pretends a headset is connected; asking for a session fails, as it does with nothing on. */
async function fakeHeadset(page) {
    await page.addInitScript(() => {
        const xr = new EventTarget();
        xr.isSessionSupported = async (mode) => mode === 'immersive-vr';
        xr.requestSession = async () => {
            throw new DOMException('No headset', 'NotSupportedError');
        };
        Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
    });
}

test('a first visit has Found Footage first, and picked', async ({ page }) => {
    await page.goto('./?debug');
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    const modes = page.locator('#modes [role="radio"]');
    await expect(modes).toHaveText(['Found Footage', 'Explore']);
    await expect(modes.first()).toHaveAttribute('aria-checked', 'true');
    await expect(modes.last()).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#mode-note')).toHaveText('Find the eight notes. Don\'t look at it.');
    // The tape is what's behind the title, and what Start starts.
    expect(await page.evaluate(() => [window.__backrooms.mode, window.__backrooms.footage.prepared])).toEqual(['footage', true]);
});

test.describe('before the script runs', () => {
    test.use({ javaScriptEnabled: false });

    test('the page already has Found Footage first, and picked', async ({ page }) => {
        await page.goto('./');
        const modes = page.locator('#modes [role="radio"]');
        await expect(modes).toHaveText(['Found Footage', 'Explore']);
        await expect(modes.first()).toHaveAttribute('aria-checked', 'true');
        await expect(modes.last()).toHaveAttribute('aria-checked', 'false');
        await expect(page.locator('#mode-note')).toHaveText('Find the eight notes. Don\'t look at it.');
    });
});

test('Explore: Title goes back to the start of the same world, edits and all', async ({ page, browserName }, testInfo) => {
    test.skip(browserName === 'webkit', "Playwright's WebKit can't capture the mouse, so the game can't start");
    await openGame(page, '?seed=7&mode=explore');
    // Far from the start, so the map of where you've been can't overlap the map of the start.
    await page.evaluate(() => window.__backrooms.player.reset(24, -18));
    await start(page);

    // Leave as much behind as a session can: zoomed in, the flashlight on, flying in edit mode, in the middle of a
    // power cut, with a hint waiting, and something built.
    const pillar = await page.evaluate(() => {
        const game = window.__backrooms;
        game._toggleEditMode();
        game.player.position.y += 1;
        game.zoomTarget = 3;
        game._toggleFlashlight();
        game.blackouts.phase = 'out';
        game.blackouts._remaining = 60; // keep it out until Title, independent of random cut duration
        game.toast.show('A hint from before.', 60_000);
        const on = !game.store.pillar(2, 2);
        game.store.setPillar(2, 2, on);
        game.world.refreshCell(2, 2);
        // As if Title were clicked straight after, before the edit is saved.
        clearTimeout(game.store.edits._timer);
        return on;
    });
    await play(page, 3);
    await expect.poll(() => page.evaluate(() => [window.__backrooms.lighting.blackout, window.__backrooms.zoom > 2])).toEqual([1, true]);
    const mapped = await page.evaluate(() => [...window.__backrooms.minimap.seen]);
    expect(mapped.length).toBeGreaterThan(0);

    await pause(page, testInfo);
    const title = page.locator('#quit');
    await expect(title).toBeVisible();
    await title.click();

    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title');
    await expect(page.locator('#start')).toHaveText(/to Start$/);
    await expect(title).toBeHidden();
    await expect(page.locator('#modes [data-mode="explore"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#osd')).toBeHidden();
    await expect(page.locator('#touch')).toBeHidden();
    await expect(page.locator('#toast')).not.toHaveClass(/visible/);
    expect(await leftOver(page)).toEqual(CLEAN);
    // The same world, with what was built still there.
    expect(await page.evaluate(() => [window.__backrooms.seed, window.__backrooms.store.pillar(2, 2), window.__backrooms.store.edits.size])).toEqual([7, pillar, 1]);

    // Start works again, from the beginning: a fresh clock and map, and no leftover hint.
    const restarted = await start(page);
    await expect(page.locator('#osd')).toBeVisible();
    await expect(page.locator('#touch')).toBeVisible({ visible: isTouch(testInfo) });
    await expect(page.locator('#toast').filter({ hasText: 'A hint from before.' })).not.toBeVisible();
    await expectFreshClock(page, restarted);
    await expect.poll(() => page.evaluate(() => window.__backrooms.minimap.store === window.__backrooms.store)).toBe(true);
    expect(await page.evaluate((before) => before.filter((cell) => window.__backrooms.minimap.seen.has(cell)).length, mapped)).toBe(0);

    // Picking the other mode and back on the title screen keeps the edit too.
    await pause(page, testInfo);
    await title.click();
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title');
    await page.locator('#modes [data-mode="footage"]').click();
    await expect.poll(() => page.evaluate(() => window.__backrooms.footage.prepared)).toBe(true);
    await page.locator('#modes [data-mode="explore"]').click();
    await expect.poll(() => page.evaluate(() => window.__backrooms.mode)).toBe('explore');
    expect(await page.evaluate(() => window.__backrooms.store.pillar(2, 2))).toBe(pillar);

    // ...and it was saved, for the next visit.
    await page.reload();
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    expect(await page.evaluate(() => [window.__backrooms.mode, window.__backrooms.store.pillar(2, 2)])).toEqual(['explore', pillar]);
});

test('Found Footage: Title goes back to the same tape, not yet begun', async ({ page, browserName }, testInfo) => {
    test.skip(browserName === 'webkit', "Playwright's WebKit can't capture the mouse, so the game can't start");
    await fakeHeadset(page);
    await openGame(page, '?seed=7&mode=footage');
    await start(page);
    await expect.poll(() => page.evaluate(() => window.__backrooms.footage.active)).toBe(true);

    // A note taken (the lights start to go with it), zoomed in, the flashlight on.
    await page.evaluate(() => {
        const game = window.__backrooms;
        game.footage._take(0, game.footage._viewer);
        game.zoomTarget = 3;
        game._toggleFlashlight();
    });
    await expect(page.locator('#osd-notes-count')).toHaveText('1/8');
    await play(page, 3);
    await expect.poll(() => page.evaluate(() => window.__backrooms.lighting.blackout)).toBeGreaterThan(0);

    await pause(page, testInfo);
    const title = page.locator('#quit');
    await expect(title).toBeVisible();
    await title.click();

    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title');
    await expect(page.locator('#modes [data-mode="footage"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#osd-notes')).toBeHidden();
    await expect(page.locator('#note-view')).not.toHaveClass(/visible/);
    await expect(page.locator('#touch')).toBeHidden();
    expect(await leftOver(page)).toEqual(CLEAN);
    // The same tape, with every note back on the wall.
    expect(await page.evaluate(() => {
        const footage = window.__backrooms.footage;
        return [window.__backrooms.seed, footage.active, footage.prepared, footage.found, footage.noteMeshes.filter((mesh) => mesh.visible).length];
    })).toEqual([7, false, true, 0, 8]);

    // VR can still be started from here (the pretend headset won't, and says so).
    await page.locator('#enter-vr').click();
    await expect(page.locator('#menu-note')).toHaveText(/Couldn't start VR/);
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title');

    // Start begins the tape again from nothing.
    const restarted = await start(page);
    await expect.poll(() => page.evaluate(() => window.__backrooms.footage.active)).toBe(true);
    await expect(page.locator('#osd-notes-count')).toHaveText('0/8');
    await expect(page.locator('#touch')).toBeVisible({ visible: isTouch(testInfo) });
    await expectFreshClock(page, restarted);

    // A new tape from the title screen, after going back to it.
    await pause(page, testInfo);
    await title.click();
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title');
    await page.locator('.menu-links [data-action="new-world"]').click();
    await expect(page.locator('#toast')).toHaveText('New tape.');
    const seed = await page.evaluate(() => window.__backrooms.seed);
    expect(seed).not.toBe(7);
    expect(new URL(page.url()).searchParams.get('seed')).toBe(String(seed));
    expect(new URL(page.url()).searchParams.get('mode')).toBe('footage');
    await start(page);
    await expect.poll(() => page.evaluate(() => window.__backrooms.footage.active)).toBe(true);
});

test('links say which mode they are for', async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Only needs one browser');
    // Explore, opened by someone who has Found Footage picked.
    await openGame(page, '?seed=7&mode=explore');
    expect(await page.evaluate(() => window.__backrooms.mode)).toBe('explore');

    await page.evaluate(() => {
        navigator.clipboard.writeText = async (text) => {
            window.copied = text;
        };
    });
    await page.evaluate(() => window.__backrooms._copyWorldLink());
    const copied = new URL(await page.evaluate(() => window.copied));
    expect([copied.searchParams.get('seed'), copied.searchParams.get('mode')]).toEqual(['7', 'explore']);

    // The address keeps up with a new world, mode and all.
    await page.locator('.menu-links [data-action="new-world"]').click();
    await expect(page.locator('#toast')).toHaveText('Entered a new world.');
    const address = new URL(page.url());
    expect(address.searchParams.get('seed')).toBe(String(await page.evaluate(() => window.__backrooms.seed)));
    expect(address.searchParams.get('mode')).toBe('explore');
    await page.close(); // one game at a time is plenty for a machine with no GPU

    // Whoever opens the copied link gets that world in that mode, whatever they have picked themselves; and the same
    // for a link to a tape.
    const others = await browser.newContext();
    const footagePlayer = await others.newPage();
    await openGame(footagePlayer, copied.search, { world: { mode: 'footage' } });
    expect(await footagePlayer.evaluate(() => [window.__backrooms.mode, window.__backrooms.seed])).toEqual(['explore', 7]);
    await footagePlayer.close();
    const explorePlayer = await others.newPage();
    await openGame(explorePlayer, '?seed=7&mode=footage', { world: { mode: 'explore' } });
    expect(await explorePlayer.evaluate(() => [window.__backrooms.mode, window.__backrooms.seed])).toEqual(['footage', 7]);
    await others.close();
});

// A pretend controller, as in gamepad.spec.js.
const A = 0;
const MENU = 9;
const DOWN = 13;

async function press(page, button) {
    await page.evaluate(pressButton, button);
}

test('a controller can go back to the title and start again', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Only needs one browser');
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
    });
    await openGame(page, '?seed=7&mode=explore');
    await page.evaluate(() => window.__pad.connect());

    await press(page, MENU);
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');
    await press(page, MENU);
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'paused');

    // Down the menu to Title, and A.
    const title = page.locator('#quit');
    for (let i = 0; i < 8 && !(await title.evaluate((el) => el === document.activeElement)); i++) await press(page, DOWN);
    await expect(title).toBeFocused();
    await press(page, A);
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title');
    // The link has gone, and so has the focus, back to Start.
    await expect(title).toBeHidden();
    await expect(page.locator('#start')).toBeFocused();
    await expect(page.locator('#start')).toHaveText('Press A to Start');

    await press(page, A);
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
});

test('Explore can be on any level but Level Fun, and keeps to the one picked', async ({ page }) => {
    await openGame(page, '?mode=explore&seed=3');
    const level = (id) => page.locator(`#levels [data-level="${id}"]`);
    await expect(page.locator('#levels [data-level]')).toHaveCount(3);
    await expect(level(0)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#mode-note')).toHaveText('The endless level.');

    // Picking Level 1 builds it behind the title screen.
    await level(1).click();
    await expect(level(1)).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => page.evaluate(() => [window.__backrooms.level, window.__backrooms.store.level])).toEqual([1, 1]);
    await expect(page).toHaveURL(/level=1/);

    // A tape always starts on Level 0, so Found Footage hides the levels.
    await page.locator('#modes [data-mode="footage"]').click();
    await expect(page.locator('#levels')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__backrooms.store.level)).toBe(0);
    await page.locator('#modes [data-mode="explore"]').click();
    await expect(level(1)).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => page.evaluate(() => window.__backrooms.store.level)).toBe(1);

    // Level Fun isn't one of them: with it on, none is picked, and picking one leaves it.
    await page.evaluate(() => window.__backrooms._konamiCode());
    await expect(page.locator('#levels [aria-checked="true"]')).toHaveCount(0);
    await level(0).click();
    expect(await page.evaluate(() => [window.__backrooms.party, window.__backrooms.level])).toEqual([false, 0]);
});
