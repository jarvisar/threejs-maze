import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, HALF_CHUNK } from '../src/config.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { EditLog } from '../src/world/edits.js';
import { PANELS_PER_SIDE, borderLine, generateChunk } from '../src/world/generator.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, cellCoord, chunkCoord, chunkKey } from '../src/world/grid.js';
import { panelFlicker } from '../src/world/panelLights.js';
import { hashInts, mulberry32, parseSeed, valueNoise } from '../src/world/random.js';
import { ZONE_NAMES, zoneAt } from '../src/world/zones.js';

const N = CHUNK_SIZE;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Flood fill over open edges from (x, z), limited to a rectangle of cells. */
function reachable(store, x0, z0, x1, z1, fromX, fromZ) {
    const seen = new Set([`${fromX},${fromZ}`]);
    const stack = [[fromX, fromZ]];
    while (stack.length) {
        const [x, z] = stack.pop();
        for (const [dx, dz] of DIRECTIONS) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < x0 || nz < z0 || nx > x1 || nz > z1 || seen.has(`${nx},${nz}`)) continue;
            if (store.edgeBetween(x, z, dx, dz) === EDGE_WALL) continue;
            seen.add(`${nx},${nz}`);
            stack.push([nx, nz]);
        }
    }
    return seen;
}

describe('generateChunk', () => {
    it('is deterministic', () => {
        const a = generateChunk(42, 3, -7);
        const b = generateChunk(42, 3, -7);
        expect(Array.from(a.edgesX)).toEqual(Array.from(b.edgesX));
        expect(Array.from(a.edgesZ)).toEqual(Array.from(b.edgesZ));
        expect(Array.from(a.pillars)).toEqual(Array.from(b.pillars));
        expect(Array.from(a.lights)).toEqual(Array.from(b.lights));
    });

    it('only produces known edge types', () => {
        for (let seed = 0; seed < 20; seed++) {
            const chunk = generateChunk(seed, seed - 10, 5 - seed);
            for (const type of [...chunk.edgesX, ...chunk.edgesZ]) expect([EDGE_NONE, EDGE_WALL, EDGE_DOOR]).toContain(type);
        }
    });

    it('agrees with its neighbours about the walls on shared borders', () => {
        for (let seed = 0; seed < 30; seed++) {
            const cx = (seed % 7) - 3;
            const cz = (seed % 5) - 2;
            const chunk = generateChunk(seed, cx, cz);
            // The chunk owns its east and north borders; they must match the line the neighbour generates for
            // its west and south borders.
            const east = borderLine(seed, 0, cx + 1, cz);
            const north = borderLine(seed, 1, cx, cz + 1);
            for (let k = 0; k < N; k++) {
                expect(chunk.edgesX[(N - 1) * N + k]).toBe(east[k]);
                expect(chunk.edgesZ[k * N + (N - 1)]).toBe(north[k]);
            }
        }
    });

    it('always leaves a way through every border', () => {
        for (let seed = 0; seed < 200; seed++) {
            const line = borderLine(seed, seed & 1, (seed % 11) - 5, (seed % 13) - 6);
            expect(line.some((type) => type !== EDGE_WALL)).toBe(true);
        }
    });

    it('connects every cell of a chunk without leaving it', () => {
        for (let seed = 0; seed < 60; seed++) {
            const cx = (seed % 9) - 4;
            const cz = ((seed * 7) % 9) - 4;
            const store = new ChunkStore(seed);
            const x0 = cx * N - HALF_CHUNK;
            const z0 = cz * N - HALF_CHUNK;
            const seen = reachable(store, x0, z0, x0 + N - 1, z0 + N - 1, x0, z0);
            expect(seen.size, `seed ${seed}, chunk ${cx},${cz} (${ZONE_NAMES[store.getChunk(cx, cz).zone.type]})`).toBe(N * N);
        }
    });

    it('makes the whole world reachable from the spawn point', () => {
        for (const seed of [1, 2, 3, 99, 12345]) {
            const store = new ChunkStore(seed);
            // Chunks −3..2 on both axes, without leaving them.
            const min = -3 * N - HALF_CHUNK;
            const max = 3 * N - HALF_CHUNK - 1;
            const seen = reachable(store, min, min, max, max, 0, 0);
            expect(seen.size).toBe((6 * N) ** 2);
        }
    });

    it('never buries a pillar in a wall', () => {
        for (let seed = 0; seed < 40; seed++) {
            const store = new ChunkStore(seed);
            for (let x = -24; x < 24; x++) {
                for (let z = -24; z < 24; z++) {
                    if (!store.pillar(x, z)) continue;
                    const incident = [store.edge(x, z, 0), store.edge(x, z + 1, 0), store.edge(x, z, 1), store.edge(x + 1, z, 1)];
                    expect(incident.every((type) => type === EDGE_NONE), `seed ${seed}, corner ${x},${z}`).toBe(true);
                }
            }
        }
    });

    it('builds the same spawn room in every world', () => {
        for (let seed = 0; seed < 20; seed++) {
            const store = new ChunkStore(seed);
            expect(store.edge(-1, -3, 1)).toBe(EDGE_DOOR); // the doorway ahead
            expect(store.edge(-3, 0, 0)).toBe(EDGE_NONE); // the opening on the left
            for (let x = -1; x <= 1; x++) for (let z = -1; z <= 0; z++) expect(store.pillar(x, z)).toBe(false);
        }
    });

    it('keeps every light around spawn working', () => {
        for (let seed = 0; seed < 20; seed++) {
            const store = new ChunkStore(seed);
            for (let x = -7; x <= 7; x += 2) {
                for (let z = -7; z <= 7; z += 2) {
                    const data = store.panelData(x, z);
                    const offset = store.panelOffset(x, z);
                    expect(data[offset]).toBeGreaterThan(0);
                    expect(data[offset + 2]).toBe(0);
                }
            }
            expect(store.areaLight(0, 0)).toBe(1);
        }
    });

    it('has some dark areas, but not too many', () => {
        const store = new ChunkStore(7);
        let dark = 0;
        let total = 0;
        for (let x = -301; x < 300; x += 6) {
            for (let z = -301; z < 300; z += 6) {
                total++;
                if (store.areaLight(x, z) < 0.5) dark++;
            }
        }
        expect(dark / total).toBeGreaterThan(0.01);
        expect(dark / total).toBeLessThan(0.15);
    });

    it('stores four bytes per ceiling panel', () => {
        expect(generateChunk(1, 0, 0).lights.length).toBe(PANELS_PER_SIDE * PANELS_PER_SIDE * 4);
    });
});

