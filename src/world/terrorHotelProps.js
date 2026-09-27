import { CHUNK_SIZE, DOOR_WIDTH, WALL_THICKNESS } from '../config.js';
import {
    PROP_BOTTLES,
    PROP_BOXES,
    PROP_BUCKET,
    PROP_CART,
    PROP_PALM,
    PROP_SHELF,
    PROP_SUITCASE,
    PROP_TROLLEY,
    makeProp,
} from './decorations.js';
import { DIRECTIONS, EDGE_WALL } from './grid.js';
import {
    CELL_BALLROOM,
    CELL_CORRIDOR,
    CELL_GALLERY,
    CELL_HALL,
    CELL_ROOM,
    CELL_STAFF,
    CELL_TAKEN,
    CELL_X_CORRIDOR,
    CELL_Z_CORRIDOR,
    DOOR_BALLROOM,
    DOOR_GUEST,
} from './terrorHotel.js';
import { ZONE_LOBBY, ZONE_STAFF } from './zones.js';

/*
 * What's been left about in Level 5 (see decorations.js for Level 0's, and props.js for what they look like): palms
 * either side of the doors down the promenade, by the lobbies' columns and against their walls; a tray outside a door
 * with the cloche still on, or someone's cases; a room-service trolley, a luggage cart; in the guest rooms, luggage
 * nobody unpacked. In the staff passages, what the staff use. Every prop keeps inside its cell and never blocks a way
 * through: it's against a wall, or in front of a door that doesn't open.
 */

const N = CHUNK_SIZE;
const FACE = 0.5 - WALL_THICKNESS / 2;
// How far along a wall from a door's middle a palm beside it stands: clear of its casing.
const BESIDE_DOOR = DOOR_WIDTH / 2 + 0.17;
// How far a palm's middle is from the wall it stands against, and from a column's corner (clear of its base).
const PALM_OUT = FACE - 0.085;
const PALM_BY_COLUMN = 0.24;

/**
 * Chooses a chunk's props.
 * @param {() => number} random The chunk's random stream.
 * @param {import('./generator.js').Layout} layout
 * @param {Uint8Array} kinds What each cell is (see TerrorHotelData.kinds).
 * @param {import('./terrorHotel.js').HotelDoor[]} doors
 * @param {number} x0 World coordinates of the chunk's first cell.
 * @param {number} z0
 * @param {number} zone The chunk's zone type.
 * @param {(x: number, z: number) => boolean} avoid Cells to leave empty (round where you start).
 * @returns {import('./decorations.js').Prop[]}
 */
