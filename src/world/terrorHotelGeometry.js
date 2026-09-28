import { Sphere, Vector3 } from 'three';
import { CHUNK_SIZE, DOOR_HEIGHT, DOOR_WIDTH, HALF_CHUNK, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { ColorBuilder } from './ColorBuilder.js';
import { PANELS_PER_SIDE } from './generator.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, chunkCoord } from './grid.js';
import { circle } from './pipeDreamsShapes.js';
import { hashFloat } from './random.js';
import { RegionGrid, intervalStart } from './regionGrid.js';
import {
    BEAM_HALF,
    DOOR_AJAR,
    DOOR_BALLROOM,
    DOOR_ELEVATOR,
    DOOR_LIT,
    DOOR_SIGN,
    DOOR_STAFF,
    FIXTURE_BOWL,
    FIXTURE_BULB,
    FIXTURE_CHANDELIER,
    FIXTURE_CRYSTAL,
    FIXTURE_LANTERN,
    LOOK_BALLROOM,
    LOOK_LOBBY,
    LOOK_STAFF,
    SCONCE_OUT,
    SCONCE_WALLS,
    SCONCE_Y,
    sconceSlot,
} from './terrorHotel.js';
import { buildFurniture, paintings } from './terrorHotelFurnishings.js';
import { faceted, tube } from './terrorHotelShapes.js';
import { HOTEL_ATLAS, HOTEL_ATLAS_SIZE } from './terrorHotelTextures.js';

/*
 * What Level 5 has that Level 0 doesn't, as meshes for one chunk (see terrorHotel.js for where it all goes):
 *
 * - the mouldings round every wall: a skirting board along the foot, a chair rail along the top of the dado, a
 *   cornice where the wall meets the ceiling, each to the look of the room in front of it. They follow the walls' faces
 *   on the same region grid (see regionGrid.js and Level 37's coves, poolroomsCoves.js), so they follow any wall you
 *   build, mitred into every inside corner and round every outside one, and they stop at a doorway's casing;
 * - the doorways' casings and linings, and the doors that don't open: panelled, a brass plate with the room's number on
 *   it, sometimes a card on the handle, a crack of black round one, light under another; the lifts' brass doors, with
 *   their dials over them;
 * - the sconces, the fittings in the light slots (alabaster bowls, lanterns, iron rings of candle bulbs, crystal
 *   chandeliers, a bulb in a shade), and the glow round each;
 * - the pipes along the tops of the staff passages' walls, on their way to the boilers;
 * - the lobbies' columns of red marble, turned, and the beams between them; the furniture, the paintings and the rugs
 *   (see terrorHotelFurnishings.js).
 *
 * Positions are relative to the chunk's centre.
 */

const N = CHUNK_SIZE;
const HALF_WALL = WALL_THICKNESS / 2;
const FACE = 0.5 - HALF_WALL;
const HALF_DOOR = DOOR_WIDTH / 2;

/** How the woodwork's material finishes each part (see FRAGMENT_FINISH in terrorHotelShading.js). */
export const F_PAINT = 0;
export const F_WOOD_X = 1;
export const F_WOOD_Y = 2;
export const F_WOOD_Z = 3;
export const F_GILT = 4;
export const F_MARBLE = 5;
export const F_FABRIC = 6;
export const F_LINEN = 7;
export const F_GLASS = 8;
export const F_PLASTER = 9;
export const F_STONE = 10;
export const F_BEAM = 11;
export const F_VEINED = 12;

export const WALNUT = 0x5a3420;
export const GILT = 0xa8843c;
export const BRASS = 0xb8903a;
export const IRON = 0x1c1a18;
const PLASTER = 0xd4c6a2;
const CREAM_PAINT = 0xcdbf9c;
const STAFF_PAINT = 0x2e2a22;
const MARBLE_BASE = 0xffffff;
const STONE = 0xa8987a;
const ALABASTER = 0xf2dcb4;
const AMBER = 0xe8a860;
const BULB = 0xfff0d0;
const CANDLE = 0xf4ecd8;
const CRYSTAL = 0xe8eef2;

/** How far a doorway's casing reaches out from the opening either side, and how far it stands off the wall. */
export const CASING_WIDTH = 0.036;
const CASING_DEPTH = 0.014;
/** The plinth block at the foot of each side: how wide, and how far it stands over the skirting it stops. */
const PLINTH_WIDTH = 0.046;
const PLINTH_OVER = 0.015;
/** How far a lift's frame reaches out from its opening either side, and how tall its doors are. */
const LIFT_FRAME = 0.045;
const LIFT_HEIGHT = 0.76;
/** How far into a casing's side (or a lift's frame) the skirting and the chair rail go where they stop at it. */
const TUCK = 0.002;

/** Round everything a chunk's meshes have (some of it reaches a cell or so into the next): see ColorBuilder.build. */
const CHUNK_BOUNDS = new Sphere(new Vector3(0, WALL_HEIGHT / 2, 0), Math.hypot(HALF_CHUNK + 1.5, HALF_CHUNK + 1.5, WALL_HEIGHT));

// One set of builders serves every chunk, as building one runs start to finish.
const woodworkBuilder = new ColorBuilder('finish');
const fittingsBuilder = new ColorBuilder('light');
const glowsBuilder = new ColorBuilder('glow');
const paintBuilder = new ColorBuilder();
const dialsBuilder = new ColorBuilder();
const spillBuilder = new ColorBuilder();

/**
 * Level 5's own meshes for one chunk (its `shape.extras`; see levels.js), by the name of the material that draws each.
 * Built in steps (see chunkGeometrySteps): a chunk is 25 ms or more of work on a desktop.
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {import('./generator.js').ChunkData} chunk
 * @param {{ pillars: import('./GeometryBuilder.js').GeometryBuilder, shade: import('./GeometryBuilder.js').GeometryBuilder }} builders
 */
export function* terrorHotelGeometrySteps(store, chunk, { shade }) {
    const data = /** @type {import('./terrorHotel.js').TerrorHotelData} */ (chunk.terrorHotel);
    const x0 = chunk.cx * N - HALF_CHUNK;
    const z0 = chunk.cz * N - HALF_CHUNK;
    const ctx = {
        store,
        seed: store.seed,
        chunk,
        data,
        x0,
        z0,
        ox: chunk.cx * N,
        oz: chunk.cz * N,
        grid: new RegionGrid(store, x0, z0),
        woodwork: woodworkBuilder.reset(),
        fittings: fittingsBuilder.reset(),
        glows: glowsBuilder.reset(),
        paint: paintBuilder.reset(),
        dials: dialsBuilder.reset(),
        spill: spillBuilder.reset(),
        shade,
        // The doors that don't open, still in a wall (edit mode can have taken it down), by wall: axis, line, along.
        doors: data.doors.filter((door) => store.edge(door.x, door.z, door.axis) === EDGE_WALL),
    };
    mouldings(ctx, 0);
    yield;
    mouldings(ctx, 1);
    yield;
    doorways(ctx);
    yield;
    // Dozens of them in a chunk.
    for (let i = 0; i < ctx.doors.length; i++) {
        closedDoor(ctx, ctx.doors[i]);
        if (i % 8 === 7) yield;
    }
    yield;
    sconces(ctx);
    fittings(ctx);
    yield;
    pipes(ctx);
    columns(ctx);
    beams(ctx);
    yield;
    buildFurniture(ctx);
    yield;
    paintings(ctx);
    yield;
    return {
        woodwork: ctx.woodwork.build(CHUNK_BOUNDS),
        fittings: ctx.fittings.build(CHUNK_BOUNDS),
        glows: ctx.glows.build(CHUNK_BOUNDS),
        paint: ctx.paint.build(CHUNK_BOUNDS),
        dials: ctx.dials.build(CHUNK_BOUNDS),
        spill: ctx.spill.build(CHUNK_BOUNDS),
    };
}

/**
 * What an empty chunk outside a tape's walls (see footage/arena.js) builds of Level 5's own (its `shape.outside`; see
 * levels.js): the mouldings on the faces of the walls it has that face into the tape. (The chunks inside have
 * everything else on them, and nothing on those walls cuts into the mouldings: there's no door in them.)
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {import('./generator.js').ChunkData} chunk
 */
export function buildTerrorHotelOutside(store, chunk) {
    const x0 = chunk.cx * N - HALF_CHUNK;
    const z0 = chunk.cz * N - HALF_CHUNK;
    const ctx = { store, x0, z0, ox: chunk.cx * N, oz: chunk.cz * N, grid: new RegionGrid(store, x0, z0), woodwork: woodworkBuilder.reset(), doors: [] };
    mouldings(ctx, 0);
    mouldings(ctx, 1);
    return { woodwork: ctx.woodwork.build(CHUNK_BOUNDS) };
}

// ---------------------------------------------------------------------------------------------- pieces

/** A point `across` a wall (world), `along` it and at y, relative to the chunk: axis 0 is a wall along z. */
export function at(ctx, axis, across, along, y) {
    return axis === 0 ? [across - ctx.ox, y, along - ctx.oz] : [along - ctx.ox, y, across - ctx.oz];
}

/**
 * A box standing off a surface (a wall, a door's leaf), from `a0` across the wall (the surface: its back, against it,
 * isn't drawn) out to `a1`, from s0 to s1 along it and y0 to y1 up (world).
 */
export function wallBox(ctx, b, axis, a0, a1, s0, s1, y0, y1, color) {
    const side = Math.sign(a1 - a0);
    const [sLow, sHigh] = [Math.min(s0, s1), Math.max(s0, s1)];
    const corner = (a, s, y) => at(ctx, axis, a, s, y);
    const n = (across, along, up) => (axis === 0 ? [across, up, along] : [along, up, across]);
    // Its front, its ends along the wall, its top and its bottom.
    face4(b, [corner(a1, sLow, y0), corner(a1, sHigh, y0), corner(a1, sHigh, y1), corner(a1, sLow, y1)], n(side, 0, 0), color);
    face4(b, [corner(a0, sLow, y0), corner(a1, sLow, y0), corner(a1, sLow, y1), corner(a0, sLow, y1)], n(0, -1, 0), color);
    face4(b, [corner(a0, sHigh, y0), corner(a1, sHigh, y0), corner(a1, sHigh, y1), corner(a0, sHigh, y1)], n(0, 1, 0), color);
    face4(b, [corner(a0, sLow, y1), corner(a1, sLow, y1), corner(a1, sHigh, y1), corner(a0, sHigh, y1)], n(0, 0, 1), color);
    if (y0 > 0) face4(b, [corner(a0, sLow, y0), corner(a1, sLow, y0), corner(a1, sHigh, y0), corner(a0, sHigh, y0)], n(0, 0, -1), color);
}

/**
 * A flat four-sided face, its corners in order round it (either way), facing n: wound to face that way.
 * @param {ColorBuilder} b
 * @param {number[][]} corners [x, y, z] each.
 * @param {number[]} n
 * @param {number} color
 * @param {number[]} [uv] [u0, v0, u1, v1] over it (a picture), from the first corner to the third.
 */
export function face4(b, corners, n, color, uv = null) {
    // Which way it's wound, from its diagonals (still right where two of its corners are one point). No arrays made
    // per call or per vertex: this makes most of Level 5's triangles, and the garbage made its chunks slow to build.
    const a = corners[0];
    const c1 = corners[1];
    const c2 = corners[2];
    const c3 = corners[3];
    const ux = c2[0] - a[0];
    const uy = c2[1] - a[1];
    const uz = c2[2] - a[2];
    const vx = c3[0] - c1[0];
    const vy = c3[1] - c1[1];
    const vz = c3[2] - c1[2];
    const nx = n[0];
    const ny = n[1];
    const nz = n[2];
    const facing = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    const u0 = uv ? uv[0] : PLAIN[0];
    const v0 = uv ? uv[1] : PLAIN[1];
    const u1 = uv ? uv[2] : PLAIN[0];
    const v1 = uv ? uv[3] : PLAIN[1];
    const first = b.vertexCount;
    b.vertex(a[0], a[1], a[2], nx, ny, nz, u0, v0, color);
    if (facing >= 0) {
        b.vertex(c1[0], c1[1], c1[2], nx, ny, nz, u1, v0, color);
        b.vertex(c2[0], c2[1], c2[2], nx, ny, nz, u1, v1, color);
        b.vertex(c3[0], c3[1], c3[2], nx, ny, nz, u0, v1, color);
    } else {
        b.vertex(c3[0], c3[1], c3[2], nx, ny, nz, u0, v1, color);
        b.vertex(c2[0], c2[1], c2[2], nx, ny, nz, u1, v1, color);
        b.vertex(c1[0], c1[1], c1[2], nx, ny, nz, u1, v0, color);
    }
    b.triangle(first, first + 1, first + 2);
    b.triangle(first, first + 2, first + 3);
}

// Plain white in the props' texture, for the woodwork (see ColorBuilder: its quads default to it).
const PLAIN = [0, 0];

/** A picture from the paint atlas as UVs. @returns {number[]} [u0, v0, u1, v1] */
export function atlasUv([x0, y0, x1, y1]) {
    return [x0 / HOTEL_ATLAS_SIZE, 1 - y1 / HOTEL_ATLAS_SIZE, x1 / HOTEL_ATLAS_SIZE, 1 - y0 / HOTEL_ATLAS_SIZE];
}

/**
 * A picture flat on a wall, facing `side` across it, centred `along` it and at y, half-size hw × hh, `lift` off the
 * wall's face; the right way round seen from in front. `flip` mirrors it.
 */
export function wallPicture(ctx, b, axis, face, side, along, y, hw, hh, rect, color = 0xffffff, flip = false) {
    const [u0, v0, u1, v1] = atlasUv(rect);
    // Left to right as you face it: along −side for a wall along z (axis 0), +side along x.
    const right = axis === 0 ? -side : side;
    const l = along - right * hw;
    const r = along + right * hw;
    const corners = [at(ctx, axis, face, l, y - hh), at(ctx, axis, face, r, y - hh), at(ctx, axis, face, r, y + hh), at(ctx, axis, face, l, y + hh)];
    const n = axis === 0 ? [side, 0, 0] : [0, 0, side];
    face4(b, corners, n, color, flip ? [u1, v0, u0, v1] : [u0, v0, u1, v1]);
}

/** The perpendiculars (u, v) to an axis, with u × v = the axis. */
function basis(ax, ay, az) {
    const [hx, hy, hz] = Math.abs(ay) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ux = hy * az - hz * ay;
    let uy = hz * ax - hx * az;
    let uz = hx * ay - hy * ax;
    const length = Math.hypot(ux, uy, uz);
    ux /= length;
    uy /= length;
    uz /= length;
    return [ux, uy, uz, ay * uz - az * uy, az * ux - ax * uz, ax * uy - ay * ux];
}

/**
 * Something turned on a lathe, about the axis (unit) through p: `profile` is [radius, distance along the axis] from its
 * base out; `inward` faces it in (the inside of a shade).
 */
export function turned(b, px, py, pz, ax, ay, az, profile, sides, color, inward = false) {
    const [ux, uy, uz, vx, vy, vz] = basis(ax, ay, az);
    const first = b.vertexCount;
    const last = profile.length - 1;
    const round = circle(sides);
    for (let j = 0; j <= last; j++) {
        const here = profile[j];
        const before = profile[Math.max(0, j - 1)];
        const after = profile[Math.min(last, j + 1)];
        const r = here[0];
        const t = here[1];
        let nr = after[1] - before[1];
        let nt = before[0] - after[0];
        const length = Math.hypot(nr, nt) || 1;
        nr /= length;
        nt /= length;
        if (inward) {
            nr = -nr;
            nt = -nt;
        }
        for (let k = 0; k <= sides; k++) {
            const c = round[k * 2];
            const s = round[k * 2 + 1];
            const rx = ux * c + vx * s;
            const ry = uy * c + vy * s;
            const rz = uz * c + vz * s;
            b.vertex(px + ax * t + rx * r, py + ay * t + ry * r, pz + az * t + rz * r, rx * nr + ax * nt, ry * nr + ay * nt, rz * nr + az * nt, PLAIN[0], PLAIN[1], color);
        }
    }
    const stride = sides + 1;
    for (let j = 0; j < last; j++) {
        for (let k = 0; k < sides; k++) {
            const a = first + j * stride + k;
            if (inward) {
                b.triangle(a, a + stride + 1, a + 1);
                b.triangle(a, a + stride, a + stride + 1);
            } else {
                b.triangle(a, a + 1, a + stride + 1);
                b.triangle(a, a + stride + 1, a + stride);
            }
        }
    }
}

/** A rod from a to b; closed at both ends if it's thick enough for them to be seen. */
export function rod(b, ax, ay, az, bx, by, bz, r, color, sides = 6) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-5) return;
    const profile = r > 0.005 ? [[0, 0], [r, 0], [r, length], [0, length]] : [[r, 0], [r, length]];
    turned(b, ax, ay, az, dx / length, dy / length, dz / length, profile, sides, color);
}

