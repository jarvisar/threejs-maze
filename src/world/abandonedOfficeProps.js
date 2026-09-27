import { CHUNK_SIZE, WALL_THICKNESS } from '../config.js';
import {
    CELL_TAKEN,
    CELL_WELL,
    CONVECTOR_DEPTH,
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
 * of almond water. Every prop keeps inside its cell and against a wall, clear of the doorways and the windows, so
 * nothing's ever in the way; and all of it, as it's drawn, keeps off the walls (see PROP_REACH).
 */

const N = CHUNK_SIZE;
const FACE = 0.5 - WALL_THICKNESS / 2;
/** Half a column's width (see OFFICE_COLUMN in levels.js), and a little over. */
const COLUMN_CLEAR = 0.115;

/**
 * How far each of the props here reaches, as it's drawn (see props.js), the most of any of its variants: half its width,
 * and how far it reaches behind and in front of where it stands, in its own frame. The plants and the bottles are
 * round (they're turned any way), so theirs is the same all round.
 */
export const PROP_REACH = new Map([
    [PROP_COOLER, [0.13, 0.065, 0.095]],
    [PROP_FICUS, [0.23, 0.23, 0.23]],
    [PROP_BIN, [0.135, 0.105, 0.105]],
    [PROP_FILES, [0.145, 0.095, 0.095]],
    [PROP_BOXES, [0.185, 0.115, 0.115]],
    [PROP_MONITOR, [0.08, 0.1, 0.065]],
    [PROP_BOTTLES, [0.14, 0.14, 0.14]],
]);
/** How far a prop against a wall is turned off square to it, either way, at most. */
const TURN = 0.15;
/** How far what's drawn keeps off a wall's face. */
const GAP = 0.005;

/**
 * Where a prop can stand against a wall (see PROP_REACH): how far out from the middle of its cell towards the wall, and
 * how far along it either way, at most, for what it reaches not to go into the wall or past the end of it, however it's
 * turned.
 * @param {number} type
 * @returns {[number, number]}
 */
export function propSpot(type) {
    const [half, behind, before] = PROP_REACH.get(type);
    // How far along the wall from the middle of the cell it may reach: clear of a window's heating in the wall across its
    // end, a column on the corner, a door's frame.
    const along = FACE - CONVECTOR_DEPTH;
    if (half === behind && half === before) return [FACE - half - GAP, Math.max(0, along - half)];
    const cos = Math.cos(TURN);
    const sin = Math.sin(TURN);
    return [FACE - (behind * cos + half * sin) - GAP, Math.max(0, along - (half * cos + Math.max(behind, before) * sin))];
}

/**
 * Chooses a chunk's props.
 * @param {() => number} random The chunk's random stream.
 * @param {import('./generator.js').Layout} layout
 * @param {Uint8Array} kinds What each cell is (see AbandonedOfficeData.kinds).
 * @param {Int16Array} rooms
 * @param {number[]} regions
 * @param {Uint8Array} windows
 * @param {import('./abandonedOffice.js').OfficeDoor[]} doors
 * @param {number[][]} solids The furniture's (see furnishOffice), to keep clear of.
 * @param {number} x0 World coordinates of the chunk's first cell.
 * @param {number} z0
 * @param {number} _zone The chunk's zone type.
 * @param {(x: number, z: number) => boolean} avoid Cells to leave empty (round where you start).
 * @param {(i: number, j: number) => boolean} outside Whether a cell just past the chunk's edge is outside a tape's walls
 *     (nothing's put against them).
 * @returns {import('./decorations.js').Prop[]}
 */
export function placeAbandonedOfficeProps(random, layout, kinds, rooms, regions, windows, doors, solids, x0, z0, _zone, avoid, outside) {
    /** @type {import('./decorations.js').Prop[]} */
    const props = [];
    const variant = () => (random() * 4294967296) >>> 0;
    const used = new Uint8Array(N * N);
    const inChunk = (i, j) => i >= 0 && j >= 0 && i < N && j < N;
    // The wall on side (di, dj) of cell (i, j), if it's a plain one: no window in it, no door that doesn't open, not a
    // tape's.
    const plainWall = (i, j, di, dj) => {
        if (layout.between(i, j, di, dj) !== EDGE_WALL) return false;
        const ni = i + di;
        const nj = j + dj;
        if (inChunk(ni, nj) ? kinds[ni * N + nj] & CELL_WELL : outside(ni, nj)) return false;
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
    // Whether a prop's clear of the furniture (a partition along the cell's edge, a machine next door), the columns on
    // the cell's corners and the props already down; and if it is, it's put down.
    const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const putDown = (prop, i, j) => {
        const box = prop.box;
        if (box) {
            if (solids.some((solid) => overlap(box, solid)) || props.some((other) => other.box && overlap(box, other.box))) return false;
            for (const [ci, cj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                if (!layout.getPillar(i + ci, j + cj)) continue;
                const [px, pz] = [x0 + i - 0.5 + ci, z0 + j - 0.5 + cj];
                if (overlap(box, [px - COLUMN_CLEAR, pz - COLUMN_CLEAR, px + COLUMN_CLEAR, pz + COLUMN_CLEAR])) return false;
            }
        }
        used[i * N + j] = 1;
        props.push(prop);
        return true;
    };
    // Up against the wall on side (di, dj), up to `spread` along it either way from the middle (less, if it would
    // reach past the end of the wall: see propSpot), facing away from it.
    const against = (type, i, j, [di, dj], spread) => {
        const [out, most] = propSpot(type);
        const along = (random() * 2 - 1) * Math.min(spread, most);
        const v = variant();
        return putDown(makeProp(
            type,
            x0 + i + di * out + (di === 0 ? along : 0),
            z0 + j + dj * out + (dj === 0 ? along : 0),
            Math.atan2(-di, -dj) + (random() * 2 - 1) * TURN,
            v,
        ), i, j);
    };
    // In a corner of the cell, between the walls on sides a and b.
    const inCorner = (type, i, j, [ai, aj], [bi, bj]) => {
        const [out] = propSpot(type);
        return putDown(makeProp(type, x0 + i + (ai + bi) * out, z0 + j + (aj + bj) * out, random() * Math.PI * 2, variant()), i, j);
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
        spots(count(cooler), (i, j, walls) => against(PROP_COOLER, i, j, pick(walls), 0.2));
        // Plants in the corners (or against a wall).
        spots(count(plant), (i, j, walls) => {
            if (walls.length >= 2) {
                const a = walls[0];
                const b = walls.find(([di, dj]) => di !== a[0] && dj !== a[1]);
                if (b) return inCorner(PROP_FICUS, i, j, a, b);
            }
            return against(PROP_FICUS, i, j, pick(walls), 0.25);
        });
        // Bins, against a wall.
        spots(count(bin), (i, j, walls) => against(PROP_BIN, i, j, pick(walls), 0.3));
        // Files and archive boxes, against a wall.
        spots(count(files), (i, j, walls) => against(PROP_FILES, i, j, pick(walls), 0.15));
        // And now and then something else: moving boxes, a computer on the floor, a bottle or two.
        spots(count(other), (i, j, walls) => {
            const roll = random();
            const type = region === REGION_STORE || roll < 0.45 ? PROP_BOXES : roll < 0.75 ? PROP_MONITOR : PROP_BOTTLES;
            return against(type, i, j, pick(walls), 0.2);
        });
    }
    return props;
}
