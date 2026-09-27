import { CHUNK_SIZE, WALL_THICKNESS } from '../config.js';
import {
    CELL_CUBICLE,
    CELL_TAKEN,
    CELL_WELL,
    CONVECTOR_DEPTH,
    EMIT_SCREEN,
    EMIT_VENDING,
    REGION_BULLPEN,
    REGION_COPY,
    REGION_CORRIDOR,
    REGION_KITCHEN,
    REGION_LOBBY,
    REGION_MEETING,
    REGION_OFFICE,
    REGION_OPEN,
    REGION_STORE,
} from './abandonedOffice.js';
import { DIRECTIONS, EDGE_NONE, EDGE_WALL } from './grid.js';
import { ZONE_CUBICLES } from './zones.js';

/*
 * The furniture of Level 4 (see abandonedOffice.js), what's left of it: on the open floors, mostly nothing, a chair or
 * two where they were pushed back, a vending machine still lit, a sofa by a column; the cubicles, row on row, their
 * computers, one or two still on; the offices' desks, the meeting rooms' tables, the kitchens' counters; the core's
 * copiers and shelves. On the walls, the clocks, the whiteboards, the drinking fountains and the fire extinguishers.
 * What's small enough to carry is in abandonedOfficeProps.js instead.
 *
 * Everything keeps inside its chunk, clear of the walls, the doorways, the windows and the columns, and leaves a way
 * through: a cell a doorway or an opening goes through has nothing solid in it, and the cubicles stand in islands with
 * an aisle all round. Everything keeps inside its own cell, too (a meeting table takes all the cells it and its chairs
 * cover), all of it, as it's drawn: a chair's back, a drawer left open. What hangs on a wall goes on one with nothing
 * against it, in a cell with nothing loose in it, and takes the cell.
 */

const N = CHUNK_SIZE;
/** How far a wall's face is from the middle of its cell. */
export const FACE = 0.5 - WALL_THICKNESS / 2;

export const FURN_WORKSTATION = 0; // a cubicle's desk, its chair and its computer
export const FURN_DESK = 1; // an office's desk, facing into the room, its chair behind it
export const FURN_TABLE = 2; // a meeting table and its chairs
export const FURN_VENDING = 3; // a vending machine, lit
export const FURN_CHAIR = 4; // a task chair on its own
export const FURN_CABINET = 5; // a filing cabinet, a drawer sometimes left open
export const FURN_SHELF = 6; // a bookcase of binders
export const FURN_SOFA = 7; // a sofa, and a low table in front of it
export const FURN_COPIER = 8; // a photocopier
export const FURN_COUNTER = 9; // a kitchen counter, a cell long: a sink, or the microwave and the coffee
export const FURN_ROUND_TABLE = 10; // a small round table, in a kitchen, with its chairs
export const FURN_WHITEBOARD = 11; // on a wall
export const FURN_CLOCK = 12; // on a wall
export const FURN_FOUNTAIN = 13; // a drinking fountain, on a wall
export const FURN_STACK = 14; // chairs, stacked
export const FURN_FRIDGE = 15; // a tall fridge, at the end of a counter
export const FURN_EXTINGUISHER = 16; // a fire extinguisher, on a wall

/** Half a cubicle partition's thickness (see the partitions in abandonedOfficeGeometry.js). */
export const PARTITION_HALF = 0.025;

/** A vending machine's variant bit: its light isn't one of its own (it's the second of a pair, or near the chunk's edge). */
export const NO_LIGHT = 0x80000000;

/**
 * Whether a cubicle's computer was left on (its variant: something on the desk, and one in thirty-two of those).
 * @param {number} variant
 */
export function workstationOn(variant) {
    return (variant & 7) !== 0 && ((variant >>> 12) & 31) === 0;
}

/**
 * Whether a chair left about is over on its back (its variant: one in sixteen).
 * @param {number} variant
 */
export function chairTipped(variant) {
    return ((variant >>> 8) & 15) === 0;
}

/** A chair on its back, lying on the floor (see the chairs in abandonedOfficeGeometry.js): its half size, across and along. */
export const TIPPED_HALF = [0.12, 0.25];

/**
 * @typedef {object} Furniture
 * @property {number} type FURN_*.
 * @property {number} x Its middle.
 * @property {number} z
 * @property {number} yaw Which way its front faces: (sin yaw, cos yaw).
 * @property {number} variant 32 bits for its size and details.
 * @property {number} [length] A meeting table's length, in cells.
 * @property {[number, number]} [reach] A kitchen counter's: how far it reaches along its own −x and +x from its middle
 *     (to the next one in its run, to the wall at its end, or short of a window's heating).
 */

