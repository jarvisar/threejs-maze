import { WALL_HEIGHT } from '../config.js';

/**
 * @typedef {object} GridHit
 * @property {'wall' | 'floor' | 'ceiling'} kind
 * @property {number} x Cell hit (for walls) or the cell under the hit point (for floor / ceiling).
 * @property {number} z
 * @property {number} distance
 * @property {[number, number, number]} normal Face normal at the hit point.
 */

/**
 * Casts a ray through the world: walls are unit cells spanning y ∈ [0, WALL_HEIGHT], plus the floor
 * (y = 0) and the ceiling (y = WALL_HEIGHT, only visible from below). Uses a 2D DDA over the XZ grid,
 * so the cost depends only on the distance travelled, not on how many walls exist.
 *
 * @param {number} ox Ray origin
 * @param {number} oy
 * @param {number} oz
 * @param {number} dx Normalized ray direction
 * @param {number} dy
 * @param {number} dz
 * @param {number} maxDistance
 * @param {(x: number, z: number) => boolean} isWall
 * @returns {GridHit | null}
 */
export function raycastGrid(ox, oy, oz, dx, dy, dz, maxDistance, isWall) {
    const tFloor = dy < 0 && oy > 0 ? -oy / dy : Infinity;
    const tCeiling = dy > 0 && oy < WALL_HEIGHT ? (WALL_HEIGHT - oy) / dy : Infinity;
    const tPlane = Math.min(tFloor, tCeiling);
    const limit = Math.min(maxDistance, tPlane);

    // Ray parameter range for which the ray is within the walls' vertical extent.
    let yMin = -Infinity;
    let yMax = Infinity;
    if (dy !== 0) {
        const a = -oy / dy;
        const b = (WALL_HEIGHT - oy) / dy;
        yMin = Math.min(a, b);
        yMax = Math.max(a, b);
    } else if (oy < 0 || oy > WALL_HEIGHT) {
        yMin = Infinity;
    }

    let cellX = Math.floor(ox + 0.5);
    let cellZ = Math.floor(oz + 0.5);
    const stepX = Math.sign(dx);
    const stepZ = Math.sign(dz);
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx > 0 ? (cellX + 0.5 - ox) / dx : dx < 0 ? (cellX - 0.5 - ox) / dx : Infinity;
    let tMaxZ = dz > 0 ? (cellZ + 0.5 - oz) / dz : dz < 0 ? (cellZ - 0.5 - oz) / dz : Infinity;
    let tEnter = 0;
    let enteredOn = null; // axis crossed to enter the current cell

    for (let guard = 0; guard < 1024; guard++) {
        const tExit = Math.min(tMaxX, tMaxZ);

        if (isWall(cellX, cellZ)) {
            const start = Math.max(tEnter, yMin);
            const end = Math.min(tExit, yMax);
            if (start <= end && start <= limit) {
                let normal;
                if (start > tEnter) normal = [0, dy < 0 ? 1 : -1, 0]; // came in through the top (or bottom)
                else if (enteredOn === 'x') normal = [-stepX, 0, 0];
                else if (enteredOn === 'z') normal = [0, 0, -stepZ];
                else normal = [0, 1, 0]; // ray starts inside the wall's column
                return { kind: 'wall', x: cellX, z: cellZ, distance: start, normal };
            }
        }

        if (tExit > limit) break;

        if (tMaxX < tMaxZ) {
            cellX += stepX;
            tEnter = tMaxX;
            tMaxX += tDeltaX;
            enteredOn = 'x';
        } else {
            cellZ += stepZ;
            tEnter = tMaxZ;
            tMaxZ += tDeltaZ;
            enteredOn = 'z';
        }
    }

    if (tPlane <= maxDistance) {
        const px = ox + dx * tPlane;
        const pz = oz + dz * tPlane;
        const floor = tPlane === tFloor;
        return {
            kind: floor ? 'floor' : 'ceiling',
            x: Math.floor(px + 0.5),
            z: Math.floor(pz + 0.5),
            distance: tPlane,
            normal: floor ? [0, 1, 0] : [0, -1, 0],
        };
    }

    return null;
}