/** A ring of rod round a circle (a chandelier's hoop), centre p, in the horizontal, radius R. */
export function hoop(b, px, py, pz, R, r, color, segments = 16) {
    for (let k = 0; k < segments; k++) {
        const a0 = (k / segments) * Math.PI * 2;
        const a1 = ((k + 1) / segments) * Math.PI * 2;
        rod(b, px + Math.cos(a0) * R, py, pz + Math.sin(a0) * R, px + Math.cos(a1) * R, py, pz + Math.sin(a1) * R, r, color, 4);
    }
}

/** A cell's look, wherever it is (see LOOK_* in terrorHotel.js), or −1 where there's nothing (outside a tape's walls). */
export function lookAt(ctx, x, z) {
    const cx = chunkCoord(x);
    const cz = chunkCoord(z);
    if (ctx.store.options.isVoid?.(cx, cz)) return -1;
    const cells = ctx.store.getChunk(cx, cz).cells;
    return cells ? cells[((x - cx * N + HALF_CHUNK) * N + (z - cz * N + HALF_CHUNK)) * 4] & 7 : -1;
}

// ---------------------------------------------------------------------------------------------- mouldings

// The profiles, as [out from the wall, up], from the bottom round to the top (each face of one lit as it faces).
const SKIRTING = [[0.011, 0], [0.011, 0.04], [0.008, 0.046], [0.008, 0.052], [0.005, 0.058], [0, 0.06]];
const TALL_SKIRTING = [[0.016, 0], [0.016, 0.075], [0.012, 0.08], [0.012, 0.088], [0.006, 0.094], [0, 0.096]];
const RAIL = [[0, 0.312], [0.007, 0.316], [0.011, 0.322], [0.013, 0.33], [0.011, 0.338], [0.007, 0.343], [0.004, 0.345], [0, 0.346]];
const CORNICE = [[0, 0.905], [0.007, 0.905], [0.007, 0.913], [0.012, 0.917], [0.018, 0.925], [0.026, 0.937], [0.034, 0.952], [0.041, 0.966], [0.046, 0.976], [0.046, 0.984], [0.056, 0.984], [0.056, 1]];
const BIG_CORNICE = CORNICE.map(([o, y]) => [o * 1.35, 1 - (1 - y) * 1.35]);

/**
 * What goes round the walls of each look (see LOOK_*: a corridor's and a guest room's are the same, so a run goes on
 * from one into the other): [profile, colour, finish] or null, for each of the three.
 */
