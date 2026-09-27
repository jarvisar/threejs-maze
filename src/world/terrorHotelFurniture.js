import { CHUNK_SIZE, DOOR_WIDTH, WALL_THICKNESS } from '../config.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, mod } from './grid.js';
import {
    CELL_BALLROOM,
    CELL_CORRIDOR,
    CELL_HALL,
    CELL_ROOM,
    CELL_TAKEN,
    CELL_X_CORRIDOR,
    CELL_Z_CORRIDOR,
    DOOR_ELEVATOR,
    FLOOR_PARQUET,
    SCONCE_WALLS,
} from './terrorHotel.js';
import { ZONE_BALLROOM, ZONE_GUEST, ZONE_LOBBY } from './zones.js';

/*
 * The furniture of Level 5 (see terrorHotelFurnishings.js for what it looks like, and terrorHotel.js), which nobody
 * moves: the guest rooms' beds, nightstands, wardrobes, writing desks and bookcases; console tables down the
 * corridors, under the sconces; the lobbies' lounges (a rug, a chesterfield, armchairs, a lamp left on), the reception
 * desk, a fireplace, bookcases, a long-case clock, a grand piano, the blackboard with the menu on it, a round table with
 * flowers under a chandelier; and in the ballroom, round tables laid for a dinner, the long table with its candles
 * lit, the bandstand with its dance floor, and the small table in the middle of it all with the drinks and the
 * unfinished game. What's small enough to carry is in terrorHotelProps.js instead.
 *
 * Everything keeps inside its chunk, clear of the walls and the mouldings along them, the doorways, the doors that
 * don't open and the columns (and anything tall, of the sconces), and leaves a way through: a doorway, or a gap in a
 * wall, always has the floor in front of it free, the halls are big, and what stands in a corridor is shallow, against
 * its wall.
 */

const N = CHUNK_SIZE;
const HALF_WALL = WALL_THICKNESS / 2;
/** How far a wall's face is from the middle of its cell. */
export const FACE = 0.5 - HALF_WALL;
/**
 * How far anything standing against a wall keeps off its face: in front of the skirting and the chair rail (the
 * deepest of them, a lobby's skirting, stands 0.016 out; see terrorHotelGeometry.js).
 */
export const WALL_CLEAR = 0.018;

export const FURN_BED = 0;
export const FURN_NIGHTSTAND = 1; // with a lamp on it, lit or not
export const FURN_WARDROBE = 2;
export const FURN_ARMCHAIR = 3; // a wingback
export const FURN_SOFA = 4; // a chesterfield
export const FURN_SIDE_TABLE = 5; // a round lamp table, its lamp lit or not
export const FURN_LOW_TABLE = 6; // a low table in front of a sofa
export const FURN_RUG = 7; // a rug, under a lounge (you walk on it)
export const FURN_DESK = 8; // the reception desk, and the rack of pigeonholes and keys on the wall behind it
export const FURN_CLOCK = 9; // a long-case clock
export const FURN_PIANO = 10; // a grand piano and its stool
export const FURN_CENTRE_TABLE = 11; // a round table with a tall vase of flowers on it
export const FURN_BANQUET = 12; // a round table laid for dinner, with its chairs round it
export const FURN_BEVERLY = 13; // the small table in the Beverly Room: drinks, and a game of mahjong left half played
export const FURN_WRITING_DESK = 14; // a writing desk and its chair, in a guest room
export const FURN_BOOKCASE = 15; // full of books, in a lobby or a guest room
export const FURN_FIREPLACE = 16; // marble, cold, a mirror over it, in a lobby
export const FURN_CONSOLE = 17; // a half-round table against a corridor's wall, under a sconce
export const FURN_BANDSTAND = 18; // the band's stage in the ballroom, its desks' lamps on, and nobody there
export const FURN_LONG_TABLE = 19; // a long table laid for dinner in the ballroom, its candles lit
export const FURN_CHALKBOARD = 20; // a blackboard on an easel, MENU on it, in a lobby

/**
 * @typedef {object} Furniture
 * @property {number} type FURN_*.
 * @property {number} x Its middle.
 * @property {number} z
 * @property {number} dx Which way its front faces (unit, along an axis).
 * @property {number} dz
 * @property {number} variant 32 bits for its size and details.
 * @property {boolean} [lit] A lamp on it, and whether it's on (see Lamp in terrorHotel.js).
 */

