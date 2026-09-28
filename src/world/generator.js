import { CHUNK_SIZE, HALF_CHUNK } from '../config.js';
import { placeDecorations } from './decorations.js';
import { DIRECTIONS, EDGE_DOOR, EDGE_NONE, EDGE_WALL, mod } from './grid.js';
import { hashFloat, hashInts, mulberry32, valueNoise } from './random.js';
import { ZONE_HALLS, ZONE_MAZE, ZONE_PILLARS, ZONE_ROOMS, isEnclosed, zoneAt } from './zones.js';

const N = CHUNK_SIZE;
export const PANELS_PER_SIDE = N / 2;

/**
 * @typedef {object} ChunkData
 * @property {number} cx
 * @property {number} cz
 * @property {import('./zones.js').Zone} zone
 * @property {Uint8Array} edgesX +x edge type of each cell, indexed `i * N + j` by local cell.
 * @property {Uint8Array} edgesZ +z edge type of each cell.
 * @property {Uint8Array} pillars 1 where the cell's +x+z corner has a pillar.
 * @property {Uint8Array} lights 4 bytes per ceiling panel, indexed `(pi * PANELS_PER_SIDE + pj) * 4`:
 *     brightness (0 = dead), area light, flicker pattern (0 = steady), and Level Fun's gel (255 = none, see
 *     party.js).
 * @property {import('./decorations.js').Prop[]} props
 * @property {import('./decorations.js').Leak[]} leaks Ceiling stain plus the wet carpet under it.
 * @property {import('./party.js').PartyDressing | null} [party] Level Fun's decorations while it's on. In Level 1,
 *     also the party leaking out around the way on (see levelOne.js).
 * @property {number[][]} [solids] Other level-specific solids (Level 1's cars, Level 2's machines, Level 4's
 *     furniture and light wells, Level 5's furniture) as [minX, minZ, maxX, maxZ]. Each stays inside the chunk.
 * @property {import('./ground.js').Ground} [ground] Uneven floor (Level 37).
 * @property {import('./poolrooms.js').Ladder[]} [ladders] Pool ladders (Level 37). Each stays inside the chunk.
 * @property {Map<number, number | null>} [outlets] Edit mode outlet changes by outletSlot (see outlets.js): offset
 *     along the wall, or null if removed. Anything not in here is where the seed put it.
 * @property {Uint8Array} [cells] 4 bytes per cell for the level's shaders, indexed `(i * N + j) * 4` (see
 *     PanelLightMap.cells). The first 3 are the level's, the 4th comes from the walls.
 * @property {{ edgesX: Uint8Array, edgesZ: Uint8Array, pillars: Uint8Array, lights: Uint8Array }} [generated] Edges,
 *     pillars and lights before any edits. Only set when the world keeps edits (see ChunkStore.getChunk).
 * @property {import('./levelOne.js').LevelOneData} [levelOne] Level 1 extras.
 * @property {import('./poolrooms.js').PoolroomsData} [poolrooms] Level 37 extras.
 * @property {import('./pipeDreams.js').PipeDreamsData} [pipeDreams] Level 2 extras.
 * @property {import('./abandonedOffice.js').AbandonedOfficeData} [abandonedOffice] Level 4 extras.
 * @property {import('./terrorHotel.js').TerrorHotelData} [terrorHotel] Level 5 extras.
 */

/**
 * @typedef {object} WorldOptions
 * Game mode tweaks to generation (see footage/arena.js). All optional. Without them you get the endless level.
 * @property {(cx: number, cz: number) => import('./zones.js').Zone | null} [zoneAt] Zone for a chunk, or null for
 *     the usual regions.
 * @property {(cx: number, cz: number) => boolean} [isVoid] Empty chunks: unlit floor, no walls, lights, stains or
 *     props.
 * @property {(axis: 0 | 1, cx: number, cz: number) => boolean} [isSealed] Borders (addressed like borderLine) that
 *     are solid wall all the way.
 * @property {number} [level] Level id (see levels.js). Defaults to Level 0.
 */

/**
 * Generates one chunk from the world seed.
 *
 * Chunks are generated independently, in any order. Neighbors only share the wall line on their border, which
 * comes from `borderLine` using the border's own coordinates, so both sides agree. Each chunk connects all its own
 * cells and every border has at least one opening, so the whole infinite level is connected.
 *
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @param {WorldOptions} [options]
 * @returns {ChunkData}
 */
