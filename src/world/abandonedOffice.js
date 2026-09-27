import { CHUNK_SIZE, HALF_CHUNK, WALL_THICKNESS } from '../config.js';
import { FURN_CHAIR, furnishOffice } from './abandonedOfficeFurniture.js';
import { placeAbandonedOfficeProps } from './abandonedOfficeProps.js';
import { PANELS_PER_SIDE, borderedLayout, connectAll, darkLights, generateRooms, placeGridPillars, removeBuriedPillars, smoothstep } from './generator.js';
import { DIRECTIONS, EDGE_DOOR, EDGE_NONE, EDGE_WALL, chunkCoord, mod } from './grid.js';
import { hashFloat, hashInts, mulberry32, valueNoise } from './random.js';
import { ZONE_CORE, ZONE_CUBICLES, ZONE_OFFICES, ZONE_OPEN_PLAN, zoneAt } from './zones.js';

/*
 * Level 4, "the Abandoned Office": a modern office building at night that goes on for ever, with nobody in it. Open-plan
 * floors on a grid of concrete columns, cleared out, only the dents in the carpet left where the desks stood; farms of
 * cubicles still standing; corridors of offices, meeting rooms and kitchens; and the core, bare concrete, with its lift
 * doors and stair doors (the stairs only ever come back out on this floor). Most of the tubes are dead. Here and there
 * the floor is cut round a light well, open to the sky, with the building's other wings across it, floor over floor,
 * down into the fog: floor-to-ceiling windows between concrete piers, and outside, rain that never stops, and now and
 * then lightning.
 *
 * It's the same grid of cells as Level 0, so walking, editing and a tape (see footage/) work on it unchanged. This works
 * out the layout, the light wells and their windows, the doors that don't open, the lights, the furniture
 * (abandonedOfficeFurniture.js) and what's lying about (abandonedOfficeProps.js), and what each cell tells the shaders;
 * abandonedOfficeGeometry.js builds the windows, the building across the wells, the rain, the fittings and the furniture;
 * the materials (abandonedOfficeMaterials.js, abandonedOfficeShading.js) do the carpet, the ceiling tiles, the concrete,
 * the glass, the light through the windows and the storm (see storm.js). levels.js ties it in.
 */

const N = CHUNK_SIZE;

/** What Level 4's regions are made of (see zones.js). Where you start is always an open-plan floor. */
export const ABANDONED_OFFICE_ZONES = Object.freeze({
    weights: [
        [ZONE_OPEN_PLAN, 34],
        [ZONE_CUBICLES, 24],
        [ZONE_OFFICES, 26],
        [ZONE_CORE, 16],
    ],
    start: ZONE_OPEN_PLAN,
    salt: 0x4400,
});

// ---------------------------------------------------------------------------------------------- cells

/** What's in a cell (see AbandonedOfficeData.kinds). */
export const CELL_WELL = 1; // a light well: outside, open to the sky, walled off by windows
export const CELL_OPEN = 2; // an open-plan floor
export const CELL_CUBICLE = 4; // a cubicle farm
export const CELL_ROOM = 8; // an office, a meeting room, a store room
export const CELL_CORRIDOR = 16;
export const CELL_CORE = 32; // the core: its lobbies and its back rooms
export const CELL_KITCHEN = 64; // a kitchen, or a break room
export const CELL_TAKEN = 128; // furniture stands in it

/** What kind of room a region of the chunk is (see AbandonedOfficeData.regions). */
export const REGION_OPEN = 0; // open floor
export const REGION_CORRIDOR = 1;
export const REGION_OFFICE = 2; // someone's office
export const REGION_MEETING = 3; // a meeting room
export const REGION_KITCHEN = 4; // a kitchen
export const REGION_BULLPEN = 5; // a big room of desks
export const REGION_LOBBY = 6; // a lift lobby, in the core
export const REGION_COPY = 7; // a copy room
export const REGION_STORE = 8; // a store room

/** A cell's look, for the shaders (the low three bits of its first byte; see cellBytes). */
export const LOOK_OPEN = 0; // carpet tiles, bare, the dents where the furniture was
export const LOOK_CUBICLES = 1; // carpet tiles
export const LOOK_ROOM = 2; // an office's carpet
export const LOOK_CORRIDOR = 3; // the corridors' darker carpet
export const LOOK_CORE = 4; // vinyl tiles, bare concrete walls
export const LOOK_KITCHEN = 5; // vinyl in a check, and tiles up the walls
export const LOOK_MEETING = 6; // a meeting room's carpet, and its one coloured wall
export const LOOK_WELL = 7; // outside
/** The first byte's other bits: a window in the cell's +x edge, in its +z edge, and the light of its own nearest it. */
export const BYTE_WINDOW_X = 8;
export const BYTE_WINDOW_Z = 16;
export const EMITTER_SHIFT = 5;
export const BYTE_EMITTER = 128;

/** The lights of their own that things have (see Emitter). */
export const EMIT_VENDING = 0; // a vending machine's front
export const EMIT_SCREEN = 1; // a computer left on
export const EMIT_EXIT = 2; // an EXIT sign, on its battery through a power cut
/** How far each kind's light reaches, and how high it comes from. */
export const EMIT_RANGE = [1.6, 0.9, 1.1];
export const EMIT_Y = [0.34, 0.33, 0.83];
/** How finely where it is is written down, from a cell's middle (see cellBytes): a third of a cell, from −7/3 to 8/3. */
export const EMIT_STEPS = 3;
export const EMIT_BIAS = 7;

