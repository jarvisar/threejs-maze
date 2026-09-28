import { CHUNK_SIZE, HALF_CHUNK, WALL_THICKNESS } from '../config.js';
import { PANELS_PER_SIDE, borderedLayout, connectAll, darkLights, generateRooms, placeGridPillars, removeBuriedPillars, smoothstep } from './generator.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, mod } from './grid.js';
import { placeLevelOneProps, rackRowsAlongX } from './levelOneProps.js';
import { propFootprint } from './props.js';
import { hashFloat, hashInts, mulberry32, valueNoise } from './random.js';
import { ZONE_PARKING, ZONE_SERVICE, ZONE_STORAGE, zoneAt } from './zones.js';

/*
 * Level 1: an underground car park that goes on for ever, with a warehouse and service corridors behind it. Bare
 * concrete, a low slab ceiling with beams and pipes under it, a column every few metres with its bay stencilled on
 * it, rows of fluorescent battens with dark between them, puddles everywhere, mist on the floor.
 *
 * Same grid of cells as Level 0 (walls on the lines between cells, a light slot over every odd cell), so movement,
 * collision, edit mode and tapes (see footage/) all work on it unchanged. This file works out the layout: columns
 * and walls, aisles and bays, the cars left in them, the odd bay walled in round a stair, and what's painted on the
 * floor. levelOneGeometry.js builds the meshes, materials.js and levelOneShading.js do the concrete, paint, water
 * and air. levels.js ties it in.
 */

const N = CHUNK_SIZE;

/** How wide Level 1's columns are (about 70 cm, Level 0's pillars are 49). */
export const LEVEL_ONE_PILLAR = 0.26;
/** The column grid: a column every BAY cells (about 8 m) both ways, on the lines x, z = BAY·k + 1.5. */
export const BAY = 3;
/** How near the start the lights all work. */
const LIT_START = 9;

/** What Level 1's regions are made of (see zones.js): mostly car park. Where you start is always car park. */
export const LEVEL_ONE_ZONES = Object.freeze({
    weights: [
        [ZONE_PARKING, 52],
        [ZONE_STORAGE, 26],
        [ZONE_SERVICE, 22],
    ],
    start: ZONE_PARKING,
    salt: 0x1e00,
});

/** A light slot's fourth byte in Level 1 (see ChunkData.lights): the kind of tube in it. */
export const TUBE_COOL = 255;
export const TUBE_OLD = 254; // an old tube gone green
export const TUBE_WARM = 253; // a warm one someone put in

/** Which way a light slot's batten runs, if there is one (see LevelOneData.fixtures). */
export const FIXTURE_NONE = 0;
export const FIXTURE_X = 1;
export const FIXTURE_Z = 2;

/**
 * @typedef {object} LevelOneData What a Level 1 chunk has that Level 0's don't.
 * @property {Uint8Array} fixtures One per light slot (indexed like the lights): FIXTURE_NONE, FIXTURE_X or
 *     FIXTURE_Z.
 * @property {Car[]} cars (What of them is solid is in the chunk's `solids`, first.)
 * @property {Bay[]} bays The car park's bays, with their wheel stops.
 * @property {Core | null} core A walled-in bay, if the chunk has one.
 */

/**
 * @typedef {object} Car Someone's car, left in a bay a long time ago.
 * @property {number} x Its middle.
 * @property {number} z
 * @property {number} yaw Its front faces +z at 0.
 * @property {number} variant 32 bits for the colour and the details (see carStyle).
 */

/**
 * @typedef {object} Bay One bay of a double row: a cell across, and half the row deep, its head at the row's middle.
 * @property {number} x Its wheel stop's middle.
 * @property {number} z
 * @property {boolean} alongX Whether a car in it lies along x (else along z).
 * @property {number} dir Which way its head is from its mouth, along x or z: 1 or −1.
 * @property {number} stop Its wheel stop: STOP_NONE, STOP_CONCRETE, STOP_YELLOW or STOP_RUBBER.
 */

