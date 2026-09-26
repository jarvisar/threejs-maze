import { CHUNK_SIZE } from '../config.js';
import {
    PROP_BARREL,
    PROP_BOTTLES,
    PROP_BOXES,
    PROP_CHAIR,
    PROP_CONE,
    PROP_CRATES,
    PROP_MONITOR,
    PROP_PALLET,
    PROP_RACK,
    PROP_SIGN,
    makeProp,
} from './decorations.js';
import { DIRECTIONS, EDGE_NONE, EDGE_WALL } from './grid.js';
import { ZONE_PARKING, ZONE_SERVICE, ZONE_STORAGE } from './zones.js';

/*
 * What's been left lying about in Level 1 (see decorations.js for Level 0's, and props.js for what they look
 * like). The supply crates are what Level 1 is known for: plain wooden boxes, on the floor and on shelves, and
 * nobody knows who leaves them. The car park has cones and drums by the columns and the odd crate; the warehouse
 * is rows of racking with pallets and crates in the aisles; the corridors behind have boxes, buckets and chairs.
 *
 * Like Level 0's, every prop keeps inside its cell and never blocks a way through on its own.
 */

const N = CHUNK_SIZE;

/**
 * Chooses a chunk's props.
 * @param {() => number} random The chunk's random stream.
 * @param {(i: number, j: number, di: number, dj: number) => number} edgeBetween
 * @param {(i: number, j: number) => boolean} pillarAt Whether layout corner (i, j) holds a column (the +x+z corner
 *     of local cell (i − 1, j − 1)).
 * @param {number} x0 World coordinates of the chunk's first cell.
 * @param {number} z0
 * @param {number} zone The chunk's zone type.
 * @param {(x: number, z: number) => boolean} avoid Cells to leave empty (where you start, the way out).
 * @returns {import('./decorations.js').Prop[]}
 */