const STYLE = [0, 0, 2, 3, 4];
const MOULDINGS = [
    { skirting: [SKIRTING, WALNUT, -1], rail: [RAIL, WALNUT, -1], cornice: [CORNICE, PLASTER, F_PLASTER] },
    null,
    { skirting: [TALL_SKIRTING, MARBLE_BASE, F_MARBLE], rail: [RAIL, 0xb89a58, F_GILT], cornice: [BIG_CORNICE, PLASTER, F_PLASTER] },
    { skirting: [SKIRTING, CREAM_PAINT, F_PAINT], rail: [RAIL, 0xb89a58, F_GILT], cornice: [CORNICE, PLASTER, F_PLASTER] },
    { skirting: [SKIRTING, STAFF_PAINT, F_PAINT], rail: null, cornice: null },
];

// How a run of moulding ends: carried on by the next chunk's (or the next piece's), in an inside corner, round an
// outside corner, or stopped (against a doorway's casing, or where the room in front changes).
const JOINED = 0;
const INSIDE = 1;
const OUTSIDE = 2;
const CLOSED = 3;

/**
 * Every face of wall across `axis` whose regions are in the chunk: its skirting and chair rail (below the doorways),
 * its cornice. One axis at a time, since together they're the longest step of a chunk (see terrorHotelGeometrySteps).
 */
function mouldings(ctx, axis) {
    const first = [ctx.x0 * 4, ctx.z0 * 4];
    const along = first[1 - axis];
    for (let a = first[axis]; a < first[axis] + N * 4; a++) {
        for (const layer of [0, 1]) mouldingLine(ctx, axis, a, along, along + N * 4, layer);
    }
}

const MAX_PIECES = 4 * (N + 2);
const pieceFrom = new Float64Array(MAX_PIECES);
const pieceTo = new Float64Array(MAX_PIECES);
const pieceRegion = new Int32Array(MAX_PIECES);
const pieceFacing = new Int8Array(MAX_PIECES);
const pieceLook = new Int8Array(MAX_PIECES);

/**
 * The mouldings along the faces on the line between regions a and a + 1 across an axis, from region b0 to b1 along
 * it, in one layer: the skirting and the chair rail (0), or the cornice (1). Pieces of face in a row, facing the same
 * way, in front of cells of one look, are one run, finished at its ends by whatever it meets.
 */
function mouldingLine(ctx, axis, a, b0, b1, layer) {
    const { grid } = ctx;
    const solidAt = (ra, b, l = layer) => (axis === 0 ? grid.solid(l, ra, b) : grid.solid(l, b, ra));
    const plane = intervalStart(a + 1);
    let count = 0;
    let first = 0;
    let end = 0;
    for (let b = b0 - 1; b <= b1; b++) {
        if (b === b0) first = count;
        if (b === b1) end = count;
        const facing = faceAt(ctx, axis, a, b, layer);
        pieceFrom[count] = intervalStart(b);
        pieceTo[count] = intervalStart(b + 1);
        pieceRegion[count] = b;
        pieceFacing[count] = facing;
        pieceLook[count] = facing === 0 ? -1 : faceStyle(ctx, axis, a, b, facing, layer);
        count++;
    }
    // How a run ends past its piece p, where piece q is, the way dir along the line; and round a corner, the style of the
    // face there.
    const endOf = (p, q, dir) => {
        const facing = pieceFacing[p];
        if (pieceFacing[q] === facing) return [pieceLook[q] === pieceLook[p] ? JOINED : CLOSED, -1];
        const open = facing > 0 ? a + 1 : a;
        const wall = facing > 0 ? a : a + 1;
        // (The line across, between the run's end and the region past it.)
        const line = dir > 0 ? pieceRegion[q] - 1 : pieceRegion[q];
        // Another wall across the end: its face, facing back along the run.
        if (solidAt(open, pieceRegion[q])) return [INSIDE, faceStyle(ctx, 1 - axis, line, open, -dir, layer)];
        // A doorway beyond (the wall goes on over it): stopped at its casing.
        if (layer === 0 && solidAt(wall, pieceRegion[q], 1)) return [CLOSED, -1];
        // The wall's end: its face, facing on along the run.
        return [OUTSIDE, faceStyle(ctx, 1 - axis, line, wall, dir, layer)];
    };
    const originAcross = axis === 0 ? ctx.ox : ctx.oz;
    const originAlong = axis === 0 ? ctx.oz : ctx.ox;
    for (let p = first; p < end; p++) {
        if (pieceFacing[p] === 0 || pieceLook[p] < 0) continue;
        let q = p;
        while (q + 1 < end && pieceFacing[q + 1] === pieceFacing[p] && pieceLook[q + 1] === pieceLook[p]) q++;
        const [start, startStyle] = endOf(p, p - 1, -1);
        const [stop, stopStyle] = endOf(q, q + 1, 1);
        const set = MOULDINGS[pieceLook[p]];
        const facing = pieceFacing[p];
        // (Where it stops at a doorway.)
        const doorway0 = start === CLOSED && pieceFacing[p - 1] !== facing;
        const doorway1 = stop === CLOSED && pieceFacing[q + 1] !== facing;
        const run = { axis, plane: plane - originAcross, facing, originAlong };
        for (const name of layer === 0 ? ['skirting', 'rail'] : ['cornice']) {
            const piece = set[name];
            if (!piece) continue;
            // Round a corner into a moulding of another profile (or none), it stops at the corner, its end closed.
            const e0 = (start === INSIDE || start === OUTSIDE) && MOULDINGS[startStyle]?.[name]?.[0] !== piece[0] ? CLOSED : start;
            const e1 = (stop === INSIDE || stop === OUTSIDE) && MOULDINGS[stopStyle]?.[name]?.[0] !== piece[0] ? CLOSED : stop;
            // At a doorway, it goes a little way into the casing, out of sight.
            const into = casingInto(name);
            const s0 = pieceFrom[p] + (doorway0 ? into : 0);
            const s1 = pieceTo[q] - (doorway1 ? into : 0);
            if (s1 - s0 < 1e-3) continue;
            // (And either side of each door that doesn't open, in this face's wall.)
            const spans = layer === 0 ? aroundDoors(ctx, axis, plane - facing * HALF_WALL, s0, s1, e0, e1, into) : [[s0, s1, e0, e1]];
            for (const [from, to, k0, k1] of spans) extrude(ctx.woodwork, run, piece, from, to, k0, k1);
        }
        p = q;
    }
}

/** How far past a doorway's opening the skirting (into the plinth) or the chair rail (into the casing's side) stops. */
function casingInto(name) {
    return (name === 'skirting' ? PLINTH_WIDTH : CASING_WIDTH) - TUCK;
}

/**
 * Which way the face on the line between regions a and a + 1 across an axis faces, at region b along it, in a layer
 * (see mouldingLine): 1 or −1, out of the wall, or 0 where there's none.
 */
function faceAt(ctx, axis, a, b, layer) {
    const solidAt = (ra, rb, l = layer) => (axis === 0 ? ctx.grid.solid(l, ra, rb) : ctx.grid.solid(l, rb, ra));
    const low = solidAt(a, b);
    const facing = low === solidAt(a + 1, b) ? 0 : low ? 1 : -1;
    // (Under a lintel, the sides of a doorway: its lining, not a moulding.)
    if (layer === 0 && facing !== 0 && solidAt(facing > 0 ? a + 1 : a, b, 1)) return 0;
    return facing;
}

/**
 * The style of the mouldings on that face (see MOULDINGS), or −1: the look of the cell in front of it. A wall's
 * thickness across its way goes with the face before it, if it carries on from one, else the one after (on its own,
 * with the cell before it).
 */
function faceStyle(ctx, axis, a, b, facing, layer) {
    if ((b & 3) === 3) {
        for (const next of [b - 1, b + 1]) {
            if (faceAt(ctx, axis, a, next, layer) !== facing) continue;
            const style = frontStyle(ctx, axis, a, next, facing);
            if (style >= 0) return style;
        }
    }
    return frontStyle(ctx, axis, a, b, facing);
}

function frontStyle(ctx, axis, a, b, facing) {
    const along = (intervalStart(b) + intervalStart(b + 1)) / 2 - ((b & 3) === 3 ? 0.1 : 0);
    const across = intervalStart(a + 1) + facing * 0.05;
    const look = axis === 0 ? lookAt(ctx, Math.floor(across + 0.5), Math.floor(along + 0.5)) : lookAt(ctx, Math.floor(along + 0.5), Math.floor(across + 0.5));
    return look < 0 ? -1 : STYLE[look];
}

/**
 * A run's stretch of face, cut either side of every door that doesn't open in the wall, a little way into its casing
 * (`into` past its opening; into a lift's frame, whatever it is): [from, to, how it starts, how it ends] for each piece
 * left. `wall` is the wall's middle line.
 */
function aroundDoors(ctx, axis, wall, s0, s1, start, stop, into) {
    const cuts = [];
    for (const door of ctx.doors) {
        if (door.axis !== axis) continue;
        const line = (axis === 0 ? door.x : door.z) + 0.5;
        if (Math.abs(line - wall) > 1e-6) continue;
        const middle = axis === 0 ? door.z : door.x;
        const reach = HALF_DOOR + (door.kind === DOOR_ELEVATOR ? LIFT_FRAME - TUCK : into);
        if (middle + reach > s0 && middle - reach < s1) cuts.push([middle - reach, middle + reach]);
    }
    if (cuts.length === 0) return [[s0, s1, start, stop]];
    cuts.sort((p, q) => p[0] - q[0]);
    const spans = [];
    let from = s0;
    let begin = start;
    for (const [c0, c1] of cuts) {
        if (c0 > from + 1e-4) spans.push([from, c0, begin, CLOSED]);
        from = Math.max(from, c1);
        begin = CLOSED;
    }
    if (s1 > from + 1e-4) spans.push([from, s1, begin, stop]);
    return spans;
}

/**
 * One run of a moulding along a face, from s0 to s1 (world, along the wall), its ends mitred into an inside corner,
 * round an outside one, flush, or closed off with the profile's end.
 * @param {ColorBuilder} b
 */