export function generateChunk(seed, cx, cz, options = {}) {
    const zoneOf = (x, z) => options.zoneAt?.(x, z) ?? zoneAt(seed, x, z);
    const zone = zoneOf(cx, cz);
    const random = mulberry32(hashInts(seed, cx, cz));
    const layout = borderedLayout(seed, cx, cz, options);
    const x0 = cx * N - HALF_CHUNK; // world coords of the first cell
    const z0 = cz * N - HALF_CHUNK;
    const empty = options.isVoid?.(cx, cz) === true;

    if (empty) {
        // Nothing inside.
    } else {
        switch (zone.type) {
            case ZONE_ROOMS:
                generateRooms(layout, random, false);
                break;
            case ZONE_HALLS:
                generateRooms(layout, random, true);
                break;
            case ZONE_MAZE:
                generateMaze(layout, random);
                break;
            case ZONE_PILLARS:
                generatePillarHall(layout, random, seed, zone, zoneOf, cx, cz);
                break;
            default:
                generateOpenFloor(layout, random);
        }
    }

    if (cx === 0 && cz === 0) stampSpawnRoom(layout);
    removeBuriedPillars(layout);
    connectAll(layout, random);
    // Has to come after the walls so adding decorations didn't change existing worlds' layouts.
    const { props, leaks } = empty
        ? { props: [], leaks: [] }
        : placeDecorations(random, (i, j, di, dj) => layout.between(i, j, di, dj), x0, z0);
    for (let i = 0; i < props.length; i++) props[i].index = i;

    const { edgesX, edgesZ, pillars } = layout.cellData();
    return { cx, cz, zone, edgesX, edgesZ, pillars, lights: generateLights(seed, x0, z0, empty), props, leaks };
}

/**
 * New layout with the 4 borders filled in (see borderLine). Every level's generator starts here. Borders are the
 * only thing chunks share, so they don't depend on what's generated inside.
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @param {WorldOptions} [options]
 * @returns {Layout}
 */
export function borderedLayout(seed, cx, cz, options = {}) {
    const layout = new Layout();
    const west = borderLine(seed, 0, cx, cz, options);
    const east = borderLine(seed, 0, cx + 1, cz, options);
    const south = borderLine(seed, 1, cx, cz, options);
    const north = borderLine(seed, 1, cx, cz + 1, options);
    for (let k = 0; k < N; k++) {
        layout.setV(0, k, west[k]);
        layout.setV(N, k, east[k]);
        layout.setH(k, 0, south[k]);
        layout.setH(k, N, north[k]);
    }
    return layout;
}

/**
 * Wall line on the low-x (axis 0) or low-z (axis 1) border of chunk (cx, cz). How much wall depends on the zones
 * on both sides.
 *
 * @param {number} seed
 * @param {0 | 1} axis
 * @param {number} cx
 * @param {number} cz
 * @param {WorldOptions} [options]
 * @returns {Uint8Array} One edge type per cell along the border.
 */
export function borderLine(seed, axis, cx, cz, options = {}) {
    const line = new Uint8Array(N);
    if (options.isSealed?.(axis, cx, cz)) return line.fill(EDGE_WALL);
    const beforeX = axis === 0 ? cx - 1 : cx;
    const beforeZ = axis === 0 ? cz : cz - 1;
    // No wall between two empty chunks.
    if (options.isVoid?.(beforeX, beforeZ) && options.isVoid?.(cx, cz)) return line;
    const zoneOf = (x, z) => options.zoneAt?.(x, z) ?? zoneAt(seed, x, z);
    const before = zoneOf(beforeX, beforeZ).type;
    const after = zoneOf(cx, cz).type;
    const random = mulberry32(hashInts(seed, 0xb0d, axis, cx, cz));
    const set = (k, type) => {
        line[k] = type;
    };

    if (!isEnclosed(before) && !isEnclosed(after)) {
        // Two open areas just flow together, with maybe one stray wall. It stays off the ends because a chunk
        // corner can have a pillar and the chunk that owns it can't see this border.
        if (random() < 0.35) {
            const length = 2 + Math.floor(random() * 4);
            const start = 1 + Math.floor(random() * (N - length - 1));
            line.fill(EDGE_WALL, start, start + length);
        }
        return line;
    }

    line.fill(EDGE_WALL);
    if (before === ZONE_MAZE && after === ZONE_MAZE) {
        // Continue the maze with a few one-cell passages.
        punchOpenings(N, set, random, 3 + Math.floor(random() * 3), 'maze');
    } else if (isEnclosed(before) && isEnclosed(after)) {
        punchOpenings(N, set, random, 2 + Math.floor(random() * 3), 'rooms');
    } else {
        // Edge of an open area: long wall with lots of openings, some wide.
        punchOpenings(N, set, random, 4 + Math.floor(random() * 4), 'edge');
    }
    return line;
}

