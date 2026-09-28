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
 * Level 5 furniture placement. The models are in terrorHotelFurnishings.js, small carryable stuff in
 * terrorHotelProps.js.
 *
 * Everything stays inside its chunk and clear of walls, mouldings, doorways, locked doors and columns. Tall pieces
 * also avoid sconces. There's always a way through: the floor in front of doorways and wall gaps stays free, halls
 * are big, and anything in a corridor is shallow and against the wall.
 */

const N = CHUNK_SIZE;
const HALF_WALL = WALL_THICKNESS / 2;
/** Cell middle to wall face. */
export const FACE = 0.5 - HALF_WALL;
/**
 * Gap kept in front of a wall so furniture clears the skirting and chair rail. The deepest, a lobby skirting,
 * sticks out 0.016 (see terrorHotelGeometry.js).
 */
export const WALL_CLEAR = 0.018;

export const FURN_BED = 0;
export const FURN_NIGHTSTAND = 1; // lamp on it, lit or not
export const FURN_WARDROBE = 2;
export const FURN_ARMCHAIR = 3; // wingback
export const FURN_SOFA = 4; // chesterfield
export const FURN_SIDE_TABLE = 5; // round lamp table, lit or not
export const FURN_LOW_TABLE = 6; // in front of a sofa
export const FURN_RUG = 7; // under a lounge, walkable
export const FURN_DESK = 8; // reception desk, plus the key rack on the wall behind it
export const FURN_CLOCK = 9; // grandfather clock
export const FURN_PIANO = 10; // grand piano and stool
export const FURN_CENTRE_TABLE = 11; // round table with a tall vase of flowers
export const FURN_BANQUET = 12; // round dinner table with chairs
export const FURN_BEVERLY = 13; // Beverly Room small table: drinks and a half-played mahjong game
export const FURN_WRITING_DESK = 14; // desk and chair, guest rooms
export const FURN_BOOKCASE = 15; // lobbies and guest rooms
export const FURN_FIREPLACE = 16; // cold marble fireplace with a mirror, lobbies
export const FURN_CONSOLE = 17; // half-round table under a corridor sconce
export const FURN_BANDSTAND = 18; // empty ballroom stage, desk lamps on
export const FURN_LONG_TABLE = 19; // long ballroom dinner table, candles lit
export const FURN_CHALKBOARD = 20; // MENU board on an easel, lobbies

/**
 * @typedef {object} Furniture
 * @property {number} type FURN_*.
 * @property {number} x Center.
 * @property {number} z
 * @property {number} dx Facing direction (axis-aligned unit vector).
 * @property {number} dz
 * @property {number} variant 32 bits for its size and details.
 * @property {boolean} [lit] Set if it has a lamp, true when it's on (see Lamp in terrorHotel.js).
 */

/**
 * Per type: half width (local x), half depth (local z), solid. Everything drawn stays inside this box except the
 * reception key rack (see terrorHotelFurnishings.js). Bed width comes from the variant (see furnitureHalf).
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

/** Half width and half depth. @param {{ type: number, variant: number }} piece */
export function furnitureHalf(piece) {
    if (piece.type === FURN_BED && (piece.variant & 1) === 0) return [0.2, 0.385];
    return [HALF[piece.type][0], HALF[piece.type][1]];
}

/** Collision box as [minX, minZ, maxX, maxZ], or null. @param {Furniture} piece */
export function furnitureBox(piece) {
    if (!HALF[piece.type][2]) return null;
    const [a, d] = furnitureHalf(piece);
    const [hx, hz] = piece.dx !== 0 ? [d, a] : [a, d];
    // dinner tables are inset so you can squeeze between the chairs
    const inset = piece.type === FURN_BANQUET ? 0.13 : piece.type === FURN_BEVERLY || piece.type === FURN_LONG_TABLE ? 0.1 : 0.01;
    return [piece.x - hx + inset, piece.z - hz + inset, piece.x + hx - inset, piece.z + hz - inset];
}

/**
 * Lamp shade offset from the piece's middle as [forward, right], or null. Table candles and bandstand desk lights
 * count as lamps.
 */