/**
 * @typedef {object} Core A bay walled in round a stair: its door, and the flight of stairs inside, going up into the
 *     slab (where it's clear of anything left on the floor).
 * @property {number} x0 Its first cell (it's BAY cells a side).
 * @property {number} z0
 * @property {number} doorX The cell inside it by its door.
 * @property {number} doorZ
 * @property {number} dx Out through the door: one of DIRECTIONS.
 * @property {number} dz
 * @property {number[] | null} stairs Where the flight is, [minX, minZ, maxX, maxZ] (it's solid), or null.
 * @property {boolean} stairsAlongX Whether it climbs along x (else z).
 * @property {number} climb Which way it climbs along that: 1 or −1.
 */

/** A bay's wheel stop (see Bay). */
export const STOP_NONE = 0;
export const STOP_CONCRETE = 1;
export const STOP_YELLOW = 2;
export const STOP_RUBBER = 3;

/**
 * What's painted on a cell's floor, its first byte for the shaders (see ChunkData.cells): bay lines for a double row
 * whose cars lie along x or z, hatching kept clear in front of a door, a drain, and in the warehouse the lines
 * either side of a row of racking along x or z.
 */
export const PAINT_BAYS_X = 1;
export const PAINT_BAYS_Z = 2;
export const PAINT_HATCH = 4;
export const PAINT_DRAIN = 8;
export const PAINT_RACKS_X = 16;
export const PAINT_RACKS_Z = 32;

/**
 * The car park's bays lie in blocks of BLOCK cells a side, edged by lines of columns, with the aisles all one way in
 * each: an aisle between every other pair of column lines, a double row of bays nose to nose between the rest,
 * three to a span. Where you start, the aisles run along z, looking down one.
 */
export const BLOCK = 24;
const BLOCK_EDGE = BAY * 4 + 1.5;

/** Whether the aisles run along x (else along z) in the block with cell (x, z) in it. */
export function aislesAlongX(seed, x, z) {
    const bx = Math.floor((x - BLOCK_EDGE) / BLOCK);
    const bz = Math.floor((z - BLOCK_EDGE) / BLOCK);
    if (bx === -1 && bz === -1) return false;
    return (hashInts(seed, 0xa151, bx, bz) & 1) === 1;
}

/** Which span of the column grid (the cells between two lines of columns) coordinate `c` is in. */
export function spanOf(c) {
    return Math.floor((c - 1.5) / BAY);
}

/** Whether span `s` holds a double row of bays (else it's an aisle). */
export function isBaySpan(s) {
    return (s & 1) === 0;
}

/** Car bodies (see levelOneCars.js), and how long and wide each is. */
export const CAR_SALOON = 0;
export const CAR_HATCHBACK = 1;
export const CAR_ESTATE = 2;
export const CAR_VAN = 3;
export const CAR_SIZES = Object.freeze([[1.62, 0.64], [1.46, 0.62], [1.66, 0.64], [1.72, 0.68]]);

/** A car's body, from its variant: mostly saloons, then hatchbacks, estates, and the odd van. */
export function carStyle(car) {
    const k = (car.variant >>> 10) & 15;
    return k < 7 ? CAR_SALOON : k < 11 ? CAR_HATCHBACK : k < 14 ? CAR_ESTATE : CAR_VAN;
}

/** Whether a car's under a cover, and whether it's sitting on a flat tyre (see levelOneCars.js). */
export const carCovered = (car) => (car.variant & 3) === 0;
export const carFlat = (car) => ((car.variant >>> 6) & 3) === 0;

/**
 * How the endless level is generated for Level 1 (see generator.js's WorldOptions).
 * @param {number} seed
 * @returns {import('./generator.js').WorldOptions}
 */
export function levelOneOptions(seed) {
    return { level: 1, zoneAt: (cx, cz) => levelOneZoneAt(seed, cx, cz) };
}

/**
 * The kind of space a chunk of Level 1 is. Like Level 0, it clumps into regions round scattered sites.
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @returns {import('./zones.js').Zone}
 */
export function levelOneZoneAt(seed, cx, cz) {
    return zoneAt(seed, cx, cz, LEVEL_ONE_ZONES);
}