/**
 * @typedef {object} Emitter Something with a light of its own (see EMIT_*): where its light comes from.
 * @property {number} x
 * @property {number} z
 * @property {number} kind
 */

// ---------------------------------------------------------------------------------------------- the windows

/** The windows (on our floor): a bay a cell wide, glass from the sill to the head, a concrete pier between each two. */
export const SILL_Y = 0.14;
export const HEAD_Y = 0.88;
export const PIER_HALF = 0.06;
/** How far along a bay the glass reaches from its middle. */
export const GLASS_HALF = 0.5 - PIER_HALF;
/** The enclosure along the foot of every window, with the heating in it: how far it stands out, and how tall. */
export const CONVECTOR_DEPTH = 0.1;
export const CONVECTOR_HEIGHT = 0.13;
/** The building round a light well: one floor to the next, and how far up and down it goes. */
export const STOREY = 1.36;
export const FACADE_TOP = 1 + 3 * STOREY - 0.12;
export const FACADE_BOTTOM = -7 * STOREY;
/** How far into the rooms the light through the windows is worked out (see cellBytes): up to this many cells from one. */
const WINDOW_REACH = 3;

/**
 * @typedef {object} Well A light well: the chunk's cells from (i0, j0) to (i1, j1), local and inclusive.
 * @property {number} i0
 * @property {number} j0
 * @property {number} i1
 * @property {number} j1
 */

// ---------------------------------------------------------------------------------------------- the doors

/** What a door that doesn't open is (see OfficeDoor). */
export const DOOR_OFFICE = 0; // an office's: wood veneer, a narrow light of glass, a number
export const DOOR_STAIR = 1; // a stair door: steel, a push bar, wired glass, and an EXIT sign over it
export const DOOR_LIFT = 2; // a lift's steel doors, its buttons, and the floor over them (always 4)
export const DOOR_SERVICE = 3; // a plain steel door: a cupboard, the toilets, the plant

/**
 * @typedef {object} OfficeDoor A door set in a wall that doesn't open (see abandonedOfficeGeometry.js): the wall is the
 *     +x edge (axis 0) or +z edge (axis 1) of cell (x, z), and the door is drawn on both of its faces.
 * @property {number} x
 * @property {number} z
 * @property {0 | 1} axis
 * @property {number} front The side it faces (where its sign is): 1 (+x or +z) or −1.
 * @property {number} kind DOOR_*.
 * @property {number} variant 32 bits for its details.
 */

// ---------------------------------------------------------------------------------------------- the lights

/** A light slot's fourth byte in Level 4 (see ChunkData.lights): the colour of its tubes. */
export const TUBE_COOL = 255; // cool white
export const TUBE_OLD = 254; // old tubes, gone greenish
export const TUBE_WARM = 253; // warm white, in the kitchens
export const TUBE_NONE = 252; // nothing there (over a light well)

/** What's in a light slot (see AbandonedOfficeData.fixtures). */
export const FIXTURE_NONE = 0;
export const FIXTURE_TROFFER = 1; // a recessed troffer, its louvres in a grid
export const FIXTURE_STRIP = 2; // a bare batten with its tube, on the concrete of the core
export const FIXTURE_HANGING = 3; // a troffer come down at one end, hanging on its wire

/**
 * @typedef {object} AbandonedOfficeData What a Level 4 chunk has that Level 0's don't.
 * @property {Uint8Array} kinds What each cell is (CELL_*), indexed `i * N + j`.
 * @property {Int16Array} rooms Which of the chunk's regions each cell is in, or −1 (a light well).
 * @property {number[]} regions What each region is (REGION_*).
 * @property {Well[]} wells
 * @property {Uint8Array} windows Each cell's windows: 1 in its +x edge, 2 in its +z edge.
 * @property {Uint8Array} fixtures What's in each light slot (FIXTURE_*), indexed like the lights.
 * @property {OfficeDoor[]} doors The doors that don't open, in the walls the chunk's cells own.
 * @property {import('./abandonedOfficeFurniture.js').Furniture[]} furniture (What of it is solid is in the chunk's
 *     `solids`.)
 * @property {number[]} partitions The cubicles' partitions, as runs [x0, z0, x1, z1, height] along the lines between
 *     cells.
 * @property {Emitter[]} emitters
 */

// ---------------------------------------------------------------------------------------------- generating

/**
 * How the endless level is generated for Level 4 (see generator.js's WorldOptions).
 * @param {number} seed
 * @returns {import('./generator.js').WorldOptions}
 */
export function abandonedOfficeOptions(seed) {
    return { level: 5, zoneAt: (cx, cz) => abandonedOfficeZoneAt(seed, cx, cz) };
}

/** The kind of space a chunk of Level 4 is. */
export function abandonedOfficeZoneAt(seed, cx, cz) {
    return zoneAt(seed, cx, cz, ABANDONED_OFFICE_ZONES);
}

/** Whether a zone is open floor, which flows on into the next chunk (see borderLine in generator.js). */
export function isOpenFloor(type) {
    return type === ZONE_OPEN_PLAN || type === ZONE_CUBICLES;
}

/**
 * Where you start: an open floor, looking towards −z across it at the windows of a light well (world cells x −3 to 3,
 * z −6 to −4), between two columns.
 */