export function placeTerrorHotelProps(random, layout, kinds, doors, x0, z0, zone, avoid) {
    /** @type {import('./decorations.js').Prop[]} */
    const props = [];
    const variant = () => (random() * 4294967296) >>> 0;
    const taken = new Uint8Array(N * N);
    // The door in the wall on side (di, dj) of cell (x, z), if there's one.
    const doorAt = (x, z, di, dj) => {
        const [ex, ez, axis] = di !== 0 ? [di > 0 ? x : x - 1, z, 0] : [x, dj > 0 ? z : z - 1, 1];
        return doors.find((door) => door.x === ex && door.z === ez && door.axis === axis) ?? null;
    };
    // Up against the wall on side (di, dj), `along` it from the middle, `out` from the middle towards it, facing away.
    const against = (type, x, z, [di, dj], along, out, v = variant()) => makeProp(
        type,
        x + di * out + (di === 0 ? along : 0),
        z + dj * out + (dj === 0 ? along : 0),
        Math.atan2(-di, -dj) + (random() - 0.5) * 0.2,
        v,
    );
    const palmsBeside = (x, z, wall, chance) => {
        for (const side of [-1, 1]) if (random() < chance) props.push(against(PROP_PALM, x, z, wall, side * BESIDE_DOOR, PALM_OUT));
    };
    const pick = (list) => list[Math.floor(random() * list.length)];

    // In a lobby, first a palm in a corner by some of the columns, diagonally off it.
    if (zone === ZONE_LOBBY) {
        for (let i = 1; i < N; i++) {
            for (let j = 1; j < N; j++) {
                if (!layout.getPillar(i, j) || random() >= 0.3) continue;
                const [ci, cj] = pick([[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]);
                const cell = ci * N + cj;
                if (!(kinds[cell] & CELL_HALL) || kinds[cell] & CELL_TAKEN || taken[cell] || avoid(x0 + ci, z0 + cj)) continue;
                // (The column's corner is on the cell's +x side if the cell is before it.)
                const sx = ci < i ? 1 : -1;
                const sz = cj < j ? 1 : -1;
                const offset = 0.5 - PALM_BY_COLUMN;
                props.push(makeProp(PROP_PALM, x0 + ci + sx * offset, z0 + cj + sz * offset, random() * Math.PI * 2, variant()));
                taken[cell] = 1;
            }
        }
    }

    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cell = i * N + j;
            const kind = kinds[cell];
            const x = x0 + i;
            const z = z0 + j;
            if (kind & CELL_TAKEN || taken[cell]) continue;
            const walls = DIRECTIONS.filter(([di, dj]) => layout.between(i, j, di, dj) === EDGE_WALL);
            const bare = walls.filter(([di, dj]) => !doorAt(x, z, di, dj));
            if (kind & CELL_GALLERY) {
                // Palms either side of every door down the promenade.
                for (const wall of walls) if (wall[0] !== 0 && doorAt(x, z, ...wall)?.kind === DOOR_GUEST) palmsBeside(x, z, wall, 0.85);
                continue;
            }
            if (avoid(x, z)) continue;
            if (kind & CELL_CORRIDOR) {
                const run = kind & (CELL_X_CORRIDOR | CELL_Z_CORRIDOR);
                if (run === (CELL_X_CORRIDOR | CELL_Z_CORRIDOR) || walls.length === 0) continue;
                const roll = random();
                if (zone === ZONE_STAFF) {
                    if (bare.length > 0 && roll < 0.03) props.push(against(PROP_BUCKET, x, z, pick(bare), (random() - 0.5) * 0.4, 0.23));
                    else if (bare.length > 0 && roll < 0.05) props.push(against(PROP_BOXES, x, z, pick(bare), (random() - 0.5) * 0.3, 0.23));
                    continue;
                }
                // Outside a door: a tray, someone's cases, a trolley. At the end of a corridor, a palm or a cart.
                const doorWalls = walls.filter((wall) => doorAt(x, z, ...wall)?.kind === DOOR_GUEST);
                const endWalls = bare.filter(([di, dj]) => (run === CELL_X_CORRIDOR ? di !== 0 : dj !== 0));
                if (doorWalls.length > 0 && roll < 0.035) {
                    props.push(against(PROP_TROLLEY, x, z, pick(doorWalls), (random() - 0.5) * 0.1, FACE - 0.09, variant() & ~1));
                } else if (doorWalls.length > 0 && roll < 0.05) {
                    props.push(against(PROP_SUITCASE, x, z, pick(doorWalls), (random() - 0.5) * 0.1, FACE - 0.12));
                } else if (doorWalls.length > 0 && roll < 0.058) {
                    props.push(against(PROP_TROLLEY, x, z, pick(doorWalls), (random() - 0.5) * 0.06, FACE - 0.14, variant() | 1));
                } else if (endWalls.length > 0 && roll < 0.4) {
                    if (random() < 0.7) props.push(against(PROP_PALM, x, z, endWalls[0], (random() < 0.5 ? -1 : 1) * 0.3, PALM_OUT));
                    else props.push(against(PROP_CART, x, z, endWalls[0], 0, FACE - 0.13));
                }
                continue;
            }
            if (kind & CELL_ROOM) {
                // Luggage nobody unpacked.
                if (bare.length > 0 && random() < 0.12) props.push(against(PROP_SUITCASE, x, z, pick(bare), (random() - 0.5) * 0.3, FACE - 0.1));
                continue;
            }
            if (kind & CELL_STAFF) {
                if (bare.length === 0) continue;
                const roll = random();
                const wall = pick(bare);
                if (roll < 0.05) props.push(makeProp(PROP_SHELF, x + wall[0] * 0.378, z + wall[1] * 0.378, Math.atan2(-wall[0], -wall[1]), variant()));
                else if (roll < 0.08) props.push(against(PROP_BUCKET, x, z, wall, (random() - 0.5) * 0.4, 0.23));
                else if (roll < 0.1) props.push(against(PROP_BOXES, x, z, wall, (random() - 0.5) * 0.3, 0.23));
                else if (roll < 0.115) props.push(against(PROP_BOTTLES, x, z, wall, (random() - 0.5) * 0.4, 0.23));
                continue;
            }
            if (kind & CELL_HALL) {
                // Palms either side of some of the doors round a lobby (and the lifts); a luggage cart, cases.
                for (const wall of walls) if (doorAt(x, z, ...wall)) palmsBeside(x, z, wall, 0.35);
                const roll = random();
                if (bare.length > 0 && roll < 0.03) props.push(against(PROP_CART, x, z, pick(bare), (random() - 0.5) * 0.2, FACE - 0.13));
                else if (bare.length > 0 && roll < 0.06) props.push(against(PROP_SUITCASE, x, z, pick(bare), (random() - 0.5) * 0.3, FACE - 0.1));
                continue;
            }
            if (kind & CELL_BALLROOM) {
                for (const wall of walls) if (doorAt(x, z, ...wall)?.kind === DOOR_BALLROOM) palmsBeside(x, z, wall, 0.12);
            }
        }
    }
    return props;
}
