import { CHUNK_SIZE, DOOR_WIDTH } from '../config.js';
import {
    PALM_BACK,
    PALM_WALL,
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
import { DIRECTIONS, EDGE_NONE, EDGE_WALL } from './grid.js';
import { propFootprint } from './props.js';
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
    DOOR_AJAR,
    DOOR_BALLROOM,
    DOOR_ELEVATOR,
    DOOR_GUEST,
    SCONCE_WALLS,
} from './terrorHotel.js';
import { FACE, FURN_RUG, WALL_CLEAR, furnitureHalf } from './terrorHotelFurniture.js';
import { ZONE_LOBBY, ZONE_STAFF } from './zones.js';

/*
 * Level 5 props: palms, room service trays and trolleys, suitcases, luggage carts, and staff supplies. Level 0's are in
 * decorations.js, the models in props.js.
 *
 * No prop blocks a path. Each one goes against a wall or in front of a locked door, and stays inside its cell and clear
 * of mouldings, furniture and other props. Palm fronds are the exception and can reach over neighbors.
 */

const N = CHUNK_SIZE;
// Palm offset along the wall from a door's middle. Keeps the pot clear of the casing (see casing and lift in
// terrorHotelGeometry.js) and the fronds (palm in props.js) short of the doorway.
const BESIDE_DOOR = DOOR_WIDTH / 2 + 0.14;
// cell middle to a wall palm, pot just clear of the skirting
const PALM_OUT = FACE - WALL_CLEAR - PALM_BACK;
// offset each way from a column's corner so the pot clears the column base
const PALM_BY_COLUMN = 0.24;

/**
 * Chooses a chunk's props.
 * @param {() => number} random The chunk's random stream.
 * @param {import('./generator.js').Layout} layout
 * @param {Uint8Array} kinds What each cell is (see TerrorHotelData.kinds).
 * @param {Uint8Array} sconces Each cell's sconces (see TerrorHotelData.sconces).
 * @param {import('./terrorHotel.js').HotelDoor[]} doors
 * @param {import('./terrorHotelFurniture.js').Furniture[]} furniture
 * @param {number} x0 World coordinates of the chunk's first cell.
 * @param {number} z0
 * @param {number} zone The chunk's zone type.
 * @param {(x: number, z: number) => boolean} avoid Cells to leave empty (around the spawn).
 * @returns {import('./decorations.js').Prop[]}
 */