/**
 * Each kind's half size across (its own x) and front to back (its own z): all of what's drawn of it is inside that
 * (see terrorHotelFurnishings.js; the reception's key rack, on the wall behind it, aside). And whether it's solid. A
 * bed's width comes from its variant (see furnitureHalf).
 */
const HALF = [
    [0.29, 0.385, true],
    [0.08, 0.072, true],
    [0.2, 0.11, true],
    [0.15, 0.15, true],
    [0.405, 0.155, true],
    [0.09, 0.09, true],
    [0.16, 0.09, true],
    [0.62, 0.52, false],
    [0.575, 0.125, true],
    [0.11, 0.075, true],
    [0.27, 0.34, true],
    [0.2, 0.2, true],
    [0.49, 0.49, true],
    [0.35, 0.35, true],
    [0.22, 0.2, true],
    [0.24, 0.085, true],
    [0.34, 0.09, true],
    [0.15, 0.062, true],
    [0.92, 0.52, true],
    [0.36, 0.99, true],
    [0.1, 0.07, true],
];

/** Its half size across and front to back. @param {{ type: number, variant: number }} piece */
export function furnitureHalf(piece) {
    if (piece.type === FURN_BED && (piece.variant & 1) === 0) return [0.2, 0.385];
    return [HALF[piece.type][0], HALF[piece.type][1]];
}

/** What of it is solid, as [minX, minZ, maxX, maxZ], or null. @param {Furniture} piece */
export function furnitureBox(piece) {
    if (!HALF[piece.type][2]) return null;
    const [a, d] = furnitureHalf(piece);
    const [hx, hz] = piece.dx !== 0 ? [d, a] : [a, d];
    // (A table laid for dinner: just the table and the chairs close in; you can squeeze between the chairs.)
    const inset = piece.type === FURN_BANQUET ? 0.13 : piece.type === FURN_BEVERLY || piece.type === FURN_LONG_TABLE ? 0.1 : 0.01;
    return [piece.x - hx + inset, piece.z - hz + inset, piece.x + hx - inset, piece.z + hz - inset];
}

/**
 * How far its lamp's shade is from its middle, along its front and to its right, if it has a lamp (the light over a
 * table's candles, or the bandstand's desks, is its lamp too).
 */
export function lampOffset(piece) {
    if (piece.type === FURN_NIGHTSTAND || piece.type === FURN_SIDE_TABLE || piece.type === FURN_LONG_TABLE) return [0, 0];
    if (piece.type === FURN_DESK) return [-0.02, -0.4];
    if (piece.type === FURN_BANDSTAND) return [0.1, 0];
    return null;
}

// ---------------------------------------------------------------------------------------------- placing

/**
 * Furnishes a chunk (see generateTerrorHotelChunk): the guest rooms, the lobbies, the ballroom. Adds to `furniture`,
 * `solids` and `lamps`, and marks the cells anything stands in (CELL_TAKEN).
 * @param {object} ctx
 * @param {import('./generator.js').Layout} ctx.layout
 * @param {Uint8Array} ctx.kinds
 * @param {Int16Array} ctx.rooms
 * @param {Uint8Array} ctx.sconces
 * @param {import('./terrorHotel.js').HotelDoor[]} ctx.doors
 * @param {Furniture[]} ctx.furniture
 * @param {import('./terrorHotel.js').Lamp[]} ctx.lamps
 * @param {number[][]} ctx.solids
 * @param {() => number} ctx.random
 * @param {number} ctx.seed
 * @param {number} ctx.x0
 * @param {number} ctx.z0
 * @param {number} ctx.zone
 * @param {(x: number, z: number) => boolean} ctx.avoid
 * @param {number} ctx.lampClear How far a lamp keeps from the middles of the chunk's edge cells (its light has to stop
 *     before the chunk does).
 * @param {Uint8Array} ctx.floors How each cell's floor is laid, if not as its look has it (a dance floor: FLOOR_*).
 * @returns {Set<number>} The light slots (as local i * N + j) that have to be lit, for what's under them.
 */