/** Each kind's half size across (its own x) and front to back (its own z), and whether it's solid. */
const HALF = [
    [0.36, 0.17, true],
    [0.26, 0.13, true],
    [0.2, 0.2, true],
    [0.15, 0.15, true],
    [0.1, 0.1, true],
    [0.075, 0.1, true],
    [0.17, 0.07, true],
    [0.26, 0.2, true],
    [0.16, 0.12, true],
    [0.46, 0.11, true],
    [0.12, 0.12, true],
    [0.3, 0.02, false],
    [0.06, 0.02, false],
    [0.07, 0.06, false],
    [0.1, 0.1, true],
    [0.13, 0.12, true],
    [0.03, 0.035, false],
];

/**
 * An office desk's chair: how far behind the desk's middle it is, and how far it's turned either way at most (see the
 * desk in abandonedOfficeGeometry.js); and how far the desk stands off its wall, so the chair's back keeps off it.
 */
export const DESK_CHAIR = 0.21;
export const DESK_CHAIR_TURN = 0.1;
const DESK_GAP = 0.26;

/** Its half size across and front to back. @param {Furniture} piece */
export function furnitureHalf(piece) {
    if (piece.type === FURN_TABLE) return [(piece.length ?? 1) * 0.5 - 0.2, 0.2];
    if (piece.type === FURN_CHAIR && chairTipped(piece.variant)) return [TIPPED_HALF[0], TIPPED_HALF[1]];
    return [HALF[piece.type][0], HALF[piece.type][1]];
}

/** What of it is solid, as [minX, minZ, maxX, maxZ], or null. @param {Furniture} piece */
export function furnitureBox(piece) {
    if (!HALF[piece.type][2]) return null;
    const [a, d] = furnitureHalf(piece);
    // Square to the grid, or round what's turned (the chairs left about aren't square to anything).
    const quarter = Math.round(piece.yaw / (Math.PI / 2));
    const turned = Math.abs(piece.yaw - quarter * (Math.PI / 2)) > 1e-6;
    const cos = Math.abs(Math.cos(piece.yaw));
    const sin = Math.abs(Math.sin(piece.yaw));
    const [hx, hz] = turned ? [a * cos + d * sin, a * sin + d * cos] : quarter & 1 ? [d, a] : [a, d];
    return [piece.x - hx, piece.z - hz, piece.x + hx, piece.z + hz];
}

// ---------------------------------------------------------------------------------------------- placing

/**
 * Furnishes a chunk (see generateAbandonedOfficeChunk): each region by what it is. Adds to `furniture`, `partitions`,
 * `emitters` and `solids`, and marks the cells anything stands in (CELL_TAKEN).
 * @param {object} ctx
 * @param {import('./generator.js').Layout} ctx.layout
 * @param {Uint8Array} ctx.kinds
 * @param {Int16Array} ctx.rooms
 * @param {number[]} ctx.regions
 * @param {Uint8Array} ctx.windows
 * @param {import('./abandonedOffice.js').OfficeDoor[]} ctx.doors
 * @param {Furniture[]} ctx.furniture
 * @param {number[]} ctx.partitions
 * @param {import('./abandonedOffice.js').Emitter[]} ctx.emitters
 * @param {number[][]} ctx.solids
 * @param {() => number} ctx.random
 * @param {number} ctx.seed
 * @param {number} ctx.x0
 * @param {number} ctx.z0
 * @param {number} ctx.zone
 * @param {(x: number, z: number) => boolean} ctx.avoid
 * @param {(i: number, j: number) => boolean} ctx.outside Whether a cell just past the chunk's edge is outside a tape's
 *     walls (nothing's put against them).
 */
export function furnishOffice(ctx) {
    const { layout, kinds, rooms, regions } = ctx;
    // The cells of each region.
    /** @type {number[][]} */
    const cellsOf = regions.map(() => []);
    for (let cell = 0; cell < N * N; cell++) if (rooms[cell] >= 0) cellsOf[rooms[cell]].push(cell);
    // A cell a way through goes through (a doorway, or an opening into another region or the next chunk): nothing solid
    // in it.
    const passage = new Uint8Array(N * N);
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cell = i * N + j;
            for (const [di, dj] of DIRECTIONS) {
                const edge = layout.between(i, j, di, dj);
                if (edge === EDGE_WALL) continue;
                const ni = i + di;
                const nj = j + dj;
                const outside = ni < 0 || nj < 0 || ni >= N || nj >= N;
                if (edge !== EDGE_NONE || outside || rooms[ni * N + nj] !== rooms[cell]) passage[cell] = 1;
            }
        }
    }
    const place = makePlacer(ctx, passage);
    for (let r = 0; r < regions.length; r++) {
        const cells = cellsOf[r];
        switch (regions[r]) {
            case REGION_OPEN:
                if (kinds[cells[0]] & CELL_CUBICLE || ctx.zone === ZONE_CUBICLES) cubicles(ctx, place, cells, false);
                else openFloor(ctx, place, cells);
                break;
            case REGION_BULLPEN:
                cubicles(ctx, place, cells, true);
                break;
            case REGION_OFFICE:
                office(ctx, place, cells);
                break;
            case REGION_MEETING:
                meeting(ctx, place, cells);
                break;
            case REGION_KITCHEN:
                kitchen(ctx, place, cells);
                break;
            case REGION_CORRIDOR:
                corridor(ctx, place, cells);
                break;
            case REGION_LOBBY:
                lobby(ctx, place, cells);
                break;
            case REGION_COPY:
                copyRoom(ctx, place, cells);
                break;
            case REGION_STORE:
                storeRoom(ctx, place, cells);
                break;
            default:
        }
    }
}