/** Whether a column stands on the corner (x + 0.5, z + 0.5) of cell (x, z). */
export function isColumnCorner(x, z) {
    return mod(x, BAY) === 1 && mod(z, BAY) === 1;
}

/**
 * Generates one chunk of Level 1. Like Level 0 (see generator.js), chunks are independent and share only the
 * wall lines on their borders, and a game mode's options (a tape's walls, see footage/arena.js) work the same.
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @param {import('./generator.js').WorldOptions} options
 * @returns {import('./generator.js').ChunkData}
 */
export function generateLevelOneChunk(seed, cx, cz, options) {
    const zoneOf = (x, z) => options.zoneAt?.(x, z) ?? levelOneZoneAt(seed, x, z);
    const zone = zoneOf(cx, cz);
    const random = mulberry32(hashInts(seed, 0x1e10, cx, cz));
    const layout = borderedLayout(seed, cx, cz, options);
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const empty = options.isVoid?.(cx, cz) === true;
    const parking = !empty && zone.type === ZONE_PARKING;

    let core = null;
    if (empty) {
        // Nothing inside at all.
    } else if (zone.type === ZONE_SERVICE) {
        generateRooms(layout, random, true);
        // Clear the rooms' own pillars: the building's columns use the same grid here too, where there's room.
        layout.pillars.fill(0);
        placeColumns(layout, zoneOf, cx, cz);
    } else {
        placeColumns(layout, zoneOf, cx, cz);
        if (parking) core = parkingWalls(layout, random, x0, z0, cx === 0 && cz === 0);
    }
    if (cx === 0 && cz === 0) clearStart(layout, x0, z0);
    removeBuriedPillars(layout);
    connectAll(layout, random);

    const edgeBetween = (i, j, di, dj) => layout.between(i, j, di, dj);
    /** @type {Car[]} */
    const cars = [];
    // Nothing where you start (on a tape, nothing in the room-sized space you start in either).
    const avoid = (x, z) => Math.abs(x) <= 3 && Math.abs(z) <= 4;
    const props = empty ? [] : placeLevelOneProps(random, edgeBetween, (i, j) => layout.getPillar(i, j) === 1, LEVEL_ONE_PILLAR / 2, x0, z0, zone.type, avoid);
    for (let i = 0; i < props.length; i++) props[i].index = i;

    const cells = new Uint8Array(N * N * 4);
    /** @type {Bay[]} */
    const bays = [];
    const solids = [];
    if (parking) {
        // (A door walled over since isn't a door: stairs only go behind one that's still there.)
        if (core && layout.between(core.doorX - x0, core.doorZ - z0, core.dx, core.dz) !== EDGE_DOOR) core = null;
        if (core) stairs(core, props);
        paintBays(seed, x0, z0, core, bays, cells);
        paintFloor(seed, x0, z0, core, cells);
        wheelStops(seed, bays, props);
        parkCars(random, layout, x0, z0, bays, cars, props, avoid, core);
        solids.push(...cars.map(carBox));
        if (core?.stairs) solids.push(core.stairs);
    } else if (!empty && zone.type === ZONE_STORAGE) {
        paintRacks(x0, z0, cells);
    }

    const { edgesX, edgesZ, pillars } = layout.cellData();
    const fixtures = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE);
    const lights = levelOneLights(seed, x0, z0, zone.type, layout, fixtures, empty);
    if (core?.stairs) unhang(core.stairs, x0, z0, fixtures, lights);
    return { cx, cz, zone, edgesX, edgesZ, pillars, lights, props, leaks: [], solids, cells, levelOne: { fixtures, cars, bays, core } };
}

// ---------------------------------------------------------------------------------------------- layout

/**
 * The column grid, on every corner where it falls. Like Level 0's pillar halls, a corner on the chunk's east or
 * north border only gets one if the open floor carries on across it.
 */
function placeColumns(layout, zoneOf, cx, cz) {
    placeGridPillars(layout, cx, cz, (ncx, ncz) => zoneOf(ncx, ncz).type !== ZONE_SERVICE, isColumnCorner);
}