function extrude(b, run, [profile, color, finish], s0, s1, start, stop) {
    const { axis, plane, facing, originAlong } = run;
    // Each point's end, by how far out it is: into an inside corner it stops that much short, round an outside one it
    // goes that much past.
    const endAt = (s, kind, dir, out) => (kind === INSIDE ? s - dir * out : kind === OUTSIDE ? s + dir * out : s);
    b.finish(finish >= 0 ? finish : axis === 0 ? F_WOOD_Z : F_WOOD_X, 0);
    const point = (out, y, s) => {
        const across = plane + facing * out;
        const along = s - originAlong;
        return axis === 0 ? [across, y, along] : [along, y, across];
    };
    const normal = (no, ny) => (axis === 0 ? [facing * no, ny, 0] : [0, ny, facing * no]);
    for (let k = 0; k + 1 < profile.length; k++) {
        const [o0, y0] = profile[k];
        const [o1, y1] = profile[k + 1];
        let no = y1 - y0;
        let ny = o0 - o1;
        const length = Math.hypot(no, ny) || 1;
        no /= length;
        ny /= length;
        const corners = [
            point(o0, y0, endAt(s0, start, -1, o0)),
            point(o0, y0, endAt(s1, stop, 1, o0)),
            point(o1, y1, endAt(s1, stop, 1, o1)),
            point(o1, y1, endAt(s0, start, -1, o1)),
        ];
        face4(b, corners, normal(no, ny), color);
    }
    // Its ends, where it stops: the profile, closed against the wall, a slice for each of its faces (it goes up all the
    // way, so the slices never overlap).
    for (const [kind, s, dir] of [[start, s0, -1], [stop, s1, 1]]) {
        if (kind !== CLOSED) continue;
        const n = axis === 0 ? [0, 0, dir] : [dir, 0, 0];
        for (let k = 0; k + 1 < profile.length; k++) {
            const [o0, y0] = profile[k];
            const [o1, y1] = profile[k + 1];
            if (y1 - y0 < 1e-6) continue;
            face4(b, [point(0, y0, s), point(o0, y0, s), point(o1, y1, s), point(0, y1, s)], n, color);
        }
    }
}

// ---------------------------------------------------------------------------------------------- doorways

/**
 * Every doorway in the walls the chunk's cells own (their +x and +z edges): its casing on both faces of the wall, and
 * its lining round the opening.
 */
function doorways(ctx) {
    const { store, x0, z0 } = ctx;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            for (const axis of [0, 1]) {
                const x = x0 + i;
                const z = z0 + j;
                if (store.edge(x, z, axis) !== EDGE_DOOR) continue;
                const wall = (axis === 0 ? x : z) + 0.5;
                const middle = axis === 0 ? z : x;
                for (const side of [-1, 1]) {
                    const [fx, fz] = axis === 0 ? [side > 0 ? x + 1 : x, z] : [x, side > 0 ? z + 1 : z];
                    const look = lookAt(ctx, fx, fz);
                    if (look < 0) continue;
                    casing(ctx, axis, wall, side, middle, look, DOOR_HEIGHT, HALF_DOOR);
                }
                lining(ctx, axis, wall, middle, lookAt(ctx, x, z));
            }
        }
    }
}

/** What a casing's made of, for the look of the room in front of it: [colour, finish]. */
function casingFinish(look, axis) {
    if (look === LOOK_BALLROOM) return [CREAM_PAINT, F_PAINT];
    if (look === LOOK_STAFF) return [STAFF_PAINT, F_PAINT];
    return [WALNUT, axis === 0 ? F_WOOD_Z : F_WOOD_X];
}

/**
 * A doorway's casing on one face of its wall (the wall's middle line `wall`, the face towards `side`): a plinth block
 * at the foot of each side, taller than the skirting that stops in it, the sides up to the head, the head across, and a
 * little cornice over it. The opening is `half` either side of `middle` and `top` high.
 */
function casing(ctx, axis, wall, side, middle, look, top, half) {
    const b = ctx.woodwork;
    const surface = wall + side * HALF_WALL;
    const [color, finish] = casingFinish(look, axis);
    const out = (d) => surface + side * d;
    const skirting = MOULDINGS[STYLE[look]].skirting[0];
    const plinth = skirting[skirting.length - 1][1] + PLINTH_OVER;
    b.finish(F_WOOD_Y, 0);
    if (finish === F_PAINT) b.finish(F_PAINT, 0);
    for (const e of [-1, 1]) {
        const inner = middle + e * half;
        // The plinth, and the side over it.
        wallBox(ctx, b, axis, surface, out(CASING_DEPTH + 0.004), inner, inner + e * PLINTH_WIDTH, 0, plinth, color);
        wallBox(ctx, b, axis, surface, out(CASING_DEPTH), inner, inner + e * CASING_WIDTH, plinth, top, color);
        // Its bead, along the opening.
        wallBox(ctx, b, axis, out(CASING_DEPTH), out(CASING_DEPTH + 0.003), inner + e * 0.004, inner + e * 0.01, plinth, top, color);
    }
    b.finish(finish === F_PAINT ? F_PAINT : finish, 0);
    wallBox(ctx, b, axis, surface, out(CASING_DEPTH), middle - half - CASING_WIDTH, middle + half + CASING_WIDTH, top, top + CASING_WIDTH, color);
    // The cornice over the head: a shelf, standing out.
    const [capColor, capFinish] = look === LOOK_BALLROOM ? [GILT, F_GILT] : [color, finish];
    b.finish(capFinish, 0);
    wallBox(ctx, b, axis, surface, out(CASING_DEPTH + 0.012), middle - half - CASING_WIDTH - 0.012, middle + half + CASING_WIDTH + 0.012, top + CASING_WIDTH, top + CASING_WIDTH + 0.012, capColor);
    wallBox(ctx, b, axis, surface, out(CASING_DEPTH + 0.006), middle - half - CASING_WIDTH - 0.004, middle + half + CASING_WIDTH + 0.004, top + CASING_WIDTH + 0.012, top + CASING_WIDTH + 0.02, color);
}

/** The lining of a doorway: wood over the sides and the top of the opening, through the wall. */
function lining(ctx, axis, wall, middle, look) {
    const b = ctx.woodwork;
    const [color] = casingFinish(look, axis);
    b.finish(F_WOOD_Y, 0);
    const inset = 0.003;
    for (const e of [-1, 1]) {
        const s = middle + e * (HALF_DOOR - inset);
        const n = axis === 0 ? [0, 0, -e] : [-e, 0, 0];
        const corners = [at(ctx, axis, wall - HALF_WALL, s, 0), at(ctx, axis, wall + HALF_WALL, s, 0), at(ctx, axis, wall + HALF_WALL, s, DOOR_HEIGHT - inset), at(ctx, axis, wall - HALF_WALL, s, DOOR_HEIGHT - inset)];
        face4(b, corners, n, color);
    }
    const y = DOOR_HEIGHT - inset;
    const corners = [at(ctx, axis, wall - HALF_WALL, middle - HALF_DOOR, y), at(ctx, axis, wall + HALF_WALL, middle - HALF_DOOR, y), at(ctx, axis, wall + HALF_WALL, middle + HALF_DOOR, y), at(ctx, axis, wall - HALF_WALL, middle + HALF_DOOR, y)];
    face4(b, corners, [0, -1, 0], color);
}

// ---------------------------------------------------------------------------------------------- the doors that don't open

/**
 * A door that doesn't open (see HotelDoor), on both faces of its wall: its casing and its leaf, and on the side it
 * faces, its plate and number, and however it's been left. A lift's are brass, with the dial over them.
 */
function closedDoor(ctx, door) {
    const { axis } = door;
    const wall = (axis === 0 ? door.x : door.z) + 0.5;
    const middle = axis === 0 ? door.z : door.x;
    for (const side of [-1, 1]) {
        const [fx, fz] = axis === 0 ? [side > 0 ? door.x + 1 : door.x, door.z] : [door.x, side > 0 ? door.z + 1 : door.z];
        const look = lookAt(ctx, fx, fz);
        if (look < 0) continue;
        const front = side === door.front;
        if (door.kind === DOOR_ELEVATOR) {
            lift(ctx, door, axis, wall, side, middle, look, front);
            continue;
        }
        casing(ctx, axis, wall, side, middle, look, DOOR_HEIGHT, HALF_DOOR);
        leaf(ctx, door, axis, wall, side, middle, look, front);
    }
}

/**
 * A door's leaf on one face of its wall, and what's on it: its panels, its knob, and on the side it faces, its number
 * on a brass plate and a spyhole, a card on its handle, or light under it. One left ajar is all of that turned open a
 * crack on its hinges, towards you, and black behind.
 */
