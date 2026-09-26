import { test, expect } from '@playwright/test';

test('swim', async ({ page }) => {
    page.on('console', (m) => console.log('PAGE', m.text()));
    await page.addInitScript(() => localStorage.setItem('backrooms-simulator:settings:v1', JSON.stringify({ version: 3, graphics: { resolutionScale: 30, dynamicLights: false } })));
    await page.goto('./?seed=1&mode=explore&level=2&debug');
    await page.addStyleTag({ content: '.menu { backdrop-filter: none !important; }' });
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'title', { timeout: 60_000 });
    await page.locator('#start').click();
    await expect(page.locator('#menu')).toHaveAttribute('data-state', 'hidden');

    const spot = await page.evaluate(() => {
        const g = window.__backrooms;
        for (let r = 0; r < 30; r++) {
            for (let x = -r; x <= r; x++) {
                for (let z = -r; z <= r; z++) {
                    let deep = true;
                    for (const [a, b] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) if (g.store.groundAt(x + a, z + b) > -0.7) deep = false;
                    if (deep) {
                        g.player.reset(x, z);
                        return { x, z, level: g.store.level, terrain: !!g.terrain, floor: g.store.groundAt(x, z) };
                    }
                }
            }
        }
        return null;
    });
    console.log('SPOT', JSON.stringify(spot));
    const sample = () => page.evaluate(() => {
        const p = window.__backrooms.player;
        return `y=${p.position.y.toFixed(3)} floor=${p.floor.toFixed(3)} swim=${p.swimming} vy=${p.velocity.y.toFixed(4)} state=${window.__backrooms.state} held=${[...window.__backrooms.keyboard.held]}`;
    });
    for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(250);
        console.log('FLOAT', await sample());
    }
    // Dive with E, then hold Space.
    await page.keyboard.down('KeyE');
    for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(250);
        console.log('DIVE', await sample());
    }
    await page.keyboard.up('KeyE');
    await page.keyboard.down('Space');
    for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(250);
        console.log('SPACE', await sample());
    }
    await page.keyboard.up('Space');
});