/**
 * A car park isn't all open: now and then a wall runs along a line of columns (with ways through it), and now
 * and then a bay is walled in round a stair, with a doorway into it.
 * @returns {Core | null} The walled-in bay, if there's one.
 */
function parkingWalls(layout, random, x0, z0, start) {
    // Column lines inside the chunk, as layout line indices.
    const lines = (origin) => {
        const found = [];
        for (let k = 2; k < N - 1; k++) if (mod(origin + k, BAY) === 2) found.push(k);
        return found;
    };
    const xLines = lines(x0);
    const zLines = lines(z0);
    if (!start && random() < 0.4) {
        // A long wall down a column line, with a few openings in it.
        const alongX = random() < 0.5;
        const pick = alongX ? zLines : xLines;
        const line = pick[Math.floor(random() * pick.length)];
        const from = 1 + Math.floor(random() * 4);
        const to = N - 1 - Math.floor(random() * 4);
        for (let k = from; k < to; k++) {
            if (alongX) layout.setH(k, line, EDGE_WALL);
            else layout.setV(line, k, EDGE_WALL);
        }
        for (let k = from + 1 + Math.floor(random() * 3); k < to - 1; k += 3 + Math.floor(random() * 4)) {
            const width = random() < 0.5 ? 2 : 1;
            for (let w = 0; w < width && k + w < to; w++) {
                if (alongX) layout.setH(k + w, line, random() < 0.3 && width === 1 ? EDGE_DOOR : EDGE_NONE);
                else layout.setV(line, k + w, random() < 0.3 && width === 1 ? EDGE_DOOR : EDGE_NONE);
            }
        }
    }
    if (!start && random() < 0.3 && xLines.length >= 2 && zLines.length >= 2) {
        // A walled-in bay, round a stair.
        const a = Math.floor(random() * (xLines.length - 1));
        const b = Math.floor(random() * (zLines.length - 1));
        const i0 = xLines[a];
        const j0 = zLines[b];
        const i1 = i0 + BAY;
        const j1 = j0 + BAY;
        layout.vRun(i0, j0, j1, EDGE_WALL);
        layout.vRun(i1, j0, j1, EDGE_WALL);
        layout.hRun(j0, i0, i1, EDGE_WALL);
        layout.hRun(j1, i0, i1, EDGE_WALL);
        const side = Math.floor(random() * 4);
        const middle = 1;
        if (side === 0) layout.setV(i0, j0 + middle, EDGE_DOOR);
        else if (side === 1) layout.setV(i1, j0 + middle, EDGE_DOOR);
        else if (side === 2) layout.setH(i0 + middle, j0, EDGE_DOOR);
        else layout.setH(i0 + middle, j1, EDGE_DOOR);
        // Out through the door, and the cell inside it.
        const [dx, dz] = [[-1, 0], [1, 0], [0, -1], [0, 1]][side];
        const doorX = x0 + i0 + (side === 0 ? 0 : side === 1 ? BAY - 1 : middle);
        const doorZ = z0 + j0 + (side === 2 ? 0 : side === 3 ? BAY - 1 : middle);
        return { x0: x0 + i0, z0: z0 + j0, doorX, doorZ, dx, dz, stairs: null, stairsAlongX: false, climb: 1 };
    }
    return null;
}

/** Nothing in the way where you start: the aisle ahead of you stays open. */
function clearStart(layout, x0, z0) {
    const i0 = -3 - x0;
    const i1 = 3 - x0;
    const j0 = -6 - z0;
    const j1 = 4 - z0;
    for (let i = i0; i <= i1 + 1; i++) layout.vRun(i, j0, j1 + 1, EDGE_NONE);
    for (let j = j0; j <= j1 + 1; j++) layout.hRun(j, i0, i1 + 1, EDGE_NONE);
}

/** How long a flight of stairs is (up to the slab), and how wide. */
export const STAIR_LENGTH = 1.5;
export const STAIR_WIDTH = 0.42;