// ---------------------------------------------------------------------------------------------- layout

/**
 * A chunk's walls during generation, borders included.
 *
 * Vertical lines (walls along z) use `i` = 0..N for the line on the low-x side of column i (0 and N are the west
 * and east borders) and `j` for the row. Horizontal lines are the other way around: column `i`, line `j` = 0..N.
 * Corners are (i, j), both 0..N.
 */
export class Layout {
    constructor() {
        this.v = new Uint8Array((N + 1) * N);
        this.h = new Uint8Array(N * (N + 1));
        this.pillars = new Uint8Array((N + 1) * (N + 1));
    }

    getV(i, j) {
        return this.v[i * N + j];
    }

    setV(i, j, type) {
        this.v[i * N + j] = type;
    }

    getH(i, j) {
        return this.h[i * (N + 1) + j];
    }

    setH(i, j, type) {
        this.h[i * (N + 1) + j] = type;
    }

    getPillar(i, j) {
        return this.pillars[i * (N + 1) + j];
    }

    setPillar(i, j, on) {
        this.pillars[i * (N + 1) + j] = on ? 1 : 0;
    }

    /** Sets vertical line i over rows [j0, j1), clamped to the chunk. */
    vRun(i, j0, j1, type) {
        for (let j = Math.max(j0, 0); j < Math.min(j1, N); j++) this.setV(i, j, type);
    }

    hRun(j, i0, i1, type) {
        for (let i = Math.max(i0, 0); i < Math.min(i1, N); i++) this.setH(i, j, type);
    }

    /** Edge between local cell (i, j) and its neighbor in direction (di, dj). */
    between(i, j, di, dj) {
        if (di === 1) return this.getV(i + 1, j);
        if (di === -1) return this.getV(i, j);
        if (dj === 1) return this.getH(i, j + 1);
        return this.getH(i, j);
    }

    setBetween(i, j, di, dj, type) {
        if (di === 1) this.setV(i + 1, j, type);
        else if (di === -1) this.setV(i, j, type);
        else if (dj === 1) this.setH(i, j + 1, type);
        else this.setH(i, j, type);
    }

    /** Clears edges and pillars strictly inside the cell rect [i0, i1) × [j0, j1). */
    clearInside(i0, j0, i1, j1) {
        for (let i = i0 + 1; i < i1; i++) this.vRun(i, j0, j1, EDGE_NONE);
        for (let j = j0 + 1; j < j1; j++) this.hRun(j, i0, i1, EDGE_NONE);
        for (let i = i0 + 1; i < i1; i++) for (let j = j0 + 1; j < j1; j++) this.setPillar(i, j, false);
    }

    /**
     * Converts to ChunkData's per-cell format: +x edge, +z edge and +x+z corner.
     * @returns {{ edgesX: Uint8Array, edgesZ: Uint8Array, pillars: Uint8Array }}
     */
    cellData() {
        const edgesX = new Uint8Array(N * N);
        const edgesZ = new Uint8Array(N * N);
        const pillars = new Uint8Array(N * N);
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                edgesX[i * N + j] = this.getV(i + 1, j);
                edgesZ[i * N + j] = this.getH(i, j + 1);
                pillars[i * N + j] = this.getPillar(i + 1, j + 1);
            }
        }
        return { edgesX, edgesZ, pillars };
    }
}

