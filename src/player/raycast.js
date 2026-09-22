import { PILLAR_SIZE, WALL_HEIGHT } from '../config.js';
import { EDGE_NONE, edgeSolidAt } from '../world/grid.js';

const HALF_PILLAR = PILLAR_SIZE / 2;

/**
 * @typedef {object} WorldHit
 * @property {'edge' | 'pillar' | 'floor' | 'ceiling'} kind
 * @property {number} x Cell owning the edge or pillar corner, or the cell under the hit point.
 * @property {number} z
 * @property {0 | 1} [axis] For edges (see grid.js).
 * @property {number} distance
 * @property {[number, number, number]} point Where the ray hit.
 */

/**
 * @typedef {object} WorldQuery
 * @property {(x: number, z: number, axis: 0 | 1) => number} edge
 * @property {(x: number, z: number) => boolean} pillar
 */

/**
 * Casts a ray through the level: thin walls on cell borders (treated as having no thickness, which is
 * plenty for aiming at them), doorway openings, pillars, the floor (y = 0) and the ceiling (y = WALL_HEIGHT,
 * only from below). Steps through the grid cell by cell (a 2D DDA), so the cost depends only on the
 * distance travelled, not on how much is in the world.
 *
 * @param {number} ox Ray origin
 * @param {number} oy
 * @param {number} oz
 * @param {number} dx Normalized ray direction
 * @param {number} dy
 * @param {number} dz
 * @param {number} maxDistance
 * @param {WorldQuery} world
 * @returns {WorldHit | null}
 */
export function raycastWorld(ox, oy, oz, dx, dy, dz, maxDistance, world) {
    const tFloor = dy < 0 && oy > 0 ? -oy / dy : Infinity;
    const tCeiling = dy > 0 && oy < WALL_HEIGHT ? (WALL_HEIGHT - oy) / dy : Infinity;
    const tPlane = Math.min(tFloor, tCeiling);
    const limit = Math.min(maxDistance, tPlane);
    const at = (t) => /** @type {[number, number, number]} */ ([ox + dx * t, oy + dy * t, oz + dz * t]);

    let cellX = Math.floor(ox + 0.5);
    let cellZ = Math.floor(oz + 0.5);
    const stepX = Math.sign(dx);
    const stepZ = Math.sign(dz);
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx > 0 ? (cellX + 0.5 - ox) / dx : dx < 0 ? (cellX - 0.5 - ox) / dx : Infinity;
    let tMaxZ = dz > 0 ? (cellZ + 0.5 - oz) / dz : dz < 0 ? (cellZ - 0.5 - oz) / dz : Infinity;
    let tEnter = 0;

    for (let guard = 0; guard < 1024; guard++) {
        const tExit = Math.min(tMaxX, tMaxZ);

        // Pillars stand on the cell's corners and poke into it.
        for (let px = cellX - 1; px <= cellX; px++) {
            for (let pz = cellZ - 1; pz <= cellZ; pz++) {
                if (!world.pillar(px, pz)) continue;
                const t = rayBox(ox, oy, oz, dx, dy, dz, px + 0.5, pz + 0.5);
                if (t >= tEnter - 1e-9 && t <= tExit && t <= limit) {
                    return { kind: 'pillar', x: px, z: pz, distance: t, point: at(t) };
                }
            }
        }

        if (tExit > limit) break;

        if (tMaxX < tMaxZ) {
            const owner = stepX > 0 ? cellX : cellX - 1;
            const t = tMaxX;
            const type = world.edge(owner, cellZ, 0);
            if (type !== EDGE_NONE && edgeSolidAt(type, oz + dz * t - cellZ, oy + dy * t)) {
                return { kind: 'edge', x: owner, z: cellZ, axis: 0, distance: t, point: at(t) };
            }
            cellX += stepX;
            tEnter = t;
            tMaxX += tDeltaX;
        } else {
            const owner = stepZ > 0 ? cellZ : cellZ - 1;
            const t = tMaxZ;
            const type = world.edge(cellX, owner, 1);
            if (type !== EDGE_NONE && edgeSolidAt(type, ox + dx * t - cellX, oy + dy * t)) {
                return { kind: 'edge', x: cellX, z: owner, axis: 1, distance: t, point: at(t) };
            }
            cellZ += stepZ;
            tEnter = t;
            tMaxZ += tDeltaZ;
        }
    }

    if (tPlane <= maxDistance) {
        const point = at(tPlane);
        return {
            kind: tPlane === tFloor ? 'floor' : 'ceiling',
            x: Math.floor(point[0] + 0.5),
            z: Math.floor(point[2] + 0.5),
            distance: tPlane,
            point,
        };
    }

    return null;
}

/** Entry distance of the ray into a pillar's box (Infinity if it misses). Slab method. */
function rayBox(ox, oy, oz, dx, dy, dz, cx, cz) {
    let tNear = -Infinity;
    let tFar = Infinity;
    for (const [o, d, min, max] of [
        [ox, dx, cx - HALF_PILLAR, cx + HALF_PILLAR],
        [oy, dy, 0, WALL_HEIGHT],
        [oz, dz, cz - HALF_PILLAR, cz + HALF_PILLAR],
    ]) {
        if (d === 0) {
            if (o < min || o > max) return Infinity;
            continue;
        }
        let t0 = (min - o) / d;
        let t1 = (max - o) / d;
        if (t0 > t1) [t0, t1] = [t1, t0];
        tNear = Math.max(tNear, t0);
        tFar = Math.min(tFar, t1);
    }
    return tNear <= tFar && tFar >= 0 ? Math.max(tNear, 0) : Infinity;
}
