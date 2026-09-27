import { CHUNK_SIZE, DOOR_WIDTH, WALL_THICKNESS } from '../config.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, mod } from './grid.js';
import { CELL_BALLROOM, CELL_HALL, CELL_ROOM, CELL_TAKEN, DOOR_ELEVATOR, SCONCE_WALLS } from './terrorHotel.js';
import { ZONE_BALLROOM, ZONE_GUEST, ZONE_LOBBY } from './zones.js';

/*
 * The furniture of Level 5 (see terrorHotel.js), which nobody moves: the guest rooms' beds, nightstands and wardrobes;
 * the lobbies' lounges (a rug, a chesterfield, armchairs, a lamp left on), the reception desk, a long-case clock, a
 * grand piano, a round table with flowers under a chandelier; and in the ballroom, round tables laid for a dinner, and
 * the small table in the middle of it all with the drinks and the unfinished game. What's small enough to carry is in
 * terrorHotelProps.js instead.
 *
 * Everything keeps inside its chunk, clear of the walls, the doorways, the doors that don't open and the columns (and
 * anything tall, of the sconces), and leaves a way through: a doorway, or a gap in a wall, always has the floor in front
 * of it free, and the halls are big.
 */

const N = CHUNK_SIZE;
const HALF_WALL = WALL_THICKNESS / 2;
/** How far a wall's face is from the middle of its cell. */
export const FACE = 0.5 - HALF_WALL;

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
 * Each kind's half size across (its own x) and front to back (its own z), and whether it's solid. A bed's width comes
 * from its variant (see furnitureHalf).
 */
const HALF = [
    [0.27, 0.38, true],
    [0.08, 0.07, true],
    [0.19, 0.1, true],
    [0.15, 0.15, true],
    [0.36, 0.15, true],
    [0.09, 0.09, true],
    [0.16, 0.09, true],
    [0.62, 0.52, false],
    [0.56, 0.11, true],
    [0.1, 0.07, true],
    [0.27, 0.34, true],
    [0.2, 0.2, true],
    [0.44, 0.44, true],
    [0.33, 0.33, true],
    [0.22, 0.2, true],
];

/** Its half size across and front to back. @param {{ type: number, variant: number }} piece */
export function furnitureHalf(piece) {
    if (piece.type === FURN_BED && (piece.variant & 1) === 0) return [0.18, 0.38];
    return [HALF[piece.type][0], HALF[piece.type][1]];
}

/** What of it is solid, as [minX, minZ, maxX, maxZ], or null. @param {Furniture} piece */
export function furnitureBox(piece) {
    if (!HALF[piece.type][2]) return null;
    const [a, d] = furnitureHalf(piece);
    const [hx, hz] = piece.dx !== 0 ? [d, a] : [a, d];
    // (A table laid for dinner: just the table and the chairs close in; you can squeeze between the chairs.)
    const inset = piece.type === FURN_BANQUET || piece.type === FURN_BEVERLY ? 0.08 : 0.01;
    return [piece.x - hx + inset, piece.z - hz + inset, piece.x + hx - inset, piece.z + hz - inset];
}

