import { CHUNK_SIZE, WALL_THICKNESS } from '../config.js';
import { DIRECTIONS, EDGE_NONE, EDGE_WALL } from './grid.js';
import { CELL_HALL, CELL_MACHINE, CELL_ROOM, CELL_TAKEN, CELL_TUNNEL } from './pipeDreams.js';
import { ZONE_STEAM } from './zones.js';

/*
 * Level 2 furniture: larger pieces against walls (switchboards, workbenches, pipe racks, cable drums, trolleys,
 * carts, lockers). Meshes are in pipeDreamsFurnishings.js, small props in pipeDreamsProps.js.
 * Each piece stays inside its cell with its back to a wall, clear of any low pipes, and leaves room to walk past.
 * Its cell is marked taken so nothing else goes there (no props, no black streaks down that wall, no fittings).
 */

const N = CHUNK_SIZE;
const HALF_WALL = WALL_THICKNESS / 2;
/** How far the low pipes reach out from the middle of a wall (see LOW_PIPES in pipeDreamsProps.js). */
const LOW_PIPES = 0.152;

export const FURN_BOARD = 0; // switchboard: gray panels, meters, handles and lamps
export const FURN_BENCH = 1; // workbench with vise, tools and a tool board above
export const FURN_STOCK = 2; // pipe rack and offcuts
export const FURN_DRUM = 3; // cable drum standing on its flanges
export const FURN_TROLLEY = 4; // loaded platform trolley
export const FURN_CART = 5; // small electric utility truck with a load on the back
export const FURN_LOCKERS = 6; // row of steel lockers, sometimes one open

/**
 * @typedef {object} Piece
 * @property {number} type FURN_*.
 * @property {number} x Center.
 * @property {number} z
 * @property {number} dx Facing direction, unit axis vector pointing away from the wall.
 * @property {number} dz
 * @property {number} half Half length along the wall.
 * @property {number} variant 32 random bits for details.
 */

/** Half depth (front to back) and max half length along the wall, per type. */
const DEPTH = [0.075, 0.105, 0.075, 0.11, 0.125, 0.215, 0.072];
const LENGTH = [0.44, 0.4, 0.44, 0.17, 0.235, 0.47, 0.22];
/** Min half length per type. */
const SHORTEST = [0.2, 0.3, 0.3, 0.17, 0.235, 0.47, 0.11];

/**
 * Collision box [minX, minZ, maxX, maxZ], a little inside the drawn shape like a prop's.
 * @param {Piece} piece
 */
export function furnitureBox(piece) {
    const along = piece.half - 0.01;
    const depth = DEPTH[piece.type] - 0.01;
    const hx = piece.dx !== 0 ? depth : along;
    const hz = piece.dx !== 0 ? along : depth;
    return [piece.x - hx, piece.z - hz, piece.x + hx, piece.z + hz];
}

/** Half depth, front to back. @param {Piece} piece */
export function furnitureDepth(piece) {
    return DEPTH[piece.type];
}

/**
 * Places the chunk's furniture and marks its cells CELL_TAKEN.
 * @param {() => number} random The chunk's random stream.
 * @param {(i: number, j: number, di: number, dj: number) => number} edgeBetween
 * @param {Uint8Array} kinds
 * @param {number} x0
 * @param {number} z0
 * @param {number} zone
 * @param {(x: number, z: number) => boolean} avoid Cells to leave empty (spawn).
 * @param {number[][]} solids Collision boxes get pushed here.
 * @returns {Piece[]}
 */