export const START_WELL = Object.freeze({ x0: -3, z0: -6, x1: 3, z1: -4 });

/**
 * Generates one chunk of Level 4. Like Level 0 (see generator.js), chunks are independent and share only the wall lines
 * on their borders (Level 0's own borders, from this level's zones), and a game mode's options (a tape's walls, see
 * footage/arena.js) work the same.
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @param {import('./generator.js').WorldOptions} options
 * @returns {import('./generator.js').ChunkData}
 */
export function generateAbandonedOfficeChunk(seed, cx, cz, options) {
    const zoneOf = (x, z) => options.zoneAt?.(x, z) ?? abandonedOfficeZoneAt(seed, x, z);
    const zone = zoneOf(cx, cz);
    const random = mulberry32(hashInts(seed, 0x4d30, cx, cz));
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const empty = options.isVoid?.(cx, cz) === true;
    const layout = borderedLayout(seed, cx, cz, { ...options, zoneAt: zoneOf });

    const kinds = new Uint8Array(N * N);
    /** @type {Well[]} */
    const wells = [];
    if (!empty) {
        if (zone.type === ZONE_OFFICES || zone.type === ZONE_CORE) generateRooms(layout, random, true);
        else openFloor(layout, random, seed, zone, zoneOf, cx, cz);
        const well = cx === 0 && cz === 0 ? startWell(x0, z0) : chooseWell(random, zone.type);
        if (well) {
            carveWell(layout, kinds, well);
            wells.push(well);
        }
        if (cx === 0 && cz === 0) stampStart(layout, x0, z0);
    }
    removeBuriedPillars(layout);
    const wellMask = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) wellMask[k] = kinds[k] & CELL_WELL;
    connectAll(layout, random, wells.length > 0 ? wellMask : null);

    const rooms = new Int16Array(N * N).fill(-1);
    /** @type {number[]} */
    const regions = [];
    const windows = new Uint8Array(N * N);
    /** @type {OfficeDoor[]} */
    const doors = [];
    /** @type {import('./abandonedOfficeFurniture.js').Furniture[]} */
    const furniture = [];
    /** @type {number[]} */
    const partitions = [];
    /** @type {Emitter[]} */
    const emitters = [];
    /** @type {number[][]} */
    const solids = [];
    // Nothing solid where you start, so the view across to the windows is clear.
    const avoid = (x, z) => cx === 0 && cz === 0 && x >= -2 && x <= 2 && z >= -3 && z <= 2;
    if (!empty) {
        classify(layout, kinds, rooms, regions, random, zone.type);
        for (const well of wells) {
            findWindows(layout, windows, well);
            // Solid: open to the sky, and nothing to stand on. (Nothing's put there, nor a tape's note.)
            solids.push([x0 + well.i0 - 0.45, z0 + well.j0 - 0.45, x0 + well.i1 + 0.45, z0 + well.j1 + 0.45]);
        }
        convectors(kinds, windows, solids, x0, z0);
        findDoors(layout, kinds, rooms, regions, windows, doors, seed, x0, z0, zone.type);
        furnishOffice({ layout, kinds, rooms, regions, windows, doors, furniture, partitions, emitters, solids, random, seed, x0, z0, zone: zone.type, avoid });
        if (cx === 0 && cz === 0) dressStart(furniture, solids, kinds, x0, z0);
    }
    const props = empty ? [] : placeAbandonedOfficeProps(random, layout, kinds, rooms, regions, windows, doors, x0, z0, zone.type, avoid);
    for (let i = 0; i < props.length; i++) props[i].index = i;
    // The doors' EXIT signs are lights of their own.
    for (const door of doors) {
        if (door.kind !== DOOR_STAIR) continue;
        const [fx, fz] = door.axis === 0 ? [door.x + 0.5 + door.front * 0.08, door.z] : [door.x, door.z + 0.5 + door.front * 0.08];
        emitters.push({ x: fx, z: fz, kind: EMIT_EXIT });
    }

    const { edgesX, edgesZ, pillars } = layout.cellData();
    const fixtures = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE);
    const lights = officeLights(seed, x0, z0, zone.type, kinds, rooms, regions, fixtures, empty);
    const cells = cellBytes(layout, kinds, rooms, regions, windows, wells, emitters, x0, z0, empty);
    return {
        cx,
        cz,
        zone,
        edgesX,
        edgesZ,
        pillars,
        lights,
        props,
        leaks: [],
        solids,
        cells,
        abandonedOffice: { kinds, rooms, regions, wells, windows, fixtures, doors, furniture, partitions, emitters },
    };
}

// ---------------------------------------------------------------------------------------------- the floors

/** How far apart the columns of an open floor are. */
export const COLUMN_SPACING = 4;

/**
 * Where an open floor's columns are: on the corners of the cells (x, z) with x − ox and z − oz multiples of
 * COLUMN_SPACING, the same for the whole floor, so they line up from chunk to chunk.
 * @param {import('./zones.js').Zone} zone
 * @returns {[number, number]}
 */
export function columnGrid(zone) {
    return [zone.variant % COLUMN_SPACING, (zone.variant >>> 5) % COLUMN_SPACING];
}

/**
 * An open floor: columns on a grid across it, and a stray wall or two (the end of a meeting room, a lift shaft's back);
 * now and then a room stood out in the middle of it.
 */