/**
 * Places pillars on a grid that continues across chunks (pillar halls, parking garage columns). `standsAt(x, z)`
 * gets the cell whose +x+z corner it is. Corners on the east and north borders belong to this chunk but only get a
 * pillar if `carriesOn` the neighbor too, otherwise they could end up against the neighbor's walls.
 * @param {Layout} layout
 * @param {number} cx
 * @param {number} cz
 * @param {(cx: number, cz: number) => boolean} carriesOn True if the same open floor continues into that chunk.
 * @param {(x: number, z: number) => boolean} standsAt
 */
export function placeGridPillars(layout, cx, cz, carriesOn, standsAt) {
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const lastI = carriesOn(cx + 1, cz) ? N : N - 1;
    const lastJ = carriesOn(cx, cz + 1) ? N : N - 1;
    // The far corner touches 4 chunks and the borders between the other 3 could be walls.
    const cornerOk = lastI === N && lastJ === N && carriesOn(cx + 1, cz + 1);
    for (let i = 1; i <= lastI; i++) {
        for (let j = 1; j <= lastJ; j++) {
            if (i === N && j === N && !cornerOk) continue;
            // Corner (i, j) is the +x+z corner of world cell (x0 + i - 1, z0 + j - 1).
            if (standsAt(x0 + i - 1, z0 + j - 1)) layout.setPillar(i, j, true);
        }
    }
}

/**
 * Puts `count` openings in a run of wall, spaced so they don't bunch up.
 * @param {number} length Cells along the run.
 * @param {(k: number, type: number) => void} set
 * @param {() => number} random
 * @param {number} count
 * @param {'rooms' | 'maze' | 'edge'} style
 */
export function punchOpenings(length, set, random, count, style) {
    const used = new Uint8Array(length);
    let placed = 0;
    for (let n = 0; n < count; n++) {
        for (let attempt = 0; attempt < 10; attempt++) {
            const k = Math.floor(random() * length);
            if (used[k] || used[k - 1] || used[k + 1]) continue;
            const roll = random();
            if (style === 'maze' || roll < 0.28) {
                set(k, EDGE_NONE);
                used[k] = 1;
            } else if (roll < (style === 'edge' ? 0.7 : 0.87)) {
                set(k, EDGE_DOOR);
                used[k] = 1;
            } else {
                // Wide opening, 2 or 3 cells.
                const width = Math.min(random() < 0.6 ? 2 : 3, length - k);
                for (let w = 0; w < width; w++) {
                    set(k + w, EDGE_NONE);
                    used[k + w] = 1;
                }
            }
            placed++;
            break;
        }
    }
    if (placed === 0) set(length >> 1, EDGE_DOOR);
}

// ---------------------------------------------------------------------------------------------- zones

/**
 * Offices. The chunk is split recursively (BSP) into rooms and every cut wall gets at least one opening, so rooms
 * always connect. Some cuts leave no wall or a wall that stops short, so it doesn't look like a neat grid of boxes.
 *
 * With `corridors`, the first cuts across big areas become one-cell corridors lined with doorways.
 */
