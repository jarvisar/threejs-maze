import { CHUNK_SIZE, HALF_CHUNK, WALL_HEIGHT } from '../config.js';
import { cellCoord } from './grid.js';
import { TILE } from './poolrooms.js';
import { RegionGrid, intervalStart } from './regionGrid.js';

/*
 * Where Level 37's walls meet the floor, the ceiling and each other, they meet in a curve, the way a pool is tiled: a
 * cove along the foot and the top of every wall and up every inside corner, wrapping round every corner where a wall
 * turns away. The walls themselves are every level's, square (chunkGeometry.js); the coves are laid in the corners in
 * front of them and tiled on from them, so the tiles run down a wall and round into the floor without a break.
 *
 * They follow the walls' faces on the same region grid (see regionGrid.js), so a face's coves are built by the chunk
 * that builds the face. Each face finishes its own half of every corner at its ends, and the face it meets there
 * finishes the other half.
 */

const N = CHUNK_SIZE;

/** How big the curve is: three tiles round. (The columns curve into the floor the same way: see poolroomsGeometry.js.) */
export const COVE_RADIUS = (3 * TILE) / (Math.PI / 2);
/** Steps round a cove's curve, and round each half of a corner (a step every 22.5°: at this size, round enough). */
export const COVE_STEPS = 4;
const CORNER_STEPS = 2;

// How a stretch of cove ends: carried on by the next chunk's, against a wall standing across it (an inside corner),
// where its wall turns away (an outside corner), or closed off where the floor in front of it changes height or turns
// into a stair.
const JOINED = 0;
const INSIDE = 1;
const OUTSIDE = 2;
const CLOSED = 3;

/** A point on a cove's curve (see curvePoint). */
const curve = { out: 0, rise: 0, normalOut: 0, normalUp: 0, round: 0 };

/**
 * Point `k` of COVE_STEPS round a cove's curve (of `radius`), from where it leaves the wall (0) to where it meets the
 * floor (COVE_STEPS), into `curve`: how far out from the wall it is and how far up from the floor, its normal (out from
 * the wall, and up), and how far round the curve it's come. (A ceiling's is the same, upside down.)
 * @param {number} k
 * @param {number} [radius]
 * @returns {typeof curve}
 */
export function curvePoint(k, radius = COVE_RADIUS) {
    const angle = (k / COVE_STEPS) * (Math.PI / 2);
    curve.out = radius * (1 - Math.cos(angle));
    curve.rise = radius * (1 - Math.sin(angle));
    curve.normalOut = Math.cos(angle);
    curve.normalUp = Math.sin(angle);
    curve.round = radius * angle;
    return curve;
}

/**
 * The coves along the walls of chunk (cx, cz), into `tiles`: at the foot of every face of wall (at the height of the
 * floor in front of it, but not in front of a stair), up the inside corners, and along the top.
 * @param {import('./GeometryBuilder.js').GeometryBuilder} tiles
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {number} cx
 * @param {number} cz
 */
export function buildCoves(tiles, store, cx, cz) {
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const grid = new RegionGrid(store, x0, z0);
    const first = [x0 * 4, z0 * 4];
    for (const axis of [0, 1]) {
        const along = first[1 - axis];
        for (let a = first[axis]; a < first[axis] + N * 4; a++) {
            for (const layer of [0, 1]) coveLine(tiles, store, grid, cx * N, cz * N, axis, a, along, along + N * 4, layer);
        }
    }
}

// The pieces of wall face along one line of the region grid (see coveLine): where each starts and ends along the line,
// its region, which way it faces (0: there's no face), and the height of the floor in front of it (NaN on a stair).
const MAX_PIECES = 2 * 4 * (N + 2);
const pieceFrom = new Float64Array(MAX_PIECES);
const pieceTo = new Float64Array(MAX_PIECES);
const pieceRegion = new Int32Array(MAX_PIECES);
const pieceFacing = new Int8Array(MAX_PIECES);
const pieceHeight = new Float64Array(MAX_PIECES);

/**
 * The coves along the faces on the line between regions `a` and `a + 1` across `axis` (0: the line runs along z), from
 * region b0 to b1 along it, in one layer: the foot of the walls (0) or their top (1). Pieces of face in a row, in front
 * of floor at one height, are one stretch of cove, finished at its ends by whatever it meets there.
 */