/**
 * What the placing of furniture shares: where a cell's walls are, and whether one's free for something against it, and
 * putting a piece down (its box into the solids, its cells taken).
 */
function makePlacer(ctx, passage) {
    const { layout, kinds, windows, doors, furniture, solids, x0, z0, avoid, outside } = ctx;
    const inChunk = (i, j) => i >= 0 && j >= 0 && i < N && j < N;
    /** Whether the side (di, dj) of cell (i, j) is a window (in the edge the cell or its neighbour owns). */
    const windowSide = (i, j, di, dj) => {
        const ni = i + di;
        const nj = j + dj;
        if (di === 1) return (windows[i * N + j] & 1) !== 0;
        if (dj === 1) return (windows[i * N + j] & 2) !== 0;
        if (di === -1) return inChunk(ni, nj) && (windows[ni * N + nj] & 1) !== 0;
        return inChunk(ni, nj) && (windows[ni * N + nj] & 2) !== 0;
    };
    /** Whether the wall on side (di, dj) of cell (i, j) is a plain one: a wall, no window, no door that doesn't open. */
    const plainWall = (i, j, di, dj) => {
        if (layout.between(i, j, di, dj) !== EDGE_WALL) return false;
        const ni = i + di;
        const nj = j + dj;
        if (inChunk(ni, nj) ? kinds[ni * N + nj] & CELL_WELL : outside(ni, nj)) return false;
        if (windowSide(i, j, di, dj)) return false;
        const x = x0 + i;
        const z = z0 + j;
        const [ex, ez, axis] = di !== 0 ? [di > 0 ? x : x - 1, z, 0] : [x, dj > 0 ? z : z - 1, 1];
        return !doors.some((door) => door.x === ex && door.z === ez && door.axis === axis);
    };
    // What stands against each wall of each cell (a bit for each way, in the order of DIRECTIONS), and the cells with
    // something loose in them, that could be anywhere in the cell (a chair, a table and its chairs): nothing hangs on a
    // wall over either.
    const backed = new Uint8Array(N * N);
    const loose = new Uint8Array(N * N);
    const sideBit = (di, dj) => 1 << DIRECTIONS.findIndex(([a, b]) => a === di && b === dj);
    /** Marks the wall on side (di, dj) of cell (i, j) as having something against it. */
    const back = (i, j, [di, dj]) => {
        backed[i * N + j] |= sideBit(di, dj);
    };
    /** Whether a cell's free for something solid. */
    const free = (i, j) => {
        if (!inChunk(i, j)) return false;
        const cell = i * N + j;
        return !(kinds[cell] & (CELL_TAKEN | CELL_WELL)) && !passage[cell] && !avoid(x0 + i, z0 + j);
    };
    /** Whether a pillar stands on any corner of cell (i, j). */
    const pillarBy = (i, j) => layout.getPillar(i, j) || layout.getPillar(i + 1, j) || layout.getPillar(i, j + 1) || layout.getPillar(i + 1, j + 1);
    /** Puts a piece down, into the cell (i, j) it's in. */
    const put = (piece, i, j) => {
        furniture.push(piece);
        const box = furnitureBox(piece);
        if (box) solids.push(box);
        if (i !== undefined) kinds[i * N + j] |= CELL_TAKEN;
        return piece;
    };
    /**
     * A piece against the wall on side (di, dj) of cell (i, j), `along` it from the middle, standing `gap` off the wall,
     * facing away from it.
     */
    const against = (type, i, j, [di, dj], along, variant, gap = 0.01) => {
        const [, depth] = HALF[type];
        const out = FACE - depth - gap;
        const piece = {
            type,
            x: x0 + i + di * out + (di === 0 ? along : 0),
            z: z0 + j + dj * out + (dj === 0 ? along : 0),
            yaw: Math.atan2(-di, -dj),
            variant,
        };
        back(i, j, [di, dj]);
        return put(piece, i, j);
    };
    /** The plain walls of a cell, as ways to them. */
    const wallsOf = (i, j) => DIRECTIONS.filter(([di, dj]) => plainWall(i, j, di, dj));
    /** Whether something can hang on the wall on side (di, dj) of cell (i, j). */
    const mountable = (i, j, [di, dj]) => {
        if (!inChunk(i, j)) return false;
        const cell = i * N + j;
        return !(kinds[cell] & CELL_WELL) && !loose[cell] && !(backed[cell] & sideBit(di, dj)) && plainWall(i, j, di, dj);
    };
    /** The walls of a cell something can hang on. */
    const mountsOf = (i, j) => DIRECTIONS.filter((wall) => mountable(i, j, wall));
    const variant = () => (ctx.random() * 4294967296) >>> 0;
    /** Hangs a piece (a clock, a whiteboard, a fountain) on the wall on side `wall` of cell (i, j), flat to it. */
    const mount = (type, i, j, wall) => against(type, i, j, wall, 0, variant(), 0);
    /** Marks a cell as having something loose in it. */
    const loosen = (i, j) => {
        loose[i * N + j] = 1;
    };
    return { inChunk, windowSide, plainWall, free, pillarBy, put, against, back, wallsOf, mountsOf, mount, loosen, variant };
}

