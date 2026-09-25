import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { RELEASES_URL } from '../policy.js';

// Update checks against a feed served from here instead of GitHub. Packaged builds only (BACKROOMS_APP): a build
// run from the repository never checks. Builds that aren't installed can't update themselves, so these all take the
// 'notify' path: the menu links to the download page.

// resolve(): a path with both kinds of slash (as CI passes it) doesn't start on Windows.
const packaged = process.env.BACKROOMS_APP && resolve(process.env.BACKROOMS_APP);
test.skip(!packaged, 'update checks only happen in packaged builds; set BACKROOMS_APP');

/** The version the feed says is out, or null for a feed that answers nothing. */
let feedVersion = null;
let server;
let feedUrl;

test.beforeAll(async () => {
    server = createServer((request, response) => {
        // latest.yml (Windows), latest-linux.yml, latest-mac.yml: the same answer for all.
        // (electron-updater adds a query string, to get past caches.)
        if (feedVersion && /^\/latest(-\w+)?\.yml$/.test(new URL(request.url, 'http://localhost').pathname)) {
            response.writeHead(200, { 'Content-Type': 'text/yaml' });
            response.end([
                `version: ${feedVersion}`,
                'files:',
                `  - url: Backrooms-Simulator-${feedVersion}.zip`,
                '    sha512: AAAA',
                '    size: 1',
                `path: Backrooms-Simulator-${feedVersion}.zip`,
                'sha512: AAAA',
                "releaseDate: '2026-01-01T00:00:00.000Z'",
            ].join('\n'));
        } else {
            response.writeHead(404).end();
        }
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    feedUrl = `http://127.0.0.1:${server.address().port}/`;
});

test.afterAll(() => server?.close());

/** Starts the app against the given feed, and returns it with its page, its log and what links it opened. */
async function launch(feed) {
    const userData = mkdtempSync(join(tmpdir(), 'backrooms-updates-'));
    const env = { ...process.env, BACKROOMS_USER_DATA: userData, BACKROOMS_UPDATE_FEED: feed };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
        executablePath: packaged,
        args: ['--windowed', ...(process.env.CI ? ['--enable-unsafe-swiftshader'] : [])],
        env,
    });
    await app.evaluate(({ shell }) => {
        globalThis.opened = [];
        shell.openExternal = async (url) => {
            globalThis.opened.push(url);
        };
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 90_000 });
    const log = () => readFileSync(join(userData, 'desktop.log'), 'utf8');
    const close = async () => {
        await app.close();
        rmSync(userData, { recursive: true, force: true });
    };
    return { app, page, errors, log, close };
}

test('a newer version shows up in the menu and links to the download page', async () => {
    feedVersion = '99.0.0';
    const { app, page, errors, close } = await launch(feedUrl);
    const link = page.locator('[data-action="update"]');
    await expect(link).toHaveText('New version 99.0.0', { timeout: 30_000 });
    await expect(link).toBeVisible();
    await link.click();
    await expect.poll(() => app.evaluate(() => globalThis.opened)).toEqual([RELEASES_URL]);
    expect(errors).toEqual([]);
    await close();
});

test('the same version shows nothing', async () => {
    // Packaged builds take their version from the root package.json.
    feedVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
    const { page, errors, log, close } = await launch(feedUrl);
    await expect.poll(log, { timeout: 30_000 }).toMatch(/not available/);
    await expect(page.locator('[data-action="update"]')).toBeHidden();
    expect(errors).toEqual([]);
    await close();
});

test('a check that fails leaves the game alone', async () => {
    feedVersion = null; // every request gets a 404, as from a release missing its latest*.yml
    const { page, errors, log, close } = await launch(feedUrl);
    await expect.poll(log, { timeout: 30_000 }).toMatch(/\[updates\] Check failed/);
    await expect(page.locator('[data-action="update"]')).toBeHidden();
    await expect(page.locator('#start')).toBeVisible();
    expect(errors).toEqual([]);
    await close();
});
