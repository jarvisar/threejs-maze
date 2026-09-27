import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, DOOR_HEIGHT, DOOR_WIDTH, HALF_CHUNK, WALL_THICKNESS } from '../src/config.js';
import { arenaOptions, openExit, placeNotes } from '../src/footage/arena.js';
import {
    CELL_WELL,
    CONVECTOR_DEPTH,
    EMIT_RANGE,
    END_ROUND,
    START_WELL,
    abandonedOfficeOptions,
    abandonedOfficeRainAt,
    windowEnd,
} from '../src/world/abandonedOffice.js';
import {
    FACE,
    FURN_CHAIR,
    FURN_CLOCK,
    FURN_COUNTER,
    FURN_FOUNTAIN,
    FURN_FRIDGE,
    FURN_STACK,
    FURN_WHITEBOARD,
    furnitureBox,
} from '../src/world/abandonedOfficeFurniture.js';
import { buildAbandonedOfficeGeometry } from '../src/world/abandonedOfficeGeometry.js';
import { PROP_REACH, propSpot } from '../src/world/abandonedOfficeProps.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { PROP_BIN, PROP_BOTTLES, PROP_BOXES, PROP_COOLER, PROP_FICUS, PROP_FILES, PROP_MONITOR } from '../src/world/decorations.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, chunkCoord, edgeBoxes, pillarBox } from '../src/world/grid.js';
import { LEVELS, LEVELS_IN_ORDER, TAPE_LEVELS, levelById } from '../src/world/levels.js';
import { buildPropGeometry, templateFor } from '../src/world/props.js';
import { Storm } from '../src/world/storm.js';
import { ZONE_CORE, ZONE_CUBICLES, ZONE_OFFICES, ZONE_OPEN_PLAN } from '../src/world/zones.js';

const N = CHUNK_SIZE;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const LEVEL = LEVELS.findIndex((level) => level.name === 'Level 4');
/** What hangs on a wall. */
const MOUNTED = [FURN_WHITEBOARD, FURN_CLOCK, FURN_FOUNTAIN];

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
    it('is one of the levels, listed by its number, with its own sound and a storm; a tape goes down into it from Level 2', () => {
        expect(LEVEL).toBeGreaterThan(0);
        const level = levelById(LEVEL);
        expect(level.number).toBe(4);
        expect(level.options(1).level).toBe(LEVEL);
        expect(typeof level.sound).toBe('function');
        expect(level.atmosphere.storm).toBe(true);
        expect(LEVELS_IN_ORDER.map(({ name }) => name)).toEqual(['Level 0', 'Level 1', 'Level 2', 'Level 4', 'Level 5', 'Level 37']);
        expect(TAPE_LEVELS.indexOf(LEVEL)).toBe(TAPE_LEVELS.indexOf(LEVELS.findIndex((l) => l.number === 2)) + 1);
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

// ---------------------------------------------------------------------------------------------- its geometry

/** A mesh's triangles (those with any area), where they are in the world, its chunk's middle at (ox, oz). */
function trianglesOf(geometry, ox, oz) {
    if (!geometry) return [];
    const p = geometry.attributes.position.array;
    const index = geometry.index?.array;
    const count = index ? index.length : p.length / 3;
    const out = [];
    for (let t = 0; t < count; t += 3) {
        const tri = [0, 1, 2].map((k) => {
            const i = index ? index[t + k] : t + k;
            return [p[i * 3] + ox, p[i * 3 + 1], p[i * 3 + 2] + oz];
        });
        if (Math.hypot(...cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))) > 1e-10) out.push(tri);
    }
    return out;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The box round some triangles: [minX, minY, minZ, maxX, maxY, maxZ]. */
function boundsOf(triangles) {
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const tri of triangles) {
        for (const v of tri) {
            for (let k = 0; k < 3; k++) {
                box[k] = Math.min(box[k], v[k]);
                box[k + 3] = Math.max(box[k + 3], v[k]);
            }
        }
    }
    return box;
}

/** Whether two boxes [minX, minY, minZ, maxX, maxY, maxZ] overlap. */
const meet = (a, b) => a[0] < b[3] && b[0] < a[3] && a[1] < b[4] && b[1] < a[4] && a[2] < b[5] && b[2] < a[5];