export function lampOffset(piece) {
    if (piece.type === FURN_NIGHTSTAND || piece.type === FURN_SIDE_TABLE || piece.type === FURN_LONG_TABLE) return [0, 0];
    if (piece.type === FURN_DESK) return [-0.02, -0.4];
    if (piece.type === FURN_BANDSTAND) return [0.1, 0];
    return null;
}

// ---------------------------------------------------------------------------------------------- placing

/**
 * Furnishes a chunk (see generateTerrorHotelChunk). Adds to `furniture`, `solids` and `lamps` and sets CELL_TAKEN on
 * cells with furniture.
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
 * @param {number} ctx.lampClear Min distance from a lamp to the middles of the chunk's edge cells, so its light ends
 *     inside the chunk.
 * @param {Uint8Array} ctx.floors Floor pattern overrides (FLOOR_*), for dance floors.
 * @returns {Set<number>} Light slots (local i * N + j) that must stay lit for what's under them.
 */
export function furnish(ctx) {
    const { layout, kinds, x0, z0, zone } = ctx;
    const place = new Placer(ctx);
    // Keep clear in front of every doorway, wall gap and locked door, and around every column.
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const edge = layout.between(i, j, di, dj);
                if (edge === EDGE_WALL) continue;
                if (edge === EDGE_NONE && !gapInWall(layout, i, j, di, dj)) continue;
                // skip where a corridor continues, corridor furniture is shallow and against the wall anyway
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

/** Whether the open edge on side (di, dj) of local cell (i, j) is a gap in a wall, i.e. has wall next to it on the same line. */
function gapInWall(layout, i, j, di, dj) {
    if (di !== 0) {
        const line = di > 0 ? i + 1 : i;
        return (j > 0 && layout.getV(line, j - 1) !== EDGE_NONE) || (j + 1 < N && layout.getV(line, j + 1) !== EDGE_NONE);
    }
    const line = dj > 0 ? j + 1 : j;
    return (i > 0 && layout.getH(i - 1, line) !== EDGE_NONE) || (i + 1 < N && layout.getH(i + 1, line) !== EDGE_NONE);
}

/** Tracks free space in a chunk: rectangles placed or kept clear, walls and lamps. */
class Placer {
    constructor(ctx) {
        this.ctx = ctx;
        /** @type {number[][]} */
        this.rects = [];
    }

    block(minX, minZ, maxX, maxZ) {
        this.rects.push([Math.min(minX, maxX), Math.min(minZ, maxZ), Math.max(minX, maxX), Math.max(minZ, maxZ)]);
    }

    /** Whether a rectangle is inside the chunk (a bit in from the edge), clear of walls, and `margin` clear of the rest. */
    free(minX, minZ, maxX, maxZ, margin = 0) {
        const { x0, z0 } = this.ctx;
        if (minX < x0 - 0.45 || minZ < z0 - 0.45 || maxX > x0 + N - 0.55 || maxZ > z0 + N - 0.55) return false;
        if (!this.clearOfWalls(minX, minZ, maxX, maxZ)) return false;
        const e = 1e-4 - margin;
        for (const [a, b, c, d] of this.rects) if (minX < c - e && maxX > a + e && minZ < d - e && maxZ > b + e) return false;
        return true;
    }

    /**
     * Whether a rectangle clears wall thickness, mouldings, wall posts and columns. Every cell line it reaches into
     * must be open there.
     */
    clearOfWalls(minX, minZ, maxX, maxZ) {
        const { layout, x0, z0 } = this.ctx;
        const e = 1e-4;
        const reach = HALF_WALL + WALL_CLEAR;
        // cell lines the rectangle reaches into, local line k is at x0 + k - 0.5
        const lines = (min, max, origin) => {
            const found = [];
            for (let k = Math.floor(min - origin); k <= Math.ceil(max - origin) + 1; k++) {
                const at = origin + k - 0.5;
                if (min < at + reach - e && max > at - reach + e) found.push(k);
            }
            return found;
        };
        // cells it covers along the other axis
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
        // corners where lines cross: wall ends or columns
        for (const i of xs) {
            for (const j of zs) {
                if (v(i, j - 1) !== EDGE_NONE || v(i, j) !== EDGE_NONE || h(i - 1, j) !== EDGE_NONE || h(i, j) !== EDGE_NONE) return false;
                if (i >= 1 && j >= 1 && i <= N && j <= N && layout.getPillar(i, j)) return false;
            }
        }
        return true;
    }

    /** Blocks the floor inside the opening on side (di, dj) of cell (x, z), `half` each side, `depth` deep. */
    keepClear(x, z, di, dj, half, depth) {
        if (di !== 0) {
            const near = x + di * 0.5;
            this.block(near, z - half, near - di * depth, z + half);
        } else {
            const near = z + dj * 0.5;
            this.block(x - half, near, x + half, near - dj * depth);
        }
    }

    /** Whether a lamp at (x, z) is far enough from the chunk edge and every other lamp. */
    lampFits(x, z) {
        const { x0, z0, lampClear, lamps } = this.ctx;
        if (Math.min(x - x0, z - z0, x0 + N - 1 - x, z0 + N - 1 - z) < lampClear) return false;
        // No cell can be lit by two lamps since each cell only stores its nearest (see cellBytes).
        return lamps.every((lamp) => Math.max(Math.abs(lamp.x - x), Math.abs(lamp.z - z)) > 2 * lampClear + 1.2);
    }

    /**
     * Places a piece if its box plus `margin` is free. Returns the piece, or null.
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

    /** Turns on the piece's lamp if it has one and lampFits allows. */
    light(piece) {
        const offset = lampOffset(piece);
        if (!offset) return;
        const [f, r] = offset;
        // right is front turned 90° clockwise seen from above: (-dz, dx)
        const x = snap(piece.x + piece.dx * f - piece.dz * r);
        const z = snap(piece.z + piece.dz * f + piece.dx * r);
        piece.lit = this.lampFits(x, z);
        if (piece.lit) this.ctx.lamps.push({ x, z });
    }
}

/** Rounds to 1/8 unit, since lamp positions are stored in eighths (see cellBytes). */
function snap(value) {
    return Math.round(value * 8) / 8;
}

/**
 * Walls of a cell that furniture can stand against (solid, no door of any kind), as [di, dj] toward the wall.
 * `tall` also skips walls with a sconce.
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

/** The odd console table under a corridor sconce. Not at crossings or near the spawn. */
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
 * Guest rooms: a bed (double in bigger rooms, single in a corner for one-cell rooms), a nightstand with a lamp (on if
 * no lamp is too close), a wardrobe, and an armchair, writing desk or bookcase.
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
        // some rooms are empty
        if (random() < 0.1) continue;
        const single = cells.length === 1;
        // cell middle offset for a piece of this depth with its back just off the mouldings
        const off = (depth) => FACE - WALL_CLEAR - depth;
        let bed = null;
        for (const [i, j] of shuffled(cells, random)) {
            for (const [di, dj] of shuffled(wallsOf(ctx, i, j, false), random)) {
                const x = x0 + i;
                const z = z0 + j;
                const variant = (((random() * 4294967296) >>> 0) & ~1) | (single ? 0 : 1);
                const [a, d] = furnitureHalf({ type: FURN_BED, variant });
                if (single) {
                    // along the wall, pushed into a corner, head against the end wall
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
        // nightstand by the head of the bed, against the same wall
        const [a, d] = furnitureHalf(bed);
        const [sa, sd] = furnitureHalf({ type: FURN_NIGHTSTAND, variant: 0 });
        for (const side of shuffled([-1, 1], random)) {
            // right is (-dz, dx)
            const x = bed.x - bed.dx * (d - sd) - bed.dz * side * (a + sa + 0.01);
            const z = bed.z - bed.dz * (d - sd) + bed.dx * side * (a + sa + 0.01);
            const stand = place.put(FURN_NIGHTSTAND, x, z, bed.dx, bed.dz, 0.005);
            if (stand) {
                place.light(stand);
                break;
            }
        }
        // wardrobe, then an armchair, desk or bookcase
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
 * Lobby chunk: lounges where they fit between the columns, and sometimes a reception desk, fireplace, clock,
 * bookcases, menu board and grand piano. Plus a flower table under a chandelier.
 */
function furnishLobby(ctx, place, lit) {
    const { layout, random, x0, z0, avoid, kinds } = ctx;
    const open = (i, j) => i >= 1 && j >= 1 && i < N - 1 && j < N - 1 && kinds[i * N + j] & CELL_HALL && !avoid(x0 + i, z0 + j);
    // 2x2 cells with no wall between them and no column in the middle
    const block = (i, j) => open(i, j) && open(i + 1, j) && open(i, j + 1) && open(i + 1, j + 1)
        && layout.getV(i + 1, j) === EDGE_NONE && layout.getV(i + 1, j + 1) === EDGE_NONE
        && layout.getH(i, j + 1) === EDGE_NONE && layout.getH(i + 1, j + 1) === EDGE_NONE && !layout.getPillar(i + 1, j + 1);
    // Reception needs two adjacent cells sharing a bare wall (no door or sconce). The desk straddles the line
    // between them.
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
            // key rack goes on the wall face between skirting and cornice
            const x = x0 + i + ai * 0.5 + di * (FACE - 0.3);
            const z = z0 + j + aj * 0.5 + dj * (FACE - 0.3);
            // keep space clear behind the desk for the clerk
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
    // fireplace and clock against a wall
    if (random() < 0.45) placeAgainstWall(ctx, place, FURN_FIREPLACE, open, 40);
    if (random() < 0.55) placeAgainstWall(ctx, place, FURN_CLOCK, open, 40);
    // lounges
    const lounges = 1 + Math.floor(random() * 3);
    for (let n = 0, attempt = 0; n < lounges && attempt < 40; attempt++) {
        const i = 1 + Math.floor(random() * (N - 3));
        const j = 1 + Math.floor(random() * (N - 3));
        if (!block(i, j)) continue;
        if (lounge(ctx, place, x0 + i + 0.5, z0 + j + 0.5)) n++;
    }
    // bookcases along the walls, sometimes the menu board
    const shelves = random() < 0.55 ? 1 + Math.floor(random() * 3) : 0;
    for (let k = 0; k < shelves; k++) placeAgainstWall(ctx, place, FURN_BOOKCASE, open, 30);
    if (random() < 0.3) placeAgainstWall(ctx, place, FURN_CHALKBOARD, open, 30, false);
    // grand piano
    if (random() < 0.3) {
        for (let attempt = 0; attempt < 20; attempt++) {
            const i = 1 + Math.floor(random() * (N - 3));
            const j = 1 + Math.floor(random() * (N - 3));
            if (!block(i, j)) continue;
            const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(random() * 4)];
            if (place.put(FURN_PIANO, x0 + i + 0.5, z0 + j + 0.5, dx, dz, 0.2)) break;
        }
    }
    // flower table under a chandelier
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
 * Lounge centered on corner (x, z): rug, chesterfield, two armchairs facing it, a low table between, and a lamp table
 * at one end of the sofa.
 * @returns {boolean} Whether it fitted.
 */
function lounge(ctx, place, x, z) {
    const { random } = ctx;
    const [fx, fz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(random() * 4)];
    // sofa at the back facing f, chairs in front facing it, right is (-fz, fx)
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

/** Places a piece backed against a wall in an `open` cell, if it fits. Tall pieces avoid sconces. */
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
 * Beverly Room. A third of its chunks get the small table under a lit chandelier (likely the only one lit for a long
 * way). Sometimes a bandstand with a parquet dance floor, the long candlelit table, a few dinner tables and a lone
 * grand piano.
 */
function furnishBallroom(ctx, place, lit) {
    const { random, x0, z0, avoid, kinds, floors } = ctx;
    const open = (i, j) => i >= 2 && j >= 2 && i < N - 2 && j < N - 2 && kinds[i * N + j] & CELL_BALLROOM && !avoid(x0 + i, z0 + j);
    // chandeliers are on every other slot each way (see hotelLights)
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
            // dance floor in front, 5 cells wide and 3 deep, kept clear
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

/** Shuffled copy (Fisher-Yates on the chunk's own random stream). */
function shuffled(list, random) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const k = Math.floor(random() * (i + 1));
        [copy[i], copy[k]] = [copy[k], copy[i]];
    }
    return copy;
}