function openFloor(layout, random, seed, zone, zoneOf, cx, cz) {
    const [ox, oz] = columnGrid(zone);
    const sameFloor = (ncx, ncz) => {
        const other = zoneOf(ncx, ncz);
        return isOpenFloor(other.type) && other.variant === zone.variant;
    };
    placeGridPillars(layout, cx, cz, sameFloor, (x, z) => mod(x - ox, COLUMN_SPACING) === 0 && mod(z - oz, COLUMN_SPACING) === 0
        && hashFloat(seed, 0x4c01, x, z) >= 0.03);
    const walls = random() < 0.5 ? 0 : 1 + Math.floor(random() * 2);
    for (let n = 0; n < walls; n++) {
        const length = 2 + Math.floor(random() * 4);
        const line = 2 + Math.floor(random() * (N - 4));
        const start = 2 + Math.floor(random() * (N - length - 3));
        if (random() < 0.5) layout.vRun(line, start, start + length, EDGE_WALL);
        else layout.hRun(line, start, start + length, EDGE_WALL);
    }
    if (random() < 0.3) {
        // A room stood out on the floor: a meeting room, or an office, its door on one side.
        const w = 2 + Math.floor(random() * 2);
        const h = 2 + Math.floor(random() * 2);
        const i0 = 2 + Math.floor(random() * (N - w - 4));
        const j0 = 2 + Math.floor(random() * (N - h - 4));
        layout.clearInside(i0, j0, i0 + w, j0 + h);
        layout.vRun(i0, j0, j0 + h, EDGE_WALL);
        layout.vRun(i0 + w, j0, j0 + h, EDGE_WALL);
        layout.hRun(j0, i0, i0 + w, EDGE_WALL);
        layout.hRun(j0 + h, i0, i0 + w, EDGE_WALL);
        const side = Math.floor(random() * 4);
        if (side === 0) layout.setV(i0, j0 + Math.floor(random() * h), EDGE_DOOR);
        else if (side === 1) layout.setV(i0 + w, j0 + Math.floor(random() * h), EDGE_DOOR);
        else if (side === 2) layout.setH(i0 + Math.floor(random() * w), j0, EDGE_DOOR);
        else layout.setH(i0 + Math.floor(random() * w), j0 + h, EDGE_DOOR);
    }
}

/** How likely a chunk of each kind is to have a light well. */
function chooseWell(random, zone) {
    const chance = zone === ZONE_OPEN_PLAN ? 0.55 : zone === ZONE_CUBICLES ? 0.4 : zone === ZONE_OFFICES ? 0.35 : 0;
    if (random() >= chance) return null;
    const w = 3 + Math.floor(random() * 4);
    const h = 3 + Math.floor(random() * 5);
    // At least two cells in from the chunk's edge, so the way round it stays the chunk's own.
    const i0 = 2 + Math.floor(random() * (N - 3 - w));
    const j0 = 2 + Math.floor(random() * (N - 3 - h));
    return { i0, j0, i1: i0 + w - 1, j1: j0 + h - 1 };
}

function startWell(x0, z0) {
    return { i0: START_WELL.x0 - x0, j0: START_WELL.z0 - z0, i1: START_WELL.x1 - x0, j1: START_WELL.z1 - z0 };
}

/** A light well: open inside, walled all round, and nothing standing in it. */
function carveWell(layout, kinds, { i0, j0, i1, j1 }) {
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) kinds[i * N + j] = CELL_WELL;
    layout.clearInside(i0, j0, i1 + 1, j1 + 1);
    layout.vRun(i0, j0, j1 + 1, EDGE_WALL);
    layout.vRun(i1 + 1, j0, j1 + 1, EDGE_WALL);
    layout.hRun(j0, i0, i1 + 1, EDGE_WALL);
    layout.hRun(j1 + 1, i0, i1 + 1, EDGE_WALL);
    // No columns on its edges, where its piers are, nor just outside its corners.
    for (let i = i0 - 1; i <= i1 + 2; i++) {
        for (let j = j0 - 1; j <= j1 + 2; j++) if (i >= 0 && j >= 0 && i <= N && j <= N) layout.setPillar(i, j, false);
    }
    // Nor anything left of what was there running into it: a wall ending on a window, a way in through one.
    for (let j = j0; j <= j1; j++) {
        for (const i of [i0 - 1, i1 + 1]) if (i >= 0 && i < N) clearStub(layout, i, j, 0);
    }
    for (let i = i0; i <= i1; i++) {
        for (const j of [j0 - 1, j1 + 1]) if (j >= 0 && j < N) clearStub(layout, i, j, 1);
    }
}

/**
 * A wall running up to a light well's side, square to it, between the cell next to the well at (i, j) and the next
 * one along the well (axis 0: along z; 1: along x), is taken down: it would end on the glass.
 */
function clearStub(layout, i, j, axis) {
    if (axis === 0) {
        if (j + 1 < N) layout.setH(i, j + 1, EDGE_NONE);
    } else if (i + 1 < N) {
        layout.setV(i + 1, j, EDGE_NONE);
    }
}

/**
 * Where you start (world cell (0, 0), local (8, 8)): an open floor from the well's windows back past you, clear of
 * walls, with a column either side of the view.
 */
