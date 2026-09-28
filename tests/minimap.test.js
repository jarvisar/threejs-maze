import { describe, expect, it } from 'vitest';
import { REVEAL_RADIUS, cellKey, markPlace, revealAround } from '../src/ui/Minimap.js';
import { EDGE_NONE, EDGE_WALL } from '../src/world/grid.js';

const open = { edgeBetween: () => EDGE_NONE };

/** A wall between x = 0 and x = 1, for every z at or below `upTo`. */
function wallAlongZ(upTo) {
    return {
        edgeBetween(x, z, dx) {
            const crossing = (x === 0 && dx === 1) || (x === 1 && dx === -1);
            return crossing && z <= upTo ? EDGE_WALL : EDGE_NONE;
        },
    };
}

const has = (seen, x, z) => seen.has(cellKey(x, z));

describe('minimap', () => {
    it('only reveals a couple of cells around you on open floor', () => {
        const seen = new Set();
        revealAround(open, seen, 0, 0);
        // Every cell whose center is within the radius. 21 of them, a small disc.
        expect(seen.size).toBe(21);
        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) expect(has(seen, x, z), `${x},${z}`).toBe(Math.hypot(x, z) <= REVEAL_RADIUS);
        }
    });

    it('reveals a narrow band, not the whole map, while walking', () => {
        const seen = new Set();
        for (let x = 0; x <= 20; x++) revealAround(open, seen, x, 0);
        const rows = new Set([...seen].map((key) => key - Math.round(key / 1048576) * 1048576));
        expect([...rows].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
    });

    it('does not see through walls', () => {
        const seen = new Set();
        revealAround(wallAlongZ(Infinity), seen, 0, 0);
        for (const key of seen) expect(Math.round(key / 1048576)).toBeLessThanOrEqual(0);
    });

    it('wraps round the end of a wall', () => {
        const seen = new Set();
        revealAround(wallAlongZ(0), seen, 0, 0);
        expect(has(seen, 1, 1)).toBe(true);
        // Straight through the wall, but reachable by going around it.
        expect(has(seen, 1, 0)).toBe(true);
        // Around the wall's end, but too far back to reach.
        expect(has(seen, 1, -2)).toBe(false);
    });

    it('marks what it is given where it is, turned with the map, or on the edge in its direction', () => {
        const half = 100;
        // Two cells straight ahead (−z), facing that way. Above the middle.
        const [ax, ay, aEdge] = /** @type {[number, number, boolean]} */ (markPlace(0, -2, 0, half));
        expect(ax).toBeCloseTo(half, 6);
        expect(ay).toBeLessThan(half - 20);
        expect(aEdge).toBe(false);
        // Turned to face it, off to the left along −x. Above the middle again.
        const [bx, by] = /** @type {[number, number, boolean]} */ (markPlace(-2, 0, Math.PI / 2, half));
        expect(bx).toBeCloseTo(half, 6);
        expect(by).toBeCloseTo(ay, 6);
        // To the right of someone facing −z.
        expect(markPlace(2, 0, 0, half)?.[0]).toBeGreaterThan(half + 20);

        // Far off, ahead and to the right. On the edge in that direction, inside the map.
        const [cx, cy, cEdge] = /** @type {[number, number, boolean]} */ (markPlace(30, -30, 0, half));
        expect(cEdge).toBe(true);
        expect(cx - half).toBeCloseTo(half - cy, 6);
        expect(cx).toBeGreaterThan(half * 1.8);
        expect(cx).toBeLessThan(half * 2);
        // Or not at all.
        expect(markPlace(30, -30, 0, half, false)).toBeNull();
    });
});