function coveLine(tiles, store, grid, ox, oz, axis, a, b0, b1, layer) {
    const solidAt = (ra, b) => (axis === 0 ? grid.solid(layer, ra, b) : grid.solid(layer, b, ra));
    const plane = intervalStart(a + 1);
    let count = 0;
    const addPiece = (from, to, region, facing) => {
        pieceFrom[count] = from;
        pieceTo[count] = to;
        pieceRegion[count] = region;
        pieceFacing[count] = facing;
        pieceHeight[count] = facing === 0 ? NaN : layer === 1 ? WALL_HEIGHT : floorInFront(store, axis, plane + facing * 0.01, (from + to) / 2);
        count++;
    };
    // The pieces of the chunk's own regions, and of the region either side, to see how the stretches reaching its
    // edges carry on.
    let first = 0;
    let end = 0;
    for (let b = b0 - 1; b <= b1; b++) {
        if (b === b0) first = count;
        if (b === b1) end = count;
        const low = solidAt(a, b);
        const facing = low === solidAt(a + 1, b) ? 0 : low ? 1 : -1;
        const from = intervalStart(b);
        const to = intervalStart(b + 1);
        // A wall's thickness straddles the line between two cells, whose floors can differ: a piece for each.
        if ((b & 3) === 3) {
            const between = (b >> 2) + 0.5;
            addPiece(from, between, b, facing);
            addPiece(between, to, b, facing);
        } else {
            addPiece(from, to, b, facing);
        }
    }
    const endOf = (p, q) => {
        if (pieceFacing[q] === pieceFacing[p]) return pieceHeight[q] === pieceHeight[p] ? JOINED : CLOSED;
        return solidAt(pieceFacing[p] > 0 ? a + 1 : a, pieceRegion[q]) ? INSIDE : OUTSIDE;
    };
    const originAcross = axis === 0 ? ox : oz;
    const originAlong = axis === 0 ? oz : ox;
    for (let p = first; p < end; p++) {
        if (pieceFacing[p] === 0 || Number.isNaN(pieceHeight[p])) continue;
        let q = p;
        while (q + 1 < end && pieceFacing[q + 1] === pieceFacing[p] && pieceHeight[q + 1] === pieceHeight[p]) q++;
        run.axis = axis;
        run.plane = plane - originAcross;
        run.normal = pieceFacing[p];
        run.right = axis === 0 ? -run.normal : run.normal;
        run.y = pieceHeight[p];
        run.up = layer === 0 ? 1 : -1;
        stretch(tiles, pieceFrom[p] - originAlong, pieceTo[q] - originAlong, endOf(p, p - 1), endOf(q, q + 1));
        p = q;
    }
}

/** The floor of the cell at `across` (x, or z) on a line across `axis`, and `along` it (NaN on a stair). */
function floorInFront(store, axis, across, along) {
    const x = cellCoord(axis === 0 ? across : along);
    const z = cellCoord(axis === 0 ? along : across);
    return store.flatFloor(x, z) ?? NaN;
}

// ---------------------------------------------------------------------------------------------- building

/**
 * The stretch of cove being built: along the face on the line x = plane (axis 0) or z = plane (axis 1), facing
 * `normal` (±1 across it), from the floor at y (up = 1) or the ceiling there (up = −1). Its tiles run on from the
 * wall's, whose texture coordinate along it goes `right` times the way along the line (see wallQuad in
 * chunkGeometry.js).
 */
const run = { axis: 0, plane: 0, normal: 1, right: 1, y: 0, up: 1 };

/** One stretch of cove from s0 to s1 along its line, and its two ends. */
function stretch(tiles, s0, s1, start, end) {
    // In an inside corner the straight part stops short, for the corner's own curve.
    const from = s0 + (start === INSIDE ? COVE_RADIUS : 0);
    const to = s1 - (end === INSIDE ? COVE_RADIUS : 0);
    if (to > from) {
        tiles.patch(COVE_STEPS, 1, (k, j, target) => {
            const point = curvePoint(k);
            const s = j === 0 ? from : to;
            place(target, point.out, s, coveY(point), point.normalOut, 0, run.up * point.normalUp, s * run.right, coveV(point));
        });
    }
    finish(tiles, start, s0, -1);
    finish(tiles, end, s1, 1);
}