function stampStart(layout, x0, z0) {
    const [i0, j0] = [-4 - x0, -3 - z0];
    const [i1, j1] = [4 - x0, 3 - z0];
    // (Everything strictly inside: the well's row of windows, along its edge, stays.)
    layout.clearInside(i0, j0, i1 + 1, j1 + 1);
    const corner = (x, z) => layout.setPillar(x - x0 + 1, z - z0 + 1, true);
    corner(-3, -3);
    corner(2, -3);
    corner(-3, 1);
    corner(2, 1);
}

/**
 * What each cell is, and each region (the cells that open into each other without a door or a wall between): on an
 * open floor, open floor (or cubicles), and any room stood out on it an office or a meeting room; in the offices and the
 * core, what a region's size and shape make it.
 */
function classify(layout, kinds, rooms, regions, random, zone) {
    let count = 0;
    for (let start = 0; start < N * N; start++) {
        if (kinds[start] & CELL_WELL || rooms[start] >= 0) continue;
        const cells = [start];
        rooms[start] = count;
        for (let q = 0; q < cells.length; q++) {
            const i = Math.floor(cells[q] / N);
            const j = cells[q] % N;
            for (const [di, dj] of DIRECTIONS) {
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
                const next = ni * N + nj;
                if (rooms[next] >= 0 || kinds[next] & CELL_WELL || layout.between(i, j, di, dj) !== EDGE_NONE) continue;
                rooms[next] = count;
                cells.push(next);
            }
        }
        let i0 = N;
        let j0 = N;
        let i1 = 0;
        let j1 = 0;
        for (const cell of cells) {
            i0 = Math.min(i0, Math.floor(cell / N));
            i1 = Math.max(i1, Math.floor(cell / N));
            j0 = Math.min(j0, cell % N);
            j1 = Math.max(j1, cell % N);
        }
        const narrow = Math.min(i1 - i0, j1 - j0) === 0 && cells.length >= 3;
        const size = cells.length;
        let region;
        let kind;
        if (zone === ZONE_OPEN_PLAN || zone === ZONE_CUBICLES) {
            if (size > 16) {
                region = REGION_OPEN;
                kind = zone === ZONE_CUBICLES ? CELL_CUBICLE : CELL_OPEN;
            } else {
                region = size <= 4 && random() < 0.6 ? REGION_OFFICE : REGION_MEETING;
                kind = CELL_ROOM;
            }
        } else if (zone === ZONE_CORE) {
            kind = CELL_CORE;
            region = narrow || size > 10 ? REGION_LOBBY : size <= 3 ? REGION_STORE : random() < 0.5 ? REGION_COPY : REGION_STORE;
        } else if (narrow) {
            region = REGION_CORRIDOR;
            kind = CELL_CORRIDOR;
        } else if (size <= 4) {
            region = REGION_OFFICE;
            kind = CELL_ROOM;
        } else if (size <= 14) {
            const roll = random();
            region = roll < 0.4 ? REGION_MEETING : roll < 0.62 ? REGION_KITCHEN : REGION_OFFICE;
            kind = region === REGION_KITCHEN ? CELL_KITCHEN : CELL_ROOM;
        } else {
            region = random() < 0.55 ? REGION_BULLPEN : REGION_OPEN;
            kind = region === REGION_BULLPEN ? CELL_CUBICLE : CELL_OPEN;
        }
        for (const cell of cells) kinds[cell] |= kind;
        regions.push(region);
        count++;
    }
}

/** The windows round a light well: every bay of every side of it, in the cells that own those edges. */
function findWindows(layout, windows, { i0, j0, i1, j1 }) {
    for (let j = j0; j <= j1; j++) {
        if (i0 > 0 && layout.getV(i0, j) === EDGE_WALL) windows[(i0 - 1) * N + j] |= 1;
        if (layout.getV(i1 + 1, j) === EDGE_WALL) windows[i1 * N + j] |= 1;
    }
    for (let i = i0; i <= i1; i++) {
        if (j0 > 0 && layout.getH(i, j0) === EDGE_WALL) windows[i * N + j0 - 1] |= 2;
        if (layout.getH(i, j1 + 1) === EDGE_WALL) windows[i * N + j1] |= 2;
    }
}

/**
 * The heating along the foot of every window, on the room's side (see CONVECTOR_DEPTH): solid, so nothing's put against
 * the glass, and nobody walks into it.
 */
function convectors(kinds, windows, solids, x0, z0) {
    const face = 0.5 - WALL_THICKNESS / 2;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const bits = windows[i * N + j];
            if (!bits) continue;
            const x = x0 + i;
            const z = z0 + j;
            const well = kinds[i * N + j] & CELL_WELL;
            if (bits & 1) {
                // The window in the cell's +x edge: the room's on its far side if the cell's the well.
                const [a, b] = well ? [x + 1 - face, x + 1 - face + CONVECTOR_DEPTH] : [x + face - CONVECTOR_DEPTH, x + face];
                solids.push([a, z - 0.5, b, z + 0.5]);
            }
            if (bits & 2) {
                const [a, b] = well ? [z + 1 - face, z + 1 - face + CONVECTOR_DEPTH] : [z + face - CONVECTOR_DEPTH, z + face];
                solids.push([x - 0.5, a, x + 0.5, b]);
            }
        }
    }
}