export function furnish(ctx) {
    const { layout, kinds, x0, z0, zone } = ctx;
    const place = new Placer(ctx);
    // Keep clear: the floor in front of every doorway and every gap in a wall, in front of every door that doesn't open,
    // and round every column.
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const edge = layout.between(i, j, di, dj);
                if (edge === EDGE_WALL) continue;
                if (edge === EDGE_NONE && !gapInWall(layout, i, j, di, dj)) continue;
                // (Not where a corridor goes on into the next cell: what stands in one is shallow, against its wall.)
                const [ni, nj] = [i + di, j + dj];
                const inside = ni >= 0 && nj >= 0 && ni < N && nj < N;
                if (edge === EDGE_NONE && kinds[i * N + j] & CELL_CORRIDOR && inside && kinds[ni * N + nj] & CELL_CORRIDOR) continue;
                const half = edge === EDGE_DOOR ? DOOR_WIDTH / 2 + 0.06 : 0.5;
                place.keepClear(x0 + i, z0 + j, di, dj, half, 0.6);
            }
        }
    }
    for (const door of ctx.doors) {
        for (const side of [-1, 1]) {
            const [x, z] = door.axis === 0 ? [door.x + (side > 0 ? 1 : 0), door.z] : [door.x, door.z + (side > 0 ? 1 : 0)];
            const [di, dj] = door.axis === 0 ? [-side, 0] : [0, -side];
            place.keepClear(x, z, di, dj, DOOR_WIDTH / 2 + 0.08, door.kind === DOOR_ELEVATOR ? 0.4 : 0.3);
        }
    }
    for (let i = 1; i <= N; i++) {
        for (let j = 1; j <= N; j++) {
            if (layout.getPillar(i, j)) place.block(x0 + i - 0.5 - 0.3, z0 + j - 0.5 - 0.3, x0 + i - 0.5 + 0.3, z0 + j - 0.5 + 0.3);
        }
    }
    const lit = new Set();
    if (zone === ZONE_GUEST) {
        furnishCorridors(ctx, place);
        furnishRooms(ctx, place);
    }
    else if (zone === ZONE_LOBBY) furnishLobby(ctx, place, lit);
    else if (zone === ZONE_BALLROOM) furnishBallroom(ctx, place, lit);
    for (const piece of ctx.furniture) {
        const box = furnitureBox(piece);
        if (box) ctx.solids.push(box);
        const i = Math.round(piece.x) - x0;
        const j = Math.round(piece.z) - z0;
        if (i >= 0 && j >= 0 && i < N && j < N) kinds[i * N + j] |= CELL_TAKEN;
    }
    return lit;
}

/** Whether the open edge on side (di, dj) of local cell (i, j) is a gap in a wall (a wall along its line beside it). */
function gapInWall(layout, i, j, di, dj) {
    if (di !== 0) {
        const line = di > 0 ? i + 1 : i;
        return (j > 0 && layout.getV(line, j - 1) !== EDGE_NONE) || (j + 1 < N && layout.getV(line, j + 1) !== EDGE_NONE);
    }
    const line = dj > 0 ? j + 1 : j;
    return (i > 0 && layout.getH(i - 1, line) !== EDGE_NONE) || (i + 1 < N && layout.getH(i + 1, line) !== EDGE_NONE);
}

/** Where things can go in a chunk: what's been put down or kept clear so far (as rectangles), the walls, the lamps. */
class Placer {
    constructor(ctx) {
        this.ctx = ctx;
        /** @type {number[][]} */
        this.rects = [];
    }

    block(minX, minZ, maxX, maxZ) {
        this.rects.push([Math.min(minX, maxX), Math.min(minZ, maxZ), Math.max(minX, maxX), Math.max(minZ, maxZ)]);
    }

    /**
     * Whether a rectangle is inside the chunk (a little in from its edge), clear of every wall, and `margin` clear of
     * everything so far.
     */
    free(minX, minZ, maxX, maxZ, margin = 0) {
        const { x0, z0 } = this.ctx;
        if (minX < x0 - 0.45 || minZ < z0 - 0.45 || maxX > x0 + N - 0.55 || maxZ > z0 + N - 0.55) return false;
        if (!this.clearOfWalls(minX, minZ, maxX, maxZ)) return false;
        const e = 1e-4 - margin;
        for (const [a, b, c, d] of this.rects) if (minX < c - e && maxX > a + e && minZ < d - e && maxZ > b + e) return false;
        return true;
    }

