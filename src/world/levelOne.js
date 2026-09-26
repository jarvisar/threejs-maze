import { CHUNK_SIZE, HALF_CHUNK } from '../config.js';
import { Layout, PANELS_PER_SIDE, borderLine, connectAll, generateRooms, removeBuriedPillars, smoothstep } from './generator.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL } from './grid.js';
import { placeLevelOneProps } from './levelOneProps.js';
import { hashFloat, hashInts, mulberry32, valueNoise } from './random.js';
import { ZONE_PARKING, ZONE_SERVICE, ZONE_STORAGE, zoneAt } from './zones.js';

/*
 * Level 1: an underground car park that goes on for ever, with the warehouse and the service corridors behind
 * it. Bare concrete, a low slab ceiling with beams and pipes under it, a column every few metres with its bay
 * stencilled on it, rows of fluorescent battens with dark between them, puddles everywhere, and a mist lying on
 * the floor.
 *
 * It's the same grid of cells as Level 0 (walls on the lines between cells, a light slot over every cell with
 * odd coordinates), so everything that walks, collides, edits, and plays a tape (see footage/) works on it
 * unchanged. This works out the layout; levelOneGeometry.js builds what's special about it, and the materials
 * (materials.js, levelOneShading.js) do the concrete, the water and the air. levels.js ties it in.
 */

const N = CHUNK_SIZE;

/** How wide Level 1's columns are (about 70 cm; Level 0's pillars are 49). */
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
 * @property {Car[]} cars (What of them is solid is in the chunk's `solids`.)
 */

/**
 * @typedef {object} Car Someone's car, left in a bay a long time ago.
 * @property {number} x Its middle.
 * @property {number} z
 * @property {number} yaw Its front faces +z at 0.
 * @property {number} variant 32 bits for the colour and the details.
 */

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
    const layout = new Layout();
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const empty = options.isVoid?.(cx, cz) === true;

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

    if (empty) {
        // Nothing inside at all.
    } else if (zone.type === ZONE_SERVICE) {
        generateRooms(layout, random, true);
        // The rooms' own pillars go: the building's columns stand on the one grid here too, where there's room.
        layout.pillars.fill(0);
        placeColumns(layout, zoneOf, cx, cz, x0, z0);
    } else {
        placeColumns(layout, zoneOf, cx, cz, x0, z0);
        if (zone.type === ZONE_PARKING) parkingWalls(layout, random, x0, z0, cx === 0 && cz === 0);
    }
    if (cx === 0 && cz === 0) clearStart(layout, x0, z0);
    removeBuriedPillars(layout);
    connectAll(layout, random);

    const edgeBetween = (i, j, di, dj) => layout.between(i, j, di, dj);
    /** @type {Car[]} */
    const cars = [];
    // Nothing where you start (on a tape, nothing in the room-sized space you start in either).
    const avoid = (x, z) => Math.abs(x) <= 3 && Math.abs(z) <= 4;
    const props = empty ? [] : placeLevelOneProps(random, edgeBetween, (i, j) => layout.getPillar(i, j) === 1, x0, z0, zone.type, avoid);
    for (let i = 0; i < props.length; i++) props[i].index = i;
    if (!empty && zone.type === ZONE_PARKING) parkCars(random, layout, x0, z0, cars, avoid);

    const edgesX = new Uint8Array(N * N);
    const edgesZ = new Uint8Array(N * N);
    const pillars = new Uint8Array(N * N);
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            edgesX[i * N + j] = layout.getV(i + 1, j);
            edgesZ[i * N + j] = layout.getH(i, j + 1);
            pillars[i * N + j] = layout.getPillar(i + 1, j + 1);
        }
    }

    const fixtures = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE);
    const lights = levelOneLights(seed, x0, z0, zone.type, layout, fixtures, empty);
    return { cx, cz, zone, edgesX, edgesZ, pillars, lights, props, leaks: [], solids: cars.map(carBox), levelOne: { fixtures, cars } };
}

// ---------------------------------------------------------------------------------------------- layout

/**
 * The column grid, on every corner where it falls. Like Level 0's pillar halls, a corner on the chunk's east or
 * north border only gets one if the open floor carries on across it.
 */
function placeColumns(layout, zoneOf, cx, cz, x0, z0) {
    const open = (ncx, ncz) => zoneOf(ncx, ncz).type !== ZONE_SERVICE;
    const lastI = open(cx + 1, cz) ? N : N - 1;
    const lastJ = open(cx, cz + 1) ? N : N - 1;
    const cornerOk = lastI === N && lastJ === N && open(cx + 1, cz + 1);
    for (let i = 1; i <= lastI; i++) {
        for (let j = 1; j <= lastJ; j++) {
            if (i === N && j === N && !cornerOk) continue;
            // Corner (i, j) is the +x+z corner of world cell (x0 + i - 1, z0 + j - 1).
            if (isColumnCorner(x0 + i - 1, z0 + j - 1)) layout.setPillar(i, j, true);
        }
    }
}