/** Whether a triangle goes into a box [minX, minY, minZ, maxX, maxY, maxZ] (the separating axes). */
function intoBox(tri, box) {
    const middle = [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2];
    const half = [(box[3] - box[0]) / 2, (box[4] - box[1]) / 2, (box[5] - box[2]) / 2];
    const v = tri.map((p) => sub(p, middle));
    const edges = [sub(v[1], v[0]), sub(v[2], v[1]), sub(v[0], v[2])];
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1], cross(edges[0], edges[1])];
    for (const a of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) for (const e of edges) axes.push(cross(a, e));
    return axes.every((axis) => {
        if (Math.hypot(...axis) < 1e-12) return true;
        const p = v.map((q) => dot(q, axis));
        const r = half[0] * Math.abs(axis[0]) + half[1] * Math.abs(axis[1]) + half[2] * Math.abs(axis[2]);
        return Math.min(...p) <= r && Math.max(...p) >= -r;
    });
}

/**
 * Whether two triangles go through each other: each has corners on both sides of the other's plane (by more than a
 * hair), and where they cross the line the planes meet on, they overlap. Touching (resting on, or against) isn't.
 */
function crossing(a, b, hair = 4e-4) {
    const na = cross(sub(a[1], a[0]), sub(a[2], a[0]));
    const nb = cross(sub(b[1], b[0]), sub(b[2], b[0]));
    const ua = na.map((value) => value / Math.hypot(...na));
    const ub = nb.map((value) => value / Math.hypot(...nb));
    const db = b.map((p) => dot(ua, sub(p, a[0])));
    const da = a.map((p) => dot(ub, sub(p, b[0])));
    if (!(Math.max(...db) > hair && Math.min(...db) < -hair && Math.max(...da) > hair && Math.min(...da) < -hair)) return false;
    const line = cross(ua, ub);
    if (Math.hypot(...line) < 1e-6) return false;
    const span = (tri, d) => {
        const at = [];
        for (let k = 0; k < 3; k++) {
            const [p, q, dp, dq] = [tri[k], tri[(k + 1) % 3], d[k], d[(k + 1) % 3]];
            if ((dp > 0) !== (dq > 0)) at.push(dot(line, p.map((value, axis) => value + (q[axis] - value) * (dp / (dp - dq)))));
        }
        return [Math.min(...at), Math.max(...at)];
    };
    const [a0, a1] = span(a, da);
    const [b0, b1] = span(b, db);
    return Math.min(a1, b1) - Math.max(a0, b0) > hair;
}

/**
 * Each thing of a chunk's own (see abandonedOfficeGeometry.js), drawn on its own: each piece of furniture, each prop,
 * each door, each cubicle partition, each light fitting, and the windows round its light well; as {what, triangles,
 * box}, with `piece` or `prop` for the furniture and the props.
 */
function thingsOf(store, chunk) {
    const data = chunk.abandonedOffice;
    const [ox, oz] = [chunk.cx * N, chunk.cz * N];
    const none = { windows: new Uint8Array(N * N), wells: [], fixtures: new Uint8Array(data.fixtures.length), doors: [], partitions: [], furniture: [] };
    const drawn = (only) => {
        const meshes = buildAbandonedOfficeGeometry(store, { ...chunk, abandonedOffice: { ...data, ...none, ...only } });
        return [meshes.furnishings, meshes.displays, meshes.glass].flatMap((geometry) => trianglesOf(geometry, ox, oz));
    };
    const things = [];
    const add = (what, triangles, extra = {}) => {
        if (triangles.length) things.push({ what, triangles, box: boundsOf(triangles), ...extra });
    };
    for (const piece of data.furniture) add(`furniture ${piece.type} at ${piece.x.toFixed(2)},${piece.z.toFixed(2)}`, drawn({ furniture: [piece] }), { piece });
    for (const prop of chunk.props) add(`prop ${prop.type} at ${prop.x.toFixed(2)},${prop.z.toFixed(2)}`, trianglesOf(buildPropGeometry([prop], ox, oz), ox, oz), { prop });
    for (const door of data.doors) add(`door at ${door.x},${door.z},${door.axis}`, drawn({ doors: [door] }));
    for (let k = 0; k < data.partitions.length; k += 5) add(`partition ${data.partitions.slice(k, k + 4).join()}`, drawn({ partitions: data.partitions.slice(k, k + 5) }));
    for (let k = 0; k < data.fixtures.length; k++) {
        if (!data.fixtures[k]) continue;
        const fixtures = new Uint8Array(data.fixtures.length);
        fixtures[k] = data.fixtures[k];
        add(`light ${k}`, drawn({ fixtures }));
    }
    add('windows', drawn({ windows: data.windows }), { windows: true });
    return things;
}

