import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// Loads the game in the desktop app, the way a player would start it, and checks the parts of the wrapper the web
// app relies on. Needs the web build: run it with `npm run desktop:test` from the repository root, which builds first.

// No trailing slash: on Windows, a quoted argument ending in a backslash swallows its closing quote.
const appDir = dirname(fileURLToPath(new URL('.', import.meta.url)));

/** @type {import('@playwright/test').ElectronApplication} */
let app;
/** @type {import('@playwright/test').Page} */
let page;
let userData;
const problems = [];
const requests = [];

test.beforeAll(async () => {
    userData = mkdtempSync(join(tmpdir(), 'backrooms-desktop-'));
    // resolve(): a path with both kinds of slash (as CI passes it) doesn't start on Windows.
    const packaged = process.env.BACKROOMS_APP && resolve(process.env.BACKROOMS_APP);
    // No update checks here: test/updates.spec.js has those.
    const env = { ...process.env, BACKROOMS_USER_DATA: userData, BACKROOMS_UPDATE_FEED: 'off' };
    // Set in VS Code's own processes; with it, Electron starts as plain Node.
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
        executablePath: packaged || electronPath,
        // CI machines have no GPU; this lets Chromium draw WebGL in software there.
        args: [...(packaged ? [] : [appDir]), '--windowed', ...(process.env.CI ? ['--enable-unsafe-swiftshader'] : [])],
        env,
    });
    // Nothing leaves the machine: links would open in the browser, so record them instead.
    await app.evaluate(({ shell }) => {
        globalThis.opened = [];
        shell.openExternal = async (url) => {
            globalThis.opened.push(url);
        };
    });
    page = await app.firstWindow();
    page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
    page.on('request', (request) => requests.push(request.url()));
});

test.afterAll(async () => {
    await app?.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
});

test('loads to the title screen from the bundled build', async () => {
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 90_000 });
    expect(await page.title()).toBe('Backrooms Simulator');
    expect(await page.evaluate(() => location.origin)).toBe('app://backrooms');
});

test('everything comes from the app itself', async () => {
    const outside = requests.filter((url) => !/^(app:|data:|blob:|devtools:)/.test(url));
    expect(outside).toEqual([]);
});

test('no errors or blocked content on the way', async () => {
    expect(problems).toEqual([]);
});

test('the page has the desktop bridge and no service worker', async () => {
    const bridge = await page.evaluate(() => {
        const desktop = window.backroomsDesktop;
        return desktop && { version: desktop.version, quit: typeof desktop.quit, fullscreen: typeof desktop.isFullscreen() };
    });
    expect(bridge).toEqual({ version: expect.stringMatching(/^\d+\.\d+\.\d+/), quit: 'function', fullscreen: 'boolean' });
    // The game registers its service worker on load; the app has every file already, so it doesn't.
    expect(requests.filter((url) => url.endsWith('/sw.js'))).toEqual([]);
});

test('the menu has Quit and no Install', async () => {
    await expect(page.locator('[data-action="quit-app"]')).toBeVisible();
    await expect(page.locator('.menu-links [data-action="install"]')).toBeHidden();
});

test('links open in the browser, not in the game window', async () => {
    await page.locator('a.github').click();
    await expect.poll(() => app.evaluate(() => globalThis.opened)).toEqual(['https://github.com/jarvisar/threejs-maze/']);
    expect(app.windows()).toHaveLength(1);
});

test('the window goes full screen and back without a click', async () => {
    // X servers on CI machines have no window manager to go full screen with.
    test.skip(!!process.env.CI && process.platform === 'linux', 'no window manager');
    const fullscreen = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
    await page.evaluate(() => window.backroomsDesktop.setFullscreen(true));
    await expect.poll(fullscreen).toBe(true);
    await expect.poll(() => page.evaluate(() => window.backroomsDesktop.isFullscreen())).toBe(true);
    await page.evaluate(() => window.backroomsDesktop.setFullscreen(false));
    await expect.poll(fullscreen).toBe(false);
});

test('plays, and saves stills to Pictures without asking', async () => {
    // Capturing the mouse needs a window manager too.
    test.skip(!!process.env.CI && process.platform === 'linux', 'no window manager');
    const pictures = join(userData, 'Pictures');
    await app.evaluate(({ app }, folder) => app.setPath('pictures', folder), pictures);
    // A window opened by the test isn't focused the way one opened by a player is, and the mouse can't be captured without it.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page.locator('#start').click();
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');
    await page.waitForTimeout(1000);
    await page.keyboard.press('p');
    const folder = join(pictures, 'Backrooms Simulator');
    await expect.poll(() => (existsSync(folder) ? readdirSync(folder) : [])).toEqual([expect.stringMatching(/^backrooms-.*\.png$/)]);
    expect(problems).toEqual([]);
});

test('Quit closes the app', async () => {
    const closed = app.waitForEvent('close');
    // Back to the menu if the last test left it playing (as Esc would).
    await page.evaluate(() => document.exitPointerLock());
    await page.locator('[data-action="quit-app"]').click();
    await closed;
});
