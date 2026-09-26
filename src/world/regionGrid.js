import { CHUNK_SIZE, DOOR_WIDTH, WALL_THICKNESS } from '../config.js';
import { EDGE_DOOR, EDGE_WALL } from './grid.js';

const HALF_THICKNESS = WALL_THICKNESS / 2;
const HALF_DOOR = DOOR_WIDTH / 2;

/*
 * Walls are meshed on a "region grid". Along each axis, every cell is cut into four intervals:
 *
 *   A: from the cell's low wall to the doorway        (r & 3 == 0)
 *   D: the width of a doorway, centred on the cell    (r & 3 == 1)
 *   B: from the doorway to the cell's high wall       (r & 3 == 2)
 *   W: the thickness of the wall on the high side     (r & 3 == 3)
 *
 * Every piece of wall is then a region of that grid: a W×W region is the post where edges meet, a W band
 * crossed with A/D/B is the body of an edge, and A/D/B × A/D/B is open floor. A region is solid or not
 * (per layer), and the wall surface is simply every boundary between a solid and an empty region, the same
 * way the old block maze was meshed, just on an uneven grid. Corners, wall ends, T-junctions and doorways
 * (including the sides and underside of their openings) all fall out of that without special cases.
 *
 * Region index r = 4k + interval, for cell k. Each chunk meshes the boundaries between regions r and r + 1
 * for the r in its own cells, so every face is built by exactly one chunk. (chunkGeometry.js builds the walls this
 * way, and Level 37's coves follow the same faces: see poolroomsCoves.js.)
 */
const INTERVAL_OFFSET = [-0.5 + HALF_THICKNESS, -HALF_DOOR, HALF_DOOR, 0.5 - HALF_THICKNESS];

/** World coordinate where region interval r starts. */
export function intervalStart(r) {
    return (r >> 2) + INTERVAL_OFFSET[r & 3];
}

/** A copy of the edges around one chunk, so meshing doesn't go through the store for every lookup. */
export class RegionGrid {
    constructor(store, x0, z0) {
        this.x0 = x0 - 2;
        this.z0 = z0 - 2;
        this.size = CHUNK_SIZE + 4;
        const count = this.size * this.size;
        this.edgesX = new Uint8Array(count);
        this.edgesZ = new Uint8Array(count);
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                this.edgesX[i * this.size + j] = store.edge(this.x0 + i, this.z0 + j, 0);
                this.edgesZ[i * this.size + j] = store.edge(this.x0 + i, this.z0 + j, 1);
            }
        }
    }

    ex(x, z) {
        return this.edgesX[(x - this.x0) * this.size + (z - this.z0)];
    }

    ez(x, z) {
        return this.edgesZ[(x - this.x0) * this.size + (z - this.z0)];
    }

    /** Whether region (rx, rz) is solid in the given layer (0 = below doorway height, 1 = above). */
    solid(layer, rx, rz) {
        const tx = rx & 3;
        const tz = rz & 3;
        if (tx !== 3 && tz !== 3) return false;
        const kx = rx >> 2;
        const kz = rz >> 2;
        if (tx === 3 && tz === 3) {
            return (this.ex(kx, kz) | this.ex(kx, kz + 1) | this.ez(kx, kz) | this.ez(kx + 1, kz)) !== 0;
        }
        const type = tx === 3 ? this.ex(kx, kz) : this.ez(kx, kz);
        const along = tx === 3 ? tz : tx;
        return type === EDGE_WALL || (type === EDGE_DOOR && (along !== 1 || layer === 1));
    }
}