/**
 * A car park isn't all open: now and then a wall runs along a line of columns (with ways through it), and now
 * and then a bay is walled in, a stair core or a plant room, with a doorway into it.
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
        // A walled-in bay: a stair core or a plant room.
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
    }
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

/**
 * Cars, left in the bays: now and then one or two in a chunk, nose to a line of columns. Only where the whole car
 * is inside the chunk and nothing else is in the way.
 */
function parkCars(random, layout, x0, z0, cars, avoid) {
    const count = random() < 0.35 ? 1 + (random() < 0.3 ? 1 : 0) : 0;
    for (let n = 0; n < count; n++) {
        for (let attempt = 0; attempt < 10; attempt++) {
            // A bay's middle cell, and a spot along it.
            const i = 2 + Math.floor(random() * (N - 4));
            const j = 2 + Math.floor(random() * (N - 4));
            const x = x0 + i;
            const z = z0 + j;
            if (mod(x, BAY) !== 0 && mod(z, BAY) !== 0) continue;
            const alongZ = mod(x, BAY) === 0;
            const shift = (random() - 0.5) * 0.5;
            const car = {
                x: alongZ ? x + shift * 0.5 : x,
                z: alongZ ? z : z + shift * 0.5,
                yaw: (alongZ ? 0 : Math.PI / 2) + (random() < 0.5 ? Math.PI : 0) + (random() - 0.5) * 0.08,
                variant: (random() * 4294967296) >>> 0,
            };
            const [bx0, bz0, bx1, bz1] = carBox(car);
            // The whole thing in the chunk, and no wall, column or other car across it.
            if (bx0 < x0 - 0.45 || bz0 < z0 - 0.45 || bx1 > x0 + N - 0.55 || bz1 > z0 + N - 0.55) continue;
            if (avoid(car.x, car.z) || cars.some((other) => Math.hypot(other.x - car.x, other.z - car.z) < 1.2)) continue;
            if (!clearArea(layout, x0, z0, bx0, bz0, bx1, bz1)) continue;
            cars.push(car);
            break;
        }
    }
}

/** A car's length and width. */
export const CAR_LENGTH = 1.62;
export const CAR_WIDTH = 0.66;

/** @param {Car} car */
export function carBox(car) {
    const along = Math.abs(Math.cos(car.yaw)) > 0.5;
    const hx = (along ? CAR_WIDTH : CAR_LENGTH) / 2;
    const hz = (along ? CAR_LENGTH : CAR_WIDTH) / 2;
    return [car.x - hx, car.z - hz, car.x + hx, car.z + hz];
}

/** Whether no edge or column of the layout falls inside the rectangle (world coordinates). */
function clearArea(layout, x0, z0, minX, minZ, maxX, maxZ) {
    for (let i = 0; i <= N; i++) {
        for (let j = 0; j <= N; j++) {
            const cornerX = x0 + i - 0.5;
            const cornerZ = z0 + j - 0.5;
            if (cornerX < minX - 0.2 || cornerX > maxX + 0.2 || cornerZ < minZ - 0.2 || cornerZ > maxZ + 0.2) continue;
            if (i > 0 && j > 0 && layout.getPillar(i, j)) return false;
        }
    }
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            if (x < minX - 0.6 || x > maxX + 0.6 || z < minZ - 0.6 || z > maxZ + 0.6) continue;
            // The cell's +x and +z edges.
            if (i < N - 1 && layout.getV(i + 1, j) !== EDGE_NONE && x + 0.5 > minX && x + 0.5 < maxX && z + 0.5 > minZ && z - 0.5 < maxZ) return false;
            if (j < N - 1 && layout.getH(i, j + 1) !== EDGE_NONE && z + 0.5 > minZ && z + 0.5 < maxZ && x + 0.5 > minX && x - 0.5 < maxX) return false;
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
 * of slots, with dark between; in the corridors there's one over every slot, along the corridor. More of them
 * are dead or dying than in Level 0. An empty chunk (outside a tape's walls) has none, and no light at all.
 */
function levelOneLights(seed, x0, z0, zone, layout, fixtures, empty) {
    const lights = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE * 4);
    if (empty) {
        for (let k = 3; k < lights.length; k += 4) lights[k] = TUBE_COOL;
        return lights;
    }
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

function mod(a, b) {
    return ((a % b) + b) % b;
}