export function placePipeDreamsFurniture(random, edgeBetween, kinds, x0, z0, zone, avoid, solids) {
    /** @type {Piece[]} */
    const pieces = [];
    const steam = zone === ZONE_STEAM;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const kind = kinds[i * N + j];
            const roll = random();
            if (kind & (CELL_MACHINE | CELL_TAKEN) || avoid(x0 + i, z0 + j)) continue;
            let type = -1;
            if (kind & CELL_HALL) {
                if (roll < 0.009) type = FURN_BOARD;
                else if (roll < 0.024) type = FURN_BENCH;
                else if (roll < 0.036) type = FURN_DRUM;
                else if (roll < 0.045) type = FURN_STOCK;
                else if (roll < 0.054) type = FURN_TROLLEY;
                else if (roll < 0.066) type = FURN_CART;
                else if (roll < 0.072) type = FURN_LOCKERS;
            } else if (kind & CELL_ROOM) {
                if (roll < 0.02) type = FURN_BENCH;
                else if (roll < 0.035) type = FURN_STOCK;
                else if (roll < 0.047) type = FURN_DRUM;
                else if (roll < 0.054) type = FURN_TROLLEY;
                else if (roll < 0.058) type = FURN_BOARD;
                else if (roll < 0.072) type = FURN_LOCKERS;
            } else if (kind & CELL_TUNNEL) {
                if (roll < (steam ? 0.004 : 0.012)) type = FURN_TROLLEY;
                else if (roll < (steam ? 0.006 : 0.017)) type = FURN_DRUM;
            }
            if (type < 0) continue;
            const walls = DIRECTIONS.filter(([di, dj]) => edgeBetween(i, j, di, dj) === EDGE_WALL);
            if (walls.length === 0) continue;
            const [di, dj] = walls[Math.floor(random() * walls.length)];
            const variant = (random() * 4294967296) >>> 0;
            // back to the wall, clear of the low pipes (store room walls have none)
            const room = (kind & CELL_ROOM) !== 0;
            const back = (room ? HALF_WALL : LOW_PIPES) + 0.006;
            const depth = DEPTH[type];
            const out = 0.5 - back - depth;
            const [ai, aj] = [dj !== 0 ? 1 : 0, di !== 0 ? 1 : 0];
            // Plant hall switchboards come in a row along the wall, one per cell.
            const cells = [[i, j]];
            if (type === FURN_BOARD && kind & CELL_HALL) {
                const wanted = 1 + Math.floor(random() * 3);
                for (let n = 1; n <= wanted; n++) {
                    const [ni, nj] = [i + ai * n, j + aj * n];
                    if (ni >= N || nj >= N || edgeBetween(ni - ai, nj - aj, ai, aj) !== EDGE_NONE || edgeBetween(ni, nj, di, dj) !== EDGE_WALL) break;
                    if (kinds[ni * N + nj] & (CELL_MACHINE | CELL_TAKEN) || !(kinds[ni * N + nj] & CELL_HALL) || avoid(x0 + ni, z0 + nj)) break;
                    cells.push([ni, nj]);
                }
            }
            for (let n = 0; n < cells.length; n++) {
                const [ci, cj] = cells[n];
                // Room along the wall between the ends. An end can be a cross wall (plus its pipes), open, or the
                // next piece in the row.
                const end = (s) => (edgeBetween(ci, cj, ai * s, aj * s) === EDGE_NONE ? 0.02 : back);
                const room0 = 0.5 - (n > 0 ? 0 : end(-1));
                const room1 = 0.5 - (n < cells.length - 1 ? 0 : end(1));
                const half = cells.length > 1 ? (room0 + room1) / 2 : Math.min(LENGTH[type], (room0 + room1) / 2);
                if (half < SHORTEST[type]) break;
                // anywhere along the wall it fits
                const lo = -room0 + half;
                const hi = room1 - half;
                const along = lo + (hi - lo) * random();
                // Pieces in a row share the low bits so they match.
                const own = n === 0 ? variant : ((variant & 0xff) | (Math.floor(random() * 16777216) << 8)) >>> 0;
                /** @type {Piece} */
                const piece = { type, x: x0 + ci + di * out + ai * along, z: z0 + cj + dj * out + aj * along, dx: -di, dz: -dj, half, variant: own };
                pieces.push(piece);
                solids.push(furnitureBox(piece));
                kinds[ci * N + cj] |= CELL_TAKEN;
            }
        }
    }
    return pieces;
}

/**
 * Truck parked on the right side of the spawn gallery a few steps ahead, in the cell at z (see carveGallery in
 * pipeDreams.js).
 * @param {number} variant
 * @param {number} z
 * @returns {Piece}
 */
export function galleryCart(variant, z) {
    const half = LENGTH[FURN_CART];
    const depth = DEPTH[FURN_CART];
    return { type: FURN_CART, x: 1.5 - LOW_PIPES - 0.006 - depth, z, dx: -1, dz: 0, half, variant };
}