/** The end of a stretch of cove at `s` along its line, the way `dir` along it (±1). */
function finish(tiles, kind, s, dir) {
    if (kind === INSIDE) {
        insideCorner(tiles, s, dir);
        if (run.up === 1) cornerUpright(tiles, s, dir);
    } else if (kind === OUTSIDE) {
        outsideCorner(tiles, s, dir);
    } else if (kind === CLOSED) {
        closeEnd(tiles, s, dir);
    }
}

/**
 * Half of the round corner where two stretches meet in an inside corner at `s` (a corner of a sphere, between the two
 * coves and the curve up the corner), from this stretch's end round to halfway.
 */
function insideCorner(tiles, s, dir) {
    const middle = s - dir * COVE_RADIUS;
    tiles.patch(COVE_STEPS, CORNER_STEPS, (k, m, target) => {
        const point = curvePoint(k);
        // How far this ring of the sphere is from the corner's upright axis.
        const ring = COVE_RADIUS - point.out;
        const turn = (m / CORNER_STEPS) * (Math.PI / 4);
        place(target, COVE_RADIUS - ring * Math.cos(turn), middle + dir * ring * Math.sin(turn), coveY(point),
            point.normalOut * Math.cos(turn), -dir * point.normalOut * Math.sin(turn), run.up * point.normalUp,
            (middle + dir * ring * turn) * run.right, coveV(point));
    });
}

/** Half of the curve up an inside corner at `s`, from the floor's cove to the ceiling's. */
function cornerUpright(tiles, s, dir) {
    const middle = s - dir * COVE_RADIUS;
    const y0 = run.y + COVE_RADIUS;
    const y1 = WALL_HEIGHT - COVE_RADIUS;
    if (y1 <= y0) return;
    tiles.patch(CORNER_STEPS, 1, (m, j, target) => {
        const turn = (m / CORNER_STEPS) * (Math.PI / 4);
        const y = j === 0 ? y0 : y1;
        place(target, COVE_RADIUS * (1 - Math.cos(turn)), middle + dir * COVE_RADIUS * Math.sin(turn), y, Math.cos(turn), -dir * Math.sin(turn), 0,
            (middle + dir * COVE_RADIUS * turn) * run.right, y);
    });
}

/** Half of the cove round an outside corner at `s`, where its wall turns away: its curve swept round the corner. */
function outsideCorner(tiles, s, dir) {
    tiles.patch(COVE_STEPS, CORNER_STEPS, (k, m, target) => {
        const point = curvePoint(k);
        const turn = (m / CORNER_STEPS) * (Math.PI / 4);
        place(target, point.out * Math.cos(turn), s + dir * point.out * Math.sin(turn), coveY(point),
            point.normalOut * Math.cos(turn), dir * point.normalOut * Math.sin(turn), run.up * point.normalUp,
            (s + dir * point.out * turn) * run.right, coveV(point));
    });
}

/**
 * The flat end of a stretch of cove stopped at `s` where the floor in front drops away or rises: in line with the face
 * of the step, and tiled like it (across, and up).
 */
function closeEnd(tiles, s, dir) {
    tiles.patch(COVE_STEPS, 1, (k, j, target) => {
        const point = curvePoint(k);
        const out = j === 0 ? 0 : point.out;
        const y = j === 0 ? run.y : coveY(point);
        place(target, out, s, y, 0, dir, 0, run.plane + run.normal * out, y);
    });
}

/** The height of a point of the stretch's curve. */
function coveY(point) {
    return run.y + run.up * point.rise;
}

/**
 * The texture's v at a point of the stretch's curve: the wall's (its height) where the curve leaves it, and on round
 * the curve from there, so the rows of tiles carry on down it.
 */
function coveV(point) {
    return run.y + run.up * (COVE_RADIUS - point.round);
}

/**
 * Fills `target` with a corner of the stretch's cove: `out` from its wall, `along` its line, at height y, with a normal
 * (out from the wall, along the line, up) and texture coordinates.
 */
function place(target, out, along, y, normalOut, normalAlong, normalUp, u, v) {
    const across = run.plane + run.normal * out;
    if (run.axis === 0) {
        target[0] = across;
        target[2] = along;
        target[3] = run.normal * normalOut;
        target[5] = normalAlong;
    } else {
        target[0] = along;
        target[2] = across;
        target[3] = normalAlong;
        target[5] = run.normal * normalOut;
    }
    target[1] = y;
    target[4] = normalUp;
    target[6] = u;
    target[7] = v;
}