function leaf(ctx, door, axis, wall, side, middle, look, front) {
    const b = ctx.woodwork;
    const paint = ctx.paint;
    const surface = wall + side * HALF_WALL;
    const out = (d) => surface + side * d;
    const staff = door.kind === DOOR_STAFF;
    const ballroom = door.kind === DOOR_BALLROOM;
    const color = staff ? 0x4a5046 : ballroom ? CREAM_PAINT : 0x4a2818;
    const trim = ballroom ? GILT : staff ? 0x3e443a : 0x2a1208;
    const thick = 0.01;
    // Which side the handle's on (the hinges the other).
    const hand = (door.variant >>> 12) & 1 ? 1 : -1;
    const ajar = front && door.state === DOOR_AJAR;
    const bottom = front && door.state === DOOR_LIT ? 0.007 : 0.002;
    const fromWood = b.vertexCount;
    const fromPaint = paint.vertexCount;
    b.finish(staff || ballroom ? F_PAINT : F_WOOD_Y, (door.variant & 255) / 255);
    wallBox(ctx, b, axis, surface, out(thick), middle - HALF_DOOR, middle + HALF_DOOR, bottom, DOOR_HEIGHT - 0.002, color);
    // (Turned out from the wall, its back shows in the crack.)
    if (ajar) {
        const corners = [[-1, bottom], [1, bottom], [1, DOOR_HEIGHT - 0.002], [-1, DOOR_HEIGHT - 0.002]].map(([e, y]) => at(ctx, axis, surface, middle + e * HALF_DOOR, y));
        face4(b, corners, axis === 0 ? [-side, 0, 0] : [0, 0, -side], color);
    }
    // Its panels: two tall over two short, each a frame of moulding standing off the leaf.
    const panels = staff ? [[0.08, 0.36], [0.4, 0.66]] : [[0.06, 0.3], [0.36, 0.66]];
    b.finish(ballroom ? F_GILT : staff ? F_PAINT : F_WOOD_Y, 0.3);
    for (const [y0, y1] of panels) {
        for (const e of staff ? [0] : [-1, 1]) {
            const s0 = staff ? middle - 0.15 : middle + (e < 0 ? -0.18 : 0.025);
            const s1 = staff ? middle + 0.15 : middle + (e < 0 ? -0.025 : 0.18);
            const w = 0.011;
            const f0 = out(thick);
            const f1 = out(thick + 0.004);
            wallBox(ctx, b, axis, f0, f1, s0, s1, y0, y0 + w, trim);
            wallBox(ctx, b, axis, f0, f1, s0, s1, y1 - w, y1, trim);
            wallBox(ctx, b, axis, f0, f1, s0, s0 + w, y0 + w, y1 - w, trim);
            wallBox(ctx, b, axis, f0, f1, s1 - w, s1, y0 + w, y1 - w, trim);
        }
    }
    const handle = middle + hand * (HALF_DOOR - 0.026);
    knob(ctx, axis, out(thick), side, handle, staff ? 0x9ea4a5 : BRASS);
    if (front) {
        if (door.number > 0) {
            // The brass plate, with the number on it.
            const digits = String(door.number);
            const width = 0.022 + digits.length * 0.013;
            b.finish(F_GILT, 0.5);
            wallBox(ctx, b, axis, out(thick), out(thick + 0.0068), middle - width / 2, middle + width / 2, 0.555, 0.595, BRASS);
            digits.split('').forEach((d, k) => {
                const along = middle + (axis === 0 ? -side : side) * ((k - (digits.length - 1) / 2) * 0.0125);
                wallPicture(ctx, paint, axis, out(thick + 0.0072), side, along, 0.575, 0.0065, 0.0105, HOTEL_ATLAS.digits[Number(d)], 0x2a1a08);
            });
            // A spyhole.
            turned(b, ...at(ctx, axis, out(thick), middle, 0.52), ...(axis === 0 ? [side, 0, 0] : [0, 0, side]), [[0.006, 0], [0.006, 0.004], [0, 0.005]], 6, BRASS);
        }
        if (staff) wallPicture(ctx, paint, axis, out(thick + 0.0015), side, middle, 0.52, 0.09, 0.034, HOTEL_ATLAS.staff);
        if (door.state === DOOR_SIGN) {
            const card = (door.variant >>> 14) & 1 ? HOTEL_ATLAS.makeUp : HOTEL_ATLAS.doNotDisturb;
            wallPicture(ctx, paint, axis, out(thick + 0.012), side, handle, 0.325, 0.016, 0.032, card);
        }
    }
    if (ajar) {
        // Turned on its hinges (about the line up its hinged edge), the far edge towards you.
        const angle = 0.13;
        const [hx, , hz] = at(ctx, axis, surface, middle - hand * HALF_DOOR, 0);
        const yaw = (axis === 0 ? 1 : -1) * side * hand * angle;
        for (const [builder, from] of [[b, fromWood], [paint, fromPaint]]) {
            builder.transform(from, 0, -hx, -hz);
            builder.transform(from, yaw, hx, hz);
        }
        // The dark past it, in the opening.
        wallPicture(ctx, paint, axis, out(0.0015), side, middle, DOOR_HEIGHT / 2, HALF_DOOR, DOOR_HEIGHT / 2, HOTEL_ATLAS.black, 0x000000);
    }
    if (front && door.state === DOOR_LIT) {
        // Light under it: the gap along its foot, glowing, and a line of it on the carpet in front.
        const f = ctx.fittings;
        f.light(0, 0, 1.6);
        const n = axis === 0 ? [side, 0, 0] : [0, 0, side];
        face4(f, [at(ctx, axis, out(thick + 0.0005), middle - HALF_DOOR, 0), at(ctx, axis, out(thick + 0.0005), middle + HALF_DOOR, 0), at(ctx, axis, out(thick + 0.0005), middle + HALF_DOOR, bottom), at(ctx, axis, out(thick + 0.0005), middle - HALF_DOOR, bottom)], n, 0xffc070);
        f.light(0, 0, 0);
        spill(ctx, axis, surface, side, middle, door.variant);
    }
}

/** A door knob and the plate behind it, on the face towards `side`, at `along`. */
function knob(ctx, axis, face, side, along, color) {
    const b = ctx.woodwork;
    b.finish(F_GILT, 0.4);
    const [nx, nz] = axis === 0 ? [side, 0] : [0, side];
    const [px, py, pz] = at(ctx, axis, face, along, 0.36);
    wallBox(ctx, b, axis, face, face + side * 0.002, along - 0.009, along + 0.009, 0.33, 0.39, color);
    turned(b, px, py, pz, nx, 0, nz, [[0, 0.002], [0.006, 0.002], [0.004, 0.012], [0.011, 0.018], [0.012, 0.024], [0.008, 0.029], [0, 0.03]], 8, color);
}

/**
 * The light under a door, on the carpet in front of it (see the spill material in terrorHotelMaterials.js): its
 * texture coordinates are how far along the door (−0.5 to 0.5) and how far out from it, and its colour's red is the
 * door's own time.
 */
function spill(ctx, axis, surface, side, middle, variant) {
    const b = ctx.spill;
    const out = 0.34;
    const seed = ((variant >>> 3) & 255) / 255;
    const corners = [at(ctx, axis, surface, middle - HALF_DOOR - 0.04, 0.002), at(ctx, axis, surface, middle + HALF_DOOR + 0.04, 0.002), at(ctx, axis, surface + side * out, middle + HALF_DOOR + 0.04, 0.002), at(ctx, axis, surface + side * out, middle - HALF_DOOR - 0.04, 0.002)];
    // (Along: from the door's left to its right as you face it; out: from the door.)
    const flip = axis === 0 ? -side : side;
    face4(b, corners, [0, 1, 0], ((Math.round(seed * 255) & 255) << 16) | 0x0000ff, flip > 0 ? [0, 0, 1, 1] : [1, 0, 0, 1]);
}

/**
 * A lift, on one face of its wall: a bronze frame, two brass leaves, engraved, meeting in the middle (or in a lobby now
 * and then, an old one: a scissor gate of brass across the shaft, and nothing but dark behind it); over them the dial,
 * its needle on whatever floor it's on, under the cornice of the room in front (`look`); the call button beside, over
 * the chair rail. From behind, just the frame and doors.
 */
function lift(ctx, door, axis, wall, side, middle, look, front) {
    const b = ctx.woodwork;
    const surface = wall + side * HALF_WALL;
    const out = (d) => surface + side * d;
    const bronze = 0x5a3e1e;
    b.finish(F_GILT, 0.2);
    const half = HALF_DOOR;
    for (const e of [-1, 1]) wallBox(ctx, b, axis, surface, out(0.018), middle + e * half, middle + e * (half + LIFT_FRAME), 0, LIFT_HEIGHT, bronze);
    wallBox(ctx, b, axis, surface, out(0.018), middle - half - LIFT_FRAME, middle + half + LIFT_FRAME, LIFT_HEIGHT, LIFT_HEIGHT + 0.04, bronze);
    const right = axis === 0 ? -side : side;
    if (front && look === LOOK_LOBBY && ((door.variant >>> 24) & 3) === 0) {
        gate(ctx, axis, side, middle, out);
    } else {
        // The doors: brass, and the pattern on them.
        b.finish(F_GILT, 0.6);
        wallBox(ctx, b, axis, surface, out(0.008), middle - half, middle + half, 0.002, LIFT_HEIGHT, BRASS);
        if (!front) return;
        for (const e of [-1, 1]) {
            wallPicture(ctx, ctx.paint, axis, out(0.0092), side, middle + right * e * half / 2, LIFT_HEIGHT / 2, half / 2 - 0.004, LIFT_HEIGHT / 2 - 0.004, HOTEL_ATLAS.liftDoor, 0xffffff, e > 0);
        }
    }
    // The dial, in a brass surround: smaller, where a room's deep cornice comes down lower.
    const cornice = MOULDINGS[STYLE[look]].cornice?.[0];
    const y0 = LIFT_HEIGHT + 0.045;
    const scale = Math.min(1, ((cornice ? cornice[0][1] : WALL_HEIGHT) - 0.006 - y0) / 0.08);
    b.finish(F_GILT, 0.5);
    wallBox(ctx, b, axis, surface, out(0.012), middle - 0.1 * scale, middle + 0.1 * scale, y0, y0 + 0.08 * scale, bronze);
    const d = ctx.dials;
    const seed = ((door.variant >>> 5) & 255) / 255;
    wallPicture(ctx, d, axis, out(0.0138), side, middle, y0 + 0.04 * scale, 0.085 * scale, 0.036 * scale, [0, 0, HOTEL_ATLAS_SIZE, HOTEL_ATLAS_SIZE], (Math.round(seed * 255) << 8) | 0);
    wallPicture(ctx, ctx.paint, axis, out(0.0015), side, middle + right * (half + 0.1), 0.41, 0.018, 0.03, HOTEL_ATLAS.button);
}

/**
 * An old lift's scissor gate across its opening (see lift): the shaft black behind it, and in front, brass bars upright,
 * crossed on the diagonal between them, and a rail top and bottom.
 */