/** Its cells, in a random order (from the chunk's own stream). */
function shuffled(cells, random) {
    const order = cells.slice();
    for (let k = order.length - 1; k > 0; k--) {
        const r = Math.floor(random() * (k + 1));
        [order[k], order[r]] = [order[r], order[k]];
    }
    return order;
}

/** Whether a point is far enough in from the chunk's edge for a light of its own (its light has to stop inside it). */
function lightFits(ctx, x, z) {
    const i = x - ctx.x0;
    const j = z - ctx.z0;
    return i > 1.6 && j > 1.6 && i < N - 2.6 && j < N - 2.6;
}

/**
 * A vending machine against a plain wall of one of `cells` (a pair of them side by side, sometimes): its front's light
 * is a light of its own. Returns whether one went in.
 */
function vending(ctx, place, cells, pairs = true) {
    const { random, emitters } = ctx;
    for (const cell of shuffled(cells, random).slice(0, 24)) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        if (!place.free(i, j) || place.pillarBy(i, j)) continue;
        const walls = place.wallsOf(i, j);
        if (walls.length === 0) continue;
        const wall = walls[Math.floor(random() * walls.length)];
        const [di, dj] = wall;
        const pair = pairs && random() < 0.45;
        const along = pair ? -0.17 : (random() - 0.5) * 0.3;
        const machine = place.against(FURN_VENDING, i, j, wall, along, place.variant());
        const out = [-di, -dj];
        const light = (m) => {
            const lx = m.x + out[0] * 0.2;
            const lz = m.z + out[1] * 0.2;
            if (lightFits(ctx, lx, lz)) emitters.push({ x: lx, z: lz, kind: EMIT_VENDING });
            else m.variant = (m.variant | NO_LIGHT) >>> 0;
        };
        light(machine);
        if (pair) {
            const second = place.against(FURN_VENDING, i, j, wall, 0.17, place.variant());
            // (Two side by side light as one.)
            second.variant = (second.variant | NO_LIGHT) >>> 0;
        }
        return true;
    }
    return false;
}

/**
 * The cubicles: islands of them, two rows back to back along a spine, each cell a desk walled on three sides by
 * partitions, with an aisle a cell wide all round every island. `bullpen`: a big room of them, off a corridor.
 */