/**
 * The flight of stairs in a walled-in bay: along the wall across from its door, from one end of it, climbing up into the
 * slab. Left out if anything's been left on the floor where it would go.
 */
function stairs(core, props) {
    const inset = WALL_THICKNESS / 2 + 0.01;
    // The wall across from the door, and which way the stairs stand out from it.
    const alongX = core.dx === 0;
    const out = alongX ? core.dz : core.dx;
    const back = (alongX ? core.z0 : core.x0) - 0.5 + (out > 0 ? 0 : BAY);
    const a0 = back + out * inset;
    const a1 = a0 + out * STAIR_WIDTH;
    // Along the wall, climbing one way or the other, from one end of it.
    const lo = (alongX ? core.x0 : core.z0) - 0.5 + inset;
    const climb = (hashInts(core.x0, core.z0, 0x57a1) & 1) === 1 ? 1 : -1;
    const s0 = climb > 0 ? lo : lo + BAY - 2 * inset - STAIR_LENGTH;
    const s1 = s0 + STAIR_LENGTH;
    const box = alongX
        ? [s0, Math.min(a0, a1), s1, Math.max(a0, a1)]
        : [Math.min(a0, a1), s0, Math.max(a0, a1), s1];
    if (props.some((prop) => overlaps(propFootprint(prop), box, 0.02))) return;
    core.stairs = box;
    core.stairsAlongX = alongX;
    core.climb = climb;
}

/** No batten where one would hang into a flight of stairs (they go up into the slab): the slot's left empty, and dark. */
function unhang([minX, minZ, maxX, maxZ], x0, z0, fixtures, lights) {
    for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
        for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
            const x = x0 + pi * 2 + 1;
            const z = z0 + pj * 2 + 1;
            const k = pi * PANELS_PER_SIDE + pj;
            if (fixtures[k] === FIXTURE_NONE || !overlaps([x - 0.25, z - 0.25, x + 0.25, z + 0.25], [minX, minZ, maxX, maxZ], 0)) continue;
            fixtures[k] = FIXTURE_NONE;
            lights[k * 4] = 0;
        }
    }
}

/** Whether cell (x, z) is inside the walled-in bay. */
function inCore(core, x, z) {
    return core !== null && x >= core.x0 && x < core.x0 + BAY && z >= core.z0 && z < core.z0 + BAY;
}

/** How far in from a bay's head its wheel stop is. */
export const WHEEL_STOP_IN = 0.42;
/** A wheel stop's half length and half depth. */
export const WHEEL_STOP_HALF = 0.25;
export const WHEEL_STOP_DEPTH = 0.03;

/**
 * The bays of the double rows, and their lines painted on the floor: every cell of a double row gets the way its
 * cars lie (the shader draws the lines from that), and each bay whose wheel stop is in the chunk is listed, a row
 * at a time. Not in the walled-in bay.
 */
function paintBays(seed, x0, z0, core, bays, cells) {
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            if (inCore(core, x, z)) continue;
            // (Cars lie across the aisles.)
            const alongX = !aislesAlongX(seed, x, z);
            const across = alongX ? x : z;
            const s = spanOf(across);
            if (!isBaySpan(s)) continue;
            cells[(i * N + j) * 4] |= alongX ? PAINT_BAYS_X : PAINT_BAYS_Z;
        }
    }
    // The bays, whose wheel stops are in the first and last cells across each double row, a little in from its middle:
    // along each row in turn.
    for (const alongX of [true, false]) {
        for (let a = 0; a < N; a++) {
            for (let b = 0; b < N; b++) {
                const x = x0 + (alongX ? a : b);
                const z = z0 + (alongX ? b : a);
                if (inCore(core, x, z) || aislesAlongX(seed, x, z) === alongX) continue;
                const across = alongX ? x : z;
                const s = spanOf(across);
                const k = across - (s * BAY + 2);
                if (!isBaySpan(s) || k === 1) continue;
                const dir = k === 0 ? 1 : -1;
                const stop = s * BAY + 3 - dir * WHEEL_STOP_IN;
                bays.push({ x: alongX ? stop : x, z: alongX ? z : stop, alongX, dir, stop: STOP_NONE });
            }
        }
    }
}