export function generateRooms(layout, random, corridors) {
    const MIN_ROOM = 2;
    // Some offices get cubicle-sized rooms, others big open ones.
    const maxRoom = corridors ? 4 + Math.floor(random() * 2) : 4 + Math.floor(random() ** 0.8 * 6);

    const wallAlong = (vertical, line, k0, k1, depth) => {
        const length = k1 - k0;
        const set = vertical
            ? (k, type) => layout.setV(line, k0 + k, type)
            : (k, type) => layout.setH(k0 + k, line, type);
        const roll = random();
        // Open plan: two neighboring rooms merge into one irregular space.
        if (!corridors && depth > 0 && roll < 0.14) return;
        for (let k = 0; k < length; k++) set(k, EDGE_WALL);
        if (roll < (corridors ? 0.18 : 0.34) && length >= 3) {
            // Wall stops short of one end.
            const gap = 1 + Math.floor(random() * Math.min(3, length - 2));
            const fromStart = random() < 0.5;
            for (let k = 0; k < gap; k++) set(fromStart ? k : length - 1 - k, EDGE_NONE);
            if (length - gap >= 6 && random() < 0.5) {
                const k = fromStart ? gap + 1 + Math.floor(random() * (length - gap - 2)) : 1 + Math.floor(random() * (length - gap - 2));
                set(k, EDGE_DOOR);
            }
            return;
        }
        const count = 1 + (length >= 6 && random() < 0.55 ? 1 : 0) + (length >= 10 && random() < 0.5 ? 1 : 0);
        punchOpenings(length, set, random, count, 'rooms');
    };

    const corridor = (vertical, x0, z0, x1, z1, depth) => {
        // One column (or row) of cells, walled on both sides, with doors every few cells.
        const [a0, a1, b0, b1] = vertical ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
        const c = a0 + 3 + Math.floor(random() * (a1 - a0 - 6));
        for (const line of [c, c + 1]) {
            const set = vertical ? (k, type) => layout.setV(line, b0 + k, type) : (k, type) => layout.setH(b0 + k, line, type);
            const length = b1 - b0;
            for (let k = 0; k < length; k++) set(k, EDGE_WALL);
            let k = Math.floor(random() * 3);
            while (k < length) {
                set(k, random() < 0.8 ? EDGE_DOOR : EDGE_NONE);
                k += 2 + Math.floor(random() * 3);
            }
        }
        // Open both ends, except at the chunk border which is fixed.
        if (vertical) {
            if (z0 > 0) layout.setH(c, z0, EDGE_NONE);
            if (z1 < N) layout.setH(c, z1, EDGE_NONE);
            split(x0, z0, c, z1, depth + 1);
            split(c + 1, z0, x1, z1, depth + 1);
        } else {
            if (x0 > 0) layout.setV(x0, c, EDGE_NONE);
            if (x1 < N) layout.setV(x1, c, EDGE_NONE);
            split(x0, z0, x1, c, depth + 1);
            split(x0, c + 1, x1, z1, depth + 1);
        }
    };

    const split = (x0, z0, x1, z1, depth) => {
        const w = x1 - x0;
        const h = z1 - z0;
        const canSplitX = w >= 2 * MIN_ROOM;
        const canSplitZ = h >= 2 * MIN_ROOM;
        const fits = w <= maxRoom && h <= maxRoom;
        if ((!canSplitX && !canSplitZ) || (fits && random() < (w * h <= 9 ? 0.9 : 0.6))) {
            furnishRoom(layout, random, x0, z0, x1, z1);
            return;
        }
        const vertical = canSplitX && (!canSplitZ || random() < (w > h ? 0.8 : w < h ? 0.2 : 0.5));
        if (corridors && depth < 2 && (vertical ? w : h) >= 9 && random() < (depth === 0 ? 0.9 : 0.6)) {
            corridor(vertical, x0, z0, x1, z1, depth);
            return;
        }
        if (vertical) {
            const i = x0 + MIN_ROOM + Math.floor(random() * (w - 2 * MIN_ROOM + 1));
            wallAlong(true, i, z0, z1, depth);
            split(x0, z0, i, z1, depth + 1);
            split(i, z0, x1, z1, depth + 1);
        } else {
            const j = z0 + MIN_ROOM + Math.floor(random() * (h - 2 * MIN_ROOM + 1));
            wallAlong(false, j, x0, x1, depth);
            split(x0, z0, x1, j, depth + 1);
            split(x0, j, x1, z1, depth + 1);
        }
    };

    split(0, 0, N, N, 0);
}

/** Sometimes breaks up a big room with pillars or a short partition. */
function furnishRoom(layout, random, x0, z0, x1, z1) {
    const w = x1 - x0;
    const h = z1 - z0;
    const roll = random();
    if (w >= 4 && h >= 4 && roll < 0.25) {
        // Pillars on every other corner, away from the walls.
        for (let i = x0 + 2; i <= x1 - 2; i += 2) {
            for (let j = z0 + 2; j <= z1 - 2; j += 2) layout.setPillar(i, j, true);
        }
    } else if (w * h >= 12 && roll < 0.42) {
        // Partition out from one wall, never all the way across.
        if (w >= h) {
            const i = x0 + 1 + Math.floor(random() * (w - 1));
            const length = 1 + Math.floor(random() * (h - 1));
            if (random() < 0.5) layout.vRun(i, z0, z0 + length, EDGE_WALL);
            else layout.vRun(i, z1 - length, z1, EDGE_WALL);
        } else {
            const j = z0 + 1 + Math.floor(random() * (h - 1));
            const length = 1 + Math.floor(random() * (w - 1));
            if (random() < 0.5) layout.hRun(j, x0, x0 + length, EDGE_WALL);
            else layout.hRun(j, x1 - length, x1, EDGE_WALL);
        }
    }
}

