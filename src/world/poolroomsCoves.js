import { CHUNK_SIZE, HALF_CHUNK, WALL_HEIGHT } from '../config.js';
import { cellCoord } from './grid.js';
import { TILE } from './poolrooms.js';
import { RegionGrid, intervalStart } from './regionGrid.js';

/*
 * Level 37 coves: curved tile where walls meet the floor, ceiling and each other, like a pool. Runs along the
 * bottom and top of every wall, up inside corners, and around outside corners. Walls are the normal square ones
 * (chunkGeometry.js). Coves sit in front and continue the wall tiling into the floor.
 *
 * Coves follow wall faces on the same region grid (regionGrid.js), so the chunk that builds a face builds its
 * coves. Each face builds its half of a corner and the face it meets builds the other half.
 */

const N = CHUNK_SIZE;

/** Cove radius, three tiles around the curve. Columns use the same curve (see poolroomsGeometry.js). */
export const COVE_RADIUS = (3 * TILE) / (Math.PI / 2);
/** Segments per cove curve and per half corner. 22.5° each is smooth enough at this size. */
export const COVE_STEPS = 4;
const CORNER_STEPS = 2;

// How a cove stretch ends: continued by the next chunk, an inside corner, an outside corner, or closed off where
// the floor ahead changes height or turns into a stair.
const JOINED = 0;
const INSIDE = 1;
const OUTSIDE = 2;
const CLOSED = 3;

/** Scratch point on the cove curve (see curvePoint). */
const curve = { out: 0, rise: 0, normalOut: 0, normalUp: 0, round: 0 };

/**
 * Point `k` of COVE_STEPS along the curve, from the wall (0) to the floor (COVE_STEPS). Fills `curve` with the
 * offset out and up, the normal, and arc length so far. Ceiling coves are the same flipped.
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
 * Builds the coves for chunk (cx, cz) into `tiles`. Bottom coves sit at the floor height in front and are skipped
 * in front of stairs.
 * @param {import('./GeometryBuilder.js').GeometryBuilder} tiles
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {number} cx
 * @param {number} cz
 * @param {((x: number, z: number) => boolean) | null} [only] Only faces in front of these cells. All if not given.
 */
export function buildCoves(tiles, store, cx, cz, only = null) {
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const grid = new RegionGrid(store, x0, z0);
    const first = [x0 * 4, z0 * 4];
    for (const axis of [0, 1]) {
        const along = first[1 - axis];
        for (let a = first[axis]; a < first[axis] + N * 4; a++) {
            for (const layer of [0, 1]) coveLine(tiles, store, grid, cx * N, cz * N, axis, a, along, along + N * 4, layer, only);
        }
    }
}

// Wall face pieces along one region grid line (see coveLine). Facing 0 means no face. Height is the floor in
// front, NaN on a stair.
const MAX_PIECES = 2 * 4 * (N + 2);
const pieceFrom = new Float64Array(MAX_PIECES);
const pieceTo = new Float64Array(MAX_PIECES);
const pieceRegion = new Int32Array(MAX_PIECES);
const pieceFacing = new Int8Array(MAX_PIECES);
const pieceHeight = new Float64Array(MAX_PIECES);

/**
 * Coves on the line between regions `a` and `a + 1` across `axis` (0 means the line runs along z), from region b0
 * to b1. `layer` is 0 for the wall bottom, 1 for the top. Consecutive pieces facing the same way over the same
 * floor height make one stretch.
 */