/** Something to look at from where you start: a chair at the windows, turned to them, as if someone sat watching. */
function dressStart(furniture, solids, kinds, x0, z0) {
    furniture.push({ type: FURN_CHAIR, x: -1.18, z: -3.2, yaw: Math.PI + 0.25, variant: 0x2a51 });
    kinds[(-1 - x0) * N + (-3 - z0)] |= CELL_TAKEN;
    solids.push([-1.3, -3.34, -1.06, -3.1]);
}

// ---------------------------------------------------------------------------------------------- the doors

/**
 * The doors that don't open, in the walls the chunk's cells own (not on its borders, nor round a light well): office
 * doors down a corridor, the doors round a lift lobby (the lifts, the stairs, the toilets, the plant), a door now and
 * then off the back of an office or out of an open floor.
 */
function findDoors(layout, kinds, rooms, regions, windows, doors, seed, x0, z0, zone) {
    const regionOf = (cell) => (rooms[cell] >= 0 ? regions[rooms[cell]] : -1);
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            for (const axis of /** @type {(0 | 1)[]} */ ([0, 1])) {
                if (axis === 0 ? i === N - 1 : j === N - 1) continue;
                if ((axis === 0 ? layout.getV(i + 1, j) : layout.getH(i, j + 1)) !== EDGE_WALL) continue;
                const here = i * N + j;
                const there = axis === 0 ? here + N : here + 1;
                if ((kinds[here] | kinds[there]) & CELL_WELL || windows[here] & (axis === 0 ? 1 : 2)) continue;
                const x = x0 + i;
                const z = z0 + j;
                const along = axis === 0 ? z : x;
                const roll = hashFloat(seed, 0x4d00, x, z, axis);
                const variant = hashInts(seed, 0x4d01, x, z, axis);
                // Which side it faces: the lobby's, the corridor's, else either.
                const a = regionOf(here);
                const b = regionOf(there);
                const facing = (region) => region === REGION_LOBBY || region === REGION_CORRIDOR;
                const front = facing(b) && !facing(a) ? 1 : facing(a) && !facing(b) ? -1 : (variant & 1) === 0 ? 1 : -1;
                const into = front > 0 ? b : a;
                let kind = -1;
                if (into === REGION_LOBBY) {
                    if (roll < 0.34) kind = DOOR_LIFT;
                    else if (roll < 0.5) kind = DOOR_STAIR;
                    else if (roll < 0.62) kind = DOOR_SERVICE;
                } else if (into === REGION_CORRIDOR) {
                    // Every other cell down a corridor, most of them offices.
                    if ((along & 1) === 0 && roll < 0.55) kind = roll < 0.06 ? DOOR_STAIR : roll < 0.1 ? DOOR_SERVICE : DOOR_OFFICE;
                } else if (zone === ZONE_CORE) {
                    if (roll < 0.1) kind = DOOR_SERVICE;
                } else if (into === REGION_OPEN) {
                    if (roll < 0.035) kind = DOOR_STAIR;
                    else if (roll < 0.05) kind = DOOR_SERVICE;
                } else if (roll < 0.03) {
                    kind = DOOR_OFFICE;
                }
                if (kind < 0) continue;
                // (A stair door's EXIT sign lights what's round it, which has to be in the chunk.)
                if (kind === DOOR_STAIR && (i < 2 || j < 2 || i > N - 4 || j > N - 4)) kind = DOOR_SERVICE;
                // (Never two side by side.)
                const beside = doors.some((door) => door.axis === axis && (axis === 0 ? door.x === x && Math.abs(door.z - z) < 2 : door.z === z && Math.abs(door.x - x) < 2));
                if (beside) continue;
                doors.push({ x, z, axis, front, kind, variant });
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------- the lights

/**
 * How dark Level 4 is around a point, 0 to 1: great stretches where every tube has died, and round where you start,
 * lit.
 */
export function abandonedOfficeDarkness(seed, x, z) {
    const n = 0.6 * valueNoise(seed ^ 0x4dac, x / 28, z / 28) + 0.4 * valueNoise(seed ^ 0x4dad, x / 10, z / 10);
    let darkness = smoothstep(0.5, 0.68, n);
    const distance = Math.hypot(x, z);
    if (distance < 20) darkness *= smoothstep(9, 20, distance);
    return darkness;
}

/**
 * Level 4's lights: a troffer in every slot of the floors, the offices and the corridors, a bare batten in the core,
 * none over a light well; and most of them dead. Now and then one's come down at one end.
 */
function officeLights(seed, x0, z0, zone, kinds, rooms, regions, fixtures, empty) {
    if (empty) return darkLights(TUBE_COOL);
    const lights = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE * 4);
    for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
        for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
            const i = pi * 2 + 1;
            const j = pj * 2 + 1;
            const x = x0 + i;
            const z = z0 + j;
            const k = pi * PANELS_PER_SIDE + pj;
            const kind = kinds[i * N + j];
            const region = rooms[i * N + j] >= 0 ? regions[rooms[i * N + j]] : -1;
            const darkness = abandonedOfficeDarkness(seed, x, z);
            const roll = (salt) => hashFloat(seed, salt, x, z);
            let fixture = FIXTURE_TROFFER;
            let tint = roll(0x4e10) < 0.18 ? TUBE_OLD : TUBE_COOL;
            let dead = 0.42 + 0.56 * darkness;
            let area = 0.5;
            if (kind & CELL_WELL) {
                fixture = FIXTURE_NONE;
                tint = TUBE_NONE;
                dead = 1;
                area = 0.3;
            } else if (kind & CELL_CORE) {
                fixture = FIXTURE_STRIP;
                tint = TUBE_OLD;
                dead = 0.3 + 0.6 * darkness;
                area = 0.4;
            } else if (kind & CELL_KITCHEN) {
                tint = TUBE_WARM;
                dead = 0.3 + 0.6 * darkness;
            } else if (region === REGION_CORRIDOR) {
                dead = 0.3 + 0.6 * darkness;
                area = 0.4;
            } else if (kind & CELL_ROOM) {
                dead = 0.5 + 0.5 * darkness;
                area = 0.42;
            }
            const start = x >= -5 && x <= 5 && z >= -4 && z <= 5;
            if (fixture === FIXTURE_TROFFER && !start && roll(0x4e11) < 0.035) fixture = FIXTURE_HANGING;
            let brightness = 0;
            let flicker = 0;
            if (fixture !== FIXTURE_NONE) {
                brightness = 255;
                if (start) {
                    // Round where you start: lit behind you, and dead by the windows, so their light shows.
                    brightness = z <= -3 ? 0 : 255;
                    if (x === 1 && z === -1) flicker = 1 + (hashInts(seed, 0x4e1d, x, z) % 255);
                } else if (fixture === FIXTURE_HANGING || roll(0x4e19) < dead) {
                    brightness = 0;
                } else {
                    if (roll(0x4e1a) < 0.2) brightness = 110 + Math.floor(roll(0x4e1b) * 110);
                    if (roll(0x4e1c) < 0.05 + 1.3 * darkness * (1 - darkness)) flicker = 1 + (hashInts(seed, 0x4e1d, x, z) % 255);
                }
            }
            fixtures[k] = fixture;
            lights[k * 4] = brightness;
            lights[k * 4 + 1] = Math.round(255 * area * (1 - 0.8 * darkness));
            lights[k * 4 + 2] = flicker;
            lights[k * 4 + 3] = tint;
        }
    }
    return lights;
}

