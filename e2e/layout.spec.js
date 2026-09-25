import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

// Apple and Google both recommend about this much for anything a finger has to hit.
const MIN_TOUCH_TARGET = 44;

/**
 * Opens the title screen, drawn as cheaply as possible: CI has no GPU, and at desktop sizes the game behind the menus
 * and the menu's blur leave the page so busy that every click takes seconds. Shader effects are off too; these
 * settings leave the layout being checked unchanged.
 * @param {import('@playwright/test').Page} page
 * @param {'footage' | 'explore'} [mode] What Start starts: Found Footage, as on a first visit, if left out.
 */
async function openGame(page, mode = 'footage') {
    await page.addInitScript(() => localStorage.setItem('backrooms-simulator:settings:v1', JSON.stringify({ version: 3, graphics: { resolutionScale: 30, dynamicLights: false }, effects: { enabled: false } })));
    await page.goto(`./?seed=1&mode=${mode}`);
    await page.addStyleTag({ content: '.menu { backdrop-filter: none !important; }' });
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
}

/**
 * Bounding boxes of the visible elements matching each selector (hidden ones are left out).
 * @param {import('@playwright/test').Page} page
 * @param {string[]} selectors
 */
function boxes(page, selectors) {
    return page.evaluate((selectors) => selectors.flatMap((selector) => [...document.querySelectorAll(selector)]
        .filter((el) => el.checkVisibility({ visibilityProperty: true }))
        .map((el) => {
            const r = el.getBoundingClientRect();
            return { selector, text: el.textContent.trim().slice(0, 30), left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        })), selectors);
}

async function expectInsideViewport(page, selectors) {
    expectBoxesInside(await boxes(page, selectors), page.viewportSize());
}

function expectBoxesInside(all, viewport) {
    for (const box of all) {
        const where = `${box.selector} "${box.text}" at ${Math.round(box.left)},${Math.round(box.top)}–${Math.round(box.right)},${Math.round(box.bottom)}`;
        expect(box.left, where).toBeGreaterThanOrEqual(-0.5);
        expect(box.top, where).toBeGreaterThanOrEqual(-0.5);
        expect(box.right, where).toBeLessThanOrEqual(viewport.width + 0.5);
        expect(box.bottom, where).toBeLessThanOrEqual(viewport.height + 0.5);
    }
}

async function expectNoOverlap(page, selectors) {
    expectBoxesApart(await boxes(page, selectors));
}

function expectBoxesApart(all) {
    for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
            const a = all[i];
            const b = all[j];
            const overlaps = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
            expect(overlaps, `${a.selector} "${a.text}" overlaps ${b.selector} "${b.text}"`).toBe(false);
        }
    }
}

async function expectTouchTargets(page, selectors) {
    for (const box of await boxes(page, selectors)) {
        const what = `${box.selector} "${box.text}" is ${Math.round(box.width)}x${Math.round(box.height)}`;
        expect(box.width, what).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET - 0.5);
        expect(box.height, what).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET - 0.5);
    }
}

async function expectNoHorizontalScroll(page) {
    const { scrollWidth, width } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(width);
}

