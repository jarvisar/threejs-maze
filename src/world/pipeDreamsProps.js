import { CHUNK_SIZE } from '../config.js';
import {
    PROP_BARREL,
    PROP_BOTTLES,
    PROP_BOXES,
    PROP_BUCKET,
    PROP_CHAIR,
    PROP_CRATES,
    PROP_CYLINDERS,
    PROP_SHELF,
    PROP_SIGN,
    PROP_TOOLBOX,
    makeProp,
} from './decorations.js';
import { DIRECTIONS, EDGE_NONE, EDGE_WALL } from './grid.js';
import { CELL_HALL, CELL_MACHINE, CELL_MAZE, CELL_ROOM, CELL_TUNNEL } from './pipeDreams.js';
import { propFootprint } from './props.js';
import { ZONE_STEAM } from './zones.js';

/*
 * What's been left about in Level 2 (see decorations.js for Level 0's, and props.js for what they look like): the store
 * rooms have steel shelving along their walls with whatever was put away on it (now and then an old computer); the
 * tunnels have toolboxes, buckets, gas cylinders and drums left against the walls, as if someone was working here and
 * went; the plant halls, the gas and the drums. Every prop keeps inside its cell and against a wall, so it never
 * blocks a tunnel.
 */

const N = CHUNK_SIZE;
// How far a shelf stands from the middle of its cell, to have its back to the wall; and anything else.
const SHELF_OUT = 0.378;
const AGAINST_WALL = 0.24;
// How far out from the middle of a wall the pipes low along it reach (track 0's and its flanges, and a tunnel's ledge:
// see pipeDreams.js), which anything left against it keeps clear of.
const LOW_PIPES = 0.152;

/**
 * Chooses a chunk's props.
 * @param {() => number} random The chunk's random stream.
 * @param {(i: number, j: number, di: number, dj: number) => number} edgeBetween
 * @param {Uint8Array} kinds What each cell is (see PipeDreamsData.kinds).
 * @param {number} x0 World coordinates of the chunk's first cell.
 * @param {number} z0
 * @param {number} zone The chunk's zone type.
 * @param {(x: number, z: number) => boolean} avoid Cells to leave empty (where you start).
 * @returns {import('./decorations.js').Prop[]}
 */
export function placePipeDreamsProps(random, edgeBetween, kinds, x0, z0, zone, avoid) {
    /** @type {import('./decorations.js').Prop[]} */
    const props = [];
    const variant = () => (random() * 4294967296) >>> 0;
    const steam = zone === ZONE_STEAM;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const kind = kinds[i * N + j];
            const x = x0 + i;
            const z = z0 + j;
            if (kind & CELL_MACHINE || avoid(x, z)) continue;
            const walls = DIRECTIONS.filter(([di, dj]) => edgeBetween(i, j, di, dj) === EDGE_WALL);
            if (walls.length === 0) continue;
            const [di, dj] = walls[Math.floor(random() * walls.length)];
            const yaw = Math.atan2(-di, -dj);
            const against = (type, out = AGAINST_WALL, turn = 0.3) => {
                const along = (random() - 0.5) * 0.36;
                // (A chair on its feet: on its side it takes up most of a cell; see props.js.)
                const v = type === PROP_CHAIR ? (variant() | 1) >>> 0 : variant();
                const prop = makeProp(type, x + di * out + (di === 0 ? along : 0), z + dj * out + (dj === 0 ? along : 0), yaw + (random() - 0.5) * turn, v);
                if (kind & CELL_ROOM) {
                    props.push(prop);
                    return;
                }
                // Anywhere but a store room there can be pipes along the foot of the walls round it: moved clear of them.
                const [minX, minZ, maxX, maxZ] = propFootprint(prop);
                let mx = 0;
                let mz = 0;
                for (const [wi, wj] of DIRECTIONS) {
                    if (edgeBetween(i, j, wi, wj) === EDGE_NONE) continue;
                    if (wi !== 0) mx = wi > 0 ? Math.min(mx, x + 0.5 - LOW_PIPES - maxX) : Math.max(mx, x - 0.5 + LOW_PIPES - minX);
                    else mz = wj > 0 ? Math.min(mz, z + 0.5 - LOW_PIPES - maxZ) : Math.max(mz, z - 0.5 + LOW_PIPES - minZ);
                }
                props.push(mx === 0 && mz === 0 ? prop : makeProp(type, prop.x + mx, prop.z + mz, prop.yaw, v));
            };
            const roll = random();
            if (kind & CELL_ROOM) {
                if (roll < 0.09) {
                    // Shelving, square to the wall.
                    props.push(makeProp(PROP_SHELF, x + di * SHELF_OUT, z + dj * SHELF_OUT, yaw, variant()));
                } else if (roll < 0.12) against(PROP_BOXES);
                else if (roll < 0.135) against(PROP_CRATES);
                else if (roll < 0.15) against(PROP_BUCKET);
                else if (roll < 0.16) against(PROP_CYLINDERS);
                else if (roll < 0.166) against(PROP_CHAIR, 0.22, 0.6);
            } else if (kind & CELL_TUNNEL) {
                if (roll >= (steam ? 0.035 : 0.055)) continue;
                const type = random();
                if (type < 0.24) against(PROP_TOOLBOX);
                else if (type < 0.46) against(PROP_BUCKET);
                else if (type < 0.6) against(PROP_CYLINDERS, 0.25, 0.15);
                else if (type < 0.74) against(PROP_BARREL);
                else if (type < 0.84) against(PROP_BOXES);
                else if (type < 0.94) against(PROP_BOTTLES);
                else against(PROP_SIGN);
            } else if (kind & CELL_HALL) {
                if (roll >= 0.06) continue;
                const type = random();
                if (type < 0.35) against(PROP_CYLINDERS, 0.25, 0.15);
                else if (type < 0.6) against(PROP_BARREL);
                else if (type < 0.8) against(PROP_TOOLBOX);
                else against(PROP_BUCKET);
            } else if (kind & CELL_MAZE) {
                if (roll >= 0.03) continue;
                const type = random();
                if (type < 0.4) against(PROP_BUCKET);
                else if (type < 0.7) against(PROP_BOTTLES);
                else against(PROP_BARREL);
            }
        }
    }
    return props;
}