describe('zones', () => {
    it('always starts in an office', () => {
        for (let seed = 0; seed < 20; seed++) expect(ZONE_NAMES[zoneAt(seed, 0, 0).type]).toBe('rooms');
    });

    it('produces every kind of zone, clumped into regions', () => {
        const counts = new Map();
        let sameAsNeighbour = 0;
        let total = 0;
        for (let cx = -40; cx < 40; cx++) {
            for (let cz = -40; cz < 40; cz++) {
                const type = zoneAt(3, cx, cz).type;
                counts.set(type, (counts.get(type) ?? 0) + 1);
                total++;
                if (zoneAt(3, cx + 1, cz).type === type) sameAsNeighbour++;
            }
        }
        expect(counts.size).toBe(ZONE_NAMES.length);
        // With five zone types, independent picks would match a neighbour well under half the time.
        expect(sameAsNeighbour / total).toBeGreaterThan(0.5);
    });
});

describe('ChunkStore', () => {
    it('maps cells to chunks the same way the renderer does', () => {
        expect(chunkCoord(-HALF_CHUNK)).toBe(0);
        expect(chunkCoord(HALF_CHUNK - 1)).toBe(0);
        expect(chunkCoord(HALF_CHUNK)).toBe(1);
        expect(chunkCoord(-HALF_CHUNK - 1)).toBe(-1);
        expect(cellCoord(0.49)).toBe(0);
        expect(cellCoord(0.5)).toBe(1);
        expect(cellCoord(-0.5)).toBe(0);
        expect(cellCoord(-0.51)).toBe(-1);
    });

    it('gives each chunk a unique key', () => {
        const keys = new Set();
        for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) keys.add(chunkKey(x, z));
        expect(keys.size).toBe(41 * 41);
    });

    it('generates the same world for the same seed', () => {
        const a = new ChunkStore(1234);
        const b = new ChunkStore(1234);
        for (let x = -30; x < 30; x++) {
            for (let z = -30; z < 30; z++) {
                expect(a.edge(x, z, 0)).toBe(b.edge(x, z, 0));
                expect(a.edge(x, z, 1)).toBe(b.edge(x, z, 1));
            }
        }
    });

    it('generates different worlds for different seeds', () => {
        const a = new ChunkStore(1);
        const b = new ChunkStore(2);
        let differences = 0;
        for (let x = -30; x < 30; x++) for (let z = -30; z < 30; z++) if (a.edge(x, z, 0) !== b.edge(x, z, 0)) differences++;
        expect(differences).toBeGreaterThan(100);
    });

    it('applies edits, including in negative chunks and on chunk borders', () => {
        const store = new ChunkStore(7);
        for (const [x, z] of [[-13, 27], [HALF_CHUNK - 1, 0], [-HALF_CHUNK - 1, -HALF_CHUNK - 1]]) {
            for (const axis of [0, 1]) {
                store.setEdge(x, z, axis, EDGE_NONE);
                expect(store.setEdge(x, z, axis, EDGE_WALL)).toBe(true);
                expect(store.edge(x, z, axis)).toBe(EDGE_WALL);
                expect(store.setEdge(x, z, axis, EDGE_WALL)).toBe(false);
                expect(store.setEdge(x, z, axis, EDGE_DOOR)).toBe(true);
                expect(store.edge(x, z, axis)).toBe(EDGE_DOOR);
            }
            expect(store.setPillar(x, z, !store.pillar(x, z))).toBe(true);
        }
    });

    it('finds the edge between neighbouring cells from either side', () => {
        const store = new ChunkStore(11);
        for (let x = -10; x < 10; x++) {
            for (let z = -10; z < 10; z++) {
                expect(store.edgeBetween(x, z, 1, 0)).toBe(store.edgeBetween(x + 1, z, -1, 0));
                expect(store.edgeBetween(x, z, 0, 1)).toBe(store.edgeBetween(x, z + 1, 0, -1));
            }
        }
    });

    it('returns the boxes of nearby walls', () => {
        const store = new ChunkStore(5);
        store.setEdge(0, 0, 0, EDGE_WALL);
        const boxes = store.boxesNear(0.3, -0.2, 0.6, 0.2);
        expect(boxes.some(([minX, minZ, maxX, maxZ]) => minX < 0.5 && maxX > 0.5 && minZ <= -0.5 && maxZ >= 0.5)).toBe(true);
    });
});