/** What's solid of the walls and the columns round chunk (cx, cz), as boxes [minX, minY, minZ, maxX, maxY, maxZ]. */
function wallsAround(store, chunk) {
    const x0 = chunk.cx * N - HALF_CHUNK;
    const z0 = chunk.cz * N - HALF_CHUNK;
    const boxes = [];
    for (let x = x0 - 1; x <= x0 + N; x++) {
        for (let z = z0 - 1; z <= z0 + N; z++) {
            for (const axis of [0, 1]) {
                const flat = [];
                edgeBoxes(x, z, axis, store.edge(x, z, axis), flat);
                // (A doorway's lintel over it, too.)
                const lintel = store.edge(x, z, axis) === EDGE_DOOR;
                for (const [minX, minZ, maxX, maxZ] of flat) boxes.push([minX, 0, minZ, maxX, 1, maxZ]);
                if (lintel) {
                    const [a, b] = [(axis === 0 ? x : z) + 0.5, axis === 0 ? z : x];
                    const [h, d] = [WALL_THICKNESS / 2, DOOR_WIDTH / 2];
                    boxes.push(axis === 0 ? [a - h, DOOR_HEIGHT, b - d, a + h, 1, b + d] : [b - d, DOOR_HEIGHT, a - h, b + d, 1, a + h]);
                }
            }
            if (store.pillar(x, z)) {
                const [minX, minZ, maxX, maxZ] = pillarBox(x, z, store.pillarHalf);
                boxes.push([minX, 0, minZ, maxX, 1, maxZ]);
            }
        }
    }
    return boxes;
}

/** The stores to look through: a few worlds, and a few tapes (where the walls round it meet the nothing outside). */
function* stores() {
    for (const seed of [0, 1, 2]) yield { store: office(seed), where: `seed ${seed}` };
    for (const seed of [3, 11]) {
        const store = new ChunkStore(seed, null, arenaOptions(seed, LEVEL));
        placeNotes(store, seed);
        yield { store, where: `tape ${seed}`, tape: true };
    }
}

/** The chunks to look at in a store: from −2 to 1 each way (a tape's from one side of it to the other). */
function* chunksOf(store) {
    for (let cx = -2; cx <= 1; cx++) {
        for (let cz = -2; cz <= 1; cz++) {
            const chunk = store.getChunk(cx, cz);
            if (chunk.abandonedOffice && !store.options.isVoid?.(cx, cz)) yield chunk;
        }
    }
}

