import { describe, expect, it } from 'vitest';
import { REVEAL_RADIUS, cellKey, revealAround } from '../src/ui/Minimap.js';
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
        // Every cell whose centre is within the radius: 21 of them, a small disc.
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
        // Straight through the wall, but reachable by going round it.
        expect(has(seen, 1, 0)).toBe(true);
        // Round it and too far back down.
        expect(has(seen, 1, -2)).toBe(false);
    });
});