/** How far its lamp's shade is from its middle, along its front and to its right, if it has a lamp. */
export function lampOffset(piece) {
    if (piece.type === FURN_NIGHTSTAND || piece.type === FURN_SIDE_TABLE) return [0, 0];
    if (piece.type === FURN_DESK) return [-0.02, -0.4];
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
    if (zone === ZONE_GUEST) furnishRooms(ctx, place);
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
     * Whether a rectangle keeps out of every wall's thickness (and the posts where walls meet, and the columns): each
     * line between cells it reaches into has to be open where it does.
     */
    clearOfWalls(minX, minZ, maxX, maxZ) {
        const { layout, x0, z0 } = this.ctx;
        const e = 1e-4;
        // The lines between cells it reaches into: local line k is at x0 + k − 0.5.
        const lines = (min, max, origin) => {
            const found = [];
            for (let k = Math.floor(min - origin); k <= Math.ceil(max - origin) + 1; k++) {
                const at = origin + k - 0.5;
                if (min < at + HALF_WALL - e && max > at - HALF_WALL + e) found.push(k);
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

// ---------------------------------------------------------------------------------------------- the guest rooms

/**
 * Each guest room: a bed with its head to a wall (a double in a room of more than one cell, else a single along a
 * wall, in a corner), a nightstand by it with a lamp (on, if nothing near has one), a wardrobe, and an armchair or a
 * writing desk.
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
        let bed = null;
        for (const [i, j] of shuffled(cells, random)) {
            for (const [di, dj] of shuffled(wallsOf(ctx, i, j, false), random)) {
                const x = x0 + i;
                const z = z0 + j;
                const variant = (((random() * 4294967296) >>> 0) & ~1) | (single ? 0 : 1);
                if (single) {
                    // Along the wall, pushed into a corner, its head to the wall at that end.
                    const end = random() < 0.5 ? -1 : 1;
                    const [ax, az] = di !== 0 ? [0, end] : [end, 0];
                    bed = place.put(FURN_BED, x + di * (FACE - 0.18) + ax * (FACE - 0.38), z + dj * (FACE - 0.18) + az * (FACE - 0.38), -ax, -az, 0.01, variant);
                } else {
                    bed = place.put(FURN_BED, x + di * (FACE - 0.38), z + dj * (FACE - 0.38), -di, -dj, 0.01, variant);
                }
                if (bed) break;
            }
            if (bed) break;
        }
        if (!bed) continue;
        // A nightstand by its head (the lamp on it lit, if it can be).
        const [a] = furnitureHalf(bed);
        for (const side of shuffled([-1, 1], random)) {
            // Its right: (−dz, dx).
            const x = bed.x - bed.dx * (0.38 - 0.08) - bed.dz * side * (a + 0.1);
            const z = bed.z - bed.dz * (0.38 - 0.08) + bed.dx * side * (a + 0.1);
            const stand = place.put(FURN_NIGHTSTAND, x, z, bed.dx, bed.dz, 0.005);
            if (stand) {
                place.light(stand);
                break;
            }
        }
        // A wardrobe against another wall, and an armchair or a desk.
        for (const type of [FURN_WARDROBE, random() < 0.5 ? FURN_ARMCHAIR : FURN_WRITING_DESK]) {
            let done = false;
            for (const [i, j] of shuffled(cells, random)) {
                for (const [di, dj] of shuffled(wallsOf(ctx, i, j, type === FURN_WARDROBE), random)) {
                    const [, depth] = furnitureHalf({ type, variant: 0 });
                    const along = (random() - 0.5) * 0.4;
                    const x = x0 + i + di * (FACE - depth - 0.005) + (di === 0 ? along : 0);
                    const z = z0 + j + dj * (FACE - depth - 0.005) + (dj === 0 ? along : 0);
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
 * long-case clock, and a grand piano; and a round table with flowers on it under one of the chandeliers.
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
            const x = x0 + i + ai * 0.5 + di * (FACE - 0.3);
            const z = z0 + j + aj * 0.5 + dj * (FACE - 0.3);
            // (With room behind it for whoever was on the desk, kept clear.)
            const behind = [x + di * 0.11, z + dj * 0.11, x + di * 0.3, z + dj * 0.3];
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
    // A clock against a wall.
    if (random() < 0.55) placeAgainstWall(ctx, place, FURN_CLOCK, open, 40);
    // Lounges.
    const lounges = 1 + Math.floor(random() * 3);
    for (let n = 0, attempt = 0; n < lounges && attempt < 40; attempt++) {
        const i = 1 + Math.floor(random() * (N - 3));
        const j = 1 + Math.floor(random() * (N - 3));
        if (!block(i, j)) continue;
        if (lounge(ctx, place, x0 + i + 0.5, z0 + j + 0.5)) n++;
    }
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

/** Something that stands with its back to a wall (a clock), in a cell that `open` allows, if there's room. */
function placeAgainstWall(ctx, place, type, open, attempts) {
    const { random, x0, z0 } = ctx;
    const [, depth] = furnitureHalf({ type, variant: 0 });
    const spots = [];
    for (let i = 1; i < N - 1; i++) {
        for (let j = 1; j < N - 1; j++) if (open(i, j)) for (const [di, dj] of wallsOf(ctx, i, j, true)) spots.push([i, j, di, dj]);
    }
    for (const [i, j, di, dj] of shuffled(spots, random).slice(0, attempts)) {
        const x = x0 + i + di * (FACE - depth - 0.005);
        const z = z0 + j + dj * (FACE - depth - 0.005);
        const piece = place.put(type, x, z, -di, -dj, 0.03);
        if (piece) return piece;
    }
    return null;
}

// ---------------------------------------------------------------------------------------------- the ballroom

/**
 * The Beverly Room: in a third of its chunks, the small table, under a chandelier that's lit (the only one for a long
 * way, most likely); here and there a round table laid for dinner, its chandelier most likely dead; now and then a
 * grand piano, alone.
 */
function furnishBallroom(ctx, place, lit) {
    const { random, x0, z0, avoid, kinds } = ctx;
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
            const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(random() * 4)];
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
