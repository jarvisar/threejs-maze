import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, HALF_CHUNK, PLAYER_RADIUS } from '../src/config.js';
import { moveAndCollide } from '../src/player/collision.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { PROP_BOTTLES, PROP_NAMES, PROP_SIGN, PROP_SOLID_HALF, PROP_TILE, tileFell } from '../src/world/decorations.js';
import { failingLightAt } from '../src/world/peels.js';
import { generateChunk } from '../src/world/generator.js';

const N = CHUNK_SIZE;

/** Every chunk in a square of chunks around the origin, for a few seeds. */
function* chunks(seeds = 12, reach = 3) {
    for (let seed = 0; seed < seeds; seed++) {
        for (let cx = -reach; cx <= reach; cx++) {
            for (let cz = -reach; cz <= reach; cz++) yield generateChunk(seed, cx, cz);
        }
    }
}

describe('decorations', () => {
    it('are the same every time for the same seed', () => {
        const a = generateChunk(7, 2, -3);
        const b = generateChunk(7, 2, -3);
        expect(a.props).toEqual(b.props);
        expect(a.leaks).toEqual(b.leaks);
    });

    it('did not change the walls of existing worlds', () => {
        // The layout is generated before the decorations draw on the random stream, so a seed shared before
        // they existed still leads to the same level.
        const chunk = generateChunk(42, 3, -7);
        expect(Array.from(chunk.edgesX).slice(0, 40)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1]);
        expect(Array.from(chunk.edgesZ).slice(100, 140)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0]);
    });

    it('are rare', () => {
        let props = 0;
        let leaks = 0;
        let count = 0;
        for (const chunk of chunks(20)) {
            props += chunk.props.length;
            leaks += chunk.leaks.length;
            count++;
        }
        expect(props / count).toBeGreaterThan(0.25);
        expect(props / count).toBeLessThan(0.8);
        expect(leaks / count).toBeGreaterThan(0.3);
        expect(leaks / count).toBeLessThan(0.7);
    });

    it('come in every kind', () => {
        const seen = new Set();
        for (const chunk of chunks(20)) for (const prop of chunk.props) seen.add(PROP_NAMES[prop.type]);
        expect([...seen].sort()).toEqual([...PROP_NAMES].sort());
    });

    it('keep props inside their cell, clear of the walls, and a collision box you can get round', () => {
        for (const chunk of chunks()) {
            for (const prop of chunk.props) {
                const cx = Math.round(prop.x);
                const cz = Math.round(prop.z);
                // The chunk's own cells.
                expect(cx).toBeGreaterThanOrEqual(chunk.cx * N - HALF_CHUNK);
                expect(cx).toBeLessThan(chunk.cx * N + HALF_CHUNK);
                // Its widest part (a chair on its side) stays well inside the cell's walls.
                expect(Math.abs(prop.x - cx)).toBeLessThanOrEqual(0.32);
                expect(Math.abs(prop.z - cz)).toBeLessThanOrEqual(0.32);
                const half = PROP_SOLID_HALF[prop.type];
                if (half === 0) {
                    expect(prop.box).toBeNull();
                } else {
                    expect(prop.box).toEqual([prop.x - half, prop.z - half, prop.x + half, prop.z + half]);
                    // Room to get past on at least one side, even in a one-cell passage (the walls' faces
                    // are 0.46 from the cell's centre).
                    for (const offset of [prop.x - cx, prop.z - cz]) {
                        expect(Math.max(0.46 - (offset + half), 0.46 + (offset - half))).toBeGreaterThan(2 * PLAYER_RADIUS + 0.06);
                    }
                }
            }
        }
    });

    it('keeps everything out of the spawn room', () => {
        for (const chunk of chunks(30, 0)) {
            for (const { x, z } of [...chunk.props, ...chunk.leaks]) {
                expect(Math.abs(x) > 3.5 || z < -3.5 || z > 2.5, `seed prop at ${x}, ${z}`).toBe(true);
            }
        }
    });

    it('keeps ceiling stains clear of the light panels and wet patches inside their cell', () => {
        for (const chunk of chunks()) {
            for (const leak of chunk.leaks) {
                const px = 2 * Math.floor((leak.x - 1) / 2) + 1;
                const pz = 2 * Math.floor((leak.z - 1) / 2) + 1;
                // Nearest panel centres are at odd coordinates; the stain's edge must not reach any of them.
                for (const x of [px, px + 2]) {
                    for (const z of [pz, pz + 2]) expect(Math.hypot(x - leak.x, z - leak.z)).toBeGreaterThan(leak.radius + 0.085);
                }
                const cx = Math.round(leak.floorX);
                const cz = Math.round(leak.floorZ);
                expect(Math.abs(leak.floorX - cx) + leak.floorRadius).toBeLessThanOrEqual(0.44 + 1e-9);
                expect(Math.abs(leak.floorZ - cz) + leak.floorRadius).toBeLessThanOrEqual(0.44 + 1e-9);
            }
        }
    });

    it('puts a fallen ceiling tile under every leak that has lost one, and nowhere else', () => {
        let fallen = 0;
        for (const chunk of chunks()) {
            const tiles = chunk.props.filter((prop) => prop.type === PROP_TILE);
            for (const leak of chunk.leaks) {
                const under = tiles.filter((tile) => Math.round(tile.x) === Math.round(leak.floorX) && Math.round(tile.z) === Math.round(leak.floorZ));
                expect(under.length).toBe(tileFell(leak) ? 1 : 0);
                if (!tileFell(leak)) continue;
                fallen++;
                // On the wet patch, or near enough.
                expect(Math.hypot(under[0].x - leak.floorX, under[0].z - leak.floorZ)).toBeLessThan(leak.floorRadius + 0.12);
            }
            expect(tiles.length).toBe(chunk.leaks.filter(tileFell).length);
        }
        expect(fallen).toBeGreaterThan(20);
    });

    it('puts a wet floor sign at the edge of some wet patches', () => {
        let signs = 0;
        for (const chunk of chunks(20)) {
            for (const leak of chunk.leaks) {
                const sign = chunk.props.find((prop) => prop.type === PROP_SIGN
                    && Math.round(prop.x) === Math.round(leak.floorX) && Math.round(prop.z) === Math.round(leak.floorZ));
                if (!sign) continue;
                signs++;
                const distance = Math.hypot(sign.x - leak.floorX, sign.z - leak.floorZ);
                expect(distance).toBeGreaterThan(leak.floorRadius - 0.05);
            }
        }
        expect(signs).toBeGreaterThan(10);
    });

    it('blocks the player with a chair but not with a bottle or a fallen tile', () => {
        let solidChecked = 0;
        let bottlesChecked = 0;
        for (let seed = 0; seed < 30; seed++) {
            const store = new ChunkStore(seed);
            const boxesNear = (a, b, c, d, doors) => store.boxesNear(a, b, c, d, doors);
            for (let cx = -2; cx <= 2; cx++) {
                for (const prop of store.getChunk(cx, 1).props) {
                    const cellX = Math.round(prop.x);
                    // Only props near the middle of their cell, so the walk up to them stays in the cell.
                    if (Math.abs(prop.x - cellX) > 0.1) continue;
                    const from = { x: prop.x - 0.3, z: prop.z };
                    moveAndCollide(from, 0.3, 0, PLAYER_RADIUS, boxesNear);
                    if (PROP_SOLID_HALF[prop.type] === 0) {
                        // Bottles, and a fallen ceiling tile: walked over.
                        expect(from.x).toBeCloseTo(prop.x, 6);
                        if (prop.type === PROP_BOTTLES) bottlesChecked++;
                    } else {
                        expect(from.x).toBeLessThanOrEqual(prop.box[0] - PLAYER_RADIUS);
                        solidChecked++;
                    }
                }
            }
        }
        expect(solidChecked).toBeGreaterThan(0);
        expect(bottlesChecked).toBeGreaterThan(0);
    });
});

describe('failingLightAt', () => {
    it('is 0 around spawn, where every light works', () => {
        const store = new ChunkStore(3);
        for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) expect(failingLightAt(store, x, z)).toBe(0);
    });

    it('is 1 under a dead panel', () => {
        const store = new ChunkStore(3);
        let found = false;
        for (let x = -40; x < 40 && !found; x += 2) {
            for (let z = -40; z < 40; z += 2) {
                const px = x + 1;
                const pz = z + 1;
                if (store.panelData(px, pz)[store.panelOffset(px, pz)] !== 0) continue;
                expect(failingLightAt(store, px, pz)).toBe(1);
                found = true;
                break;
            }
        }
        expect(found).toBe(true);
    });
});