function cubicles(ctx, place, cells, bullpen) {
    const { layout, kinds, rooms, random, partitions, emitters, x0, z0 } = ctx;
    const region = rooms[cells[0]];
    // (The aisle round an island keeps a cell in from the chunk's edge, whose cells are left free: along a tape's walls,
    // they're where its notes go.)
    const inRegion = (i, j) => i >= 1 && j >= 1 && i < N - 1 && j < N - 1 && rooms[i * N + j] === region && !(kinds[i * N + j] & (CELL_WELL | CELL_TAKEN));
    // Islands two cells deep across, `length` along: along x or along z, for the whole chunk.
    const alongX = random() < 0.5;
    const length = 3 + Math.floor(random() * 3);
    const tall = random() < 0.35;
    const across0 = Math.floor(random() * 3);
    const along0 = Math.floor(random() * (length + 1));
    const cellAt = (a, b) => (alongX ? [b, a] : [a, b]);
    for (let a = across0 - 3; a < N; a += 3) {
        for (let b = along0 - length - 1; b < N; b += length + 1) {
            // The island: across a..a+1, along b..b+length−1; its ring: one more all round.
            let fits = true;
            for (let p = a - 1; p <= a + 2 && fits; p++) {
                for (let q = b - 1; q <= b + length && fits; q++) {
                    const [i, j] = cellAt(p, q);
                    if (!inRegion(i, j)) fits = false;
                    else if (p >= a && p <= a + 1 && q >= b && q < b + length && (!place.free(i, j) || ctx.avoid(x0 + i, z0 + j))) fits = false;
                    // Nothing walled inside the ring, so the aisle round it goes all the way round.
                    else if (p < a + 2 && layout.between(i, j, ...(alongX ? [0, 1] : [1, 0])) !== EDGE_NONE) fits = false;
                    else if (q < b + length && layout.between(i, j, ...(alongX ? [1, 0] : [0, 1])) !== EDGE_NONE) fits = false;
                }
            }
            if (!fits) continue;
            // No columns on its corners, nor just outside it.
            for (let p = a; p <= a + 2; p++) {
                for (let q = b; q <= b + length; q++) {
                    const [ci, cj] = cellAt(p, q);
                    layout.setPillar(ci, cj, false);
                }
            }
            const height = tall ? 0.56 : 0.44 + random() * 0.04;
            // The partitions across, at each end and between each two desks; and the spine, a piece from each to the
            // next, up to their faces (so none goes through another). (In world coordinates: line a + 1 across is between
            // the rows.)
            const t = PARTITION_HALF;
            const run = (p0, q0, p1, q1, trim = 0) => {
                const [xa, za] = alongX ? [q0 + trim, p0] : [p0, q0 + trim];
                const [xb, zb] = alongX ? [q1 - trim, p1] : [p1, q1 - trim];
                partitions.push(x0 + xa - 0.5, z0 + za - 0.5, x0 + xb - 0.5, z0 + zb - 0.5, height);
                ctx.solids.push([x0 + Math.min(xa, xb) - 0.5 - t, z0 + Math.min(za, zb) - 0.5 - t, x0 + Math.max(xa, xb) - 0.5 + t, z0 + Math.max(za, zb) - 0.5 + t]);
            };
            for (let q = b; q <= b + length; q++) run(a, q, a + 2, q);
            for (let q = b; q < b + length; q++) run(a + 1, q, a + 1, q + 1, t);
            // A desk in each, against the spine.
            for (let p = a; p <= a + 1; p++) {
                for (let q = b; q < b + length; q++) {
                    const [i, j] = cellAt(p, q);
                    kinds[i * N + j] |= CELL_TAKEN;
                    const toSpine = p === a ? 1 : -1;
                    const [di, dj] = alongX ? [0, toSpine] : [toSpine, 0];
                    let variant = place.variant();
                    // Which side its return is on, and whether it's been cleared.
                    const piece = {
                        type: FURN_WORKSTATION,
                        x: x0 + i + di * 0.02,
                        z: z0 + j + dj * 0.02,
                        yaw: Math.atan2(di, dj),
                        variant,
                    };
                    // A computer left on, now and then (see workstationOn).
                    if (workstationOn(variant)) {
                        const sx = x0 + i + di * 0.12;
                        const sz = z0 + j + dj * 0.12;
                        if (lightFits(ctx, sx, sz)) emitters.push({ x: sx, z: sz, kind: EMIT_SCREEN });
                        else variant = (variant | (31 << 12)) >>> 0;
                    }
                    piece.variant = variant;
                    ctx.furniture.push(piece);
                    // Solid: the desk against the spine (the chair's in the open part, in front of it).
                    const desk = [x0 + i - 0.46, z0 + j - 0.46, x0 + i + 0.46, z0 + j + 0.46];
                    if (di > 0) desk[0] = x0 + i + 0.1;
                    else if (di < 0) desk[2] = x0 + i - 0.1;
                    else if (dj > 0) desk[1] = z0 + j + 0.1;
                    else desk[3] = z0 + j - 0.1;
                    ctx.solids.push(desk);
                }
            }
        }
    }
    // And round the islands, as on any floor, a little of everything else.
    if (!bullpen) openFloor(ctx, place, cells, 0.5);
}

/**
 * An open floor, cleared: mostly nothing (the dents in the carpet are the shaders'), a chair or two where they were
 * pushed back, a stack of them, a filing cabinet against a wall; a vending machine still lit; now and then a sofa and
 * its low table, where people sat.
 */