/** Each bay's wheel stop: most have one, of concrete, painted, or rubber. None where something's left on it. */
function wheelStops(seed, bays, props) {
    for (const bay of bays) {
        const h = hashFloat(seed, 0x5709, bay.x * 4, bay.z * 4);
        if (h > 0.78) continue;
        const box = bay.alongX
            ? [bay.x - WHEEL_STOP_DEPTH, bay.z - WHEEL_STOP_HALF, bay.x + WHEEL_STOP_DEPTH, bay.z + WHEEL_STOP_HALF]
            : [bay.x - WHEEL_STOP_HALF, bay.z - WHEEL_STOP_DEPTH, bay.x + WHEEL_STOP_HALF, bay.z + WHEEL_STOP_DEPTH];
        if (props.some((prop) => overlaps(propFootprint(prop), box, 0.01))) continue;
        bay.stop = h < 0.5 ? STOP_CONCRETE : h < 0.7 ? STOP_YELLOW : STOP_RUBBER;
    }
}

/**
 * The rest of what's painted on the floor: hatching kept clear in front of the stair door, and now and then a drain
 * down the middle of an aisle.
 */
function paintFloor(seed, x0, z0, core, cells) {
    if (core) {
        const i = core.doorX + core.dx - x0;
        const j = core.doorZ + core.dz - z0;
        if (i >= 0 && j >= 0 && i < N && j < N) cells[(i * N + j) * 4] |= PAINT_HATCH;
    }
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            const alongX = aislesAlongX(seed, x, z);
            const across = alongX ? z : x;
            const s = spanOf(across);
            // Down the middle of an aisle, clear of the start.
            if (isBaySpan(s) || across !== s * BAY + 3 || inCore(core, x, z)) continue;
            if (Math.abs(x) < 4 && Math.abs(z) < 6) continue;
            if (hashFloat(seed, 0xd4a1, x, z) < 0.045) cells[(i * N + j) * 4] |= PAINT_DRAIN;
        }
    }
}

/** The lines painted either side of the rows of racking in the warehouse (see racking in levelOneProps.js). */
function paintRacks(x0, z0, cells) {
    const alongX = rackRowsAlongX(x0, z0);
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            if (mod(alongX ? z0 + j : x0 + i, 3) === 0) cells[(i * N + j) * 4] |= alongX ? PAINT_RACKS_X : PAINT_RACKS_Z;
        }
    }
}

/**
 * Cars, left in the bays: a few in a chunk, now and then a row of them together. Only where the whole car is inside
 * the chunk and nothing's in the way: no wall, column, other car, anything left on the floor, or the stair door's
 * hatching.
 */
function parkCars(random, layout, x0, z0, bays, cars, props, avoid, core) {
    let previous = null;
    let parked = false;
    for (const bay of bays) {
        // (The bays come a row at a time, in order along it.)
        const next = previous !== null && previous.alongX === bay.alongX && previous.dir === bay.dir
            && (bay.alongX ? previous.x === bay.x && bay.z - previous.z === 1 : previous.z === bay.z && bay.x - previous.x === 1);
        const chance = next && parked ? 0.3 : 0.028;
        previous = bay;
        parked = false;
        if (random() >= chance) continue;
        const variant = (random() * 4294967296) >>> 0;
        // Nose in, mostly. A few backed in, now and then left crooked.
        const reversed = random() < 0.22;
        const crooked = random() < 0.08;
        const shift = (random() - 0.5) * (crooked ? 0.16 : 0.08);
        const turn = (random() - 0.5) * (crooked ? 0.34 : 0.05);
        const car = { x: 0, z: 0, yaw: 0, variant };
        const [length] = CAR_SIZES[carStyle(car)];
        // Its nose (or tail, backed in) just short of the bay's head.
        const head = (bay.alongX ? bay.x : bay.z) + bay.dir * WHEEL_STOP_IN;
        const middle = head - bay.dir * (0.035 + length / 2);
        const facing = reversed ? -bay.dir : bay.dir;
        if (bay.alongX) {
            car.x = middle;
            car.z = bay.z + shift;
            car.yaw = facing * Math.PI / 2 + turn;
        } else {
            car.x = bay.x + shift;
            car.z = middle;
            car.yaw = (facing > 0 ? 0 : Math.PI) + turn;
        }
        if (!carFits(car, layout, x0, z0, cars, props, avoid, core)) continue;
        cars.push(car);
        parked = true;
    }
}