describe("Level 4's geometry", () => {
    it('draws none of its own things going into another: furniture, props, doors, windows, partitions and lights', () => {
        let things = 0;
        for (const { store, where, tape } of stores()) {
            for (const chunk of chunksOf(store)) {
                // (Not what a tape leaves with its notes: that's the tape's.)
                const own = thingsOf(store, chunk).filter((thing) => !(tape && thing.prop && thing.prop.index === undefined));
                things += own.length;
                for (let i = 0; i < own.length; i++) {
                    for (let j = i + 1; j < own.length; j++) {
                        const [a, b] = [own[i], own[j]];
                        if (!meet(a.box, b.box)) continue;
                        const hit = a.triangles.some((p) => {
                            const pb = boundsOf([p]);
                            return meet(pb, b.box) && b.triangles.some((q) => meet(pb, boundsOf([q])) && crossing(p, q));
                        });
                        expect(hit, `${where}: ${a.what} and ${b.what}`).toBe(false);
                    }
                }
            }
        }
        expect(things).toBeGreaterThan(1500);
    });

    it('keeps all of its things, as they are drawn, out of the walls and the columns, over the floor, under the ceiling and in their chunk', () => {
        for (const { store, where } of stores()) {
            for (const chunk of chunksOf(store)) {
                const x0 = chunk.cx * N - HALF_CHUNK;
                const z0 = chunk.cz * N - HALF_CHUNK;
                const walls = wallsAround(store, chunk);
                for (const thing of thingsOf(store, chunk)) {
                    const [minX, minY, minZ, maxX, maxY, maxZ] = thing.box;
                    expect(minY, `${where}: ${thing.what}`).toBeGreaterThan(-1e-4);
                    expect(maxY, `${where}: ${thing.what}`).toBeLessThan(1 + 1e-4);
                    expect(minX > x0 - 0.5 && minZ > z0 - 0.5 && maxX < x0 + N - 0.5 && maxZ < z0 + N - 0.5, `${where}: ${thing.what}`).toBe(true);
                    // (A window's frame goes through its wall, of course.)
                    if (thing.windows) continue;
                    for (const wall of walls) {
                        // A hair inside it: flat against it is fine.
                        const inside = [wall[0] + 0.0015, wall[1] + 0.0015, wall[2] + 0.0015, wall[3] - 0.0015, wall[4] - 0.0015, wall[5] - 0.0015];
                        if (!meet(thing.box, inside)) continue;
                        expect(thing.triangles.some((tri) => intoBox(tri, inside)), `${where}: ${thing.what} in ${wall.map((v) => v.toFixed(2))}`).toBe(false);
                    }
                }
            }
        }
    });

    it('stands its furniture and its props on the floor, and hangs its clocks, whiteboards and fountains flat against a wall', () => {
        let hung = 0;
        for (const { store, where } of stores()) {
            for (const chunk of chunksOf(store)) {
                for (const thing of thingsOf(store, chunk)) {
                    const piece = thing.piece;
                    if (thing.prop || (piece && !MOUNTED.includes(piece.type))) expect(thing.box[1], `${where}: ${thing.what}`).toBeCloseTo(0, 4);
                    if (!piece || !MOUNTED.includes(piece.type)) continue;
                    hung++;
                    // Its back, on the face of the wall behind it.
                    const [wx, wz] = [-Math.round(Math.sin(piece.yaw)), -Math.round(Math.cos(piece.yaw))];
                    const [cx, cz] = [Math.round(piece.x), Math.round(piece.z)];
                    let back = -Infinity;
                    for (const tri of thing.triangles) for (const [x, , z] of tri) back = Math.max(back, (x - cx) * wx + (z - cz) * wz);
                    expect(back, `${where}: ${thing.what}`).toBeCloseTo(FACE, 4);
                    expect(store.edgeBetween(cx, cz, wx, wz), `${where}: ${thing.what}`).toBe(EDGE_WALL);
                }
            }
        }
        expect(hung).toBeGreaterThan(20);
    });

    it('knows how far each of its props reaches, as it is drawn, whichever of its variants it is', () => {
        const variants = { [PROP_COOLER]: 128, [PROP_FICUS]: 256, [PROP_BIN]: 128, [PROP_FILES]: 256, [PROP_BOXES]: 64, [PROP_MONITOR]: 1, [PROP_BOTTLES]: 512 };
        for (const [type, [half, behind, before]] of PROP_REACH) {
            const round = half === behind && half === before;
            for (let n = 0; n < variants[type]; n++) {
                // (The bottles read all of their variant: spread them over it.)
                const variant = type === PROP_BOTTLES ? Math.imul(n, 0x9e3779b1) >>> 0 : n;
                const p = templateFor({ type, variant, x: 0, z: 0, yaw: 0 }).attributes.position.array;
                for (let i = 0; i < p.length; i += 3) {
                    const where = `prop ${type} variant ${variant}`;
                    if (round) {
                        expect(Math.hypot(p[i], p[i + 2]), where).toBeLessThanOrEqual(half);
                    } else {
                        expect(Math.abs(p[i]), where).toBeLessThanOrEqual(half);
                        expect(p[i + 2], where).toBeGreaterThanOrEqual(-behind);
                        expect(p[i + 2], where).toBeLessThanOrEqual(before);
                    }
                }
            }
            // And against a wall, it keeps off it, and off the end of it.
            const [out, along] = propSpot(type);
            expect(out + (round ? half : behind)).toBeLessThan(FACE);
            expect(along + half).toBeLessThanOrEqual(FACE - CONVECTOR_DEPTH);
        }
    });

    it("runs a kitchen's counter on from one cupboard to the next, with the fridge up against its end", () => {
        let runs = 0;
        for (const { store, where } of stores()) {
            for (const chunk of chunksOf(store)) {
                const pieces = chunk.abandonedOffice.furniture.filter((piece) => piece.type === FURN_COUNTER || piece.type === FURN_FRIDGE);
                // Each one's span along its wall, in the world, and the line it's on.
                const spans = pieces.map((piece) => {
                    const [a, b] = piece.type === FURN_FRIDGE ? [0.13, 0.13] : piece.reach;
                    // (Its own +x, in the world: see abandonedOfficeFurniture.js's `against`.)
                    const [ux, uz] = [Math.round(Math.cos(piece.yaw)), -Math.round(Math.sin(piece.yaw))];
                    const middle = ux !== 0 ? piece.x : piece.z;
                    const s = ux + uz;
                    // (The wall it's against: the line of cells, and which side of them.)
                    const line = `${ux !== 0 ? 'z' : 'x'} ${Math.round(ux !== 0 ? piece.z : piece.x)} ${Math.round(piece.yaw / (Math.PI / 2)) & 3}`;
                    return { piece, line, from: middle - (s > 0 ? a : b), to: middle + (s > 0 ? b : a) };
                });
                for (const span of spans) {
                    if (span.piece.type !== FURN_COUNTER) continue;
                    const [x, z] = [Math.round(span.piece.x), Math.round(span.piece.z)];
                    for (const [end, s] of [[span.from, -1], [span.to, 1]]) {
                        // Up to the next, or at the end of the run, no further than the wall's face.
                        const next = spans.find((other) => other !== span && other.line === span.line && Math.abs((s > 0 ? other.from : other.to) - end) < 1e-9);
                        const middle = s * (end - (span.line[0] === 'z' ? x : z));
                        if (next) runs++;
                        else expect(middle, `${where}: counter at ${span.piece.x},${span.piece.z}`).toBeLessThanOrEqual(FACE + 1e-9);
                        if (Math.abs(middle - 0.5) < 1e-9) expect(next, `${where}: counter at ${span.piece.x},${span.piece.z}`).toBeTruthy();
                    }
                }
                // And none of them overlap.
                for (const a of spans) for (const b of spans) if (a !== b && a.line === b.line) expect(a.to <= b.from + 1e-9 || b.to <= a.from + 1e-9, where).toBe(true);
            }
        }
        expect(runs).toBeGreaterThan(4);
    });

    it("on a tape, puts nothing against its walls (the nothing outside them), so the way out's clear wherever it opens", () => {
        let ways = 0;
        for (const seed of [3, 11, 13]) {
            // A way out on each side, opened as far as it can be from a corner.
            for (const [fromX, fromZ] of [[-40, -40], [40, 40], [-40, 40], [40, -40]]) {
                const store = new ChunkStore(seed, null, arenaOptions(seed, LEVEL));
                const exit = openExit(store, fromX, fromZ);
                for (const [x, z] of exit.cells) {
                    ways++;
                    const chunk = store.getChunk(chunkCoord(x), chunkCoord(z));
                    // The gap in the wall, and a little in front of it.
                    const [lx, lz] = [x + exit.dx * 0.5, z + exit.dz * 0.5];
                    const gap = exit.dx !== 0 ? [lx - 0.12, z - 0.5, lx + 0.12, z + 0.5] : [x - 0.5, lz - 0.12, x + 0.5, lz + 0.12];
                    for (const piece of chunk.abandonedOffice.furniture) {
                        // (Not the chairs left about: they're not against anything.)
                        if (piece.type === FURN_CHAIR || piece.type === FURN_STACK) continue;
                        const box = furnitureBox(piece) ?? [piece.x - 0.05, piece.z - 0.05, piece.x + 0.05, piece.z + 0.05];
                        expect(overlap(box, gap), `seed ${seed}: furniture ${piece.type} at ${piece.x},${piece.z}`).toBe(false);
                    }
                    for (const prop of chunk.props) {
                        const box = prop.box ?? [prop.x - 0.05, prop.z - 0.05, prop.x + 0.05, prop.z + 0.05];
                        expect(overlap(box, gap), `seed ${seed}: prop ${prop.type} at ${prop.x},${prop.z}`).toBe(false);
                    }
                }
            }
        }
        expect(ways).toBe(24);
    });

    it('turns the corners of its light wells cleanly: the heating under the windows goes round a corner the room goes round', () => {
        let corners = 0;
        for (const { store, where } of stores()) {
            for (const chunk of chunksOf(store)) {
                const x0 = chunk.cx * N - HALF_CHUNK;
                const z0 = chunk.cz * N - HALF_CHUNK;
                const edge = (x, z, axis) => store.edge(x, z, axis);
                for (const { i0, j0, i1, j1 } of chunk.abandonedOffice.wells) {
                    // Each corner: its bays on the side along z (owned by the cell on the well's −x side, or its own on
                    // the +x side), and the corner's point.
                    for (const [i, sx] of [[i0 - 1, -1], [i1, 1]]) {
                        for (const [j, s] of [[j0, -1], [j1, 1]]) {
                            if (windowEnd(edge, x0 + i, z0 + j, 0, sx > 0 ? 1 : -1, s) !== END_ROUND) continue;
                            corners++;
                            // The square outside the corner of the walls, where the two sides' heating meet.
                            const cx = x0 + i + 0.5 + sx * (WALL_THICKNESS / 2 + CONVECTOR_DEPTH / 2);
                            const cz = z0 + j + s * (0.5 + WALL_THICKNESS / 2 + CONVECTOR_DEPTH / 2);
                            expect(chunk.solids.some(([minX, minZ, maxX, maxZ]) => minX < cx && cx < maxX && minZ < cz && cz < maxZ), `${where}: ${cx},${cz}`).toBe(true);
                        }
                    }
                }
            }
        }
        expect(corners).toBeGreaterThan(4);
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