describe('EditLog', () => {
    const memoryStorage = () => {
        const data = new Map();
        return {
            getItem: (key) => (data.has(key) ? data.get(key) : null),
            setItem: (key, value) => data.set(key, String(value)),
            removeItem: (key) => data.delete(key),
            keys: () => [...data.keys()],
        };
    };

    it('replays edits when the same world is generated again', () => {
        const original = globalThis.localStorage;
        globalThis.localStorage = memoryStorage();
        try {
            const first = new ChunkStore(77, new EditLog(77));
            first.setEdge(3, -20, 0, EDGE_DOOR);
            first.setEdge(40, 41, 1, EDGE_WALL);
            first.setPillar(-9, 9, true);
            first.edits.save();

            const second = new ChunkStore(77, new EditLog(77));
            expect(second.edge(3, -20, 0)).toBe(EDGE_DOOR);
            expect(second.edge(40, 41, 1)).toBe(EDGE_WALL);
            expect(second.pillar(-9, 9)).toBe(true);
            expect(second.edits.size).toBe(3);

            // Other worlds are unaffected.
            expect(new EditLog(78).size).toBe(0);

            second.edits.clear();
            expect(new EditLog(77).size).toBe(0);
        } finally {
            globalThis.localStorage = original;
        }
    });

    it('only keeps edits for the most recently edited worlds', () => {
        const original = globalThis.localStorage;
        const storage = memoryStorage();
        globalThis.localStorage = storage;
        try {
            for (let seed = 1; seed <= 12; seed++) {
                const log = new EditLog(seed);
                log.record(0, 0, 0, 5, EDGE_WALL);
                log.save();
            }
            expect(new EditLog(1).size).toBe(0);
            expect(new EditLog(12).size).toBe(1);
            expect(storage.keys().filter((key) => key.includes(':edits:')).length).toBe(8);
        } finally {
            globalThis.localStorage = original;
        }
    });

    it('ignores junk in storage', () => {
        const original = globalThis.localStorage;
        globalThis.localStorage = memoryStorage();
        try {
            globalThis.localStorage.setItem('backrooms-simulator:edits:5', '{"version":1,"chunks":{"0,0":[["x",1],[3]]}}');
            expect(new EditLog(5).size).toBe(0);
            globalThis.localStorage.setItem('backrooms-simulator:edits:5', 'not json');
            expect(new EditLog(5).size).toBe(0);
        } finally {
            globalThis.localStorage = original;
        }
    });
});

describe('lights', () => {
    it('flickers only in bursts, and is steady without a pattern', () => {
        let low = 0;
        for (let t = 0; t < 200; t += 0.01) {
            expect(panelFlicker(0, t)).toBe(1);
            if (panelFlicker(77, t) < 1) low++;
        }
        expect(low).toBeGreaterThan(100);
        expect(low).toBeLessThan(10000);
    });
});

describe('random helpers', () => {
    it('parses numeric and text seeds', () => {
        expect(parseSeed('12345')).toBe(12345);
        expect(parseSeed('  42 ')).toBe(42);
        expect(parseSeed('')).toBeNull();
        expect(parseSeed(null)).toBeNull();
        expect(parseSeed('hello')).toBe(parseSeed('hello'));
        expect(parseSeed('hello')).not.toBe(parseSeed('world'));
        expect(parseSeed('99999999999')).toBeTypeOf('number');
    });

    it('hashes neighbouring coordinates to unrelated values', () => {
        const values = new Set();
        for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) values.add(hashInts(1, x, z));
        expect(values.size).toBe(121);
    });

    it('mulberry32 stays in [0, 1)', () => {
        const random = mulberry32(99);
        for (let i = 0; i < 10000; i++) {
            const v = random();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it('value noise is continuous', () => {
        for (let i = 0; i < 1000; i++) {
            const x = i * 0.137 - 50;
            expect(Math.abs(valueNoise(3, x, 2.5) - valueNoise(3, x + 0.001, 2.5))).toBeLessThan(0.01);
        }
    });
});