function openFloor(ctx, place, cells, busy = 1) {
    const { random, x0, z0 } = ctx;
    if (cells.length > 30 && random() < 0.7 * busy) vending(ctx, place, cells);
    if (cells.length > 50 && random() < 0.3 * busy) vending(ctx, place, cells);
    const order = shuffled(cells, random);
    const chairs = Math.floor(cells.length / 28 + random() * 3 * busy);
    let placed = 0;
    for (const cell of order) {
        if (placed >= chairs) break;
        const i = Math.floor(cell / N);
        const j = cell % N;
        if (!place.free(i, j) || place.pillarBy(i, j)) continue;
        placed++;
        const stack = random() < 0.12;
        const variant = place.variant();
        // How far off the middle of the cell it can be: a chair on its back lies across more of it, and keeps clear of
        // a window's heating.
        let spread = 0.2;
        if (!stack && chairTipped(variant)) {
            const byWindow = DIRECTIONS.some(([di, dj]) => place.windowSide(i, j, di, dj));
            spread = Math.max(0, FACE - (byWindow ? CONVECTOR_DEPTH : 0) - Math.hypot(TIPPED_HALF[0], TIPPED_HALF[1]) - 0.005);
        }
        const x = x0 + i + (random() - 0.5) * 2 * spread;
        const z = z0 + j + (random() - 0.5) * 2 * spread;
        place.put({ type: stack ? FURN_STACK : FURN_CHAIR, x, z, yaw: random() * Math.PI * 2, variant }, i, j);
        place.loosen(i, j);
    }
    // Against the walls: cabinets, a sofa; a clock on one.
    for (const cell of order.slice(0, 40)) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        if (!place.free(i, j) || place.pillarBy(i, j)) continue;
        const walls = place.wallsOf(i, j);
        if (walls.length === 0) continue;
        const roll = random();
        const wall = walls[Math.floor(random() * walls.length)];
        if (roll < 0.05 * busy) {
            place.against(FURN_CABINET, i, j, wall, (random() - 0.5) * 0.5, place.variant());
        } else if (roll < 0.075 * busy) {
            place.against(FURN_SOFA, i, j, wall, 0, place.variant());
        } else if (roll < 0.09 * busy) {
            place.mount(FURN_CLOCK, i, j, wall);
        }
    }
}

/** Someone's office: a desk facing into the room with its chair behind it, and a cabinet or a bookcase. */
function office(ctx, place, cells) {
    const { random } = ctx;
    const order = shuffled(cells, random);
    let desk = false;
    for (const cell of order) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        if (!place.free(i, j) || place.pillarBy(i, j)) continue;
        const walls = place.wallsOf(i, j);
        if (walls.length === 0) continue;
        const wall = walls[Math.floor(random() * walls.length)];
        const variant = place.variant();
        if (!desk) {
            desk = true;
            // Back to the wall, room behind it for its chair (see DESK_GAP).
            place.against(FURN_DESK, i, j, wall, 0, variant, DESK_GAP);
            continue;
        }
        const roll = random();
        if (roll < 0.4) place.against(FURN_CABINET, i, j, wall, (random() - 0.5) * 0.4, variant);
        else if (roll < 0.7) place.against(FURN_SHELF, i, j, wall, 0, variant);
        else if (roll < 0.85) place.mount(FURN_CLOCK, i, j, wall);
    }
}

/** A meeting room: a table down the middle with its chairs round it, a whiteboard, a clock. */
function meeting(ctx, place, cells) {
    const { random, x0, z0, kinds, rooms } = ctx;
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
    const w = i1 - i0 + 1;
    const h = j1 - j0 + 1;
    // The table along the room's length: only in a room two or more across (one across would leave no way past it).
    const alongX = w >= h;
    const long = Math.max(w, h);
    const lengthCells = long - (long > 2 ? 1 : 0);
    if (Math.min(w, h) >= 2) {
        const table = { type: FURN_TABLE, x: x0 + (i0 + i1) / 2, z: z0 + (j0 + j1) / 2, yaw: alongX ? 0 : Math.PI / 2, variant: place.variant(), length: lengthCells };
        const covered = tableCells(ctx, place, table, rooms[cells[0]]);
        if (covered) {
            place.put(table);
            for (const cell of covered) kinds[cell] |= CELL_TAKEN;
        }
    }
    let board = false;
    for (const cell of shuffled(cells, random)) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        const walls = place.mountsOf(i, j);
        if (walls.length === 0) continue;
        const wall = walls[Math.floor(random() * walls.length)];
        if (!board) {
            board = true;
            place.mount(FURN_WHITEBOARD, i, j, wall);
        } else if (random() < 0.3) {
            place.mount(FURN_CLOCK, i, j, wall);
            break;
        }
    }
}