export function placeTerrorHotelProps(random, layout, kinds, sconces, doors, furniture, x0, z0, zone, avoid) {
    /** @type {import('./decorations.js').Prop[]} */
    const props = [];
    const variant = () => (random() * 4294967296) >>> 0;
    const taken = new Uint8Array(N * N);
    // Footprints taken so far as [minX, minZ, maxX, maxZ]. Furniture except rugs, then props as they're placed.
    const covered = [];
    for (const piece of furniture) {
        if (piece.type === FURN_RUG) continue;
        const [a, d] = furnitureHalf(piece);
        const [hx, hz] = piece.dx !== 0 ? [d, a] : [a, d];
        covered.push([piece.x - hx, piece.z - hz, piece.x + hx, piece.z + hz]);
    }
    // Adds the prop if its footprint is free. @returns {boolean}
    const put = (prop) => {
        const [minX, minZ, maxX, maxZ] = propFootprint(prop);
        if (covered.some(([a, b, c, d]) => minX < c && maxX > a && minZ < d && maxZ > b)) return false;
        covered.push([minX, minZ, maxX, maxZ]);
        props.push(prop);
        return true;
    };
    // door on side (di, dj) of cell (x, z), or null
    const doorAt = (x, z, di, dj) => {
        const [ex, ez, axis] = di !== 0 ? [di > 0 ? x : x - 1, z, 0] : [x, dj > 0 ? z : z - 1, 1];
        return doors.find((door) => door.x === ex && door.z === ez && door.axis === axis) ?? null;
    };
    // Prop against the wall on side (di, dj) of cell (x, z), facing out and turned up to `turn` off square. `along` is
    // the offset along the wall and `out` caps the distance toward it. Clamped to clear the mouldings and stay in the cell.
    const against = (type, x, z, [di, dj], along, v = variant(), out = Infinity, turn = 0.2) => {
        const yaw = Math.atan2(-di, -dj) + (random() - 0.5) * turn;
        const [minX, minZ, maxX, maxZ] = propFootprint(makeProp(type, 0, 0, yaw, v));
        const limit = FACE - WALL_CLEAR;
        // reach toward the wall and each way along it
        const back = di > 0 ? maxX : di < 0 ? -minX : dj > 0 ? maxZ : -minZ;
        const [low, high] = di !== 0 ? [minZ, maxZ] : [minX, maxX];
        const s = Math.min(Math.max(along, -limit - low), limit - high);
        const o = Math.min(out, limit - back);
        return makeProp(type, x + di * o + (di === 0 ? s : 0), z + dj * o + (dj === 0 ? s : 0), yaw, v);
    };
    // palm backed against the wall on side (di, dj), see PALM_WALL in decorations.js
    const palm = (x, z, [di, dj], along) => makeProp(
        PROP_PALM,
        x + di * PALM_OUT + (di === 0 ? along : 0),
        z + dj * PALM_OUT + (dj === 0 ? along : 0),
        Math.atan2(-di, -dj),
        (variant() | PALM_WALL) >>> 0,
    );
    // Palms either side of the door on side (di, dj) of local cell (i, j). Only where the fronds have an open
    // in-chunk cell to reach into, and never in front of a lift call button.
    const palmsBeside = (i, j, [di, dj], door, chance) => {
        const x = x0 + i;
        const z = z0 + j;
        // which side of the wall we're on, and which way the lift button is (see lift in terrorHotelGeometry.js)
        const side = -(di + dj);
        const button = door.kind === DOOR_ELEVATOR && door.front === side ? (door.axis === 0 ? -side : side) : 0;
        for (const e of [-1, 1]) {
            if (random() >= chance || e === button) continue;
            const [ai, aj] = di === 0 ? [e, 0] : [0, e];
            if (i + ai < 0 || j + aj < 0 || i + ai >= N || j + aj >= N || layout.between(i, j, ai, aj) !== EDGE_NONE) continue;
            put(palm(x, z, [di, dj], e * BESIDE_DOOR));
        }
    };
    const pick = (list) => list[Math.floor(random() * list.length)];

    // Lobbies: palms by some columns first, in a diagonal cell with their back to the column.
    if (zone === ZONE_LOBBY) {
        for (let i = 1; i < N; i++) {
            for (let j = 1; j < N; j++) {
                if (!layout.getPillar(i, j) || random() >= 0.3) continue;
                const [ci, cj] = pick([[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]);
                const cell = ci * N + cj;
                if (!(kinds[cell] & CELL_HALL) || kinds[cell] & CELL_TAKEN || taken[cell] || avoid(x0 + ci, z0 + cj)) continue;
                // column corner is on the cell's +x side if the cell comes before it
                const sx = ci < i ? 1 : -1;
                const sz = cj < j ? 1 : -1;
                const offset = 0.5 - PALM_BY_COLUMN;
                if (put(makeProp(PROP_PALM, x0 + ci + sx * offset, z0 + cj + sz * offset, Math.atan2(-sx, -sz), (variant() | PALM_WALL) >>> 0))) taken[cell] = 1;
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
            // nothing tall in front of a sconce
            const plain = bare.filter(([di, dj]) => !(sconces[cell] & SCONCE_WALLS.find(([a, b]) => a === di && b === dj)[2]));
            if (kind & CELL_GALLERY) {
                // palms beside every promenade door
                for (const wall of walls) {
                    const door = doorAt(x, z, ...wall);
                    if (wall[0] !== 0 && door?.kind === DOOR_GUEST) palmsBeside(i, j, wall, door, 0.85);
                }
                continue;
            }
            if (avoid(x, z)) continue;
            if (kind & CELL_CORRIDOR) {
                const run = kind & (CELL_X_CORRIDOR | CELL_Z_CORRIDOR);
                if (run === (CELL_X_CORRIDOR | CELL_Z_CORRIDOR) || walls.length === 0) continue;
                const roll = random();
                if (zone === ZONE_STAFF) {
                    if (bare.length > 0 && roll < 0.03) put(against(PROP_BUCKET, x, z, pick(bare), (random() - 0.5) * 0.4, variant(), 0.23));
                    else if (bare.length > 0 && roll < 0.05) put(against(PROP_BOXES, x, z, pick(bare), (random() - 0.5) * 0.3, variant(), 0.23));
                    continue;
                }
                // Tray, suitcase or trolley outside a door (not an ajar one, it would swing into them). Palm or cart
                // at a corridor's end.
                const doorWalls = walls.filter((wall) => {
                    const door = doorAt(x, z, ...wall);
                    return door?.kind === DOOR_GUEST && door.state !== DOOR_AJAR;
                });
                const endWalls = bare.filter(([di, dj]) => (run === CELL_X_CORRIDOR ? di !== 0 : dj !== 0));
                if (doorWalls.length > 0 && roll < 0.035) {
                    put(against(PROP_TROLLEY, x, z, pick(doorWalls), (random() - 0.5) * 0.1, variant() & ~1));
                } else if (doorWalls.length > 0 && roll < 0.05) {
                    put(against(PROP_SUITCASE, x, z, pick(doorWalls), (random() - 0.5) * 0.1));
                } else if (doorWalls.length > 0 && roll < 0.058) {
                    put(against(PROP_TROLLEY, x, z, pick(doorWalls), (random() - 0.5) * 0.06, variant() | 1));
                } else if (endWalls.length > 0 && roll < 0.4) {
                    // centered so the fronds clear anything on the side walls
                    if (random() < 0.7) put(palm(x, z, endWalls[0], 0));
                    else put(against(PROP_CART, x, z, endWalls[0], 0));
                }
                continue;
            }
            if (kind & CELL_ROOM) {
                // unpacked luggage
                if (bare.length > 0 && random() < 0.12) put(against(PROP_SUITCASE, x, z, pick(bare), (random() - 0.5) * 0.3));
                continue;
            }
            if (kind & CELL_STAFF) {
                if (bare.length === 0) continue;
                const roll = random();
                const wall = pick(bare);
                if (roll < 0.05) put(against(PROP_SHELF, x, z, wall, 0, variant(), Infinity, 0));
                else if (roll < 0.08) put(against(PROP_BUCKET, x, z, wall, (random() - 0.5) * 0.4, variant(), 0.23));
                else if (roll < 0.1) put(against(PROP_BOXES, x, z, wall, (random() - 0.5) * 0.3, variant(), 0.23));
                else if (roll < 0.115) put(against(PROP_BOTTLES, x, z, wall, (random() - 0.5) * 0.4, variant(), 0.23));
                continue;
            }
            if (kind & CELL_HALL) {
                // palms beside some lobby and lift doors, then maybe a luggage cart or suitcase
                for (const wall of walls) {
                    const door = doorAt(x, z, ...wall);
                    if (door) palmsBeside(i, j, wall, door, 0.35);
                }
                const roll = random();
                if (plain.length > 0 && roll < 0.03) put(against(PROP_CART, x, z, pick(plain), (random() - 0.5) * 0.2));
                else if (bare.length > 0 && roll < 0.06) put(against(PROP_SUITCASE, x, z, pick(bare), (random() - 0.5) * 0.3));
                continue;
            }
            if (kind & CELL_BALLROOM) {
                for (const wall of walls) {
                    const door = doorAt(x, z, ...wall);
                    if (door?.kind === DOOR_BALLROOM) palmsBeside(i, j, wall, door, 0.12);
                }
            }
        }
    }
    return props;
}
