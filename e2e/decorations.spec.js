import { test, expect } from '@playwright/test';

// Edit mode is for a keyboard and mouse (or a controller), so this runs at the desktop sizes.
test.beforeEach(async ({ browserName }, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, 'edit mode needs a keyboard and mouse');
    test.skip(browserName === 'webkit', "Playwright's WebKit can't capture the mouse, so the game can't start");
});

/**
 * Starts the endless level, drawn as cheaply as possible (see layout.spec.js), with the game object to hand
 * as window.__backrooms.
 * @param {import('@playwright/test').Page} page
 */
async function play(page) {
    await page.addInitScript(() => localStorage.setItem('backrooms-simulator:settings:v1', JSON.stringify({ version: 5, graphics: { resolutionScale: 30, dynamicLights: false, ambientOcclusion: false } })));
    await page.goto('./?seed=1&mode=explore&debug');
    await page.addStyleTag({ content: '.menu { backdrop-filter: none !important; }' });
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    await page.locator('#start').click();
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');
}

/** Bounding boxes of the visible (and not transparent) elements matching each selector. */
function boxes(page, selectors) {
    return page.evaluate((selectors) => selectors.flatMap((selector) => [...document.querySelectorAll(selector)]
        .filter((el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
        .map((el) => {
            const r = el.getBoundingClientRect();
            return { selector, text: el.textContent.trim().slice(0, 30), left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height };
        })), selectors);
}

async function click(page, button) {
    await page.mouse.down({ button });
    await page.mouse.up({ button });
}

/**
 * The tool strip is inside the screen and clear of everything else on it (the zoom bar, in the same place, is hidden
 * in edit mode), in two rows at most, and big enough to read.
 */
async function expectStripFits(page) {
    const viewport = page.viewportSize();
    const overlay = await boxes(page, ['.osd-top-left', '#osd-battery', '#osd-date', '#minimap', '#coordinates', '#osd-zoom', '#osd-tools']);
    expect(overlay.map((box) => box.selector)).not.toContain('#osd-zoom');
    for (const box of [...overlay, ...await boxes(page, ['#osd-tools span'])]) {
        const where = `${box.selector} "${box.text}" at ${Math.round(box.left)},${Math.round(box.top)}–${Math.round(box.right)},${Math.round(box.bottom)}`;
        expect(box.left, where).toBeGreaterThanOrEqual(0);
        expect(box.top, where).toBeGreaterThanOrEqual(0);
        expect(box.right, where).toBeLessThanOrEqual(viewport.width);
        expect(box.bottom, where).toBeLessThanOrEqual(viewport.height);
    }
    for (let i = 0; i < overlay.length; i++) {
        for (let j = i + 1; j < overlay.length; j++) {
            const [a, b] = [overlay[i], overlay[j]];
            const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
            expect(apart, `${a.selector} overlaps ${b.selector}`).toBe(true);
        }
    }
    const [stripBox] = overlay.filter((box) => box.selector === '#osd-tools');
    const [tool] = await boxes(page, ['#osd-tools span.on']);
    expect(stripBox.height).toBeLessThan(tool.height * 2.8);
    expect(await page.locator('#osd-tools span.on').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
}

test('the tool strip goes through every tool, a level\'s things a few at a time, and fits the screen', async ({ page }) => {
    await play(page);
    await page.keyboard.press('x');
    const strip = page.locator('#osd-tools');
    await expect(strip).toBeVisible();
    // What's built, then the levels' things, folded away.
    await expect(strip.locator('.osd-tool-row .osd-tool-group').nth(0).locator('span')).toHaveText(['wall', 'doorway', 'pillar', 'outlet', 'light']);
    await expect(strip.locator('.osd-tool-section')).toHaveText(['Levels']);
    await expect(strip.locator('.osd-tool-open')).toHaveCount(0);

    // The wheel goes through every one, either way, opening each level's as it gets there: a few of them at a time.
    const current = strip.locator('span.on');
    const open = strip.locator('.osd-tool-section.open');
    const shown = strip.locator('.osd-tool-open span');
    await expect(current).toHaveText('wall');
    for (const tool of ['doorway', 'pillar', 'outlet', 'light', 'chair']) {
        await page.mouse.wheel(0, 120);
        await expect(current).toHaveText(tool);
    }
    await expect(open).toHaveText('Level 0');
    await expect(shown).toHaveText(['chair', 'monitor', 'bottles', 'sign', 'tv', 'camcorder', 'lamp']);
    await expect(strip.locator('.osd-tool-more.before')).toBeHidden();
    await expect(strip.locator('.osd-tool-more.after')).toBeVisible();
    await page.mouse.wheel(0, -120);
    await expect(current).toHaveText('light');
    await expect(open).toHaveCount(0);
    await page.mouse.wheel(0, 120);
    await expect(current).toHaveText('chair');

    // The last of the longest (from the catalogue): inside the screen and clear of everything else on it, in two rows
    // at most.
    await page.keyboard.press('Tab');
    for (let i = 0; i < 4; i++) await page.keyboard.press('e');
    await expect(page.locator('#catalogue [role="tab"][aria-selected="true"]')).toHaveText('Level 5');
    for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(current).toHaveText('portrait');
    await expect(open).toHaveText('Level 5');
    await expect(shown).toHaveCount(7);
    await expect(strip.locator('.osd-tool-more.before')).toBeVisible();
    await expect(strip.locator('.osd-tool-more.after')).toBeHidden();
    await expectStripFits(page);
});

test('Tab opens everything there is to build, a page to each level, and what\'s chosen is taken up', async ({ page }) => {
    await play(page);
    await page.keyboard.press('x');
    const catalogue = page.locator('#catalogue');
    const tab = catalogue.locator('[role="tab"][aria-selected="true"]');
    const items = catalogue.locator('.catalogue-item');
    await page.keyboard.press('Tab');
    await expect(catalogue).toBeVisible();
    await expect(catalogue.locator('[role="tab"]')).toHaveText(['Walls', 'Level 0', 'Level 1', 'Level 2', 'Level 4', 'Level 5', 'Level 37']);
    // On the page with what's in hand, picked out.
    await expect(tab).toHaveText('Walls');
    await expect(items).toHaveText(['wall', 'doorway', 'pillar', 'outlet', 'light']);
    await expect(catalogue.locator('.catalogue-item.selected')).toHaveAttribute('data-tool', 'wall');
    // Each with its picture, with something drawn in it.
    const drawn = () => page.evaluate(() => [...document.querySelectorAll('#catalogue .catalogue-item canvas')].map((canvas) => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let solid = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) solid++;
        return solid > 200;
    }));
    await expect.poll(drawn).toEqual([true, true, true, true, true]);

    // E to the next page, the arrows round it, Enter to take it up.
    await page.keyboard.press('e');
    await expect(tab).toHaveText('Level 0');
    await expect(items).toHaveCount(8);
    expect((await drawn()).every(Boolean)).toBe(true);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(catalogue).toBeHidden();
    await expect(page.locator('#osd-tools span.on')).toHaveText('bottles');

    // Open again: back on that page, with it picked out. Q goes back a page, round to the last; Tab closes it.
    await page.keyboard.press('Tab');
    await expect(tab).toHaveText('Level 0');
    await expect(catalogue.locator('.catalogue-item.selected')).toHaveAttribute('data-tool', 'bottles');
    await page.keyboard.press('q');
    await page.keyboard.press('q');
    await expect(tab).toHaveText('Level 37');
    // (It fits the screen.)
    const viewport = page.viewportSize();
    const panel = await catalogue.locator('.catalogue-panel').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width);
    expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Tab');
    await expect(catalogue).toBeHidden();
    await expect(page.locator('#osd-tools span.on')).toHaveText('bottles');
});