function gate(ctx, axis, side, middle, out) {
    const b = ctx.woodwork;
    const half = HALF_DOOR;
    wallPicture(ctx, ctx.paint, axis, out(0.0015), side, middle, LIFT_HEIGHT / 2, half, LIFT_HEIGHT / 2, HOTEL_ATLAS.black, 0x000000);
    b.finish(F_GILT, 0.5);
    const bars = 8;
    const [y0, y1] = [0.03, LIFT_HEIGHT - 0.03];
    const along = (k) => middle - half + 0.012 + ((2 * half - 0.024) * k) / bars;
    for (let k = 0; k <= bars; k++) rod(b, ...at(ctx, axis, out(0.012), along(k), 0.004), ...at(ctx, axis, out(0.012), along(k), LIFT_HEIGHT - 0.004), 0.0028, BRASS, 5);
    // The lattice: each bay crossed, in three tiers.
    const tiers = 3;
    for (let t = 0; t < tiers; t++) {
        const [ya, yb] = [y0 + ((y1 - y0) * t) / tiers, y0 + ((y1 - y0) * (t + 1)) / tiers];
        for (let k = 0; k < bars; k++) {
            rod(b, ...at(ctx, axis, out(0.016), along(k), ya), ...at(ctx, axis, out(0.016), along(k + 1), yb), 0.0018, BRASS, 4);
            rod(b, ...at(ctx, axis, out(0.016), along(k), yb), ...at(ctx, axis, out(0.016), along(k + 1), ya), 0.0018, BRASS, 4);
        }
    }
    for (const y of [0.012, LIFT_HEIGHT - 0.012]) rod(b, ...at(ctx, axis, out(0.013), middle - half, y), ...at(ctx, axis, out(0.013), middle + half, y), 0.005, BRASS, 5);
}

// ---------------------------------------------------------------------------------------------- sconces

/**
 * The sconces on the walls of the chunk's cells (see TerrorHotelData.sconces): a brass plate, an arm out to a bar
 * along the wall, and at each end of it a candle bulb in an amber tulip; lit with their light slot.
 */
function sconces(ctx) {
    const { data, x0, z0 } = ctx;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const bits = data.sconces[i * N + j];
            if (bits === 0) continue;
            const x = x0 + i;
            const z = z0 + j;
            for (const [di, dj, bit] of SCONCE_WALLS) {
                if (!(bits & bit) || ctx.store.edgeBetween(x, z, di, dj) !== EDGE_WALL) continue;
                sconce(ctx, x, z, di, dj);
            }
        }
    }
}

function sconce(ctx, x, z, di, dj) {
    const b = ctx.woodwork;
    const f = ctx.fittings;
    const axis = di !== 0 ? 0 : 1;
    const side = -(di + dj);
    const surface = (axis === 0 ? x : z) + (di + dj) * FACE;
    const along = axis === 0 ? z : x;
    const out = (d) => surface + side * d;
    const [nx, nz] = axis === 0 ? [side, 0] : [0, side];
    const [slotX, slotZ] = sconceSlot(x, z, di, dj);
    b.finish(F_GILT, 0.3);
    // The plate, a disc of brass.
    const [px, , pz] = at(ctx, axis, surface, along, 0);
    turned(b, px, SCONCE_Y - 0.02, pz, nx, 0, nz, [[0.026, 0], [0.026, 0.003], [0.018, 0.007], [0, 0.008]], 8, BRASS);
    // The arm out, and the bar across.
    const bar = SCONCE_Y - 0.04;
    rod(b, ...at(ctx, axis, out(0.006), along, SCONCE_Y - 0.02), ...at(ctx, axis, out(SCONCE_OUT - 0.012), along, bar + 0.012), 0.004, BRASS, 4);
    rod(b, ...at(ctx, axis, out(SCONCE_OUT - 0.012), along, bar + 0.012), ...at(ctx, axis, out(SCONCE_OUT), along, bar), 0.004, BRASS, 4);
    rod(b, ...at(ctx, axis, out(SCONCE_OUT), along - 0.05, bar), ...at(ctx, axis, out(SCONCE_OUT), along + 0.05, bar), 0.004, BRASS, 4);
    for (const e of [-1, 1]) {
        const [cx, , cz] = at(ctx, axis, out(SCONCE_OUT), along + e * 0.05, 0);
        // The cup, the candle.
        turned(b, cx, bar - 0.004, cz, 0, 1, 0, [[0, 0], [0.01, 0.004], [0.012, 0.01], [0.006, 0.016]], 6, BRASS);
        b.finish(F_PAINT, 0);
        turned(b, cx, bar + 0.012, cz, 0, 1, 0, [[0.0055, 0], [0.0055, 0.03], [0, 0.0305]], 5, CANDLE);
        b.finish(F_GILT, 0.3);
        // The bulb, a flame; and the tulip round it, open at the top.
        f.light(slotX, slotZ, 2.2);
        turned(f, cx, bar + 0.042, cz, 0, 1, 0, [[0, 0], [0.007, 0.008], [0.005, 0.018], [0, 0.026]], 5, BULB);
        f.light(slotX, slotZ, 0.9);
        turned(f, cx, bar + 0.02, cz, 0, 1, 0, [[0.006, 0], [0.016, 0.012], [0.025, 0.032], [0.028, 0.046]], 8, AMBER);
        f.light(slotX, slotZ, 0.3);
        turned(f, cx, bar + 0.02, cz, 0, 1, 0, [[0.0058, 0], [0.0155, 0.012], [0.0245, 0.032], [0.0275, 0.046]], 8, AMBER, true);
        f.light(0, 0, 0);
        const [gx, gy, gz] = at(ctx, axis, out(SCONCE_OUT), along + e * 0.05, bar + 0.05);
        ctx.glows.spot(gx, gy, gz, 0.16, -2 - ((slotX - x + 1) * 3 + (slotZ - z + 1)), 0.5, 1.2);
    }
}

// ---------------------------------------------------------------------------------------------- fittings

/** Each light slot's fitting (see TerrorHotelData.fixtures), and the glow round it. */
function fittings(ctx) {
    const { data, x0, z0 } = ctx;
    for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
        for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
            const kind = data.fixtures[pi * PANELS_PER_SIDE + pj];
            if (kind === 0) continue;
            const x = x0 + pi * 2 + 1;
            const z = z0 + pj * 2 + 1;
            const lx = x - ctx.ox;
            const lz = z - ctx.oz;
            if (kind === FIXTURE_BOWL) bowl(ctx, x, z, lx, lz);
            else if (kind === FIXTURE_LANTERN) lantern(ctx, x, z, lx, lz);
            else if (kind === FIXTURE_CHANDELIER) ironChandelier(ctx, x, z, lx, lz);
            else if (kind === FIXTURE_CRYSTAL) crystalChandelier(ctx, x, z, lx, lz);
            else if (kind === FIXTURE_BULB) staffBulb(ctx, x, z, lx, lz);
        }
    }
}

/** An alabaster bowl, close under the ceiling on three short chains from a brass collar. */
function bowl(ctx, x, z, lx, lz) {
    const b = ctx.woodwork;
    const f = ctx.fittings;
    b.finish(F_GILT, 0.3);
    turned(b, lx, WALL_HEIGHT - 0.016, lz, 0, 1, 0, [[0.012, 0], [0.024, 0.004], [0.026, 0.012], [0.02, 0.016]], 10, BRASS);
    for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        rod(b, lx + Math.cos(a) * 0.02, WALL_HEIGHT - 0.012, lz + Math.sin(a) * 0.02, lx + Math.cos(a) * 0.1, 0.935, lz + Math.sin(a) * 0.1, 0.0018, BRASS, 4);
    }
    hoop(b, lx, 0.935, lz, 0.104, 0.003, BRASS, 16);
    f.light(x, z, 1.25);
    turned(f, lx, 0.935, lz, 0, -1, 0, [[0.103, 0], [0.1, 0.012], [0.088, 0.026], [0.064, 0.036], [0.034, 0.041], [0, 0.043]], 16, ALABASTER);
    f.light(x, z, 0.5);
    turned(f, lx, 0.935, lz, 0, -1, 0, [[0.0985, 0], [0.0955, 0.012], [0.084, 0.024], [0.061, 0.034], [0.032, 0.039], [0, 0.041]], 16, ALABASTER, true);
    f.light(0, 0, 0);
    // A finial under it.
    b.finish(F_GILT, 0.3);
    turned(b, lx, 0.892, lz, 0, -1, 0, [[0, 0], [0.008, 0], [0.006, 0.01], [0, 0.018]], 8, BRASS);
    ctx.glows.spot(lx, 0.9, lz, 0.5, -1, 0.62, 0.8);
}

/**
 * A lantern of black iron and amber glass on a chain: a square roof over a band, four panes tapering up between the
 * corner posts, a band round their foot, and a square base coming to a point under it. (Square to the axes: its roof,
 * its bands and its base are flat-faced, their corners on the posts.)
 */