/**
 * Maze of one-cell passages. Randomized DFS carves a spanning tree through a fully walled grid, then some dead
 * ends and walls get knocked out so there are loops.
 */
function generateMaze(layout, random) {
    for (let i = 1; i < N; i++) layout.vRun(i, 0, N, EDGE_WALL);
    for (let j = 1; j < N; j++) layout.hRun(j, 0, N, EDGE_WALL);

    const visited = new Uint8Array(N * N);
    const start = Math.floor(random() * N * N);
    const stack = [start];
    visited[start] = 1;
    const options = [];
    let lastDirection = -1;
    while (stack.length > 0) {
        const cell = stack[stack.length - 1];
        const i = Math.floor(cell / N);
        const j = cell % N;
        options.length = 0;
        for (let d = 0; d < 4; d++) {
            const ni = i + DIRECTIONS[d][0];
            const nj = j + DIRECTIONS[d][1];
            if (ni >= 0 && nj >= 0 && ni < N && nj < N && !visited[ni * N + nj]) options.push(d);
        }
        if (options.length === 0) {
            stack.pop();
            lastDirection = -1;
            continue;
        }
        // Bias toward going straight. Longer runs look better at eye level.
        const d = options.includes(lastDirection) && random() < 0.35
            ? lastDirection
            : options[Math.floor(random() * options.length)];
        const [di, dj] = DIRECTIONS[d];
        layout.setBetween(i, j, di, dj, EDGE_NONE);
        visited[(i + di) * N + (j + dj)] = 1;
        stack.push((i + di) * N + (j + dj));
        lastDirection = d;
    }

    // Open some dead ends and a few random walls so there's more than one route.
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const closed = [];
            for (const [di, dj] of DIRECTIONS) {
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
                if (layout.between(i, j, di, dj) === EDGE_WALL) closed.push([di, dj]);
            }
            if (closed.length === 3 && random() < 0.35) {
                const [di, dj] = closed[Math.floor(random() * closed.length)];
                layout.setBetween(i, j, di, dj, EDGE_NONE);
            }
        }
    }
    for (let i = 1; i < N; i++) {
        for (let j = 0; j < N; j++) {
            if (layout.getV(i, j) !== EDGE_WALL) continue;
            const roll = random();
            if (roll < 0.03) layout.setV(i, j, EDGE_NONE);
            else if (roll < 0.06) layout.setV(i, j, EDGE_DOOR);
        }
    }
    for (let i = 0; i < N; i++) {
        for (let j = 1; j < N; j++) {
            if (layout.getH(i, j) !== EDGE_WALL) continue;
            const roll = random();
            if (roll < 0.03) layout.setH(i, j, EDGE_NONE);
            else if (roll < 0.06) layout.setH(i, j, EDGE_DOOR);
        }
    }

    // Sometimes a small room in the middle.
    if (random() < 0.6) {
        const w = 2 + Math.floor(random() * 2);
        const h = 2 + Math.floor(random() * 2);
        const i0 = 1 + Math.floor(random() * (N - w - 2));
        const j0 = 1 + Math.floor(random() * (N - h - 2));
        layout.clearInside(i0, j0, i0 + w, j0 + h);
    }
}

/**
 * Big hall with pillars on a regular grid. Spacing and phase come from the zone and world coords so it lines up
 * across chunk borders. A few freestanding walls break up the view.
 */
function generatePillarHall(layout, random, seed, zone, zoneOf, cx, cz) {
    const spacing = 2 + (zone.variant % 2);
    const offset = (zone.variant >>> 8) % spacing;
    const sameHall = (ncx, ncz) => {
        const other = zoneOf(ncx, ncz);
        return other.type === ZONE_PILLARS && other.variant === zone.variant;
    };
    placeGridPillars(layout, cx, cz, sameHall, (x, z) => mod(x - offset, spacing) === 0 && mod(z - offset, spacing) === 0
        // a few pillars missing
        && hashFloat(seed, 0x9111, x + 1, z + 1) >= 0.05);

    const walls = Math.floor(random() * 3);
    for (let n = 0; n < walls; n++) {
        const length = 2 + Math.floor(random() * 5);
        const line = 2 + Math.floor(random() * (N - 3));
        const start = 1 + Math.floor(random() * (N - length - 1));
        if (random() < 0.5) layout.vRun(line, start, start + length, EDGE_WALL);
        else layout.hRun(line, start, start + length, EDGE_WALL);
    }
}