test('Level Fun\'s things are in edit mode once it has been found, and the strip still fits', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('backrooms-simulator:level-fun:v1', '1'));
    await play(page);
    await page.keyboard.press('x');
    const strip = page.locator('#osd-tools');
    await expect(strip.locator('.osd-tool-section')).toHaveText(['Levels']);
    // The last page of the catalogue.
    await page.keyboard.press('Tab');
    await page.keyboard.press('q');
    await expect(page.locator('#catalogue [role="tab"][aria-selected="true"]')).toHaveText('Level Fun');
    await expect(page.locator('#catalogue .catalogue-item')).toHaveText(['cake', 'presents', 'hat', 'balloons', 'partygoer']);
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(strip.locator('span.on')).toHaveText('partygoer');
    await expect(strip.locator('.osd-tool-section.open')).toHaveText('Level Fun');
    await expect(strip.locator('.osd-tool-open span')).toHaveText(['cake', 'presents', 'hat', 'balloons', 'partygoer']);
    await expectStripFits(page);
});

test('puts a decoration down where the preview shows it, keeps it, and takes it away again', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Only needs one screen size');
    await play(page);
    await page.keyboard.press('x');
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 120);
    await expect(page.locator('#osd-tools span.on')).toHaveText('chair');

    // Looking down at the floor a step ahead, in the empty room you start in.
    await page.evaluate(() => {
        window.__backrooms.look.yaw = 0.2;
        window.__backrooms.look.pitch = -0.45;
    });
    const preview = await (await page.waitForFunction(() => {
        const { target, shapes } = window.__backrooms.editTool;
        if (target?.kind !== 'prop' || target.current || !shapes.prop.visible) return null;
        const { type, x, z, yaw, variant } = target.prop;
        return { type, x, z, yaw, variant, cellX: target.x, cellZ: target.z };
    })).jsonValue();
    const { cellX, cellZ, ...prop } = preview;
    const propsHere = () => page.evaluate(([x, z]) => window.__backrooms.store.propsAt(x, z)
        .map(({ type, x, z, yaw, variant }) => ({ type, x, z, yaw, variant })), [cellX, cellZ]);
    const meshSize = () => page.evaluate(() => window.__backrooms.world.chunks.get(0).props?.geometry.attributes.position.count ?? 0);
    expect(await propsHere()).toEqual([]);
    const emptyMesh = await meshSize();

    // Right click: exactly what the preview showed is in the chunk, drawn, solid, and saved with the world.
    await click(page, 'right');
    await expect.poll(propsHere).toEqual([prop]);
    expect(await meshSize()).toBeGreaterThan(emptyMesh);
    expect(await page.evaluate(({ x, z }) => window.__backrooms.store.boxesNear(x - 0.2, z - 0.2, x + 0.2, z + 0.2)
        .some((box) => box[0] < x && box[2] > x && box[1] < z && box[3] > z), prop)).toBe(true);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('backrooms-simulator:edits:1'))).toContain('props');
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('backrooms-simulator:edits:1')));
    expect(Object.values(saved.props)).toEqual([{ removed: [], added: [[prop.type, prop.x, prop.z, prop.yaw, prop.variant]] }]);

    // Placement can shift the chair away from the floor ray to clear a wall or corner. Aim at the chair itself.
    await page.evaluate(({ x, z }) => {
        const { camera, look } = window.__backrooms;
        const dx = x - camera.position.x;
        const dz = z - camera.position.z;
        look.yaw = Math.atan2(-dx, -dz);
        look.pitch = Math.atan2(0.15 - camera.position.y, Math.hypot(dx, dz));
    }, prop);
    await page.waitForFunction(() => window.__backrooms.editTool.target?.kind === 'prop' && window.__backrooms.editTool.target.current);
    await click(page, 'left');
    await expect.poll(propsHere).toEqual([]);
    expect(await meshSize()).toBe(emptyMesh);
    expect(await page.evaluate(() => window.__backrooms.store.edits.size)).toBe(0);
});