function lantern(ctx, x, z, lx, lz) {
    const b = ctx.woodwork;
    const f = ctx.fittings;
    const top = 0.83;
    const low = 0.7;
    // Half the width of the glass at its foot and at its top.
    const [w0, w1] = [0.05, 0.04];
    // (Across to a square's corner: its half width, on the diagonal.)
    const corner = (w) => w * Math.SQRT2;
    const square = (y, profile, dir = 1) => faceted(b, lx, y, lz, profile.map(([w, t]) => [corner(w), t]), 4, IRON, Math.PI / 4, dir);
    b.finish(F_PAINT, 0);
    rod(b, lx, WALL_HEIGHT, lz, lx, 0.872, lz, 0.0035, IRON, 4);
    // The roof, and a knob on it where the chain comes down.
    square(top + 0.004, [[0, 0], [0.057, 0], [0.057, 0.005], [0.014, 0.032], [0, 0.036]]);
    turned(b, lx, top + 0.034, lz, 0, 1, 0, [[0.006, 0], [0.008, 0.004], [0.006, 0.01], [0, 0.012]], 8, IRON);
    // The bands, top and foot.
    square(top - 0.004, [[0, 0], [w1 + 0.006, 0], [w1 + 0.006, 0.008], [0, 0.008]]);
    square(low - 0.006, [[0, 0], [w0 + 0.006, 0], [w0 + 0.006, 0.01], [0, 0.01]]);
    // The base, down to a point, and a ball under it.
    square(low - 0.006, [[w0 + 0.004, 0], [w0 + 0.004, 0.004], [0.014, 0.03], [0, 0.034]], -1);
    turned(b, lx, low - 0.058, lz, 0, 1, 0, [[0, 0], [0.006, 0.002], [0.008, 0.008], [0.006, 0.014], [0, 0.018]], 8, IRON);
    // The posts at the corners, just outside the glass.
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        rod(b, lx + sx * (w0 + 0.002), low - 0.002, lz + sz * (w0 + 0.002), lx + sx * (w1 + 0.002), top + 0.002, lz + sz * (w1 + 0.002), 0.0035, IRON, 4);
    }
    // The glass: four panes, lit, each leaning in a little as it goes up.
    f.light(x, z, 1.1);
    const lean = Math.hypot(top - low, w0 - w1);
    for (const [ax, az] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        // Across the pane, and its corners from its foot to its top.
        const [cx, cz] = [-az, ax];
        const at = (w, s, y) => [lx + ax * w + cx * s * w, y, lz + az * w + cz * s * w];
        face4(f, [at(w0, -1, low), at(w0, 1, low), at(w1, 1, top), at(w1, -1, top)], [(ax * (top - low)) / lean, (w0 - w1) / lean, (az * (top - low)) / lean], AMBER);
    }
    f.light(0, 0, 0);
    ctx.glows.spot(lx, 0.76, lz, 0.45, -1, 0.6, 1.1);
}

/** A ring of wrought iron hung on a chain, candle bulbs standing round it, scrolled arms in to its hub. */
function ironChandelier(ctx, x, z, lx, lz) {
    const b = ctx.woodwork;
    const f = ctx.fittings;
    const ring = 0.745;
    const R = 0.19;
    b.finish(F_PAINT, 0);
    rod(b, lx, WALL_HEIGHT, lz, lx, 0.8, lz, 0.004, IRON, 4);
    turned(b, lx, 0.8, lz, 0, -1, 0, [[0.006, 0], [0.018, 0.01], [0.022, 0.04], [0.014, 0.06], [0.02, 0.07], [0, 0.1]], 8, IRON);
    hoop(b, lx, ring, lz, R, 0.006, IRON, 20);
    hoop(b, lx, ring - 0.028, lz, R * 0.86, 0.004, IRON, 20);
    const candles = 8;
    for (let k = 0; k < candles; k++) {
        const a = (k / candles) * Math.PI * 2;
        const cx = lx + Math.cos(a) * R;
        const cz = lz + Math.sin(a) * R;
        // An arm in to the hub, curling up.
        rod(b, lx + Math.cos(a) * 0.02, 0.73, lz + Math.sin(a) * 0.02, lx + Math.cos(a) * R * 0.6, 0.705, lz + Math.sin(a) * R * 0.6, 0.004, IRON, 4);
        rod(b, lx + Math.cos(a) * R * 0.6, 0.705, lz + Math.sin(a) * R * 0.6, cx, ring, cz, 0.004, IRON, 4);
        turned(b, cx, ring, cz, 0, 1, 0, [[0, 0], [0.012, 0], [0.014, 0.008], [0.009, 0.012]], 6, IRON);
        b.finish(F_PAINT, 0);
        turned(b, cx, ring + 0.01, cz, 0, 1, 0, [[0.006, 0], [0.006, 0.04], [0, 0.041]], 6, CANDLE);
        f.light(x, z, 2.2);
        turned(f, cx, ring + 0.05, cz, 0, 1, 0, [[0, 0], [0.007, 0.007], [0.008, 0.014], [0.005, 0.024], [0, 0.03]], 7, BULB);
        f.light(0, 0, 0);
    }
    ctx.glows.spot(lx, ring + 0.06, lz, 0.62, -1, 0.72, 0.7);
}

/**
 * A great chandelier of crystal: a canopy at the ceiling, a column down, three tiers of arms and candle bulbs, and
 * strings of drops hanging all round, catching the light.
 */
function crystalChandelier(ctx, x, z, lx, lz) {
    const b = ctx.woodwork;
    const f = ctx.fittings;
    b.finish(F_GILT, 0.4);
    turned(b, lx, WALL_HEIGHT, lz, 0, -1, 0, [[0.09, 0], [0.09, 0.01], [0.04, 0.03], [0.01, 0.04]], 12, GILT);
    rod(b, lx, 0.97, lz, lx, 0.62, lz, 0.008, GILT, 6);
    const tiers = [[0.84, 0.13, 6], [0.74, 0.25, 10], [0.66, 0.17, 8]];
    for (const [y, R, arms] of tiers) {
        b.finish(F_GILT, 0.4);
        hoop(b, lx, y, lz, R, 0.005, GILT, 24);
        for (let k = 0; k < arms; k++) {
            const a = (k / arms) * Math.PI * 2 + y * 3;
            const cx = lx + Math.cos(a) * R;
            const cz = lz + Math.sin(a) * R;
            rod(b, lx, y - 0.02, lz, cx, y, cz, 0.004, GILT, 4);
            if (y > 0.7) {
                turned(b, cx, y, cz, 0, 1, 0, [[0, 0], [0.012, 0], [0.013, 0.008], [0.008, 0.011]], 6, GILT);
                b.finish(F_PAINT, 0);
                turned(b, cx, y + 0.008, cz, 0, 1, 0, [[0.0055, 0], [0.0055, 0.03], [0, 0.031]], 6, CANDLE);
                f.light(x, z, 2.4);
                turned(f, cx, y + 0.038, cz, 0, 1, 0, [[0, 0], [0.006, 0.006], [0.007, 0.012], [0.004, 0.02], [0, 0.026]], 7, BULB);
            }
            // A string of drops hanging from the end of the arm, each hung from the one over it, smaller as it goes down;
            // and a drop hung from the hoop between each arm and the next.
            f.light(x, z, 0.35, 1);
            const strand = y > 0.8 ? 3 : y > 0.7 ? 5 : 4;
            let hang = y - 0.003;
            for (let d = 1; d <= strand; d++) hang = drop(f, cx, hang, cz, 0.0078 - d * 0.0006);
            const b2 = a + Math.PI / arms;
            const along = R * Math.cos(Math.PI / 24);
            drop(f, lx + Math.cos(b2) * along, y - 0.004, lz + Math.sin(b2) * along, 0.01);
            f.light(0, 0, 0);
        }
    }
    f.light(x, z, 0.4, 1);
    prism(f, lx, 0.6, lz, 0.028, CRYSTAL);
    f.light(0, 0, 0);
    ctx.glows.spot(lx, 0.76, lz, 0.9, -1, 0.95, 0.9);
}

/** A drop hung by its top from (x, top, z), `r` across: where its bottom is (just into it, for the next to hang from). */
function drop(f, x, top, z, r) {
    prism(f, x, top - r * 1.6, z, r, CRYSTAL);
    return top - r * 3.8 + 0.0015;
}

/** A crystal drop: an octahedron, pointed top and bottom, its middle at (x, y, z), `r` across. */
function prism(f, x, y, z, r, color) {
    const top = [x, y + r * 1.6, z];
    const bottom = [x, y - r * 2.2, z];
    const ring = [[x + r, y, z], [x, y, z + r], [x - r, y, z], [x, y, z - r]];
    for (let k = 0; k < 4; k++) {
        const p = ring[k];
        const q = ring[(k + 1) % 4];
        for (const tip of [top, bottom]) {
            const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
            const v = [tip[0] - p[0], tip[1] - p[1], tip[2] - p[2]];
            let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const out = [(p[0] + q[0]) / 2 - x, 0, (p[2] + q[2]) / 2 - z];
            if (n[0] * out[0] + n[2] * out[2] < 0) n = n.map((c) => -c);
            const length = Math.hypot(...n) || 1;
            n = n.map((c) => c / length);
            const first = f.vertexCount;
            for (const c of [p, q, tip]) f.vertex(c[0], c[1], c[2], n[0], n[1], n[2], PLAIN[0], PLAIN[1], color);
            // Wound to face its normal.
            const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            if (cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] >= 0) f.triangle(first, first + 1, first + 2);
            else f.triangle(first, first + 2, first + 1);
        }
    }
}

/** A bulb in a white enamel shade on its flex, in the staff passages. */
function staffBulb(ctx, x, z, lx, lz) {
    const b = ctx.woodwork;
    const f = ctx.fittings;
    b.finish(F_PAINT, 0);
    rod(b, lx, WALL_HEIGHT, lz, lx, 0.87, lz, 0.002, 0x1a1a1a, 4);
    turned(b, lx, 0.875, lz, 0, -1, 0, [[0.012, 0], [0.03, 0.01], [0.06, 0.03], [0.07, 0.036]], 10, 0xe8e6de);
    turned(b, lx, 0.875, lz, 0, -1, 0, [[0.0115, 0], [0.0295, 0.0095], [0.0595, 0.0295], [0.0695, 0.0355]], 10, 0xf4f2ea, true);
    f.light(x, z, 2.0);
    turned(f, lx, 0.866, lz, 0, -1, 0, [[0.008, 0], [0.015, 0.012], [0.017, 0.022], [0.012, 0.032], [0, 0.036]], 8, BULB);
    f.light(0, 0, 0);
    ctx.glows.spot(lx, 0.845, lz, 0.36, -1, 0.55, 1);
}

// ---------------------------------------------------------------------------------------------- pipes

