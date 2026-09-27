import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, HALF_CHUNK } from '../src/config.js';
import { arenaOptions, placeNotes } from '../src/footage/arena.js';
import {
    CELL_WELL,
    EMIT_RANGE,
    START_WELL,
    abandonedOfficeOptions,
    abandonedOfficeRainAt,
} from '../src/world/abandonedOffice.js';
import { furnitureBox } from '../src/world/abandonedOfficeFurniture.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { EDGE_NONE, EDGE_WALL, chunkCoord } from '../src/world/grid.js';
import { LEVELS, LEVELS_IN_ORDER, TAPE_LEVELS, levelById } from '../src/world/levels.js';
import { Storm } from '../src/world/storm.js';
import { ZONE_CORE, ZONE_CUBICLES, ZONE_OFFICES, ZONE_OPEN_PLAN } from '../src/world/zones.js';

const N = CHUNK_SIZE;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const LEVEL = LEVELS.findIndex((level) => level.name === 'Level 4');

function office(seed) {
    return new ChunkStore(seed, null, abandonedOfficeOptions(seed));
}

/** Each chunk within `reach` of the origin, for a few seeds. */
function* chunks(seeds = 4, reach = 2) {
    for (let seed = 0; seed < seeds; seed++) {
        const store = office(seed);
        for (let cx = -reach; cx <= reach; cx++) {
            for (let cz = -reach; cz <= reach; cz++) yield { seed, store, chunk: store.getChunk(cx, cz) };
        }
    }
}

/** What cell (x, z) is (CELL_*), wherever it is. */
function kindAt(store, x, z) {
    const chunk = store.getChunk(chunkCoord(x), chunkCoord(z));
    return chunk.abandonedOffice.kinds[(x - chunk.cx * N + HALF_CHUNK) * N + (z - chunk.cz * N + HALF_CHUNK)];
}