/** Big, mostly empty floor with a few stray walls and pillars. */
function generateOpenFloor(layout, random) {
    const pieces = 2 + Math.floor(random() * 5);
    for (let n = 0; n < pieces; n++) {
        const i = 2 + Math.floor(random() * (N - 4));
        const j = 2 + Math.floor(random() * (N - 4));
        const a = 2 + Math.floor(random() * 5);
        const b = 2 + Math.floor(random() * 4);
        const up = random() < 0.5;
        const right = random() < 0.5;
        const shape = random();
        if (shape < 0.5) {
            if (random() < 0.5) layout.vRun(i, up ? j : j - a, up ? j + a : j, EDGE_WALL);
            else layout.hRun(j, right ? i : i - a, right ? i + a : i, EDGE_WALL);
        } else {
            // L shape: one wall along z from the corner, one along x.
            layout.vRun(i, up ? j : j - a, up ? j + a : j, EDGE_WALL);
            layout.hRun(j, right ? i : i - b, right ? i + b : i, EDGE_WALL);
        }
    }
    const pillars = Math.floor(random() * 4);
    for (let n = 0; n < pillars; n++) {
        layout.setPillar(2 + Math.floor(random() * (N - 3)), 2 + Math.floor(random() * (N - 3)), true);
    }
}

/**
 * Spawn room. You face a doorway into the next room (the classic Backrooms view) with the far corner open for
 * depth. Local cell (8, 8) is world cell (0, 0), where the player spawns facing −z.
 */
function stampSpawnRoom(layout) {
    const [i0, j0, i1, j1] = [6, 6, 11, 10]; // world x −2..2, z −2..1
    layout.clearInside(i0, j0, i1, j1);
    layout.vRun(i0, j0, j1, EDGE_WALL);
    layout.vRun(i1, j0, j1, EDGE_WALL);
    layout.hRun(j0, i0, i1, EDGE_WALL);
    layout.hRun(j1, i0, i1, EDGE_WALL);
    layout.setH(7, j0, EDGE_DOOR); // ahead, a bit to the left
    layout.setH(10, j0, EDGE_NONE); // far right corner open
    layout.setV(i0, 8, EDGE_NONE); // opening on the left
    layout.setV(i1, 9, EDGE_DOOR); // doorway on the right
    layout.setH(8, j1, EDGE_NONE); // opening behind
    // Wall across the next room so the view through the doorway isn't empty.
    layout.hRun(3, 5, 9, EDGE_WALL);
    layout.setH(6, 3, EDGE_NONE);
}

/** Drops pillars that ended up where walls meet. */
export function removeBuriedPillars(layout) {
    for (let i = 1; i <= N; i++) {
        for (let j = 1; j <= N; j++) {
            if (!layout.getPillar(i, j)) continue;
            const buried = (j > 0 && layout.getV(i, j - 1)) || (j < N && layout.getV(i, j))
                || (i > 0 && layout.getH(i - 1, j)) || (i < N && layout.getH(i, j));
            if (buried) layout.setPillar(i, j, false);
        }
    }
}

/**
 * Makes sure every cell can reach every other without leaving the chunk. Flood fills from one cell and whenever it
 * gets stuck, opens a wall between reached and unreached cells. Zone generators should already be connected so
 * this is just a safety net. It also lets the spawn room be stamped on top of anything.
 * @param {Layout} layout
 * @param {() => number} random
 * @param {Uint8Array | null} [skip] Cells (local i * N + j, 1) to leave unreachable, e.g. Level 4's walled-off
 *     light wells.
 */