/** The staff passages' pipes: [how far out from the wall's face, how high, radius, colour, finish] each. */
const PIPES = [[0.034, 0.915, 0.017, 0x3a3e34, F_PAINT], [0.022, 0.958, 0.009, 0x9a5a30, F_GILT]];

/**
 * Along the top of the walls down one side of the staff passages (those on a cell's +x or +z side, so a run goes on
 * along its wall), two pipes on brackets: a painted main and a copper line over it, running on from cell to cell, over
 * the doorways, and turning into the wall where it ends; now and then a gauge on the main, its needle drifting (it's a
 * lift's dial: see FRAGMENT_DIAL in terrorHotelShading.js).
 */
function pipes(ctx) {
    const { store, x0, z0 } = ctx;
    const b = ctx.woodwork;
    const walled = (x, z, di, dj) => lookAt(ctx, x, z) === LOOK_STAFF && store.edgeBetween(x, z, di, dj) !== EDGE_NONE;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            if (lookAt(ctx, x, z) !== LOOK_STAFF) continue;
            for (const [di, dj] of SCONCE_WALLS) {
                if (di + dj < 0 || !walled(x, z, di, dj)) continue;
                const axis = di !== 0 ? 0 : 1;
                const side = -(di + dj);
                const face = (axis === 0 ? x : z) + (di + dj) * FACE;
                const along = axis === 0 ? z : x;
                // Where the wall ends, the pipes turn into it short of the end.
                const [ai, aj] = axis === 0 ? [0, 1] : [1, 0];
                const ends = [-1, 1].map((e) => (walled(x + ai * e, z + aj * e, di, dj) ? 0.5 : 0.44));
                for (const [out, y, r, color, finish] of PIPES) {
                    b.finish(finish, 0.4);
                    const across = face + side * out;
                    const points = [at(ctx, axis, across, along - ends[0], y), at(ctx, axis, across, along + ends[1], y)];
                    tube(b, points, r, r > 0.01 ? 6 : 5, color, false);
                    for (const [k, e] of [[0, -1], [1, 1]]) {
                        if (ends[k] === 0.5) continue;
                        tube(b, [at(ctx, axis, across, along + e * ends[k], y), at(ctx, axis, face - side * 0.01, along + e * ends[k], y)], r, 6, color, false);
                        turned(b, ...at(ctx, axis, across, along + e * ends[k], y), 0, 1, 0, [[0, -r], [r * 1.05, -r * 0.6], [r * 1.05, r * 0.6], [0, r]], 6, color);
                    }
                }
                // A bracket holding them to the wall in every cell.
                b.finish(F_PAINT, 0);
                wallBox(ctx, b, axis, face, face + side * 0.04, along - 0.007, along + 0.007, 0.89, 0.97, 0x1c1c1a);
                if (hashFloat(ctx.seed, 0x91e5, x, z, di * 3 + dj) < 0.08) gauge(ctx, axis, side, face, along + 0.22);
            }
        }
    }
}

/** A gauge on the main at `along`: a brass case on a stub, its face out into the passage. */
function gauge(ctx, axis, side, face, along) {
    const b = ctx.woodwork;
    const [out, y] = [PIPES[0][0], PIPES[0][1] - 0.04];
    b.finish(F_GILT, 0.5);
    rod(b, ...at(ctx, axis, face + side * out, along, PIPES[0][1]), ...at(ctx, axis, face + side * out, along, y + 0.022), 0.003, BRASS, 5);
    const n = axis === 0 ? [side, 0, 0] : [0, 0, side];
    turned(b, ...at(ctx, axis, face + side * (out - 0.008), along, y), ...n, [[0, 0], [0.022, 0], [0.024, 0.004], [0.024, 0.012], [0.02, 0.014]], 10, BRASS);
    wallPicture(ctx, ctx.dials, axis, face + side * (out + 0.0045), side, along, y, 0.019, 0.019, [0, 0, HOTEL_ATLAS_SIZE, HOTEL_ATLAS_SIZE], ((hashFloat(ctx.seed, 0x91e6, Math.round(along * 8), Math.round(face * 8)) * 255) & 255) << 8);
}

// ---------------------------------------------------------------------------------------------- columns and beams

/** How a column's shaft is turned, from its base up: [radius, height]. It swells a little, and narrows to its neck. */
const SHAFT = [[0.114, 0.1], [0.116, 0.3], [0.113, 0.55], [0.106, 0.8], [0.104, 0.84]];

/**
 * The columns (the level's pillars, on the corners of the chunk's cells): a square stone plinth, a round base of gilt
 * mouldings, a shaft of red scagliola, a gilt astragal and a capital flaring out under a square abacus, and the plaster
 * block it holds up under the ceiling. (Round everything but the plinth and the top: nothing of it reaches further out
 * than a column did before.)
 */
function columns(ctx) {
    const { chunk, x0, z0 } = ctx;
    const b = ctx.woodwork;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            if (!chunk.pillars[i * N + j]) continue;
            const x = x0 + i + 0.5 - ctx.ox;
            const z = z0 + j + 0.5 - ctx.oz;
            const wear = (i * 7 + j * 3) % 10;
            b.finish(F_STONE, wear);
            sides(b, x - 0.15, 0, z - 0.15, x + 0.15, 0.04, z + 0.15, STONE);
            b.finish(F_GILT, wear);
            turned(b, x, 0.04, z, 0, 1, 0, [[0.138, 0], [0.145, 0.008], [0.142, 0.018], [0.13, 0.024], [0.121, 0.03], [0.119, 0.037], [0.127, 0.043], [0.124, 0.05], [0.114, 0.056], [0.114, 0.06]], 20, GILT);
            b.finish(F_MARBLE, wear);
            turned(b, x, 0, z, 0, 1, 0, SHAFT, 20, MARBLE_BASE);
            b.finish(F_GILT, wear);
            turned(b, x, 0.84, z, 0, 1, 0, [[0.104, 0], [0.114, 0.008], [0.112, 0.016], [0.101, 0.02], [0.103, 0.028], [0.118, 0.05], [0.138, 0.07], [0.152, 0.082], [0.152, 0.09]], 20, GILT);
            sides(b, x - 0.165, 0.93, z - 0.165, x + 0.165, 0.955, z + 0.165, GILT);
            face4(b, [[x - 0.165, 0.93, z - 0.165], [x + 0.165, 0.93, z - 0.165], [x + 0.165, 0.93, z + 0.165], [x - 0.165, 0.93, z + 0.165]], [0, -1, 0], GILT);
            b.finish(F_PLASTER, wear);
            sides(b, x - 0.18, 0.955, z - 0.18, x + 0.18, WALL_HEIGHT, z + 0.18, PLASTER);
            face4(b, [[x - 0.18, 0.955, z - 0.18], [x + 0.18, 0.955, z - 0.18], [x + 0.18, 0.955, z + 0.18], [x - 0.18, 0.955, z + 0.18]], [0, -1, 0], PLASTER);
        }
    }
}

/** The lobbies' beams (see TerrorHotelData.beams): dark timber, their sides and undersides painted, a gilt bead along each edge. */
function beams(ctx) {
    const b = ctx.woodwork;
    const { beams: runs } = ctx.data;
    const y0 = 0.91;
    for (let k = 0; k < runs.length; k += 4) {
        const [ax, az, bx, bz] = [runs[k] - ctx.ox, runs[k + 1] - ctx.oz, runs[k + 2] - ctx.ox, runs[k + 3] - ctx.oz];
        const alongX = az === bz;
        b.finish(F_BEAM, alongX ? 0 : 1);
        if (alongX) sides(b, Math.min(ax, bx), y0, az - BEAM_HALF, Math.max(ax, bx), WALL_HEIGHT, az + BEAM_HALF, 0xffffff, false);
        else sides(b, ax - BEAM_HALF, y0, Math.min(az, bz), ax + BEAM_HALF, WALL_HEIGHT, Math.max(az, bz), 0xffffff, false);
        b.finish(F_GILT, 0.3);
        for (const e of [-1, 1]) {
            if (alongX) sides(b, Math.min(ax, bx), y0 - 0.006, az + e * BEAM_HALF - 0.004, Math.max(ax, bx), y0 + 0.004, az + e * BEAM_HALF + 0.004, GILT, false);
            else sides(b, ax + e * BEAM_HALF - 0.004, y0 - 0.006, Math.min(az, bz), ax + e * BEAM_HALF + 0.004, y0 + 0.004, Math.max(az, bz), GILT, false);
        }
    }
}

/**
 * A box's four sides, and its top where it's short of the ceiling, and its bottom where it's off the floor (a column's
 * pieces, stacked, or a beam: the faces against the ceiling, the floor or the piece below aren't drawn). `ends` false
 * leaves out its ends too (a beam's, against a wall or another beam).
 */
function sides(b, x0, y0, z0, x1, y1, z1, color, ends = true) {
    const alongX = x1 - x0 > z1 - z0;
    if (ends || alongX) {
        face4(b, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], color);
        face4(b, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], color);
    }
    if (ends || !alongX) {
        face4(b, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0], color);
        face4(b, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], color);
    }
    if (y1 < WALL_HEIGHT - 1e-6) face4(b, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], color);
    if (y0 > 1e-6 && !ends) face4(b, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], color);
}

// ---------------------------------------------------------------------------------------------- what the others need

/** Whether a face (the wall on side (di, dj) of cell (x, z)) has a door that doesn't open in it. */
export function doorIn(ctx, x, z, di, dj) {
    const [ex, ez, axis] = di !== 0 ? [di > 0 ? x : x - 1, z, 0] : [x, dj > 0 ? z : z - 1, 1];
    const cx = chunkCoord(ex);
    const cz = chunkCoord(ez);
    const data = ctx.store.getChunk(cx, cz).terrorHotel;
    return data ? data.doors.some((door) => door.x === ex && door.z === ez && door.axis === axis) : false;
}

