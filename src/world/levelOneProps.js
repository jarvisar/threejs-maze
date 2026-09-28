import { CHUNK_SIZE, WALL_THICKNESS } from '../config.js';
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
import { DIRECTIONS, EDGE_NONE, EDGE_WALL, mod } from './grid.js';
import { propFootprint } from './props.js';
import { ZONE_PARKING, ZONE_SERVICE, ZONE_STORAGE } from './zones.js';

/*
 * Level 1 props (Level 0's are in decorations.js, meshes in props.js). Supply crates are the Level 1 staple.
 * Parking gets cones and drums by the columns, storage gets racking rows with pallets and crates, service
 * corridors get boxes, buckets and chairs.
 *
 * Same rule as Level 0: every prop stays inside its cell and never blocks a path on its own.
 */

const N = CHUNK_SIZE;
// Max reach of a prop from its cell center, stopping just short of the walls.
const INSIDE = 0.5 - WALL_THICKNESS / 2 - 0.005;
const COLUMN_CLEARANCE = 0.005;

/**
 * Chooses a chunk's props.
 * @param {() => number} random The chunk's random stream.
 * @param {(i: number, j: number, di: number, dj: number) => number} edgeBetween
 * @param {(i: number, j: number) => boolean} pillarAt True if layout corner (i, j) has a column. That's the +x+z
 *     corner of local cell (i − 1, j − 1).
 * @param {number} columnHalf Half a column's width.
 * @param {number} x0 World coordinates of the chunk's first cell.
 * @param {number} z0
 * @param {number} zone
 * @param {(x: number, z: number) => boolean} avoid Cells to leave empty (spawn, exit).
 * @returns {import('./decorations.js').Prop[]}
 */
export function placeLevelOneProps(random, edgeBetween, pillarAt, columnHalf, x0, z0, zone, avoid) {
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
    // Directions to the corners of local cell (i, j) that have a column.
    const columnsBy = (i, j) => {
        const found = [];
        for (const [ci, cj, dx, dz] of [[i, j, -1, -1], [i + 1, j, 1, -1], [i, j + 1, -1, 1], [i + 1, j + 1, 1, 1]]) {
            if (ci >= 1 && cj >= 1 && ci <= N && cj <= N && pillarAt(ci, cj)) found.push([dx, dz]);
        }
        return found;
    };
    // Shift that moves span lo..hi inside from..to. Centers it if it's too long to fit.
    const into = (lo, hi, from, to) => (hi - lo > to - from ? (from + to - lo - hi) / 2 : Math.max(from - lo, 0) + Math.min(to - hi, 0));
    /**
     * Nudges a prop at (px, pz) in cell (x, z) the least amount needed to keep it inside the cell, off the walls and
     * clear of corner columns (from columnsBy). Most props don't move.
     */
    const fit = (type, px, pz, yaw, v, x, z, columns) => {
        const [minX, minZ, maxX, maxZ] = propFootprint(makeProp(type, px, pz, yaw, v));
        let dx = into(minX, maxX, x - INSIDE, x + INSIDE);
        let dz = into(minZ, maxZ, z - INSIDE, z + INSIDE);
        for (const [cdx, cdz] of columns) {
            // Move out along whichever axis is the shorter move.
            const reach = columnHalf + COLUMN_CLEARANCE;
            const ox = cdx > 0 ? x + 0.5 - reach - (maxX + dx) : x - 0.5 + reach - (minX + dx);
            const oz = cdz > 0 ? z + 0.5 - reach - (maxZ + dz) : z - 0.5 + reach - (minZ + dz);
            if (ox * cdx >= 0 || oz * cdz >= 0) continue;
            if (Math.abs(ox) < Math.abs(oz)) dx += ox;
            else dz += oz;
        }
        return [px + dx, pz + dz];
    };

    /**
     * Places a prop against a wall (facing out), next to a column, or in the open as a fallback.
     * @returns {boolean} True if placed.
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
            const middle = [px, pz, yaw];
            if (columns.length > 0 && (where === 'column' || (walls.length === 0 && random() < 0.7))) {
                // next to the column
                const [dx, dz] = columns[Math.floor(random() * columns.length)];
                px = x + dx * 0.16 + (random() - 0.5) * 0.06;
                pz = z + dz * 0.16 + (random() - 0.5) * 0.06;
            } else if (walls.length > 0 && (random() < 0.85 || walls.length >= 2)) {
                // Always against a wall in a corridor so it can't block it.
                const [di, dj] = walls[Math.floor(random() * walls.length)];
                const along = (random() - 0.5) * 0.4;
                px = x + di * 0.24 + (di === 0 ? along : 0);
                pz = z + dj * 0.24 + (dj === 0 ? along : 0);
                yaw = Math.atan2(-di, -dj) + (random() - 0.5) * 0.3;
            }
            const v = variant();
            // A tipped-over chair fills most of the cell, so keep it centered like on Level 0.
            if (type === PROP_CHAIR && (v & 3) === 0) [px, pz, yaw] = middle;
            [px, pz] = fit(type, px, pz, yaw, v, x, z, columns);
            props.push(makeProp(type, px, pz, yaw, v));
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

/** True if racking rows run along x (else z) for the chunk starting at (x0, z0). */
export function rackRowsAlongX(x0, z0) {
    return ((Math.floor(x0 / 48) + Math.floor(z0 / 48)) & 1) === 0;
}

/**
 * Pallet racking rows down the middle of each bay, with gaps to walk through. Direction is set per region (by
 * position) so rows line up across chunks.
 */
function racking(random, props, free, take, pillarAt, edgeBetween, x0, z0, variant) {
    const alongX = rackRowsAlongX(x0, z0);
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            // Middle row of each bay, with a gap every 9 cells.
            const row = alongX ? z : x;
            const run = alongX ? x : z;
            if (mod(row, 3) !== 0 || mod(run, 9) === 4) continue;
            if (!free(i, j)) continue;
            // Both ends open, and not walled in along its length (it would block the way).
            const [di, dj] = alongX ? [1, 0] : [0, 1];
            if (edgeBetween(i, j, di, dj) !== EDGE_NONE || edgeBetween(i, j, -di, -dj) !== EDGE_NONE) continue;
            if (edgeBetween(i, j, dj, di) === EDGE_WALL && edgeBetween(i, j, -dj, -di) === EDGE_WALL) continue;
            if (pillarAt(i, j) || pillarAt(i + 1, j) || pillarAt(i, j + 1) || pillarAt(i + 1, j + 1)) continue;
            // Some bays are empty.
            if (random() < 0.08) continue;
            const facing = random() < 0.5 ? 0 : Math.PI;
            props.push(makeProp(PROP_RACK, x, z, (alongX ? 0 : Math.PI / 2) + facing, variant()));
            take(i, j);
        }
    }
}