/**
 * How far a meeting table's chairs reach past it (see the table in abandonedOfficeGeometry.js): past its ends, and out
 * from its middle either side.
 */
const TABLE_CHAIRS = [0.05, 0.6];

/**
 * The cells a meeting table and its chairs (see TABLE_CHAIRS) would cover, or null if it doesn't fit: they have to be
 * the room's own and free, with nothing walled between them and no column on them; the table and its chairs have to
 * keep off the walls round them (further off a window, for its heating); and the table itself has to keep out of the
 * way in through a doorway, or any other opening.
 */
function tableCells(ctx, place, table, region) {
    const { layout, kinds, rooms, x0, z0 } = ctx;
    const [a] = furnitureHalf(table);
    const [along, across] = [a + TABLE_CHAIRS[0], TABLE_CHAIRS[1]];
    const [hx, hz] = table.yaw === 0 ? [along, across] : [across, along];
    const reach = [table.x - hx, table.z - hz, table.x + hx, table.z + hz];
    const solid = furnitureBox(table);
    const overlap = (p, q) => p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3];
    // (Clear of what's solid already: a window's heating round a corner.)
    if (ctx.solids.some((box) => overlap(box, reach))) return null;
    const [ia, ib] = [Math.floor(reach[0] - x0 + 0.5), Math.ceil(reach[2] - x0 - 0.5)];
    const [ja, jb] = [Math.floor(reach[1] - z0 + 0.5), Math.ceil(reach[3] - z0 - 0.5)];
    const covered = (i, j) => i >= ia && i <= ib && j >= ja && j <= jb;
    const cells = [];
    for (let i = ia; i <= ib; i++) {
        for (let j = ja; j <= jb; j++) {
            const cell = i * N + j;
            if (!place.inChunk(i, j) || rooms[cell] !== region || kinds[cell] & (CELL_TAKEN | CELL_WELL) || ctx.avoid(x0 + i, z0 + j) || place.pillarBy(i, j)) return null;
            for (const [di, dj] of DIRECTIONS) {
                const edge = layout.between(i, j, di, dj);
                if (covered(i + di, j + dj)) {
                    if (edge !== EDGE_NONE) return null;
                    continue;
                }
                // Its outside edges: how far in from them it all has to keep (from a wall, past what's on it).
                const x = x0 + i;
                const z = z0 + j;
                const margin = edge === EDGE_NONE ? 0 : place.windowSide(i, j, di, dj) ? 0.5 - FACE + CONVECTOR_DEPTH + 0.01 : 0.5 - FACE + 0.03;
                if (di > 0 ? reach[2] > x + 0.5 - margin : di < 0 ? reach[0] < x - 0.5 + margin : dj > 0 ? reach[3] > z + 0.5 - margin : reach[1] < z - 0.5 + margin) return null;
                // A way in (a doorway, or open to another room or chunk): the half of the cell in front of it clear.
                const ni = i + di;
                const nj = j + dj;
                if (edge === EDGE_WALL || (edge === EDGE_NONE && place.inChunk(ni, nj) && rooms[ni * N + nj] === region)) continue;
                const way = di !== 0 ? [Math.min(x, x + di * 0.5), z - 0.3, Math.max(x, x + di * 0.5), z + 0.3] : [x - 0.3, Math.min(z, z + dj * 0.5), x + 0.3, Math.max(z, z + dj * 0.5)];
                if (overlap(solid, way)) return null;
            }
            cells.push(cell);
        }
    }
    return cells;
}

/**
 * A kitchen: a counter along a wall (the sink in it, the microwave and the coffee on it, cupboards over it, the fridge at
 * one end), a vending machine, and a small table with its chairs.
 */