function coveLine(tiles, store, grid, ox, oz, axis, a, b0, b1, layer, only) {
    const solidAt = (ra, b) => (axis === 0 ? grid.solid(layer, ra, b) : grid.solid(layer, b, ra));
    const plane = intervalStart(a + 1);
    let count = 0;
    const addPiece = (from, to, region, facing) => {
        pieceFrom[count] = from;
        pieceTo[count] = to;
        pieceRegion[count] = region;
        pieceFacing[count] = facing;
        pieceHeight[count] = facing === 0 ? NaN : heightInFront(store, axis, plane + facing * 0.01, (from + to) / 2, layer, only);
        count++;
    };
    // Include one region past each end so we know how stretches at the chunk edge continue.
    let first = 0;
    let end = 0;
    for (let b = b0 - 1; b <= b1; b++) {
        if (b === b0) first = count;
        if (b === b1) end = count;
        const low = solidAt(a, b);
        const facing = low === solidAt(a + 1, b) ? 0 : low ? 1 : -1;
        const from = intervalStart(b);
        const to = intervalStart(b + 1);
        // A wall straddles two cells whose floors can differ, so split it into a piece for each.
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

/**
 * Cove height in front of the cell at (`across`, `along`). Wall height for the top layer, floor height otherwise.
 * NaN on a stair or where `only` excludes the cell.
 */
function heightInFront(store, axis, across, along, layer, only) {
    const x = cellCoord(axis === 0 ? across : along);
    const z = cellCoord(axis === 0 ? along : across);
    if (only && !only(x, z)) return NaN;
    return layer === 1 ? WALL_HEIGHT : store.flatFloor(x, z) ?? NaN;
}

// ---------------------------------------------------------------------------------------------- building

/**
 * Current stretch being built. Face is at x = plane (axis 0) or z = plane (axis 1), facing `normal` (±1). up is 1
 * for a floor cove at y, -1 for a ceiling cove. U matches the wall's, `right` times distance along the line (see
 * wallQuad in chunkGeometry.js).
 */
const run = { axis: 0, plane: 0, normal: 1, right: 1, y: 0, up: 1 };

/** One cove stretch from s0 to s1 along its line, plus its ends. */
function stretch(tiles, s0, s1, start, end) {
    // At an inside corner the straight part stops short to leave room for the corner piece.
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

/** End cap of a stretch at `s`. `dir` is ±1 along the line. */
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
 * Half of an inside corner at `s`, from this stretch's end to halfway. It's a sphere corner joining the two coves
 * and the vertical curve.
 */
function insideCorner(tiles, s, dir) {
    const middle = s - dir * COVE_RADIUS;
    tiles.patch(COVE_STEPS, CORNER_STEPS, (k, m, target) => {
        const point = curvePoint(k);
        // distance of this ring from the corner's vertical axis
        const ring = COVE_RADIUS - point.out;
        const turn = (m / CORNER_STEPS) * (Math.PI / 4);
        place(target, COVE_RADIUS - ring * Math.cos(turn), middle + dir * ring * Math.sin(turn), coveY(point),
            point.normalOut * Math.cos(turn), -dir * point.normalOut * Math.sin(turn), run.up * point.normalUp,
            (middle + dir * ring * turn) * run.right, coveV(point));
    });
}

/** Half of the vertical curve in an inside corner at `s`, from floor cove to ceiling cove. */
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

/** Half of an outside corner at `s`, the cove profile swept around it. */
function outsideCorner(tiles, s, dir) {
    tiles.patch(COVE_STEPS, CORNER_STEPS, (k, m, target) => {
        const point = curvePoint(k);
        const turn = (m / CORNER_STEPS) * (Math.PI / 4);
        place(target, point.out * Math.cos(turn), s + dir * point.out * Math.sin(turn), coveY(point),
            point.normalOut * Math.cos(turn), dir * point.normalOut * Math.sin(turn), run.up * point.normalUp,
            (s + dir * point.out * turn) * run.right, coveV(point));
    });
}

/** Flat cap where the floor steps up or down at `s`. Lines up with the step face and uses its tiling. */
function closeEnd(tiles, s, dir) {
    tiles.patch(COVE_STEPS, 1, (k, j, target) => {
        const point = curvePoint(k);
        const out = j === 0 ? 0 : point.out;
        const y = j === 0 ? run.y : coveY(point);
        place(target, out, s, y, 0, dir, 0, run.plane + run.normal * out, y);
    });
}

function coveY(point) {
    return run.y + run.up * point.rise;
}

/** Texture v on the curve. Starts at the wall's v and follows arc length so tile rows continue around it. */
function coveV(point) {
    return run.y + run.up * (COVE_RADIUS - point.round);
}

/** Writes one cove vertex into `target`: position, normal and UV. */
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