/** Whether a car can be left where it is: all of it in its chunk, and clear of everything (see parkCars). */
function carFits(car, layout, x0, z0, cars, props, avoid, core) {
    const [bx0, bz0, bx1, bz1] = carBox(car);
    if (bx0 < x0 - 0.45 || bz0 < z0 - 0.45 || bx1 > x0 + N - 0.55 || bz1 > z0 + N - 0.55) return false;
    const reach = carFootprint(car);
    if (avoid(car.x, car.z) || cars.some((other) => overlaps(carFootprint(other), reach, CAR_GAP))) return false;
    if (props.some((prop) => overlaps(propFootprint(prop), reach, 0))) return false;
    if (core) {
        const x = core.doorX + core.dx;
        const z = core.doorZ + core.dz;
        if (overlaps([x - 0.5, z - 0.5, x + 0.5, z + 0.5], reach, 0)) return false;
    }
    return clearArea(layout, x0, z0, ...reach);
}

/** How far past its body anything on a car stands out (its bumpers and mirrors: see levelOneCars.js). */
const CAR_TRIM = 0.03;
/** The least room left between two cars. */
const CAR_GAP = 0.08;

/** A car's body, square to its bay: [minX, minZ, maxX, maxZ]. @param {Car} car */
export function carBox(car) {
    const [length, width] = CAR_SIZES[carStyle(car)];
    const along = Math.abs(Math.cos(car.yaw)) > 0.5;
    const hx = (along ? width : length) / 2;
    const hz = (along ? length : width) / 2;
    return [car.x - hx, car.z - hz, car.x + hx, car.z + hz];
}

/**
 * All the floor a car covers, bumpers and all, as it's turned (carBox is its body, square to the bay): the box round
 * it, [minX, minZ, maxX, maxZ].
 * @param {Car} car
 */
function carFootprint(car) {
    const [length, width] = CAR_SIZES[carStyle(car)];
    const cos = Math.abs(Math.cos(car.yaw));
    const sin = Math.abs(Math.sin(car.yaw));
    const hw = width / 2 + CAR_TRIM;
    const hl = length / 2 + CAR_TRIM;
    const hx = hw * cos + hl * sin;
    const hz = hw * sin + hl * cos;
    return [car.x - hx, car.z - hz, car.x + hx, car.z + hz];
}

/** Whether two boxes, [minX, minZ, maxX, maxZ], come within `gap` of each other. */
function overlaps(a, b, gap) {
    return a[0] < b[2] + gap && b[0] < a[2] + gap && a[1] < b[3] + gap && b[1] < a[3] + gap;
}

/**
 * Whether the rectangle (world coordinates) is clear of the walls and the columns: every corner of the column grid near
 * it (on the chunk's borders too, which its neighbours own), and every edge of the layout.
 */
function clearArea(layout, x0, z0, minX, minZ, maxX, maxZ) {
    const area = [minX, minZ, maxX, maxZ];
    const half = LEVEL_ONE_PILLAR / 2 + 0.01;
    for (let x = Math.floor(minX - 1); x <= Math.ceil(maxX + 1); x++) {
        for (let z = Math.floor(minZ - 1); z <= Math.ceil(maxZ + 1); z++) {
            if (isColumnCorner(x, z) && overlaps([x + 0.5 - half, z + 0.5 - half, x + 0.5 + half, z + 0.5 + half], area, 0)) return false;
        }
    }
    // A wall's half its thickness either side of its line, and reaches that much past its ends.
    const t = WALL_THICKNESS / 2 + 0.01;
    for (let i = 0; i <= N; i++) {
        for (let j = 0; j <= N; j++) {
            // The edge on the −x side of local cell (i, j), along z, and the one on its −z side, along x.
            const x = x0 + i - 0.5;
            const z = z0 + j - 0.5;
            if (j < N && layout.getV(i, j) !== EDGE_NONE && overlaps([x - t, z - t, x + t, z + 1 + t], area, 0)) return false;
            if (i < N && layout.getH(i, j) !== EDGE_NONE && overlaps([x - t, z - t, x + 1 + t, z + t], area, 0)) return false;
        }
    }
    return true;
}