    /**
     * Whether a rectangle keeps out of every wall's thickness and the mouldings on it (and the posts where walls meet,
     * and the columns): each line between cells it reaches into has to be open where it does.
     */
    clearOfWalls(minX, minZ, maxX, maxZ) {
        const { layout, x0, z0 } = this.ctx;
        const e = 1e-4;
        const reach = HALF_WALL + WALL_CLEAR;
        // The lines between cells it reaches into: local line k is at x0 + k − 0.5.
        const lines = (min, max, origin) => {
            const found = [];
            for (let k = Math.floor(min - origin); k <= Math.ceil(max - origin) + 1; k++) {
                const at = origin + k - 0.5;
                if (min < at + reach - e && max > at - reach + e) found.push(k);
            }
            return found;
        };
        // The cells it covers, along the other way.
        const cells = (min, max, origin) => {
            const found = [];
            for (let k = Math.floor(min - origin + 0.5); k <= Math.floor(max - origin + 0.5 - e); k++) found.push(k);
            return found;
        };
        const xs = lines(minX, maxX, x0);
        const zs = lines(minZ, maxZ, z0);
        const rows = cells(minZ, maxZ, z0);
        const columns = cells(minX, maxX, x0);
        const v = (i, j) => (i >= 0 && i <= N && j >= 0 && j < N ? layout.getV(i, j) : EDGE_WALL);
        const h = (i, j) => (i >= 0 && i < N && j >= 0 && j <= N ? layout.getH(i, j) : EDGE_WALL);
        for (const i of xs) for (const j of rows) if (v(i, j) !== EDGE_NONE) return false;
        for (const j of zs) for (const i of columns) if (h(i, j) !== EDGE_NONE) return false;
        // Where a line each way meets: a wall's end there, or a column.
        for (const i of xs) {
            for (const j of zs) {
                if (v(i, j - 1) !== EDGE_NONE || v(i, j) !== EDGE_NONE || h(i - 1, j) !== EDGE_NONE || h(i, j) !== EDGE_NONE) return false;
                if (i >= 1 && j >= 1 && i <= N && j <= N && layout.getPillar(i, j)) return false;
            }
        }
        return true;
    }

    /** The floor in front of the way through on side (di, dj) of cell (x, z), half `half` either side, `depth` in. */
    keepClear(x, z, di, dj, half, depth) {
        if (di !== 0) {
            const near = x + di * 0.5;
            this.block(near, z - half, near - di * depth, z + half);
        } else {
            const near = z + dj * 0.5;
            this.block(x - half, near, x + half, near - dj * depth);
        }
    }

    /** Whether a lamp can go at (x, z): far enough in from the chunk's edge, and from every other lamp. */
    lampFits(x, z) {
        const { x0, z0, lampClear, lamps } = this.ctx;
        if (Math.min(x - x0, z - z0, x0 + N - 1 - x, z0 + N - 1 - z) < lampClear) return false;
        // (Far enough apart that no cell is lit by two: each cell knows only its nearest; see cellBytes.)
        return lamps.every((lamp) => Math.max(Math.abs(lamp.x - x), Math.abs(lamp.z - z)) > 2 * lampClear + 1.2);
    }

    /**
     * Puts a piece down, if its box (and a margin round it) is free: returns it, or null.
     * @param {number} type
     * @param {number} x
     * @param {number} z
     * @param {number} dx
     * @param {number} dz
     * @param {number} [margin]
     * @param {number | null} [variant]
     */
    put(type, x, z, dx, dz, margin = 0.02, variant = null) {
        const piece = { type, x, z, dx, dz, variant: variant ?? ((this.ctx.random() * 4294967296) >>> 0) };
        const [a, d] = furnitureHalf(piece);
        const [hx, hz] = dx !== 0 ? [d, a] : [a, d];
        if (!this.free(x - hx, z - hz, x + hx, z + hz, margin)) return null;
        this.block(x - hx, z - hz, x + hx, z + hz);
        this.ctx.furniture.push(piece);
        return piece;
    }

    /** Lights the lamp on a piece that has one, if it can be (see lampFits). */
    light(piece) {
        const offset = lampOffset(piece);
        if (!offset) return;
        const [f, r] = offset;
        // Its right is its front turned a quarter clockwise, seen from above: (−dz, dx).
        const x = snap(piece.x + piece.dx * f - piece.dz * r);
        const z = snap(piece.z + piece.dz * f + piece.dx * r);
        piece.lit = this.lampFits(x, z);
        if (piece.lit) this.ctx.lamps.push({ x, z });
    }
}

/** To the nearest eighth of a unit (where lamps have to be: see cellBytes). */
function snap(value) {
    return Math.round(value * 8) / 8;
}

/**
 * The walls round a cell that something can stand against: a solid wall on that side, without a door in it (one that
 * opens, or doesn't), as [di, dj] (the way to the wall from the middle of the cell); `tall` leaves out walls with a
 * sconce too.
 */