/** Elements whose content is wider than they are (cut off or spilling out). */
function horizontalOverflow(page, selector) {
    return page.evaluate((selector) => [...document.querySelectorAll(selector)]
        .filter((el) => el.checkVisibility() && el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.textContent.trim().slice(0, 40)} (${el.scrollWidth} > ${el.clientWidth})`), selector);
}

async function expectNoAccessibilityViolations(page, what) {
    const results = await new AxeBuilder({ page }).analyze();
    const violations = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
    expect(violations, `accessibility problems on the ${what}`).toEqual([]);
}

const isTouch = (testInfo) => !!testInfo.project.use.hasTouch;

test('uses touch controls only on touch screens', async ({ page }, testInfo) => {
    await openGame(page);
    await expect(page.locator('html')).toHaveAttribute('data-input', isTouch(testInfo) ? 'touch' : 'mouse');
    await expect(page.locator('#start')).toHaveText(isTouch(testInfo) ? 'Tap to Start' : 'Click to Start');
});

test('title screen fits the screen', async ({ page }, testInfo) => {
    await openGame(page);
    // Pretend the browser offers to install the game, so the title screen is checked with the install offer showing.
    await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: async () => {} })));
    await expect(page.locator('#install-offer')).toBeVisible();
    await expectNoHorizontalScroll(page);
    const items = ['.title', '#start', '.menu-links .link', '.github', '#coordinates', '#install-offer'];
    await expectInsideViewport(page, items);
    await expectNoOverlap(page, items);

    // Each link stays on one line ("[ Settings ]", never "[" on one line and "Settings ]" on the next).
    for (const box of await boxes(page, ['.menu-links .link'])) {
        expect(box.height, `"${box.text}" wrapped`).toBeLessThan(isTouch(testInfo) ? MIN_TOUCH_TARGET * 1.5 : 40);
    }
    if (isTouch(testInfo)) await expectTouchTargets(page, ['#start', '.menu-links .link', '#install-offer .link']);
});

test('every settings page fits and can be scrolled to the end', async ({ page }, testInfo) => {
    await openGame(page);
    await page.locator('[data-action="settings"]').click();
    const panel = page.locator('#settings');
    await expect(panel).toBeVisible();

    const tabs = panel.getByRole('tab');
    const count = await tabs.count();
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count; i++) {
        await tabs.nth(i).click();
        await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
        await expectInsideViewport(page, ['#settings', '#settings .tab', '#settings [data-action="back"]']);
        await expectNoHorizontalScroll(page);
        expect(await horizontalOverflow(page, '#settings .row, #settings .rows, #settings .panel-header'), `page ${i}`).toEqual([]);

        // The last row can be scrolled into view inside the list.
        const last = panel.locator('.row').last();
        await last.scrollIntoViewIfNeeded();
        const list = await panel.locator('.rows').boundingBox();
        const row = await last.boundingBox();
        expect(row.y).toBeGreaterThanOrEqual(list.y - 0.5);
        expect(row.y + row.height).toBeLessThanOrEqual(list.y + list.height + 0.5);

        if (isTouch(testInfo)) await expectTouchTargets(page, ['#settings .tab', '#settings .arrow', '#settings [data-action="back"]']);
    }

    // Nothing from the title screen sits on top of the panel.
    await expectNoOverlap(page, ['#settings', '.github', '#coordinates']);
});

test('controls page fits and shows the right controls', async ({ page }, testInfo) => {
    await openGame(page);
    // With a controller connected, so its table is checked too (PlayStation's button names are the longest).
    await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: { id: 'DualSense Wireless Controller' } })));
    await page.locator('[data-action="controls"]').click();
    const panel = page.locator('#controls');
    await expect(panel).toBeVisible();
    await expectInsideViewport(page, ['#controls', '#controls [data-action="back"]']);
    await expectNoHorizontalScroll(page);
    expect(await horizontalOverflow(page, '#controls .panel-scroll, #controls .keys')).toEqual([]);
    await expect(panel.locator('.keys-controller')).toBeVisible();
    await expect(panel.locator('.keys-touch')).toBeVisible({ visible: isTouch(testInfo) });
    await expect(panel.locator('.keys-keyboard')).toBeVisible();
    await expectNoOverlap(page, ['#controls', '.github', '#coordinates']);
    if (isTouch(testInfo)) await expectTouchTargets(page, ['#controls [data-action="back"]']);
});

test('in-game overlay fits the screen and nothing overlaps', async ({ page, browserName }, testInfo) => {
    test.skip(browserName === 'webkit', "Playwright's WebKit can't capture the mouse, so the game can't start");
    // Explore, for edit mode.
    await openGame(page, 'explore');
    await page.locator('#start').click();
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');
    await expect(page.locator('#osd')).toBeVisible();

    if (isTouch(testInfo)) {
        // The walking/looking hint shows a second into play.
        await expect(page.locator('#toast.visible')).toBeVisible({ timeout: 5_000 });
    } else {
        // Edit mode has the longest message, and puts the tool strip at the top.
        await page.keyboard.press('x');
        await expect(page.locator('#toast.visible')).toContainText('Edit mode enabled');
        await expect(page.locator('#osd-tools')).toBeVisible();
    }

    // One snapshot of everything, so the toast can't fade out halfway through the checks.
    const overlay = await boxes(page, ['.osd-top-left', '#osd-battery', '#osd-date', '#osd-tools', '#minimap', '#coordinates', '#toast', '.touch-button']);
    const toast = overlay.find((box) => box.selector === '#toast');
    expect(toast, 'toast still showing').toBeDefined();
    expectBoxesInside(overlay, page.viewportSize());
    expectBoxesApart(overlay);
    await expectNoHorizontalScroll(page);
    // The toast uses the width it has instead of squeezing into a narrow column.
    expect(toast.height, 'toast is taller than five lines').toBeLessThan(200);
    if (isTouch(testInfo)) await expectTouchTargets(page, ['.touch-button']);

    // Pretend the browser offers to install the game, so the pause menu is checked with its Install link.
    await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: async () => {} })));

    // Pause the way a player would.
    if (isTouch(testInfo)) await page.locator('.touch-pause').click();
    else await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'paused');
    await expect(page.locator('#start')).toHaveText(/to Resume$/);
    await expect(page.locator('[data-action="install"]')).toBeVisible();
    await expect(page.locator('#quit')).toBeVisible();
    await expectInsideViewport(page, ['#start', '.menu-links .link', '.osd-top-left', '#osd-date', '#minimap']);
    await expectNoOverlap(page, ['#start', '.menu-links .link', '.osd-top-left', '#osd-battery', '#osd-date', '#minimap', '#coordinates']);
});

test('menus have no accessibility problems', async ({ page }) => {
    await openGame(page);
    await expectNoAccessibilityViolations(page, 'title screen');

    await page.locator('[data-action="settings"]').click();
    const tabs = page.locator('#settings').getByRole('tab');
    for (let i = 0; i < await tabs.count(); i++) {
        await tabs.nth(i).click();
        await expectNoAccessibilityViolations(page, `settings page ${i + 1}`);
    }
    await page.keyboard.press('Escape');

    await page.locator('[data-action="controls"]').click();
    await expectNoAccessibilityViolations(page, 'controls page');
});

test('settings can be used with just the keyboard', async ({ page }, testInfo) => {
    test.skip(isTouch(testInfo), 'keyboard test runs on the desktop sizes');
    await openGame(page);

    // Tab reaches the menu links; Enter opens one.
    await page.locator('#start').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-action="settings"]')).toBeFocused();
    await page.keyboard.press('Enter');

    // Focus lands on the highlighted row, which says what it is and what it's set to.
    const focused = page.locator('#settings .row:focus');
    await expect(focused).toHaveAttribute('role', 'slider');
    await expect(focused).toHaveAttribute('aria-label', 'Resolution');
    const before = await focused.getAttribute('aria-valuetext');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#settings .row:focus')).not.toHaveAttribute('aria-valuetext', before);

    // Down to a switch, and flip it.
    await page.keyboard.press('ArrowDown');
    const toggle = page.locator('#settings .row:focus');
    await expect(toggle).toHaveAttribute('role', 'switch');
    const checked = await toggle.getAttribute('aria-checked');
    await page.keyboard.press('Enter');
    await expect(page.locator('#settings .row:focus')).toHaveAttribute('aria-checked', checked === 'true' ? 'false' : 'true');

    // Tab goes to the next page, keeping focus in the list.
    await page.keyboard.press('Tab');
    await expect(page.locator('#settings-tab-1')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#settings .row:focus')).toHaveCount(1);

    // Escape goes back, with focus on the start button.
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings')).toBeHidden();
    await expect(page.locator('#start')).toBeFocused();
});