/** Whether two boxes [minX, minZ, maxX, maxZ] overlap. */
function overlap(a, b) {
    return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

describe('Level 4', () => {
    it('is one of the levels, listed by its number, with its own sound and a storm; no tape goes through it yet', () => {
        expect(LEVEL).toBeGreaterThan(0);
        const level = levelById(LEVEL);
        expect(level.number).toBe(4);
        expect(level.options(1).level).toBe(LEVEL);
        expect(typeof level.sound).toBe('function');
        expect(level.atmosphere.storm).toBe(true);
        expect(LEVELS_IN_ORDER.map(({ name }) => name)).toEqual(['Level 0', 'Level 1', 'Level 2', 'Level 4', 'Level 5', 'Level 37']);
        expect(TAPE_LEVELS).not.toContain(LEVEL);
        expect(level.tape.zones).toContain(level.tape.start);
        expect(level.tape.notes).toHaveLength(8);
    });

    it('is the same office every time for the same seed, and a different one for another', () => {
        const a = office(8).getChunk(1, -2);
        const b = office(8).getChunk(1, -2);
        const c = office(9).getChunk(1, -2);
        expect(Array.from(a.edgesX)).toEqual(Array.from(b.edgesX));
        expect(a.abandonedOffice).toEqual(b.abandonedOffice);
        expect(a.props).toEqual(b.props);
        expect(a.solids).toEqual(b.solids);
        expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
        expect(Array.from(a.edgesX)).not.toEqual(Array.from(c.edgesX));
    });

    it('has open floors, cubicles, offices and the core, and starts on an open floor', () => {
        const seen = new Set();
        for (const { chunk } of chunks(6, 3)) seen.add(chunk.zone.type);
        expect([...seen].sort()).toEqual([ZONE_OPEN_PLAN, ZONE_CUBICLES, ZONE_OFFICES, ZONE_CORE].sort());
        for (let seed = 0; seed < 5; seed++) expect(office(seed).getChunk(0, 0).zone.type).toBe(ZONE_OPEN_PLAN);
    });

    it('starts on an open floor looking across it at the windows of a light well, lit by them', () => {
        for (let seed = 0; seed < 8; seed++) {
            const store = office(seed);
            // Nothing in the way from where you start to the glass.
            for (let x = -2; x <= 2; x++) {
                for (let z = -3; z <= 1; z++) {
                    if (x < 2) expect(store.edgeBetween(x, z, 1, 0), `seed ${seed}: ${x},${z}`).toBe(EDGE_NONE);
                    if (z > -3) expect(store.edgeBetween(x, z, 0, -1), `seed ${seed}: ${x},${z}`).toBe(EDGE_NONE);
                }
            }
            for (let x = START_WELL.x0; x <= START_WELL.x1; x++) {
                for (let z = START_WELL.z0; z <= START_WELL.z1; z++) expect(kindAt(store, x, z) & CELL_WELL, `seed ${seed}: ${x},${z}`).toBeTruthy();
                // Its row of windows, facing you.
                expect(store.edgeBetween(x, START_WELL.z1 + 1, 0, -1), `seed ${seed}: ${x}`).toBe(EDGE_WALL);
                expect(store.getChunk(0, 0).abandonedOffice.windows[(x + HALF_CHUNK) * N + START_WELL.z1 + HALF_CHUNK] & 2, `seed ${seed}: ${x}`).toBeTruthy();
            }
            // The light through them reaches the floor in front of them, and the rain is loudest there.
            const cells = store.getChunk(0, 0).cells;
            expect(cells[((0 + HALF_CHUNK) * N + (-3 + HALF_CHUNK)) * 4 + 1] & 128, `seed ${seed}`).toBeTruthy();
            expect(abandonedOfficeRainAt(store, 0, -3)).toBeGreaterThan(0.5);
            expect(abandonedOfficeRainAt(store, 0, -3)).toBeGreaterThan(abandonedOfficeRainAt(store, 0, 0));
        }
    });

    it('cuts its light wells well inside their chunks, walled all round by windows, solid, and with nothing else in them', () => {
        let wells = 0;
        for (const { store, chunk } of chunks(4, 2)) {
            const x0 = chunk.cx * N - HALF_CHUNK;
            const z0 = chunk.cz * N - HALF_CHUNK;
            const data = chunk.abandonedOffice;
            for (const { i0, j0, i1, j1 } of data.wells) {
                wells++;
                const where = `${chunk.cx},${chunk.cz}`;
                expect(Math.min(i0, j0), where).toBeGreaterThanOrEqual(1);
                expect(Math.max(i1, j1), where).toBeLessThanOrEqual(N - 2);
                for (let i = i0; i <= i1; i++) {
                    for (let j = j0; j <= j1; j++) {
                        const x = x0 + i;
                        const z = z0 + j;
                        for (const [dx, dz] of DIRECTIONS) {
                            const inside = i + dx >= i0 && i + dx <= i1 && j + dz >= j0 && j + dz <= j1;
                            expect(store.edgeBetween(x, z, dx, dz), `${where}: ${x},${z}`).toBe(inside ? EDGE_NONE : EDGE_WALL);
                        }
                        const own = [x0 + i0 - 0.45, z0 + j0 - 0.45, x0 + i1 + 0.45, z0 + j1 + 0.45];
                        const solid = chunk.solids.filter((box) => overlap(box, [x - 0.4, z - 0.4, x + 0.4, z + 0.4]));
                        expect(solid, `${where}: ${x},${z}`).toEqual([own]);
                    }
                }
                // A window in every bay round it.
                let bays = 0;
                for (let k = 0; k < N * N; k++) bays += (data.windows[k] & 1 ? 1 : 0) + (data.windows[k] & 2 ? 1 : 0);
                expect(bays, where).toBeGreaterThanOrEqual(2 * (i1 - i0 + 1) + 2 * (j1 - j0 + 1));
            }
        }
        expect(wells).toBeGreaterThan(15);
    });

    it('can be walked all through (but not out into a well): every chunk hangs together, and has a way through every border', () => {
        for (const { store, chunk } of chunks(4, 1)) {
            const x0 = chunk.cx * N - HALF_CHUNK;
            const z0 = chunk.cz * N - HALF_CHUNK;
            const wells = chunk.abandonedOffice.kinds.reduce((sum, kind) => sum + (kind & CELL_WELL ? 1 : 0), 0);
            const start = chunk.abandonedOffice.kinds.findIndex((kind) => !(kind & CELL_WELL));
            const seen = new Set([`${Math.floor(start / N)},${start % N}`]);
            const stack = [[Math.floor(start / N), start % N]];
            while (stack.length) {
                const [i, j] = stack.pop();
                for (const [di, dj] of DIRECTIONS) {
                    const ni = i + di;
                    const nj = j + dj;
                    if (ni < 0 || nj < 0 || ni >= N || nj >= N || seen.has(`${ni},${nj}`)) continue;
                    if (store.edgeBetween(x0 + i, z0 + j, di, dj) === EDGE_WALL) continue;
                    expect(chunk.abandonedOffice.kinds[ni * N + nj] & CELL_WELL, `${chunk.cx},${chunk.cz}: into a well at ${ni},${nj}`).toBe(0);
                    seen.add(`${ni},${nj}`);
                    stack.push([ni, nj]);
                }
            }
            expect(seen.size, `${chunk.cx},${chunk.cz}`).toBe(N * N - wells);
            let ways = 0;
            for (let k = 0; k < N; k++) if (store.edgeBetween(x0 - 1, z0 + k, 1, 0) !== EDGE_WALL) ways++;
            expect(ways, `${chunk.cx},${chunk.cz}`).toBeGreaterThan(0);
        }
    });

    it('keeps its furniture, its partitions and its lights inside their chunk, clear of the ways through', () => {
        let emitters = 0;
        let partitions = 0;
        for (const { store, chunk } of chunks(4, 2)) {
            const x0 = chunk.cx * N - HALF_CHUNK;
            const z0 = chunk.cz * N - HALF_CHUNK;
            const inside = (x, z) => x > x0 - 0.5 && z > z0 - 0.5 && x < x0 + N - 0.5 && z < z0 + N - 0.5;
            for (const [minX, minZ, maxX, maxZ] of chunk.solids) {
                expect(inside(minX, minZ) && inside(maxX, maxZ), `${chunk.cx},${chunk.cz}`).toBe(true);
            }
            const data = chunk.abandonedOffice;
            for (let k = 0; k < data.partitions.length; k += 5) {
                partitions++;
                expect(inside(data.partitions[k], data.partitions[k + 1]) && inside(data.partitions[k + 2], data.partitions[k + 3])).toBe(true);
            }
            // Its light has to stop before the chunk does (the cells beyond don't know of it).
            for (const emitter of data.emitters) {
                emitters++;
                const reach = EMIT_RANGE[emitter.kind];
                expect(emitter.x - reach > x0 - 0.5 && emitter.z - reach > z0 - 0.5 && emitter.x + reach < x0 + N - 0.5 && emitter.z + reach < z0 + N - 0.5, `${emitter.x},${emitter.z}`).toBe(true);
            }
            // Nothing solid in a doorway, nor across one of the chunk's ways out.
            for (const piece of data.furniture) {
                const box = furnitureBox(piece);
                if (!box) continue;
                for (let i = 0; i < N; i++) {
                    for (let j = 0; j < N; j++) {
                        const x = x0 + i;
                        const z = z0 + j;
                        for (const [dx, dz] of DIRECTIONS) {
                            if (store.edgeBetween(x, z, dx, dz) === EDGE_WALL) continue;
                            const outside = i + dx < 0 || j + dz < 0 || i + dx >= N || j + dz >= N;
                            if (!outside && store.edgeBetween(x, z, dx, dz) === EDGE_NONE) continue;
                            // The doorway's opening, a little either side.
                            const gap = [x + dx * 0.5 - (dz !== 0 ? 0.22 : 0.05), z + dz * 0.5 - (dx !== 0 ? 0.22 : 0.05), x + dx * 0.5 + (dz !== 0 ? 0.22 : 0.05), z + dz * 0.5 + (dx !== 0 ? 0.22 : 0.05)];
                            expect(overlap(box, gap), `${piece.type} at ${piece.x},${piece.z}`).toBe(false);
                        }
                    }
                }
            }
        }
        expect(emitters).toBeGreaterThan(20);
        expect(partitions).toBeGreaterThan(100);
    });

    it('sets its doors that don\'t open in walls, never in a window or on a chunk\'s edge', () => {
        let doors = 0;
        for (const { store, chunk } of chunks(4, 2)) {
            const x0 = chunk.cx * N - HALF_CHUNK;
            const z0 = chunk.cz * N - HALF_CHUNK;
            for (const door of chunk.abandonedOffice.doors) {
                doors++;
                const where = `${door.x},${door.z},${door.axis}`;
                expect(store.edge(door.x, door.z, door.axis), where).toBe(EDGE_WALL);
                const i = door.x - x0;
                const j = door.z - z0;
                expect(door.axis === 0 ? i : j, where).toBeLessThan(N - 1);
                expect(chunk.abandonedOffice.windows[i * N + j] & (door.axis === 0 ? 1 : 2), where).toBe(0);
                const [nx, nz] = door.axis === 0 ? [door.x + 1, door.z] : [door.x, door.z + 1];
                expect((kindAt(store, door.x, door.z) | kindAt(store, nx, nz)) & CELL_WELL, where).toBe(0);
            }
        }
        expect(doors).toBeGreaterThan(200);
    });

    it('on a tape, leaves its notes (and what was left with them) clear of the furniture and the windows', () => {
        for (const seed of [3, 11, 13, 20]) {
            const store = new ChunkStore(seed, null, arenaOptions(seed, LEVEL));
            for (const note of placeNotes(store, seed)) {
                const chunk = store.getChunk(chunkCoord(note.cellX), chunkCoord(note.cellZ));
                const cell = [note.cellX - 0.5, note.cellZ - 0.5, note.cellX + 0.5, note.cellZ + 0.5];
                for (const box of chunk.solids) expect(overlap(box, cell), `seed ${seed}: ${note.cellX},${note.cellZ}`).toBe(false);
                expect(kindAt(store, note.cellX, note.cellZ) & CELL_WELL).toBe(0);
            }
        }
    });
});

describe('the storm', () => {
    /** A storm on a clock of its own, run for `seconds`: when each flash began (its brightness rising from nothing). */
    function flashes(storm, seconds, dt = 1 / 120) {
        const starts = [];
        let last = 0;
        let rising = false;
        for (let t = 0; t < seconds; t += dt) {
            storm.update(dt);
            if (storm.flash > last + 1e-4 && !rising) {
                starts.push(t);
                rising = true;
            } else if (storm.flash < last) {
                rising = false;
            }
            last = storm.flash;
        }
        return starts;
    }

    it('strikes every so often, never flashing more than three times a second', () => {
        let seed = 5;
        const random = () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
        };
        const storm = new Storm(random);
        storm.on = true;
        const starts = flashes(storm, 600);
        expect(storm.strikes).toBeGreaterThan(15);
        expect(storm.strikes).toBeLessThan(80);
        for (let k = 0; k + 3 < starts.length; k++) expect(starts[k + 3] - starts[k]).toBeGreaterThan(1);
        for (let k = 0; k + 1 < starts.length; k++) expect(starts[k + 1] - starts[k]).toBeGreaterThan(0.3);
    });

    it('flashes once to a strike, softly, with reduced motion; and not at all when off', () => {
        const storm = new Storm(() => 0.5);
        storm.on = true;
        storm.calm = true;
        storm.strike();
        let peak = 0;
        let starts = 0;
        let last = 0;
        for (let t = 0; t < 3; t += 1 / 120) {
            storm.update(1 / 120);
            if (storm.flash > last + 1e-4 && last < 1e-3) starts++;
            peak = Math.max(peak, storm.flash);
            last = storm.flash;
        }
        expect(starts).toBe(1);
        expect(peak).toBeLessThan(0.5);
        storm.on = false;
        storm.strike();
        storm.update(0.05);
        expect(storm.flash).toBe(0);
    });
});