// ---------------------------------------------------------------------------------------------- cells

/**
 * Each cell's bytes for Level 4's shaders (see ChunkData.cells):
 *
 * - the first: its look (LOOK_*), whether its +x and +z edges are windows, and what light of its own is nearest it
 *   (BYTE_EMITTER, and its kind at EMITTER_SHIFT);
 * - the second: the window whose light reaches it, if one does (see windowLight): 128, the way to it (0 +x, 1 −x, 2 +z,
 *   3 −z, times 32), how many cells off its glass is (times 8), and how open to the sky the cell is (0 to 7);
 * - the third: where the light of its own is, from the cell's middle, in thirds of a cell (see EMIT_STEPS): along x in
 *   its low four bits, along z in its high four.
 */
function cellBytes(layout, kinds, rooms, regions, windows, wells, emitters, x0, z0, empty) {
    const cells = new Uint8Array(N * N * 4);
    if (empty) return cells;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cell = i * N + j;
            const kind = kinds[cell];
            const region = rooms[cell] >= 0 ? regions[rooms[cell]] : -1;
            let look = LOOK_OPEN;
            if (kind & CELL_WELL) look = LOOK_WELL;
            else if (kind & CELL_CORE) look = LOOK_CORE;
            else if (kind & CELL_KITCHEN) look = LOOK_KITCHEN;
            else if (kind & CELL_CORRIDOR) look = LOOK_CORRIDOR;
            else if (region === REGION_MEETING) look = LOOK_MEETING;
            else if (kind & CELL_ROOM) look = LOOK_ROOM;
            else if (kind & CELL_CUBICLE) look = LOOK_CUBICLES;
            cells[cell * 4] = look | (windows[cell] & 1 ? BYTE_WINDOW_X : 0) | (windows[cell] & 2 ? BYTE_WINDOW_Z : 0);
        }
    }
    windowLight(layout, kinds, wells, cells);
    // The lights of their own: each cell its nearest, among those it can see (the same room, or next door through an
    // opening).
    const best = new Float32Array(N * N).fill(Infinity);
    for (const emitter of emitters) {
        const ei = Math.round(emitter.x) - x0;
        const ej = Math.round(emitter.z) - z0;
        if (ei < 0 || ej < 0 || ei >= N || ej >= N) continue;
        const reach = EMIT_RANGE[emitter.kind] + 0.75;
        // Out from its own cell, through what's open.
        const seen = new Set([ei * N + ej]);
        const queue = [ei * N + ej];
        for (let q = 0; q < queue.length; q++) {
            const cell = queue[q];
            const i = Math.floor(cell / N);
            const j = cell % N;
            const ox = emitter.x - (x0 + i);
            const oz = emitter.z - (z0 + j);
            const codeX = Math.round(ox * EMIT_STEPS) + EMIT_BIAS;
            const codeZ = Math.round(oz * EMIT_STEPS) + EMIT_BIAS;
            const d = Math.hypot(ox, oz);
            if (codeX >= 0 && codeX < 16 && codeZ >= 0 && codeZ < 16 && d < best[cell]) {
                best[cell] = d;
                cells[cell * 4] = (cells[cell * 4] & ~(BYTE_EMITTER | (3 << EMITTER_SHIFT))) | BYTE_EMITTER | (emitter.kind << EMITTER_SHIFT);
                cells[cell * 4 + 2] = codeX | (codeZ << 4);
            }
            for (const [di, dj] of DIRECTIONS) {
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
                const next = ni * N + nj;
                if (seen.has(next) || kinds[next] & CELL_WELL || layout.between(i, j, di, dj) === EDGE_WALL) continue;
                if (Math.hypot(emitter.x - (x0 + ni), emitter.z - (z0 + nj)) > reach) continue;
                seen.add(next);
                queue.push(next);
            }
        }
    }
    return cells;
}