export function placeLevelOneProps(random, edgeBetween, pillarAt, x0, z0, zone, avoid) {
    /** @type {import('./decorations.js').Prop[]} */
    const props = [];
    const taken = new Uint8Array(N * N);
    const variant = () => (random() * 4294967296) >>> 0;
    const free = (i, j) => i >= 0 && j >= 0 && i < N && j < N && !taken[i * N + j] && !avoid(x0 + i, z0 + j);
    const take = (i, j) => {
        if (i >= 0 && j >= 0 && i < N && j < N) taken[i * N + j] = 1;
    };
    const wallsOf = (i, j) => DIRECTIONS.filter(([di, dj]) => edgeBetween(i, j, di, dj) === EDGE_WALL);
    const openSides = (i, j) => DIRECTIONS.filter(([di, dj]) => edgeBetween(i, j, di, dj) === EDGE_NONE).length;
    // The corners of local cell (i, j) with a column on, as the direction to them.
    const columnsBy = (i, j) => {
        const found = [];
        for (const [ci, cj, dx, dz] of [[i, j, -1, -1], [i + 1, j, 1, -1], [i, j + 1, -1, 1], [i + 1, j + 1, 1, 1]]) {
            if (ci >= 1 && cj >= 1 && ci <= N && cj <= N && pillarAt(ci, cj)) found.push([dx, dz]);
        }
        return found;
    };

    /**
     * Something against a wall (facing into the room) or tucked in by a column, or failing that in the open.
     * @returns {boolean} Whether it went down.
     */
    const place = (type, attempts, where = 'any') => {
        for (let attempt = 0; attempt < attempts; attempt++) {
            const i = Math.floor(random() * N);
            const j = Math.floor(random() * N);
            if (!free(i, j) || openSides(i, j) < 2) continue;
            const x = x0 + i;
            const z = z0 + j;
            const walls = wallsOf(i, j);
            const columns = columnsBy(i, j);
            if (where === 'wall' && walls.length === 0) continue;
            if (where === 'column' && columns.length === 0) continue;
            let px = x + (random() - 0.5) * 0.2;
            let pz = z + (random() - 0.5) * 0.2;
            let yaw = random() * Math.PI * 2;
            if (columns.length > 0 && (where === 'column' || (walls.length === 0 && random() < 0.7))) {
                // In by the column, clear of it.
                const [dx, dz] = columns[Math.floor(random() * columns.length)];
                px = x + dx * 0.16 + (random() - 0.5) * 0.06;
                pz = z + dz * 0.16 + (random() - 0.5) * 0.06;
            } else if (walls.length > 0 && (random() < 0.85 || walls.length >= 2)) {
                // (Always against a wall in a corridor, so it can't close it off.)
                const [di, dj] = walls[Math.floor(random() * walls.length)];
                const along = (random() - 0.5) * 0.4;
                px = x + di * 0.24 + (di === 0 ? along : 0);
                pz = z + dj * 0.24 + (dj === 0 ? along : 0);
                yaw = Math.atan2(-di, -dj) + (random() - 0.5) * 0.3;
            }
            props.push(makeProp(type, px, pz, yaw, variant()));
            take(i, j);
            return true;
        }
        return false;
    };

    if (zone === ZONE_STORAGE) {
        racking(random, props, free, take, pillarAt, edgeBetween, x0, z0, variant);
        const pallets = 2 + Math.floor(random() * 4);
        for (let n = 0; n < pallets; n++) place(PROP_PALLET, 10, random() < 0.5 ? 'wall' : 'any');
        const crates = 3 + Math.floor(random() * 4);
        for (let n = 0; n < crates; n++) place(PROP_CRATES, 10);
        const boxes = 1 + Math.floor(random() * 3);
        for (let n = 0; n < boxes; n++) place(PROP_BOXES, 10);
        if (random() < 0.5) place(PROP_BARREL, 8, 'column');
        if (random() < 0.3) place(PROP_BOTTLES, 8);
    } else if (zone === ZONE_SERVICE) {
        const boxes = Math.floor(random() * 3);
        for (let n = 0; n < boxes; n++) place(PROP_BOXES, 12, 'wall');
        if (random() < 0.55) place(PROP_CRATES, 12, 'wall');
        if (random() < 0.35) place(PROP_BARREL, 12, 'wall');
        if (random() < 0.3) place(PROP_CHAIR, 12);
        if (random() < 0.35) place(PROP_BOTTLES, 12);
        if (random() < 0.25) place(PROP_SIGN, 12);
        if (random() < 0.12) place(PROP_MONITOR, 12, 'wall');
        if (random() < 0.3) place(PROP_PALLET, 12, 'wall');
    } else if (zone === ZONE_PARKING) {
        const cones = random() < 0.6 ? 1 + Math.floor(random() * 3) : 0;
        for (let n = 0; n < cones; n++) place(PROP_CONE, 10, random() < 0.6 ? 'column' : 'any');
        if (random() < 0.45) place(PROP_CRATES, 10, random() < 0.5 ? 'column' : 'wall');
        if (random() < 0.35) place(PROP_BARREL, 10, 'column');
        if (random() < 0.2) place(PROP_BOXES, 10, 'wall');
        if (random() < 0.15) place(PROP_PALLET, 10, 'wall');
        if (random() < 0.2) place(PROP_SIGN, 10);
        if (random() < 0.15) place(PROP_BOTTLES, 10);
    }
    return props;
}

/**
 * Rows of pallet racking down the middle of the bays, with a gap every few cells to get between them. The rows run
 * the same way across the whole region (from where the chunk is), so they line up from chunk to chunk.
 */
function racking(random, props, free, take, pillarAt, edgeBetween, x0, z0, variant) {
    const alongX = ((Math.floor(x0 / 48) + Math.floor(z0 / 48)) & 1) === 0;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            // The middle row of each bay, across it; and a gap every third bay's worth.
            const row = alongX ? z : x;
            const run = alongX ? x : z;
            if (mod(row, 3) !== 0 || mod(run, 9) === 4) continue;
            if (!free(i, j)) continue;
            // Not up against a wall along its length (it would close the way off), and nothing across it.
            const [di, dj] = alongX ? [1, 0] : [0, 1];
            if (edgeBetween(i, j, di, dj) !== EDGE_NONE || edgeBetween(i, j, -di, -dj) !== EDGE_NONE) continue;
            if (edgeBetween(i, j, dj, di) === EDGE_WALL && edgeBetween(i, j, -dj, -di) === EDGE_WALL) continue;
            if (pillarAt(i, j) || pillarAt(i + 1, j) || pillarAt(i, j + 1) || pillarAt(i + 1, j + 1)) continue;
            // Now and then a bay has been emptied out.
            if (random() < 0.08) continue;
            const facing = random() < 0.5 ? 0 : Math.PI;
            props.push(makeProp(PROP_RACK, x, z, (alongX ? 0 : Math.PI / 2) + facing, variant()));
            take(i, j);
        }
    }
}

function mod(a, b) {
    return ((a % b) + b) % b;
}