function wallsOf(ctx, i, j, tall) {
    const { layout, doors, sconces, x0, z0 } = ctx;
    const x = x0 + i;
    const z = z0 + j;
    const found = [];
    for (const [di, dj, bit] of SCONCE_WALLS) {
        if (layout.between(i, j, di, dj) !== EDGE_WALL) continue;
        if (tall && sconces[i * N + j] & bit) continue;
        const [ex, ez, axis] = di !== 0 ? [di > 0 ? x : x - 1, z, 0] : [x, dj > 0 ? z : z - 1, 1];
        if (doors.some((door) => door.x === ex && door.z === ez && door.axis === axis)) continue;
        found.push([di, dj]);
    }
    return found;
}

// ---------------------------------------------------------------------------------------------- the corridors

/**
 * The corridors: now and then a console table against the wall under a sconce, where the damask panels are between
 * the doors, with something on it. Not where two corridors cross, nor round where you start.
 */
function furnishCorridors(ctx, place) {
    const { kinds, sconces, random, x0, z0, avoid } = ctx;
    const [, depth] = furnitureHalf({ type: FURN_CONSOLE, variant: 0 });
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const kind = kinds[i * N + j];
            if (!(kind & CELL_CORRIDOR) || avoid(x0 + i, z0 + j)) continue;
            if ((kind & (CELL_X_CORRIDOR | CELL_Z_CORRIDOR)) === (CELL_X_CORRIDOR | CELL_Z_CORRIDOR)) continue;
            for (const [di, dj, bit] of SCONCE_WALLS) {
                if (!(sconces[i * N + j] & bit) || random() >= 0.13) continue;
                const x = x0 + i + di * (FACE - WALL_CLEAR - depth);
                const z = z0 + j + dj * (FACE - WALL_CLEAR - depth);
                place.put(FURN_CONSOLE, x, z, -di, -dj, 0.02);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------- the guest rooms

/**
 * Each guest room: a bed with its head to a wall (a double in a room of more than one cell, else a single along a
 * wall, in a corner), a nightstand by it with a lamp (on, if nothing near has one), a wardrobe, and an armchair, a
 * writing desk or a bookcase.
 */
function furnishRooms(ctx, place) {
    const { kinds, rooms, random, x0, z0, avoid } = ctx;
    const byRoom = new Map();
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cell = i * N + j;
            if (!(kinds[cell] & CELL_ROOM) || avoid(x0 + i, z0 + j)) continue;
            if (!byRoom.has(rooms[cell])) byRoom.set(rooms[cell], []);
            byRoom.get(rooms[cell]).push([i, j]);
        }
    }
    for (const cells of byRoom.values()) {
        // (Now and then one's been cleared out.)
        if (random() < 0.1) continue;
        const single = cells.length === 1;
        // (How far in from a wall's face the middle of something against it is, its back just clear of the mouldings.)
        const off = (depth) => FACE - WALL_CLEAR - depth;
        let bed = null;
        for (const [i, j] of shuffled(cells, random)) {
            for (const [di, dj] of shuffled(wallsOf(ctx, i, j, false), random)) {
                const x = x0 + i;
                const z = z0 + j;
                const variant = (((random() * 4294967296) >>> 0) & ~1) | (single ? 0 : 1);
                const [a, d] = furnitureHalf({ type: FURN_BED, variant });
                if (single) {
                    // Along the wall, pushed into a corner, its head to the wall at that end.
                    const end = random() < 0.5 ? -1 : 1;
                    const [ax, az] = di !== 0 ? [0, end] : [end, 0];
                    bed = place.put(FURN_BED, x + di * off(a) + ax * off(d), z + dj * off(a) + az * off(d), -ax, -az, 0.01, variant);
                } else {
                    bed = place.put(FURN_BED, x + di * off(d), z + dj * off(d), -di, -dj, 0.01, variant);
                }
                if (bed) break;
            }
            if (bed) break;
        }
        if (!bed) continue;
        // A nightstand by its head, its back to the wall too (the lamp on it lit, if it can be).
        const [a, d] = furnitureHalf(bed);
        const [sa, sd] = furnitureHalf({ type: FURN_NIGHTSTAND, variant: 0 });
        for (const side of shuffled([-1, 1], random)) {
            // Its right: (−dz, dx).
            const x = bed.x - bed.dx * (d - sd) - bed.dz * side * (a + sa + 0.01);
            const z = bed.z - bed.dz * (d - sd) + bed.dx * side * (a + sa + 0.01);
            const stand = place.put(FURN_NIGHTSTAND, x, z, bed.dx, bed.dz, 0.005);
            if (stand) {
                place.light(stand);
                break;
            }
        }
        // A wardrobe against another wall, and an armchair, a desk or a bookcase.
        const roll = random();
        for (const type of [FURN_WARDROBE, roll < 0.4 ? FURN_ARMCHAIR : roll < 0.8 ? FURN_WRITING_DESK : FURN_BOOKCASE]) {
            let done = false;
            for (const [i, j] of shuffled(cells, random)) {
                for (const [di, dj] of shuffled(wallsOf(ctx, i, j, type === FURN_WARDROBE || type === FURN_BOOKCASE), random)) {
                    const [, depth] = furnitureHalf({ type, variant: 0 });
                    const along = (random() - 0.5) * 0.4;
                    const x = x0 + i + di * off(depth) + (di === 0 ? along : 0);
                    const z = z0 + j + dj * off(depth) + (dj === 0 ? along : 0);
                    if (place.put(type, x, z, -di, -dj, 0.03)) {
                        done = true;
                        break;
                    }
                }
                if (done) break;
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------- the lobbies

/**
 * A lobby chunk: lounges (a rug, a chesterfield and two armchairs round a low table, a lamp on a table at the end of
 * the sofa) wherever there's room for one between the columns; now and then the reception desk against a wall, a
 * fireplace, a long-case clock, bookcases, the blackboard with the menu, and a grand piano; and a round table with
 * flowers on it under one of the chandeliers.
 */
function furnishLobby(ctx, place, lit) {
    const { layout, random, x0, z0, avoid, kinds } = ctx;
    const open = (i, j) => i >= 1 && j >= 1 && i < N - 1 && j < N - 1 && kinds[i * N + j] & CELL_HALL && !avoid(x0 + i, z0 + j);
    // A block of 2 × 2 cells with nothing across it: no wall between its cells, no column in the middle.
    const block = (i, j) => open(i, j) && open(i + 1, j) && open(i, j + 1) && open(i + 1, j + 1)
        && layout.getV(i + 1, j) === EDGE_NONE && layout.getV(i + 1, j + 1) === EDGE_NONE
        && layout.getH(i, j + 1) === EDGE_NONE && layout.getH(i + 1, j + 1) === EDGE_NONE && !layout.getPillar(i + 1, j + 1);
    // The reception, against a long stretch of wall: two cells side by side along it with nothing on it (no door, no
    // sconce), the desk across the line between them.
    const spots = [];
    for (let i = 1; i < N - 2; i++) {
        for (let j = 1; j < N - 2; j++) {
            if (!open(i, j)) continue;
            for (const [di, dj] of wallsOf(ctx, i, j, true)) {
                const [ai, aj] = di !== 0 ? [0, 1] : [1, 0];
                if (!open(i + ai, j + aj) || layout.between(i, j, ai, aj) !== EDGE_NONE) continue;
                if (wallsOf(ctx, i + ai, j + aj, true).some(([wi, wj]) => wi === di && wj === dj)) spots.push([i, j, di, dj, ai, aj]);
            }
        }
    }
    if (spots.length > 0 && random() < 0.6) {
        for (const [i, j, di, dj, ai, aj] of shuffled(spots, random).slice(0, 12)) {
            // (Its key rack on the wall's face, between the skirting and the cornice.)
            const x = x0 + i + ai * 0.5 + di * (FACE - 0.3);
            const z = z0 + j + aj * 0.5 + dj * (FACE - 0.3);
            // (With room behind it for whoever was on the desk, kept clear.)
            const back = 0.3 - WALL_CLEAR;
            const behind = [x + di * 0.11, z + dj * 0.11, x + di * back, z + dj * back];
            const [bx0, bz0, bx1, bz1] = [Math.min(behind[0], behind[2]) - ai * 0.56, Math.min(behind[1], behind[3]) - aj * 0.56, Math.max(behind[0], behind[2]) + ai * 0.56, Math.max(behind[1], behind[3]) + aj * 0.56];
            if (!place.free(bx0, bz0, bx1, bz1)) continue;
            const desk = place.put(FURN_DESK, x, z, -di, -dj, 0.04);
            if (desk) {
                place.block(bx0, bz0, bx1, bz1);
                place.light(desk);
                break;
            }
        }
    }
    // A fireplace, and a clock, against a wall.
    if (random() < 0.45) placeAgainstWall(ctx, place, FURN_FIREPLACE, open, 40);
    if (random() < 0.55) placeAgainstWall(ctx, place, FURN_CLOCK, open, 40);
    // Lounges.
    const lounges = 1 + Math.floor(random() * 3);
    for (let n = 0, attempt = 0; n < lounges && attempt < 40; attempt++) {
        const i = 1 + Math.floor(random() * (N - 3));
        const j = 1 + Math.floor(random() * (N - 3));
        if (!block(i, j)) continue;
        if (lounge(ctx, place, x0 + i + 0.5, z0 + j + 0.5)) n++;
    }
    // Bookcases along the walls, and now and then the blackboard, propped against one.
    const shelves = random() < 0.55 ? 1 + Math.floor(random() * 3) : 0;
    for (let k = 0; k < shelves; k++) placeAgainstWall(ctx, place, FURN_BOOKCASE, open, 30);
    if (random() < 0.3) placeAgainstWall(ctx, place, FURN_CHALKBOARD, open, 30, false);
    // A grand piano.
    if (random() < 0.3) {
        for (let attempt = 0; attempt < 20; attempt++) {
            const i = 1 + Math.floor(random() * (N - 3));
            const j = 1 + Math.floor(random() * (N - 3));
            if (!block(i, j)) continue;
            const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(random() * 4)];
            if (place.put(FURN_PIANO, x0 + i + 0.5, z0 + j + 0.5, dx, dz, 0.2)) break;
        }
    }
    // A round table with flowers, under a chandelier.
    for (let attempt = 0; attempt < 24; attempt++) {
        const i = 1 + 2 * Math.floor(random() * (N / 2 - 1));
        const j = 1 + 2 * Math.floor(random() * (N / 2 - 1));
        if (!open(i, j) || (((x0 + i - 1) >> 1) + ((z0 + j - 1) >> 1)) % 2 !== 0) continue;
        if (place.put(FURN_CENTRE_TABLE, x0 + i, z0 + j, 0, 1, 0.25)) {
            lit.add(i * N + j);
            break;
        }
    }
}

/**
 * A lounge round (x, z), the corner between four cells: a rug, a chesterfield along one side facing in, an armchair at
 * each corner across from it, a low table between, and a lamp on a table at one end of the sofa.
 * @returns {boolean} Whether it fitted.
 */
function lounge(ctx, place, x, z) {
    const { random } = ctx;
    const [fx, fz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(random() * 4)];
    // The sofa at the back, facing forward (f); the chairs in front, facing it. Its right: (−fz, fx).
    const rx = -fz;
    const rz = fx;
    if (!place.free(x - 0.75, z - 0.75, x + 0.75, z + 0.75)) return false;
    ctx.furniture.push({ type: FURN_RUG, x, z, dx: fx, dz: fz, variant: (random() * 4294967296) >>> 0 });
    const sofa = place.put(FURN_SOFA, x - fx * 0.5, z - fz * 0.5, fx, fz, 0);
    place.put(FURN_LOW_TABLE, x - fx * 0.05, z - fz * 0.05, fx, fz, 0);
    for (const side of [-1, 1]) place.put(FURN_ARMCHAIR, x + fx * 0.42 + rx * side * 0.36, z + fz * 0.42 + rz * side * 0.36, -fx, -fz, 0);
    if (sofa) {
        const side = random() < 0.5 ? -1 : 1;
        const table = place.put(FURN_SIDE_TABLE, x - fx * 0.5 + rx * side * 0.5, z - fz * 0.5 + rz * side * 0.5, fx, fz, 0);
        if (table) place.light(table);
    }
    return true;
}

/**
 * Something that stands with its back to a wall (a clock), in a cell that `open` allows, if there's room; not under a
 * sconce if it's `tall`.
 */
function placeAgainstWall(ctx, place, type, open, attempts, tall = true) {
    const { random, x0, z0 } = ctx;
    const [, depth] = furnitureHalf({ type, variant: 0 });
    const spots = [];
    for (let i = 1; i < N - 1; i++) {
        for (let j = 1; j < N - 1; j++) if (open(i, j)) for (const [di, dj] of wallsOf(ctx, i, j, tall)) spots.push([i, j, di, dj]);
    }
    for (const [i, j, di, dj] of shuffled(spots, random).slice(0, attempts)) {
        const x = x0 + i + di * (FACE - WALL_CLEAR - depth);
        const z = z0 + j + dj * (FACE - WALL_CLEAR - depth);
        const piece = place.put(type, x, z, -di, -dj, 0.03);
        if (piece) return piece;
    }
    return null;
}

// ---------------------------------------------------------------------------------------------- the ballroom

/**
 * The Beverly Room: in a third of its chunks, the small table, under a chandelier that's lit (the only one for a long
 * way, most likely); now and then the bandstand, a dance floor of parquet in front of it; the long table, its candles
 * lit; here and there a round table laid for dinner, its chandelier most likely dead; now and then a grand piano,
 * alone.
 */
function furnishBallroom(ctx, place, lit) {
    const { random, x0, z0, avoid, kinds, floors } = ctx;
    const open = (i, j) => i >= 2 && j >= 2 && i < N - 2 && j < N - 2 && kinds[i * N + j] & CELL_BALLROOM && !avoid(x0 + i, z0 + j);
    // The chandeliers are every other slot each way (see hotelLights).
    const chandelier = (i, j) => mod((x0 + i - 1) >> 1, 2) === 0 && mod((z0 + j - 1) >> 1, 2) === 0;
    const slots = [];
    for (let i = 1; i < N; i += 2) for (let j = 1; j < N; j += 2) if (open(i, j) && chandelier(i, j)) slots.push([i, j]);
    const order = shuffled(slots, random);
    if (random() < 0.34) {
        for (const [i, j] of order) {
            if (place.put(FURN_BEVERLY, x0 + i, z0 + j, 0, random() < 0.5 ? 1 : -1, 0.3)) {
                lit.add(i * N + j);
                break;
            }
        }
    }
    const ways = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (random() < 0.3) {
        for (let attempt = 0; attempt < 24; attempt++) {
            const i = 3 + Math.floor(random() * (N - 6));
            const j = 3 + Math.floor(random() * (N - 6));
            const [dx, dz] = ways[Math.floor(random() * 4)];
            if (!open(i, j)) continue;
            const stand = place.put(FURN_BANDSTAND, x0 + i, z0 + j, dx, dz, 0.3);
            if (!stand) continue;
            place.light(stand);
            // The dance floor: five cells across in front of it, three deep, kept clear.
            const [rx, rz] = [-dz, dx];
            for (let out = 1; out <= 3; out++) {
                for (let side = -2; side <= 2; side++) {
                    const fi = i + dx * out + rx * side;
                    const fj = j + dz * out + rz * side;
                    if (fi < 0 || fj < 0 || fi >= N || fj >= N || !(kinds[fi * N + fj] & CELL_BALLROOM)) continue;
                    floors[fi * N + fj] = FLOOR_PARQUET;
                    place.block(x0 + fi - 0.5, z0 + fj - 0.5, x0 + fi + 0.5, z0 + fj + 0.5);
                }
            }
            break;
        }
    }
    if (random() < 0.4) {
        for (let attempt = 0; attempt < 24; attempt++) {
            const i = 3 + Math.floor(random() * (N - 6));
            const j = 3 + Math.floor(random() * (N - 6));
            const [dx, dz] = ways[Math.floor(random() * 2) * 2];
            if (!open(i, j)) continue;
            const table = place.put(FURN_LONG_TABLE, x0 + i, z0 + j, dx, dz, 0.25);
            if (!table) continue;
            place.light(table);
            break;
        }
    }
    const banquets = Math.floor(random() * 3);
    for (let n = 0, k = 0; n < banquets && k < order.length; k++) {
        const [i, j] = order[k];
        if (place.put(FURN_BANQUET, x0 + i, z0 + j, 0, 1, 0.35)) n++;
    }
    if (random() < 0.12) {
        for (let attempt = 0; attempt < 20; attempt++) {
            const i = 2 + Math.floor(random() * (N - 4));
            const j = 2 + Math.floor(random() * (N - 4));
            if (!open(i, j)) continue;
            const [dx, dz] = ways[Math.floor(random() * 4)];
            if (place.put(FURN_PIANO, x0 + i + 0.5, z0 + j + 0.5, dx, dz, 0.3)) break;
        }
    }
}

/** A copy of a list in a random order (Fisher–Yates, from the chunk's own stream). */
function shuffled(list, random) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const k = Math.floor(random() * (i + 1));
        [copy[i], copy[k]] = [copy[k], copy[i]];
    }
    return copy;
}