export function connectAll(layout, random, skip = null) {
    const reached = skip ? Uint8Array.from(skip) : new Uint8Array(N * N);
    let total = N * N;
    if (skip) for (const cell of skip) total -= cell;
    const start = skip ? reached.indexOf(0) : 0;
    if (start < 0) return;
    const queue = [start];
    reached[start] = 1;
    let count = skip ? N * N - total + 1 : 1;
    const candidates = [];
    while (count < N * N) {
        while (queue.length > 0) {
            const cell = queue.pop();
            const i = Math.floor(cell / N);
            const j = cell % N;
            for (const [di, dj] of DIRECTIONS) {
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= N || nj >= N || reached[ni * N + nj]) continue;
                if (layout.between(i, j, di, dj) === EDGE_WALL) continue;
                reached[ni * N + nj] = 1;
                count++;
                queue.push(ni * N + nj);
            }
        }
        if (count === N * N) break;

        candidates.length = 0;
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                if (!reached[i * N + j] || skip?.[i * N + j]) continue;
                for (const [di, dj] of DIRECTIONS) {
                    const ni = i + di;
                    const nj = j + dj;
                    if (ni >= 0 && nj >= 0 && ni < N && nj < N && !reached[ni * N + nj]) candidates.push([i, j, di, dj]);
                }
            }
        }
        const [i, j, di, dj] = candidates[Math.floor(random() * candidates.length)];
        layout.setBetween(i, j, di, dj, random() < 0.7 ? EDGE_DOOR : EDGE_NONE);
        reached[(i + di) * N + (j + dj)] = 1;
        count++;
        queue.push((i + di) * N + (j + dj));
    }
}

// ---------------------------------------------------------------------------------------------- lights

/**
 * Darkness at a point, 0 (normal) to 1 (all lights dead). Low-frequency noise makes a few dark patches. Spawn is
 * always lit.
 */
export function darknessAt(seed, x, z) {
    const n = 0.62 * valueNoise(seed ^ 0xda4c, x / 26, z / 26) + 0.38 * valueNoise(seed ^ 0x4e1f, x / 9, z / 9);
    let darkness = smoothstep(0.6, 0.73, n);
    const distance = Math.hypot(x, z);
    if (distance < 26) darkness *= smoothstep(16, 26, distance);
    return darkness;
}

/**
 * Lights for an empty chunk outside a game mode's walls. All off, no area light, and `slot` in each 4th byte (see
 * ChunkData.lights).
 * @param {number} slot
 */
export function darkLights(slot) {
    const lights = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE * 4);
    for (let k = 3; k < lights.length; k += 4) lights[k] = slot;
    return lights;
}

/**
 * Just the lights of chunk (cx, cz), same as generateChunk makes them. For checking a neighbor's lights while
 * generating or dressing a chunk (see peelTop in peels.js).
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @param {WorldOptions} [options]
 */
export function chunkLights(seed, cx, cz, options = {}) {
    return generateLights(seed, cx * N - HALF_CHUNK, cz * N - HALF_CHUNK, options.isVoid?.(cx, cz) === true);
}

/**
 * Ceiling panels sit on every cell with both world coords odd.
 * @param {boolean} [dead] All lights off, no area light (empty chunk).
 */
function generateLights(seed, x0, z0, dead = false) {
    if (dead) return darkLights(255);
    const lights = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE * 4);
    for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
        for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
            const x = x0 + pi * 2 + 1;
            const z = z0 + pj * 2 + 1;
            const darkness = darknessAt(seed, x, z);
            let brightness = 255;
            let flicker = 0;
            if (Math.abs(x) < 8 && Math.abs(z) < 8) {
                // All lights work around spawn.
            } else if (hashFloat(seed, 0x119, x, z) < 0.02 + 0.9 * darkness) {
                brightness = 0;
            } else {
                if (hashFloat(seed, 0x11a, x, z) < 0.06) brightness = 150 + Math.floor(hashFloat(seed, 0x11b, x, z) * 70);
                // Flickering tubes cluster around the edges of dark patches.
                if (hashFloat(seed, 0x11c, x, z) < 0.02 + darkness * (1 - darkness)) {
                    flicker = 1 + (hashInts(seed, 0x11d, x, z) % 255);
                }
            }
            const k = (pi * PANELS_PER_SIDE + pj) * 4;
            lights[k] = brightness;
            lights[k + 1] = Math.round(255 * (1 - 0.82 * darkness));
            lights[k + 2] = flicker;
            lights[k + 3] = 255;
        }
    }
    return lights;
}

export function smoothstep(edge0, edge1, x) {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
}