/** The ways to a window from a cell, as cellBytes writes them: +x, −x, +z, −z. */
const WINDOW_WAYS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * The light through the windows (see cellBytes' second byte): each cell near enough a light well, and in sight of one
 * of its sides (out from the cells along that side, through what's open, no further than WINDOW_REACH cells from the
 * glass), takes the nearest side it's in front of, and how open it is: less further in, and less off the ends of the
 * side.
 */
function windowLight(layout, kinds, wells, cells) {
    const best = new Float32Array(N * N).fill(Infinity);
    for (const { i0, j0, i1, j1 } of wells) {
        // Each side: the way to it from the rooms (as WINDOW_WAYS), the line of cells along it outside the well, and
        // how far along the side runs.
        const sides = [
            { way: 0, cells: range(j0, j1).map((j) => [i0 - 1, j]), from: j0, to: j1, across: 0 },
            { way: 1, cells: range(j0, j1).map((j) => [i1 + 1, j]), from: j0, to: j1, across: 0 },
            { way: 2, cells: range(i0, i1).map((i) => [i, j0 - 1]), from: i0, to: i1, across: 1 },
            { way: 3, cells: range(i0, i1).map((i) => [i, j1 + 1]), from: i0, to: i1, across: 1 },
        ];
        for (const side of sides) {
            const [di, dj] = WINDOW_WAYS[side.way];
            // The glass is on the edge beyond the first cells, the way to it.
            const glass = side.across === 0 ? (di > 0 ? i0 - 0.5 : i1 + 0.5) : (dj > 0 ? j0 - 0.5 : j1 + 0.5);
            const queue = [];
            const seen = new Set();
            for (const [i, j] of side.cells) {
                if (i < 0 || j < 0 || i >= N || j >= N) continue;
                if (layout.between(i, j, di, dj) !== EDGE_WALL) continue;
                queue.push([i, j]);
                seen.add(i * N + j);
            }
            for (let q = 0; q < queue.length; q++) {
                const [i, j] = queue[q];
                const cell = i * N + j;
                const k = Math.round(Math.abs((side.across === 0 ? i : j) - glass) - 0.5);
                const lateral = side.across === 0 ? j : i;
                const off = Math.max(side.from - lateral, lateral - side.to, 0);
                const score = k + off * 0.8;
                if (score < best[cell]) {
                    best[cell] = score;
                    const exposure = Math.max(0, Math.min(7, Math.round(7 - 1.6 * k - 2.2 * off)));
                    cells[cell * 4 + 1] = 128 | (side.way << 5) | (k << 3) | exposure;
                }
                for (const [ni, nj] of [[i - di, j - dj], [i + dj, j + di], [i - dj, j - di]]) {
                    if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
                    const next = ni * N + nj;
                    if (seen.has(next) || kinds[next] & CELL_WELL || layout.between(i, j, ni - i, nj - j) !== EDGE_NONE) continue;
                    const nk = Math.round(Math.abs((side.across === 0 ? ni : nj) - glass) - 0.5);
                    const nl = side.across === 0 ? nj : ni;
                    if (nk > WINDOW_REACH || nl < side.from - 2 || nl > side.to + 2) continue;
                    seen.add(next);
                    queue.push([ni, nj]);
                }
            }
        }
    }
}

function range(from, to) {
    return Array.from({ length: to - from + 1 }, (_, k) => from + k);
}

/**
 * What's underfoot at (x, z), for its footsteps: carpet (0), or the vinyl of the core and the kitchens (1).
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {number} x
 * @param {number} z
 */
export function abandonedOfficeFloorAt(store, x, z) {
    const cellX = Math.floor(x + 0.5);
    const cellZ = Math.floor(z + 0.5);
    const cx = chunkCoord(cellX);
    const cz = chunkCoord(cellZ);
    const cells = store.getChunk(cx, cz).cells;
    if (!cells) return 0;
    const look = cells[((cellX - cx * N + HALF_CHUNK) * N + (cellZ - cz * N + HALF_CHUNK)) * 4] & 7;
    return look === LOOK_CORE || look === LOOK_KITCHEN ? 1 : 0;
}

/**
 * How near the rain is at (x, z), 0 to 1, for its sound: from how open the cell is to a window (see cellBytes).
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {number} x
 * @param {number} z
 */
export function abandonedOfficeRainAt(store, x, z) {
    const cellX = Math.floor(x + 0.5);
    const cellZ = Math.floor(z + 0.5);
    const cx = chunkCoord(cellX);
    const cz = chunkCoord(cellZ);
    const cells = store.getChunk(cx, cz).cells;
    if (!cells) return 0;
    const k = ((cellX - cx * N + HALF_CHUNK) * N + (cellZ - cz * N + HALF_CHUNK)) * 4;
    if ((cells[k] & 7) === LOOK_WELL) return 1;
    const light = cells[k + 1];
    return light & 128 ? (light & 7) / 7 : 0;
}