// ---------------------------------------------------------------------------------------------- lights

/**
 * How dark Level 1 is around a point, 0 to 1: bigger dead patches than Level 0's, and the start and the way
 * out always lit.
 */
export function levelOneDarkness(seed, x, z) {
    const n = 0.6 * valueNoise(seed ^ 0x1dac, x / 30, z / 30) + 0.4 * valueNoise(seed ^ 0x1dad, x / 11, z / 11);
    let darkness = smoothstep(0.54, 0.7, n);
    const distance = Math.hypot(x, z);
    if (distance < LIT_START + 12) darkness *= smoothstep(LIT_START, LIT_START + 12, distance);
    return darkness;
}

/**
 * Level 1's lights. In the car park and the warehouse the battens hang in rows across the level, every other row
 * of slots, with dark between. In the corridors there's one over every slot, along the corridor. More of them
 * are dead or dying than in Level 0. An empty chunk (outside a tape's walls) has none, and no light at all.
 */
function levelOneLights(seed, x0, z0, zone, layout, fixtures, empty) {
    if (empty) return darkLights(TUBE_COOL);
    const lights = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE * 4);
    for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
        for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
            const x = x0 + pi * 2 + 1;
            const z = z0 + pj * 2 + 1;
            const k = pi * PANELS_PER_SIDE + pj;
            const i = x - x0;
            const j = z - z0;
            let fixture = FIXTURE_X;
            if (zone === ZONE_SERVICE) {
                // Along the corridor: across it if there are walls either side along x.
                const wallsX = layout.getV(i, j) !== EDGE_NONE && layout.getV(i + 1, j) !== EDGE_NONE;
                const wallsZ = layout.getH(i, j) !== EDGE_NONE && layout.getH(i, j + 1) !== EDGE_NONE;
                fixture = wallsX && !wallsZ ? FIXTURE_Z : FIXTURE_X;
            } else if (mod(z, 4) === 3) {
                fixture = FIXTURE_NONE;
            }
            fixtures[k] = fixture;

            const darkness = levelOneDarkness(seed, x, z);
            let brightness = fixture === FIXTURE_NONE ? 0 : 255;
            let flicker = 0;
            let tube = TUBE_COOL;
            const nearStart = Math.abs(x) < 8 && Math.abs(z) < 8;
            if (brightness > 0 && !nearStart) {
                if (hashFloat(seed, 0x1119, x, z) < 0.1 + 0.9 * darkness) {
                    brightness = 0;
                } else {
                    if (hashFloat(seed, 0x111a, x, z) < 0.1) brightness = 140 + Math.floor(hashFloat(seed, 0x111b, x, z) * 80);
                    if (hashFloat(seed, 0x111c, x, z) < 0.04 + 1.2 * darkness * (1 - darkness)) flicker = 1 + (hashInts(seed, 0x111d, x, z) % 255);
                }
            }
            const tint = hashFloat(seed, 0x111e, x, z);
            if (tint < (zone === ZONE_SERVICE ? 0.15 : 0.06)) tube = TUBE_OLD;
            else if (tint > 0.975) tube = TUBE_WARM;
            lights[k * 4] = brightness;
            // The light around here: lower than Level 0 everywhere, so the gaps between the rows stay dark.
            lights[k * 4 + 1] = Math.round(255 * 0.82 * (1 - 0.9 * darkness));
            lights[k * 4 + 2] = flicker;
            lights[k * 4 + 3] = tube;
        }
    }
    return lights;
}