function kitchen(ctx, place, cells) {
    const { random, x0, z0 } = ctx;
    // The counter: the longest run of cells along one plain wall.
    let best = null;
    for (const cell of cells) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        for (const wall of DIRECTIONS) {
            const [di, dj] = wall;
            const run = [];
            let k = 0;
            while (run.length < 3) {
                const a = i + (di === 0 ? k : 0);
                const b = j + (dj === 0 ? k : 0);
                if (!cells.includes(a * N + b) || !place.free(a, b) || place.pillarBy(a, b) || !place.plainWall(a, b, di, dj)) break;
                // (Nothing walled off between one and the next.)
                if (k > 0 && ctx.layout.between(a, b, di === 0 ? -1 : 0, dj === 0 ? -1 : 0) !== EDGE_NONE) break;
                run.push([a, b]);
                k++;
            }
            if (run.length >= 2 && (!best || run.length > best.run.length)) best = { run, wall };
        }
    }
    if (best) {
        const { run, wall } = best;
        // The way the run goes (+x or +z), and which way that is along each counter (its own +x or −x).
        const [ai, aj] = wall[0] === 0 ? [1, 0] : [0, 1];
        const sign = -wall[1] * ai + wall[0] * aj;
        const fridge = run.length === 3;
        // How far a counter reaches towards the end of the run, where it's the last: to the wall's face, or short of
        // a window's heating (the corner of the counter would be in it).
        const end = (i, j, di, dj) => (place.windowSide(i, j, di, dj) ? FACE - CONVECTOR_DEPTH - 0.005 : FACE);
        run.forEach(([i, j], k) => {
            if (fridge && k === 2) {
                // The fridge, up against the end of the counter.
                place.against(FURN_FRIDGE, i, j, wall, -(0.5 - HALF[FURN_FRIDGE][0]), place.variant(), 0.005);
            } else {
                const counter = place.against(FURN_COUNTER, i, j, wall, 0, ((place.variant() & ~3) | (k === 0 ? 1 : 2)) >>> 0, 0.005);
                // Up to the next in the run (so the worktop runs on), else to the end.
                const before = k > 0 ? 0.5 : end(i, j, -ai, -aj);
                const after = k < run.length - 1 ? 0.5 : end(i, j, ai, aj);
                counter.reach = sign > 0 ? [before, after] : [after, before];
            }
            // Nothing hung on the walls at its ends.
            place.back(i, j, [ai, aj]);
            place.back(i, j, [-ai, -aj]);
        });
    }
    vending(ctx, place, cells, false);
    // The table, in the middle of the room, if there's a cell with no wall round it at all.
    for (const cell of shuffled(cells, random)) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        if (!place.free(i, j) || place.pillarBy(i, j) || DIRECTIONS.some(([di, dj]) => ctx.layout.between(i, j, di, dj) !== EDGE_NONE)) continue;
        place.put({ type: FURN_ROUND_TABLE, x: x0 + i, z: z0 + j, yaw: random() * Math.PI * 2, variant: place.variant() }, i, j);
        place.loosen(i, j);
        break;
    }
    for (const cell of shuffled(cells, random)) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        const walls = place.mountsOf(i, j);
        if (walls.length === 0) continue;
        place.mount(FURN_CLOCK, i, j, walls[0]);
        break;
    }
}

/** A corridor: a drinking fountain now and then, a clock, a fire extinguisher; nothing on the floor. */
function corridor(ctx, place, cells) {
    const { random } = ctx;
    for (const cell of cells) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        const walls = place.mountsOf(i, j);
        if (walls.length === 0 || random() > 0.1) continue;
        const wall = walls[Math.floor(random() * walls.length)];
        const roll = random();
        place.mount(roll < 0.4 ? FURN_FOUNTAIN : roll < 0.7 ? FURN_EXTINGUISHER : FURN_CLOCK, i, j, wall);
    }
}

/** A lift lobby: a fountain, a vending machine now and then. */
function lobby(ctx, place, cells) {
    const { random } = ctx;
    if (cells.length > 6 && random() < 0.35) vending(ctx, place, cells, false);
    corridor(ctx, place, cells);
}

/** A copy room: the copier, and shelves of paper. */
function copyRoom(ctx, place, cells) {
    const { random } = ctx;
    let copier = false;
    for (const cell of shuffled(cells, random)) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        if (!place.free(i, j) || place.pillarBy(i, j)) continue;
        const walls = place.wallsOf(i, j);
        if (walls.length === 0) continue;
        const wall = walls[Math.floor(random() * walls.length)];
        if (!copier) {
            copier = true;
            place.against(FURN_COPIER, i, j, wall, 0, place.variant(), 0.04);
        } else if (random() < 0.6) {
            place.against(random() < 0.6 ? FURN_SHELF : FURN_CABINET, i, j, wall, 0, place.variant());
        }
    }
}

/** A store room: shelves, cabinets, chairs stacked. */
function storeRoom(ctx, place, cells) {
    const { random, x0, z0 } = ctx;
    for (const cell of shuffled(cells, random)) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        if (!place.free(i, j) || place.pillarBy(i, j)) continue;
        const walls = place.wallsOf(i, j);
        if (walls.length === 0) {
            if (random() < 0.3) {
                place.put({ type: FURN_STACK, x: x0 + i, z: z0 + j, yaw: random() * Math.PI * 2, variant: place.variant() }, i, j);
                place.loosen(i, j);
            }
            continue;
        }
        const wall = walls[Math.floor(random() * walls.length)];
        const roll = random();
        if (roll < 0.5) place.against(FURN_SHELF, i, j, wall, 0, place.variant());
        else if (roll < 0.75) place.against(FURN_CABINET, i, j, wall, (random() - 0.5) * 0.4, place.variant());
    }
}

