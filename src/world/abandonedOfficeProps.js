import { CHUNK_SIZE, WALL_THICKNESS } from '../config.js';
import {
    CELL_TAKEN,
    CELL_WELL,
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
import { PROP_BIN, PROP_BOTTLES, PROP_BOXES, PROP_COOLER, PROP_FICUS, PROP_FILES, PROP_MONITOR, makeProp } from './decorations.js';
import { DIRECTIONS, EDGE_NONE, EDGE_WALL } from './grid.js';

/*
 * What's been left about in Level 4 (see decorations.js for Level 0's, and props.js for what they look like): water
 * coolers, one by every kitchen and some out on the floors; plants in the corners, most of them dying; bins; files and
 * archive boxes on the floor where someone was clearing out, and never finished; a computer on the floor; the odd bottle
 * of almond water. Every prop keeps inside its cell and against a wall (or a column), clear of the doorways and the
 * windows, so nothing's ever in the way.
 */

const N = CHUNK_SIZE;
const FACE = 0.5 - WALL_THICKNESS / 2;

/**
 * Chooses a chunk's props.
 * @param {() => number} random The chunk's random stream.
 * @param {import('./generator.js').Layout} layout
 * @param {Uint8Array} kinds What each cell is (see AbandonedOfficeData.kinds).
 * @param {Int16Array} rooms
 * @param {number[]} regions
 * @param {Uint8Array} windows
 * @param {import('./abandonedOffice.js').OfficeDoor[]} doors
 * @param {number} x0 World coordinates of the chunk's first cell.
 * @param {number} z0
 * @param {number} _zone The chunk's zone type.
 * @param {(x: number, z: number) => boolean} avoid Cells to leave empty (round where you start).
 * @returns {import('./decorations.js').Prop[]}
 */
export function placeAbandonedOfficeProps(random, layout, kinds, rooms, regions, windows, doors, x0, z0, _zone, avoid) {
    /** @type {import('./decorations.js').Prop[]} */
    const props = [];
    const variant = () => (random() * 4294967296) >>> 0;
    const used = new Uint8Array(N * N);
    const inChunk = (i, j) => i >= 0 && j >= 0 && i < N && j < N;
    // The wall on side (di, dj) of cell (i, j), if it's a plain one: no window in it, no door that doesn't open.
    const plainWall = (i, j, di, dj) => {
        if (layout.between(i, j, di, dj) !== EDGE_WALL) return false;
        const ni = i + di;
        const nj = j + dj;
        if (inChunk(ni, nj) && kinds[ni * N + nj] & CELL_WELL) return false;
        if (di === 1 && windows[i * N + j] & 1) return false;
        if (dj === 1 && windows[i * N + j] & 2) return false;
        if (di === -1 && inChunk(ni, nj) && windows[ni * N + nj] & 1) return false;
        if (dj === -1 && inChunk(ni, nj) && windows[ni * N + nj] & 2) return false;
        const x = x0 + i;
        const z = z0 + j;
        const [ex, ez, axis] = di !== 0 ? [di > 0 ? x : x - 1, z, 0] : [x, dj > 0 ? z : z - 1, 1];
        return !doors.some((door) => door.x === ex && door.z === ez && door.axis === axis);
    };
    // A cell something can go in: not taken, not a way through (a doorway, an opening into the next room or chunk).
    const free = (i, j) => {
        if (!inChunk(i, j)) return false;
        const cell = i * N + j;
        if (kinds[cell] & (CELL_TAKEN | CELL_WELL) || used[cell] || avoid(x0 + i, z0 + j)) return false;
        for (const [di, dj] of DIRECTIONS) {
            const edge = layout.between(i, j, di, dj);
            if (edge === EDGE_WALL) continue;
            const ni = i + di;
            const nj = j + dj;
            if (edge !== EDGE_NONE || !inChunk(ni, nj) || rooms[ni * N + nj] !== rooms[cell]) return false;
        }
        return true;
    };
    // Up against the wall on side (di, dj), `along` it from the middle, `out` from the middle towards it, facing away.
    const against = (type, i, j, [di, dj], along, out, v = variant()) => {
        used[i * N + j] = 1;
        props.push(makeProp(
            type,
            x0 + i + di * out + (di === 0 ? along : 0),
            z0 + j + dj * out + (dj === 0 ? along : 0),
            Math.atan2(-di, -dj) + (random() - 0.5) * 0.3,
            v,
        ));
    };
    // In a corner of the cell, between the walls on sides a and b.
    const inCorner = (type, i, j, [ai, aj], [bi, bj], out) => {
        used[i * N + j] = 1;
        props.push(makeProp(type, x0 + i + (ai + bi) * out, z0 + j + (aj + bj) * out, random() * Math.PI * 2, variant()));
    };
    const wallsOf = (i, j) => DIRECTIONS.filter(([di, dj]) => plainWall(i, j, di, dj));
    const pick = (list) => list[Math.floor(random() * list.length)];

    /** @type {number[][]} */
    const cellsOf = regions.map(() => []);
    for (let cell = 0; cell < N * N; cell++) if (rooms[cell] >= 0) cellsOf[rooms[cell]].push(cell);
    for (let r = 0; r < regions.length; r++) {
        const region = regions[r];
        const cells = cellsOf[r];
        // How many of each, per cell of the region.
        let cooler = 0;
        let plant = 0;
        let bin = 0;
        let files = 0;
        let other = 0;
        switch (region) {
            case REGION_KITCHEN:
                cooler = 0.25;
                bin = 0.15;
                plant = 0.05;
                break;
            case REGION_OFFICE:
                plant = 0.12;
                bin = 0.2;
                files = 0.2;
                break;
            case REGION_MEETING:
                plant = 0.08;
                bin = 0.04;
                break;
            case REGION_OPEN:
            case REGION_BULLPEN:
                cooler = 0.012;
                plant = 0.03;
                bin = 0.02;
                files = 0.025;
                other = 0.012;
                break;
            case REGION_CORRIDOR:
                plant = 0.02;
                bin = 0.02;
                break;
            case REGION_LOBBY:
                plant = 0.06;
                cooler = 0.03;
                bin = 0.03;
                break;
            case REGION_COPY:
                files = 0.3;
                bin = 0.15;
                break;
            case REGION_STORE:
                files = 0.3;
                other = 0.25;
                break;
            default:
        }
        const count = (rate) => Math.floor(cells.length * rate + random());
        const spots = (wanted, fn) => {
            for (let n = 0, attempt = 0; n < wanted && attempt < wanted * 8; attempt++) {
                const cell = pick(cells);
                const i = Math.floor(cell / N);
                const j = cell % N;
                if (!free(i, j)) continue;
                const walls = wallsOf(i, j);
                if (walls.length === 0) continue;
                if (fn(i, j, walls)) n++;
            }
        };
        // A water cooler, its back to a wall.
        spots(count(cooler), (i, j, walls) => {
            against(PROP_COOLER, i, j, pick(walls), (random() - 0.5) * 0.4, FACE - 0.08);
            return true;
        });
        // Plants in the corners (or against a wall).
        spots(count(plant), (i, j, walls) => {
            if (walls.length >= 2) {
                const a = walls[0];
                const b = walls.find(([di, dj]) => di !== a[0] && dj !== a[1]);
                if (b) {
                    inCorner(PROP_FICUS, i, j, a, b, FACE - 0.1);
                    return true;
                }
            }
            against(PROP_FICUS, i, j, pick(walls), (random() - 0.5) * 0.5, FACE - 0.1);
            return true;
        });
        // Bins, against a wall.
        spots(count(bin), (i, j, walls) => {
            against(PROP_BIN, i, j, pick(walls), (random() - 0.5) * 0.6, FACE - 0.08);
            return true;
        });
        // Files and archive boxes, against a wall.
        spots(count(files), (i, j, walls) => {
            against(PROP_FILES, i, j, pick(walls), (random() - 0.5) * 0.3, FACE - 0.1);
            return true;
        });
        // And now and then something else: moving boxes, a computer on the floor, a bottle or two.
        spots(count(other), (i, j, walls) => {
            const roll = random();
            const type = region === REGION_STORE || roll < 0.45 ? PROP_BOXES : roll < 0.75 ? PROP_MONITOR : PROP_BOTTLES;
            against(type, i, j, pick(walls), (random() - 0.5) * 0.4, FACE - 0.16);
            return true;
        });
    }
    return props;
}
