import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three';
import { CHUNK_SIZE, DOOR_HEIGHT, DOOR_WIDTH, HALF_CHUNK, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { ColorBuilder } from './ColorBuilder.js';
import { PROP_MONITOR } from './decorations.js';
import { PANELS_PER_SIDE } from './generator.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, chunkCoord } from './grid.js';
import {
    BOILER_LENGTH,
    BOILER_RADIUS,
    BOILER_Y,
    BUNDLE_Y,
    CELL_GALLERY,
    CELL_HALL,
    CELL_TUNNEL,
    CELL_X_TUNNEL,
    CELL_Z_TUNNEL,
    FAMILY_X,
    FAMILY_Z,
    FINISH_BRASS,
    FINISH_CLAD,
    FINISH_COPPER,
    FINISH_GALVANISED,
    FINISH_IRON,
    FINISH_LAGGED,
    FINISH_PAINT,
    FINISH_RUST,
    FIRE_Y,
    FIXTURE_BATTEN,
    FIXTURE_BULB,
    FIXTURE_CAGE,
    FIXTURE_NONE,
    FIXTURE_SHADE,
    MACHINE_BOILER,
    MACHINE_HEADER,
    MACHINE_PUMP,
    MACHINE_TANK,
    TRACKS,
    TRACK_GAP,
    ceilingBundle,
    faceOf,
    faceTracks,
    firePhase,
    firePlace,
    lineAt,
    lineSpace,
    tankRadius,
    trackFinish,
    tunnelFloor,
} from './pipeDreams.js';
import { PAINT_ATLAS, PAINT_ATLAS_SIZE, stencilRect } from './pipeDreamsTextures.js';
import { hashFloat, hashInts, mulberry32 } from './random.js';

/*
 * What Level 2 has that Level 0 doesn't, as meshes for one chunk (see pipeDreams.js for where it all goes):
 *
 * - the pipes along the walls: on the tracks in pipeDreams.js, each wall carrying the ones of the space it faces, so
 *   they run the length of a tunnel. They're worked out from the walls themselves, so they follow any you build. Where
 *   a wall stops, a pipe bends round the corner onto the next one if that one has the same pipe, crosses the opening
 *   to the wall on the far side (the high ones), or bends into the wall (or the floor). They go into a wall across
 *   their way, and round a doorway they go into the wall and come back out on its other side (all but the ones over
 *   it). Each hangs on steel channel fixed to the wall, and has its valves, gauges, flanges and labels;
 * - the pipes under the ceiling of every tunnel, on hangers, and its lamp: a caged bulb, a shade, a bare bulb or a
 *   batten (lit like Level 0's panels), and the glow round each;
 * - the concrete ledge along one side of some tunnels (built with the walls, which are the same concrete), the steel
 *   frames of the doorways, the locked doors, the signs and the stencils;
 * - the machines in the plant halls: boilers (with the fire in their fireboxes), tanks, pumps and valve headers;
 * - the steam coming out of the leaks, and the black stuff coming out of others: a streak down the wall, and a puddle.
 *
 * Positions are relative to the chunk's centre. Pipes are round in 8 or 12 sides, and every ring of one is turned the
 * same way (see ring), so pieces meet without a crack.
 */

const N = CHUNK_SIZE;
const HALF_WALL = WALL_THICKNESS / 2;
/** Which tracks cross an opening in a wall along z (axis 0) and along x (axis 1): never the same height both ways. */
const BRIDGES = [[4], [3, 5]];
/** How far either side of a doorway's middle the low pipes keep: clear of its frame. */
const DOOR_CLEAR = DOOR_WIDTH / 2 + 0.034;
const FRAME_WIDTH = 0.03;
const FRAME_DEPTH = 0.012;
/** A pipe's bend into the floor: from its track's height (the lowest's) right down to it. */
const FLOOR_BEND = 0.075;
const FRAME_COLORS = [0x2f4a37, 0x3a3d40, 0x5b1f19, 0x44505b];
const STRUT = 0x5f6466;
const IRON = 0x2b2927;
const WHEEL_COLORS = [0xa3261c, 0xa3261c, 0x1f1f1f, 0xb8912c];
const BRASS = 0xb08d3c;
const INK = 0x1c1b1a;
const LAMP_WHITE = 0xfff4e6;
const CAGE = 0x232425;
const SHADE_GREEN = 0x2f4d3a;

/** Round everything a chunk's meshes have (some of it reaches a cell or so into the next): see ColorBuilder.build. */
const CHUNK_BOUNDS = new Sphere(new Vector3(0, WALL_HEIGHT / 2, 0), Math.hypot(HALF_CHUNK + 1.5, HALF_CHUNK + 1.5, WALL_HEIGHT));

// One set of builders serves every chunk, as building one runs start to finish.
const pipesBuilder = new ColorBuilder('finish');
const fixturesBuilder = new ColorBuilder();
const glowsBuilder = new ColorBuilder('glow');
const paintBuilder = new ColorBuilder();
const gooBuilder = new ColorBuilder();
const fireBuilder = new ColorBuilder();
const gaugesBuilder = new ColorBuilder();

/**
 * Level 2's own meshes for one chunk (its `shape.extras`; see levels.js), by the name of the material that draws each.
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {import('./generator.js').ChunkData} chunk
 * @param {{ pillars: import('./GeometryBuilder.js').GeometryBuilder, shade: import('./GeometryBuilder.js').GeometryBuilder }} builders
 *     The walls' (the pillars are built with them), to add the ledges to; and the soft shadows', to add the machines' to.
 */
export function buildPipeDreamsGeometry(store, chunk, { pillars, shade }) {
    const data = /** @type {import('./pipeDreams.js').PipeDreamsData} */ (chunk.pipeDreams);
    // What leaks from a pipe on a wall goes with the wall, if edit mode's taken it down.
    const leaks = data.leaks.filter((leak) => !leak.wall || store.edgeBetween(Math.round(leak.x), Math.round(leak.z), leak.wall[0], leak.wall[1]) !== EDGE_NONE);
    const goo = data.goo.filter((drip) => store.edgeBetween(Math.round(drip.x), Math.round(drip.z), -drip.nx, -drip.nz) === EDGE_WALL);
    const ctx = {
        store,
        seed: store.seed,
        chunk,
        data,
        x0: chunk.cx * N - HALF_CHUNK,
        z0: chunk.cz * N - HALF_CHUNK,
        ox: chunk.cx * N,
        oz: chunk.cz * N,
        faces: new Map(),
        // The cells with a TV in them: a tape's notes are there.
        noted: new Set(chunk.props.filter((prop) => prop.type === PROP_MONITOR).map((prop) => Math.round(prop.x) * 65536 + Math.round(prop.z))),
        pipes: pipesBuilder.reset(),
        fixtures: fixturesBuilder.reset(),
        glows: glowsBuilder.reset(),
        paint: paintBuilder.reset(),
        goo: gooBuilder.reset(),
        fire: fireBuilder.reset(),
        gauges: gaugesBuilder.reset(),
        walls: pillars,
        shade,
    };
    wallPipes(ctx);
    doorFrames(ctx);
    ceilingPipes(ctx);
    if (chunk.cx === 0 && chunk.cz === 0 && !store.options.isVoid?.(0, 0)) galleryRack(ctx);
    lamps(ctx);
    for (const machine of data.machines) buildMachine(ctx, machine);
    gooLeaks(ctx, goo);
    vents(ctx, leaks);
    return {
        pipes: ctx.pipes.build(CHUNK_BOUNDS),
        fixtures: ctx.fixtures.build(CHUNK_BOUNDS),
        glows: ctx.glows.build(CHUNK_BOUNDS),
        paint: ctx.paint.build(CHUNK_BOUNDS),
        goo: ctx.goo.build(CHUNK_BOUNDS),
        fire: ctx.fire.build(CHUNK_BOUNDS),
        gauges: ctx.gauges.build(CHUNK_BOUNDS),
        steam: buildSteam(leaks, goo, ctx.ox, ctx.oz),
    };
}

// ---------------------------------------------------------------------------------------------- pipe pieces

/**
 * The way round a pipe at a point on it: `u` and `v` across it (u × v along it). Along a horizontal pipe `u` is up,
 * along an upright one it's x; every bend keeps its `u` square to the plane it bends in, which is one of those (or
 * the other horizontal), so rings at the ends of pieces that meet line up (their sides being a multiple of four).
 */
function ringBasis(tx, ty, tz, out, ux = null, uy = 0, uz = 0) {
    if (ux === null) {
        if (Math.abs(ty) < 0.9) {
            ux = 0;
            uy = 1;
            uz = 0;
        } else {
            ux = 1;
            uy = 0;
            uz = 0;
        }
        // (Square to a pipe that slopes: a handwheel's spokes.)
        const along = ux * tx + uy * ty + uz * tz;
        ux -= tx * along;
        uy -= ty * along;
        uz -= tz * along;
        const length = Math.hypot(ux, uy, uz);
        ux /= length;
        uy /= length;
        uz /= length;
    }
    // v = t × u
    out[0] = ux;
    out[1] = uy;
    out[2] = uz;
    out[3] = ty * uz - tz * uy;
    out[4] = tz * ux - tx * uz;
    out[5] = tx * uy - ty * ux;
}

const _basis = new Float64Array(6);

/** @type {Map<number, Float64Array>} */
const circles = new Map();

/** The cosine and sine of each step k = 0..sides round a circle of `sides` steps, as [cos, sin, cos, sin, ...]. */
function circle(sides) {
    let table = circles.get(sides);
    if (!table) {
        table = new Float64Array((sides + 1) * 2);
        for (let k = 0; k <= sides; k++) {
            const angle = (k / sides) * Math.PI * 2;
            table[k * 2] = Math.cos(angle);
            table[k * 2 + 1] = Math.sin(angle);
        }
        circles.set(sides, table);
    }
    return table;
}

/** One ring of a pipe: `sides` + 1 vertices round (px, py, pz), radius r, `along` its length for the lagging. */
function ring(b, px, py, pz, tx, ty, tz, r, sides, along, color, ux = null, uy = 0, uz = 0) {
    ringBasis(tx, ty, tz, _basis, ux, uy, uz);
    const [a0, a1, a2, b0, b1, b2] = _basis;
    const round = circle(sides);
    for (let k = 0; k <= sides; k++) {
        const c = round[k * 2];
        const s = round[k * 2 + 1];
        const nx = a0 * c + b0 * s;
        const ny = a1 * c + b1 * s;
        const nz = a2 * c + b2 * s;
        b.vertex(px + nx * r, py + ny * r, pz + nz * r, nx, ny, nz, along, k / sides, color);
    }
}

/** Joins `count` rings of `sides` + 1 vertices, starting at vertex `first`, into a tube facing out. */
function joinRings(b, first, count, sides) {
    const stride = sides + 1;
    for (let j = 0; j < count - 1; j++) {
        for (let k = 0; k < sides; k++) {
            const a = first + j * stride + k;
            b.triangle(a, a + stride + 1, a + stride);
            b.triangle(a, a + 1, a + stride + 1);
        }
    }
}

function sidesFor(r) {
    return r >= 0.045 ? 12 : 8;
}

/** A straight pipe from a to b (no ends: they're in something, or meet another piece). */
function tube(b, ax, ay, az, bx, by, bz, r, color, along = 0, sides = sidesFor(r)) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-4) return;
    const tx = dx / length;
    const ty = dy / length;
    const tz = dz / length;
    const first = b.vertexCount;
    ring(b, ax, ay, az, tx, ty, tz, r, sides, along, color);
    ring(b, bx, by, bz, tx, ty, tz, r, sides, along + length, color);
    joinRings(b, first, 2, sides);
}

/**
 * A bend of a quarter turn: starting at s going along a (unit), turning towards c (unit, square to a), round a
 * radius R.
 */
function bend(b, sx, sy, sz, ax, ay, az, cx, cy, cz, R, r, color, along = 0, segments = r < 0.03 ? 2 : 3) {
    const sides = sidesFor(r);
    // The plane it bends in: its normal is u all round.
    const mx = ay * cz - az * cy;
    const my = az * cx - ax * cz;
    const mz = ax * cy - ay * cx;
    const ox = sx + cx * R;
    const oy = sy + cy * R;
    const oz = sz + cz * R;
    const first = b.vertexCount;
    for (let j = 0; j <= segments; j++) {
        const phi = (j / segments) * (Math.PI / 2);
        const co = Math.cos(phi);
        const si = Math.sin(phi);
        ring(
            b,
            ox - cx * R * co + ax * R * si,
            oy - cy * R * co + ay * R * si,
            oz - cz * R * co + az * R * si,
            ax * co + cx * si,
            ay * co + cy * si,
            az * co + cz * si,
            r,
            sides,
            along + R * phi,
            color,
            mx,
            my,
            mz,
        );
    }
    joinRings(b, first, segments + 1, sides);
}

/** A flat disc facing (nx, ny, nz). */
function disc(b, px, py, pz, nx, ny, nz, r, color, sides = sidesFor(r)) {
    ringBasis(nx, ny, nz, _basis);
    const [a0, a1, a2, b0, b1, b2] = _basis;
    const centre = b.vertex(px, py, pz, nx, ny, nz, 0, 0.5, color);
    const first = b.vertexCount;
    const round = circle(sides);
    for (let k = 0; k < sides; k++) {
        const c = round[k * 2];
        const s = round[k * 2 + 1];
        b.vertex(px + (a0 * c + b0 * s) * r, py + (a1 * c + b1 * s) * r, pz + (a2 * c + b2 * s) * r, nx, ny, nz, 0, 0.5, color);
    }
    for (let k = 0; k < sides; k++) b.triangle(centre, first + k, first + ((k + 1) % sides));
}

/**
 * A short, wider piece round a pipe along (tx, ty, tz), centred at p: a flange, a clamp (no ends), or a collar where it
 * goes into something (the end facing t only).
 * @param {'both' | 'none' | 'front'} [ends]
 * @param {number} [sides]
 */
function band(b, px, py, pz, tx, ty, tz, r, width, color, ends = 'both', sides = sidesFor(r)) {
    const h = width / 2;
    tube(b, px - tx * h, py - ty * h, pz - tz * h, px + tx * h, py + ty * h, pz + tz * h, r, color, 0, sides);
    if (ends !== 'none') disc(b, px + tx * h, py + ty * h, pz + tz * h, tx, ty, tz, r, color, sides);
    if (ends === 'both') disc(b, px - tx * h, py - ty * h, pz - tz * h, -tx, -ty, -tz, r, color, sides);
}

/** A ring of pipe round a circle (a handwheel's rim), centre c, in the plane square to n, radius R. */
function hoop(b, px, py, pz, nx, ny, nz, R, r, color, segments = 12) {
    ringBasis(nx, ny, nz, _basis);
    const [e0, e1, e2, f0, f1, f2] = _basis;
    const sides = 4;
    const first = b.vertexCount;
    for (let j = 0; j <= segments; j++) {
        const phi = (j / segments) * Math.PI * 2;
        const co = Math.cos(phi);
        const si = Math.sin(phi);
        ring(b, px + (e0 * co + f0 * si) * R, py + (e1 * co + f1 * si) * R, pz + (e2 * co + f2 * si) * R, -e0 * si + f0 * co, -e1 * si + f1 * co, -e2 * si + f2 * co, r, sides, 0, color, nx, ny, nz);
    }
    joinRings(b, first, segments + 1, sides);
}

/**
 * Something turned on a lathe, standing upright at (x, z): `profile` is [radius, y] from the top down. Faces out, or
 * with `inward` in (the inside of a lamp's shade).
 */
function lathe(b, x, z, profile, sides, color, inward = false) {
    const first = b.vertexCount;
    for (let j = 0; j < profile.length; j++) {
        const [r, y] = profile[j];
        // The profile's slope here, for the normal.
        const [r0, y0] = profile[Math.max(0, j - 1)];
        const [r1, y1] = profile[Math.min(profile.length - 1, j + 1)];
        // (Down the profile, (dr, dy) turned a quarter, to (−dy, dr), points out.)
        let nr = y0 - y1;
        let ny = r1 - r0;
        const length = Math.hypot(nr, ny) || 1;
        nr /= length;
        ny /= length;
        const flip = inward ? -1 : 1;
        const round = circle(sides);
        for (let k = 0; k <= sides; k++) {
            const c = round[k * 2];
            const s = round[k * 2 + 1];
            b.vertex(x + c * r, y, z + s * r, c * nr * flip, ny * flip, s * nr * flip, 0, 0.5, color);
        }
    }
    const stride = sides + 1;
    for (let j = 0; j < profile.length - 1; j++) {
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

/** A picture from the paint atlas as UVs. @returns {number[]} [u0, v0, u1, v1] */
function atlasUv([x0, y0, x1, y1]) {
    return [x0 / PAINT_ATLAS_SIZE, 1 - y1 / PAINT_ATLAS_SIZE, x1 / PAINT_ATLAS_SIZE, 1 - y0 / PAINT_ATLAS_SIZE];
}

/**
 * A picture flat on a wall facing (nx, 0, nz), centred at (x, y, z), half-size hw × hh; left to right as you face it.
 */
function wallPicture(b, x, y, z, nx, nz, hw, hh, rect, color = 0xffffff) {
    const [u0, v0, u1, v1] = atlasUv(rect);
    const rx = nz * hw;
    const rz = -nx * hw;
    b.quad(x - rx, y - hh, z - rz, x + rx, y - hh, z + rz, x + rx, y + hh, z + rz, x - rx, y + hh, z - rz, nx, 0, nz, color, u0, v0, u1, v1);
}

/** A picture flat on the floor, centred at (x, z), half-size hw × hl, turned by `angle`. */
function floorPicture(b, x, z, hw, hl, angle, rect, y = 0.002, color = 0xffffff) {
    const [u0, v0, u1, v1] = atlasUv(rect);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    b.quad(
        x - hw * cos - hl * sin, y, z - hw * sin + hl * cos,
        x + hw * cos - hl * sin, y, z + hw * sin + hl * cos,
        x + hw * cos + hl * sin, y, z + hw * sin - hl * cos,
        x - hw * cos + hl * sin, y, z - hw * sin - hl * cos,
        0, 1, 0, color, u0, v0, u1, v1,
    );
}

// ---------------------------------------------------------------------------------------------- the walls' faces

/**
 * @typedef {object} Face One side of one cell's worth of wall: axis 0 is a wall on the plane x = p + 0.5 (running along
 *     z, which is `s`), axis 1 on z = p + 0.5 (running along x); `side` is which way it faces.
 * @property {number} edge EDGE_WALL or EDGE_DOOR.
 * @property {number} kind What the cell it faces is (CELL_*).
 * @property {Int16Array} tracks Its pipes (see faceTracks).
 * @property {boolean} ledge A ledge along its foot.
 * @property {boolean} door A doorway in it (a real one, or a locked door the pipes go round the same way).
 * @property {boolean} locked
 */

const _cell = { kind: 0, sx: 0, sz: 0 };

/** What's in cell (x, z), wherever it is (see PipeDreamsData). The object is reused. */
function cellAt(ctx, x, z) {
    const cx = chunkCoord(x);
    const cz = chunkCoord(z);
    const data = ctx.store.getChunk(cx, cz).pipeDreams;
    const cell = (x - cx * N + HALF_CHUNK) * N + (z - cz * N + HALF_CHUNK);
    _cell.kind = data ? data.kinds[cell] : 0;
    _cell.sx = data ? data.spaces[cell * 2] : 0;
    _cell.sz = data ? data.spaces[cell * 2 + 1] : 0;
    return _cell;
}

/** The type of the edge on plane `p` of an axis at `s`. */
function planeEdge(store, axis, p, s) {
    return axis === 0 ? store.edge(p, s, 0) : store.edge(s, p, 1);
}

/** The cell on the `side` of plane p at s. */
function frontCell(axis, p, s, side) {
    const a = side > 0 ? p + 1 : p;
    return axis === 0 ? [a, s] : [s, a];
}

const NO_TRACKS = new Int16Array(TRACKS.length).fill(-1);

/** @returns {Face | null} */
function face(ctx, axis, p, s, side) {
    const key = ((p + 1048576) * 2097152 + (s + 1048576)) * 4 + axis * 2 + (side > 0 ? 1 : 0);
    let found = ctx.faces.get(key);
    if (found !== undefined) return found;
    found = null;
    const edge = planeEdge(ctx.store, axis, p, s);
    if (edge !== EDGE_NONE) {
        const [fx, fz] = frontCell(axis, p, s, side);
        const cell = cellAt(ctx, fx, fz);
        const kind = cell.kind;
        // A wall along z faces what's along z, and one along x what's along x.
        const space = axis === 0 ? cell.sz : cell.sx;
        let tracks = space === 0 ? NO_TRACKS : faceTracks(space, faceOf(kind));
        const onLine = axis === 0 ? kind & (CELL_Z_TUNNEL | CELL_GALLERY) : kind & CELL_X_TUNNEL;
        const ledge = onLine !== 0 && tunnelFloor(space).ledge === -side;
        if (ledge && tracks[0] >= 0) {
            tracks = tracks.slice();
            tracks[0] = -1;
        }
        let locked = false;
        if (edge === EDGE_WALL && kind & CELL_TUNNEL && hashFloat(ctx.seed, 0xd00e, axis, p, s) < 0.035) {
            const [bx, bz] = frontCell(axis, p, s, -side);
            // (Not behind a tape's note, which would hang on it.)
            locked = (cellAt(ctx, bx, bz).kind & CELL_TUNNEL) === 0 && !ctx.store.propsAt(fx, fz).some((prop) => prop.type === PROP_MONITOR);
        }
        found = { edge, kind, tracks, ledge, door: edge === EDGE_DOOR || locked, locked };
    }
    ctx.faces.set(key, found);
    return found;
}

/** Track k's pipe on a face (its palette entry), or −1. */
function trackOn(ctx, axis, p, s, side, k) {
    const f = face(ctx, axis, p, s, side);
    return f ? f.tracks[k] : -1;
}

/**
 * The edge across the way along a wall, on its `side`: between the cells in front of it at s and at s + dir. A wall
 * there is an inside corner.
 */
function acrossEdge(ctx, axis, p, s, side, dir) {
    const [fx, fz] = frontCell(axis, p, s, side);
    return axis === 0 ? ctx.store.edgeBetween(fx, fz, 0, dir) : ctx.store.edgeBetween(fx, fz, dir, 0);
}

/** Where along it, and in what, a wall's pipe goes: s, across and y as world x, y, z (relative to the chunk). */
function place(ctx, axis, s, a, y) {
    return axis === 0 ? [a - ctx.ox, y, s - ctx.oz] : [s - ctx.ox, y, a - ctx.oz];
}

/** A unit direction along s (the wall), across it, or up. */
function alongDir(axis, sign) {
    return axis === 0 ? [0, 0, sign] : [sign, 0, 0];
}
function acrossDir(axis, sign) {
    return axis === 0 ? [sign, 0, 0] : [0, 0, sign];
}

// ---------------------------------------------------------------------------------------------- pipes on the walls

/** How far a track's pipe is from the middle of the wall it's on. */
function trackOut(k) {
    return HALF_WALL + TRACKS[k].r + TRACK_GAP;
}

function elbowRadius(r) {
    return Math.max(r * 1.5, 0.02);
}

/** Every wall face whose cell is in the chunk: its pipes, a run at a time, and what's fixed to it. */
function wallPipes(ctx) {
    for (const axis of [0, 1]) {
        const acrossFrom = axis === 0 ? ctx.x0 : ctx.z0;
        const alongFrom = axis === 0 ? ctx.z0 : ctx.x0;
        for (let p = acrossFrom - 1; p < acrossFrom + N; p++) {
            for (const side of [-1, 1]) {
                const front = side > 0 ? p + 1 : p;
                if (front < acrossFrom || front >= acrossFrom + N) continue;
                for (let k = 0; k < TRACKS.length; k++) {
                    let s = alongFrom;
                    while (s < alongFrom + N) {
                        const entry = trackOn(ctx, axis, p, s, side, k);
                        if (entry < 0) {
                            s++;
                            continue;
                        }
                        // As far as the same pipe goes along the wall without a wall across its way.
                        let e = s;
                        while (e + 1 < alongFrom + N && trackOn(ctx, axis, p, e + 1, side, k) === entry && acrossEdge(ctx, axis, p, e, side, 1) === EDGE_NONE) e++;
                        pipeRun(ctx, axis, p, side, k, entry, s, e);
                        s = e + 1;
                    }
                }
                for (let s = alongFrom; s < alongFrom + N; s++) {
                    const f = face(ctx, axis, p, s, side);
                    if (f) wallFixtures(ctx, f, axis, p, s, side);
                }
            }
        }
    }
}

/**
 * @typedef {object} RunEnd How a run of pipe ends: where along the wall its straight stops, and what it does there.
 * @property {number} at
 * @property {'flush' | 'cap' | 'into' | 'corner' | 'turn' | 'wall' | 'floor'} fit
 */

/** One run of track k's pipe along a wall, from face sa to face sb: its straights, cut round doorways, and its ends. */
function pipeRun(ctx, axis, p, side, k, entry, sa, sb) {
    const { r, y, low } = TRACKS[k];
    const [finish, color] = trackFinish(k, entry);
    const a = p + 0.5 + side * trackOut(k);
    const wear = hashFloat(ctx.seed, 0x9e1, axis, p * 8 + k, sa);
    ctx.pipes.finish(finish, wear);
    const start = runEnd(ctx, axis, p, side, k, entry, sa, -1);
    const end = runEnd(ctx, axis, p, side, k, entry, sb, 1);
    // The pieces between doorways (only the low pipes go round them).
    let from = start;
    for (let s = sa; s <= sb && low; s++) {
        const f = face(ctx, axis, p, s, side);
        if (!f?.door) continue;
        const to = { at: 0, fit: k === 0 ? 'floor' : 'wall' };
        to.at = endAt(k, to.fit, s - DOOR_CLEAR, 1);
        piece(ctx, axis, p, side, k, a, y, r, color, from, to);
        from = { fit: to.fit, at: endAt(k, to.fit, s + DOOR_CLEAR, -1) };
    }
    piece(ctx, axis, p, side, k, a, y, r, color, from, end);
}

/** Where a pipe's straight stops to bend into the wall (or floor) before an end of wall at `wallEnd`, going `dir`. */
function endAt(k, fit, wallEnd, dir) {
    const { r } = TRACKS[k];
    const R = fit === 'floor' ? FLOOR_BEND : r + TRACK_GAP;
    return wallEnd - dir * (R + r + 0.003);
}

/** A straight from one end to the other, and the ends. */
function piece(ctx, axis, p, side, k, a, y, r, color, start, end) {
    if (end.at - start.at > 1e-4) {
        const [ax, ay, az] = place(ctx, axis, start.at, a, y);
        const [bx, by, bz] = place(ctx, axis, end.at, a, y);
        tube(ctx.pipes, ax, ay, az, bx, by, bz, r, color, start.at);
    }
    fitting(ctx, axis, p, side, k, a, y, r, color, start, -1);
    fitting(ctx, axis, p, side, k, a, y, r, color, end, 1);
}

/**
 * How a run ends, going `dir` from its last face sEnd: carrying on into the next chunk; at a wall across its way (round
 * the corner onto it if it has the same pipe, else into it); at a change of pipe along the wall; or at the end of the
 * wall (across the opening, round the corner, or into the wall).
 * @returns {RunEnd}
 */
function runEnd(ctx, axis, p, side, k, entry, sEnd, dir) {
    const out = trackOut(k);
    const { r } = TRACKS[k];
    const boundary = sEnd + dir * 0.5;
    const next = sEnd + dir;
    if (acrossEdge(ctx, axis, p, sEnd, side, dir) !== EDGE_NONE) {
        // An inside corner: the wall across the end, and its face towards this one.
        const plane = dir > 0 ? sEnd : next;
        const front = side > 0 ? p + 1 : p;
        const theirs = trackOn(ctx, 1 - axis, plane, front, -dir, k);
        if (theirs === entry) return { at: boundary - dir * (out + elbowRadius(r)), fit: 'corner' };
        // (Theirs is a different pipe at the same height, and goes into this wall: this one stops short of it.)
        if (theirs >= 0 && axis === 1) return { at: boundary - dir * (out + r + 0.012), fit: 'cap' };
        return { at: boundary, fit: 'into' };
    }
    const nextFace = face(ctx, axis, p, next, side);
    if (nextFace && nextFace.tracks[k] === entry) return { at: boundary, fit: 'flush' };
    if (nextFace) return { at: boundary - dir * 0.03, fit: 'cap' };
    const gap = bridgeGap(ctx, axis, p, side, k, entry, sEnd, dir);
    // Across the opening: the one before it goes over, and the one after starts where it lands.
    if (gap > 0) return { at: dir > 0 ? sEnd + dir * (gap + 0.5) : boundary, fit: 'flush' };
    if (turns(ctx, axis, p, side, k, entry, sEnd, dir)) return { at: boundary + dir * HALF_WALL, fit: 'turn' };
    const fit = k === 0 ? 'floor' : 'wall';
    return { at: endAt(k, fit, boundary + dir * HALF_WALL, dir), fit };
}

/**
 * Whether a high pipe crosses the opening at the end of its wall to the same wall going on beyond it, one or two cells
 * on (with nothing across its way between): how many cells, or 0.
 */
function bridgeGap(ctx, axis, p, side, k, entry, sEnd, dir) {
    if (!BRIDGES[axis].includes(k)) return 0;
    for (let gap = 1; gap <= 2; gap++) {
        const far = sEnd + dir * (gap + 1);
        if (face(ctx, axis, p, sEnd + dir * gap, side)) return 0;
        if (acrossEdge(ctx, axis, p, sEnd + dir * gap, side, dir) !== EDGE_NONE) return 0;
        if (trackOn(ctx, axis, p, far, side, k) === entry) return gap;
    }
    return 0;
}

/**
 * Whether a pipe bends round the outside corner at the end of its wall, onto the wall going off behind it (which has
 * the same pipe, and neither crosses its opening instead).
 */
function turns(ctx, axis, p, side, k, entry, sEnd, dir) {
    const back = side > 0 ? p : p + 1;
    const plane = dir > 0 ? sEnd : sEnd - 1;
    if (trackOn(ctx, 1 - axis, plane, back, dir, k) !== entry) return false;
    if (bridgeGap(ctx, axis, p, side, k, entry, sEnd, dir) > 0) return false;
    return bridgeGap(ctx, 1 - axis, plane, dir, k, entry, back, side) === 0;
}

/** The end of a piece: nothing, a blind flange, a collar where it goes into a wall, or a bend. */
function fitting(ctx, axis, p, side, k, a, y, r, color, end, dir) {
    const b = ctx.pipes;
    const [px, py, pz] = place(ctx, axis, end.at, a, y);
    const [tx, , tz] = alongDir(axis, dir);
    const plane = p + 0.5;
    switch (end.fit) {
        case 'cap':
            band(b, px - tx * 0.004, py, pz - tz * 0.004, tx, 0, tz, r * 1.3, 0.012, color, 'front');
            break;
        case 'into': {
            // Into the wall across its way: a plate round it where it goes in.
            const [cx, cy, cz] = place(ctx, axis, end.at - dir * (HALF_WALL + 0.002), a, y);
            disc(b, cx, cy, cz, -tx, 0, -tz, r * 1.35, IRON);
            break;
        }
        case 'corner':
            if (axis === 0) {
                const [cx, , cz] = acrossDir(axis, side);
                bend(b, px, py, pz, tx, 0, tz, cx, 0, cz, elbowRadius(r), r, color, end.at);
            }
            break;
        case 'turn':
            if (axis === 0) {
                const [cx, , cz] = acrossDir(axis, -side);
                bend(b, px, py, pz, tx, 0, tz, cx, 0, cz, trackOut(k) - HALF_WALL, r, color, end.at);
            }
            break;
        case 'wall': {
            // A bend into the wall behind, which ends at its face, in a plate.
            const R = r + TRACK_GAP;
            const [cx, , cz] = acrossDir(axis, -side);
            bend(b, px, py, pz, tx, 0, tz, cx, 0, cz, R, r, color, end.at);
            const [ex, , ez] = place(ctx, axis, end.at + dir * R, plane + side * (HALF_WALL + 0.002), y);
            disc(b, ex, py, ez, -cx, 0, -cz, r * 1.35, IRON);
            break;
        }
        case 'floor': {
            // Down into the floor, the same.
            bend(b, px, py, pz, tx, 0, tz, 0, -1, 0, FLOOR_BEND, r, color, end.at);
            const [ex, , ez] = place(ctx, axis, end.at + dir * FLOOR_BEND, a, 0);
            disc(b, ex, 0.002, ez, 0, 1, 0, r * 1.4, IRON);
            break;
        }
        default:
    }
}

// ---------------------------------------------------------------------------------------------- what's fixed to a wall

/**
 * What's on one face besides its pipes' runs: the channel they're clamped to, now and then a valve, a gauge, a flange,
 * a label; its ledge; a locked door; signs and stencils. (Nothing fixed where a tape's note hangs.)
 */
function wallFixtures(ctx, f, axis, p, s, side) {
    const { seed } = ctx;
    const plane = p + 0.5;
    const surface = plane + side * HALF_WALL;
    const [nx, , nz] = acrossDir(axis, side);
    const roll = (salt) => hashFloat(seed, salt, axis * 2 + (side > 0 ? 1 : 0), p, s);
    if (f.ledge) ledge(ctx, f, axis, p, s, side);
    if (f.locked) lockedDoor(ctx, axis, s, surface, nx, nz);
    // (Nothing fixed where something's been left against the wall: where a tape's note hangs, with its TV.)
    const [fx, fz] = frontCell(axis, p, s, side);
    if (f.edge !== EDGE_WALL || f.locked || ctx.noted.has(fx * 65536 + fz)) return;
    const present = [];
    for (let k = 0; k < TRACKS.length; k++) if (f.tracks[k] >= 0) present.push(k);
    // A cabinet in a plant hall, instead of a channel.
    if (f.kind & CELL_HALL && roll(0xcab) < 0.1) {
        cabinet(ctx, axis, s, surface, nx, nz, roll(0xcac));
        return;
    }
    // Signs and stencils, clear of the pipes: over the middle of the wall.
    if (f.kind & CELL_TUNNEL && roll(0x5160) < 0.045) {
        const signs = [PAINT_ATLAS.danger, PAINT_ATLAS.steam, PAINT_ATLAS.danger, PAINT_ATLAS.voltage];
        const [x, , z] = place(ctx, axis, s + (roll(0x5161) - 0.5) * 0.4, surface + side * 0.0015, 0);
        wallPicture(ctx.paint, x, 0.655, z, nx, nz, 0.045, 0.045, signs[Math.floor(roll(0x5162) * signs.length)]);
    } else if (f.kind & CELL_TUNNEL && roll(0x5163) < 0.12 && hashFloat(ctx.seed, 0x5164, axis, p, s) < 0.5 === side > 0) {
        // (On one side of the tunnel, not both at once.)
        tunnelStencil(ctx, axis, p, s, side, surface, nx, nz, (roll(0x5165) - 0.5) * 0.5);
    }
    if (present.length === 0) return;
    const at = s + (roll(0x57a1) - 0.5) * 0.36;
    // The channel the pipes are clamped to, and a clamp round each.
    if (roll(0x57a0) < 0.5) {
        let low = 1;
        let high = 0;
        for (const k of present) {
            low = Math.min(low, TRACKS[k].y - TRACKS[k].r - 0.02);
            high = Math.max(high, TRACKS[k].y + TRACKS[k].r + 0.02);
        }
        const [x0, , z0] = place(ctx, axis, at - 0.011, surface, 0);
        const [x1, , z1] = place(ctx, axis, at + 0.011, surface + side * (TRACK_GAP - 0.002), 0);
        ctx.pipes.finish(FINISH_GALVANISED, roll(0x57a2));
        ctx.pipes.box(Math.min(x0, x1), Math.max(0.012, low), Math.min(z0, z1), Math.max(x0, x1), Math.min(0.99, high), Math.max(z0, z1), STRUT);
        for (const k of present) {
            const [finish] = trackFinish(k, f.tracks[k]);
            if (finish === FINISH_LAGGED) continue;
            const [cx, cy, cz] = place(ctx, axis, at, plane + side * trackOut(k), TRACKS[k].y);
            const [tx, , tz] = alongDir(axis, 1);
            // (Six sides is plenty for something this narrow: just wide enough round to clear the pipe's.)
            const h = 0.006;
            tube(ctx.pipes, cx - tx * h, cy, cz - tz * h, cx + tx * h, cy, cz + tz * h, (TRACKS[k].r + 0.004) / Math.cos(Math.PI / 6), STRUT, 0, 6);
        }
        // Rust run down the wall from its bolts.
        if (roll(0x57a3) < 0.4) {
            const top = Math.min(0.72, high);
            const [sx, , sz] = place(ctx, axis, at, surface + side * 0.0015, 0);
            wallPicture(ctx.paint, sx, top / 2, sz, nx, nz, 0.035, top / 2, roll(0x57a4) < 0.5 ? PAINT_ATLAS.streakRust : PAINT_ATLAS.streakRust2, 0x5c3219);
        }
    }
    const other = at + (at < s ? 0.2 : -0.2);
    // A valve on one of the low pipes.
    const valveOn = [1, 0, 2].find((k) => f.tracks[k] >= 0);
    if (valveOn !== undefined && roll(0x7a1e) < 0.1) {
        valve(ctx, axis, other, plane + side * trackOut(valveOn), TRACKS[valveOn].y, TRACKS[valveOn].r, side, roll(0x7a1f));
    } else if (roll(0x6a0) < 0.08) {
        // A gauge: up off the small pipe, or down off the lagged one.
        const k = f.tracks[2] >= 0 ? 2 : f.tracks[4] >= 0 ? 4 : -1;
        if (k >= 0) gauge(ctx, axis, other, plane + side * trackOut(k), TRACKS[k].y, TRACKS[k].r, nx, nz, k === 2 ? 1 : -1, roll(0x6a1));
    }
    // Labels saying what's in them, and which way it goes.
    if (roll(0x1abe) < 0.2) {
        const k = [1, 5, 4, 0][Math.floor(roll(0x1abf) * 4)];
        if (f.tracks[k] >= 0) {
            const [finish] = trackFinish(k, f.tracks[k]);
            if (finish === FINISH_PAINT || finish === FINISH_LAGGED || finish === FINISH_CLAD) {
                pipeLabel(ctx, axis, s + (roll(0x1ac0) - 0.5) * 0.5, plane + side * trackOut(k), TRACKS[k].y, TRACKS[k].r, side, roll(0x1ac1));
            }
        }
    }
    // Flanged joints in the big pipes, where one length meets the next.
    for (const k of [0, 5]) {
        if (f.tracks[k] < 0 || roll(0xf1a + k) >= 0.3) continue;
        const [finish, color] = trackFinish(k, f.tracks[k]);
        if (finish === FINISH_LAGGED || finish === FINISH_CLAD) continue;
        if (trackOn(ctx, axis, p, s + 1, side, k) !== f.tracks[k] || acrossEdge(ctx, axis, p, s, side, 1) !== EDGE_NONE) continue;
        const [cx, cy, cz] = place(ctx, axis, s + 0.5, plane + side * trackOut(k), TRACKS[k].y);
        const [tx, , tz] = alongDir(axis, 1);
        ctx.pipes.finish(finish, 0.8);
        band(ctx.pipes, cx - tx * 0.007, cy, cz - tz * 0.007, tx, 0, tz, TRACKS[k].r * 1.32, 0.01, color);
        band(ctx.pipes, cx + tx * 0.007, cy, cz + tz * 0.007, tx, 0, tz, TRACKS[k].r * 1.32, 0.01, color);
    }
}

/**
 * The concrete ledge along the foot of a wall, a cell's worth (round a doorway, the two pieces either side). It
 * carries on into the next face, stops against a wall across it, and ends square where the wall does.
 */
const LEDGE_HEIGHT = 0.09;
const LEDGE_DEPTH = 0.105;
function ledge(ctx, f, axis, p, s, side) {
    const plane = p + 0.5;
    const surface = plane + side * HALF_WALL;
    const outer = surface + side * LEDGE_DEPTH;
    const pieces = f.door ? [[s - 0.5, s - DOOR_CLEAR + 0.004], [s + DOOR_CLEAR - 0.004, s + 0.5]] : [[s - 0.5, s + 0.5]];
    for (let n = 0; n < pieces.length; n++) {
        let [s0, s1] = pieces[n];
        let cap0 = n > 0;
        let cap1 = n < pieces.length - 1;
        // At either end of the face: into a wall across it, on into the next face's ledge, or the end of the wall.
        for (const dir of [-1, 1]) {
            if ((dir < 0 && n > 0) || (dir > 0 && n < pieces.length - 1)) continue;
            const end = s + dir * 0.5;
            let at = end;
            let cap = false;
            if (acrossEdge(ctx, axis, p, s, side, dir) !== EDGE_NONE) at = end - dir * HALF_WALL;
            else if (!face(ctx, axis, p, s + dir, side)?.ledge) {
                at = end + dir * HALF_WALL;
                cap = true;
            }
            if (dir < 0) {
                s0 = at;
                cap0 = cap;
            } else {
                s1 = at;
                cap1 = cap;
            }
        }
        const b = ctx.walls;
        const [ax, , az] = place(ctx, axis, s0, surface, 0);
        const [bx, , bz] = place(ctx, axis, s1, outer, 0);
        const minX = Math.min(ax, bx);
        const maxX = Math.max(ax, bx);
        const minZ = Math.min(az, bz);
        const maxZ = Math.max(az, bz);
        const y = LEDGE_HEIGHT;
        // Its top, its front, and its ends where it ends: textured in world units, like the walls it's built with.
        const u = (x, z) => (axis === 0 ? z + ctx.oz : x + ctx.ox);
        b.quad(minX, y, maxZ, maxX, y, maxZ, maxX, y, minZ, minX, y, minZ, 0, 1, 0, u(minX, minZ), 0.2, u(maxX, maxZ), 0.3);
        const [fx, , fz] = place(ctx, axis, 0, outer, 0);
        if (axis === 0) {
            const x = fx;
            if (side > 0) b.quad(x, 0, maxZ, x, 0, minZ, x, y, minZ, x, y, maxZ, 1, 0, 0, -(maxZ + ctx.oz), 0, -(minZ + ctx.oz), y);
            else b.quad(x, 0, minZ, x, 0, maxZ, x, y, maxZ, x, y, minZ, -1, 0, 0, minZ + ctx.oz, 0, maxZ + ctx.oz, y);
            if (cap0) b.quad(maxX, 0, minZ, minX, 0, minZ, minX, y, minZ, maxX, y, minZ, 0, 0, -1, 0, 0, 0.1, y);
            if (cap1) b.quad(minX, 0, maxZ, maxX, 0, maxZ, maxX, y, maxZ, minX, y, maxZ, 0, 0, 1, 0, 0, 0.1, y);
        } else {
            const z = fz;
            if (side > 0) b.quad(minX, 0, z, maxX, 0, z, maxX, y, z, minX, y, z, 0, 0, 1, minX + ctx.ox, 0, maxX + ctx.ox, y);
            else b.quad(maxX, 0, z, minX, 0, z, minX, y, z, maxX, y, z, 0, 0, -1, -(maxX + ctx.ox), 0, -(minX + ctx.ox), y);
            if (cap0) b.quad(minX, 0, minZ, minX, 0, maxZ, minX, y, maxZ, minX, y, minZ, -1, 0, 0, 0, 0, 0.1, y);
            if (cap1) b.quad(maxX, 0, maxZ, maxX, 0, minZ, maxX, y, minZ, maxX, y, maxZ, 1, 0, 0, 0, 0, 0.1, y);
        }
    }
}

/** A gate valve in a pipe along a wall, its spindle out from the wall and a handwheel on it. */
function valve(ctx, axis, s, a, y, r, side, roll) {
    const b = ctx.pipes;
    const [px, py, pz] = place(ctx, axis, s, a, y);
    const [tx, , tz] = alongDir(axis, 1);
    const [nx, , nz] = acrossDir(axis, side);
    b.finish(FINISH_IRON, 0.6);
    band(b, px, py, pz, tx, 0, tz, r * 1.45, 0.05, IRON);
    band(b, px - tx * 0.029, py, pz - tz * 0.029, tx, 0, tz, r * 1.75, 0.008, IRON, 'none');
    band(b, px + tx * 0.029, py, pz + tz * 0.029, tx, 0, tz, r * 1.75, 0.008, IRON, 'none');
    // The bonnet, the spindle, and the wheel.
    const out = r * 1.45 + 0.012;
    tube(b, px, py, pz, px + nx * out, py, pz + nz * out, r * 0.9, IRON);
    const reach = out + 0.03;
    tube(b, px + nx * out, py, pz + nz * out, px + nx * reach, py, pz + nz * reach, 0.004, 0x8e9496, 0, 4);
    const wheel = WHEEL_COLORS[Math.floor(roll * WHEEL_COLORS.length)];
    b.finish(FINISH_PAINT, 0.7);
    const R = 0.03 + r * 0.3;
    hoop(b, px + nx * reach, py, pz + nz * reach, nx, 0, nz, R, 0.004, wheel, 9);
    for (let n = 0; n < 3; n++) {
        const angle = (n / 3) * Math.PI * 2 + roll * 2;
        const dy = Math.cos(angle) * R;
        const ds = Math.sin(angle) * R;
        tube(b, px + nx * reach, py, pz + nz * reach, px + nx * reach + tx * ds, py + dy, pz + nz * reach + tz * ds, 0.0028, wheel, 0, 4);
    }
}

/** A pressure gauge on a stem up off a pipe (or down off one), facing out from the wall. */
function gauge(ctx, axis, s, a, y, r, nx, nz, up, roll) {
    const b = ctx.pipes;
    const [px, py, pz] = place(ctx, axis, s, a, y);
    const stem = 0.028;
    const gy = py + up * (r + stem + 0.024);
    b.finish(FINISH_BRASS, 0.5);
    tube(b, px, py + up * r * 0.8, pz, px, gy - up * 0.02, pz, 0.004, BRASS, 0, 4);
    // The case: a short drum facing out, and its dial.
    b.finish(roll < 0.5 ? FINISH_IRON : FINISH_BRASS, 0.5);
    band(b, px, gy, pz, nx, 0, nz, 0.024, 0.016, roll < 0.5 ? 0x1f1f1f : BRASS);
    dial(ctx.gauges, px + nx * 0.0085, gy, pz + nz * 0.0085, nx, nz, 0.02, roll);
}

/**
 * A gauge's face, facing (nx, 0, nz): drawn by its own material (see pipeDreamsShading.js), from its texture coordinates
 * (0..1 across it) and its colour, which says where the needle sits and how much it shakes.
 */
function dial(b, px, py, pz, nx, nz, r, roll) {
    const sides = 12;
    const centre = b.vertex(px, py, pz, nx, 0, nz, 0.5, 0.5, dialColor(roll));
    const first = b.vertexCount;
    const round = circle(sides);
    // Left to right as you face it: (nz, −nx).
    for (let k = 0; k < sides; k++) {
        const c = round[k * 2];
        const s = round[k * 2 + 1];
        b.vertex(px + nz * c * r, py + s * r, pz - nx * c * r, nx, 0, nz, 0.5 + 0.5 * c, 0.5 + 0.5 * s, dialColor(roll));
    }
    for (let k = 0; k < sides; k++) b.triangle(centre, first + k, first + ((k + 1) % sides));
}

/** A gauge's needle, as a colour: where it rests (red), how much it shakes (green), and its own time (blue). */
function dialColor(roll) {
    const rest = Math.floor(40 + ((roll * 997) % 1) * 200);
    const shake = Math.floor(((roll * 7919) % 1) * 255);
    const phase = Math.floor(roll * 255);
    return (rest << 16) | (shake << 8) | phase;
}

/**
 * A band of printed tape round the front of a pipe: what's in it, and an arrow for which way (a picture from the paint
 * atlas, wrapped round the half facing out).
 */
function pipeLabel(ctx, axis, s, a, y, r, side, roll) {
    const b = ctx.paint;
    const labels = PAINT_ATLAS.labels;
    const [u0, v0, u1, v1] = atlasUv(labels[Math.floor(roll * labels.length)]);
    const flip = (roll * 131) % 1 < 0.5;
    const R = r + 0.0015;
    const width = 0.16;
    const steps = 6;
    const first = b.vertexCount;
    // From under the front round to over it, as seen from the side it faces.
    for (let j = 0; j <= steps; j++) {
        const angle = (j / steps - 0.5) * 2.5;
        const out = Math.cos(angle);
        const up = Math.sin(angle);
        for (const e of [-1, 1]) {
            const [x, yy, z] = place(ctx, axis, s + e * width / 2, a + side * out * R, y + up * R);
            const [ax, , az] = acrossDir(axis, side);
            const u = (e > 0) !== flip ? u1 : u0;
            b.vertex(x, yy, z, ax * out, up, az * out, u, v0 + (v1 - v0) * (j / steps), 0xffffff);
        }
    }
    for (let j = 0; j < steps; j++) {
        const i = first + j * 2;
        // Facing out, whichever way round the wall runs.
        const clockwise = (axis === 0) === (side > 0);
        if (clockwise) {
            b.triangle(i, i + 2, i + 1);
            b.triangle(i + 1, i + 2, i + 3);
        } else {
            b.triangle(i, i + 1, i + 2);
            b.triangle(i + 1, i + 3, i + 2);
        }
    }
}

/** A steel door set in the wall that doesn't open: its frame, the door, its handle, and a sign on it. */
function lockedDoor(ctx, axis, s, surface, nx, nz) {
    const [x, , z] = place(ctx, axis, s, surface, 0);
    const color = FRAME_COLORS[hashInts(ctx.seed, 0xd00f, axis, s, Math.round(surface * 2)) % FRAME_COLORS.length];
    const hw = DOOR_WIDTH / 2;
    const top = DOOR_HEIGHT - 0.01;
    wallPicture(ctx.paint, x + nx * 0.004, top / 2, z + nz * 0.004, nx, nz, hw, top / 2, PAINT_ATLAS.door, color);
    // The frame round it, and the handle.
    const b = ctx.pipes;
    b.finish(FINISH_PAINT, 0.6);
    const [rx, rz] = [nz, -nx];
    for (const e of [-1, 1]) {
        const cx = x + rx * e * (hw + FRAME_WIDTH / 2);
        const cz = z + rz * e * (hw + FRAME_WIDTH / 2);
        boxAround(b, cx, cz, nx, nz, FRAME_WIDTH / 2, FRAME_DEPTH, 0, top + FRAME_WIDTH, color);
    }
    boxAround(b, x, z, nx, nz, hw + FRAME_WIDTH, FRAME_DEPTH, top, top + FRAME_WIDTH, color);
    b.finish(FINISH_GALVANISED, 0.5);
    boxAround(b, x + rx * (hw - 0.07), z + rz * (hw - 0.07), nx, nz, 0.03, 0.016, 0.37, 0.382, 0xa9aeb0);
    const signs = [PAINT_ATLAS.noEntry, PAINT_ATLAS.plantRoom, PAINT_ATLAS.store, PAINT_ATLAS.keepOut, PAINT_ATLAS.noEntry, PAINT_ATLAS.boilerHouse];
    const pick = hashInts(ctx.seed, 0xd010, axis, s) % signs.length;
    const rect = signs[pick];
    const wide = rect[2] - rect[0] > rect[3] - rect[1];
    wallPicture(ctx.paint, x + nx * 0.006, 0.56, z + nz * 0.006, nx, nz, wide ? 0.09 : 0.05, wide ? 0.022 : 0.05, rect);
}

/** A box standing out `depth` from a wall facing (nx, nz), `half` either side of (x, z) along it, from y0 to y1. */
function boxAround(b, x, z, nx, nz, half, depth, y0, y1, color) {
    const [rx, rz] = [Math.abs(nz), Math.abs(nx)];
    const ax = x - rx * half;
    const bx = x + rx * half + nx * depth;
    const az = z - rz * half;
    const bz = z + rz * half + nz * depth;
    b.box(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), color);
}

/** A grey electrical cabinet on a plant hall's wall, its door drawn on, and red and amber lamps on it. */
function cabinet(ctx, axis, s, surface, nx, nz, roll) {
    const [x, , z] = place(ctx, axis, s, surface, 0);
    const depth = 0.05;
    const hw = 0.13;
    const b = ctx.pipes;
    b.finish(FINISH_PAINT, 0.4 + roll * 0.4);
    const color = roll < 0.6 ? 0x7c7f7a : 0x5d6a61;
    boxAround(b, x, z, nx, nz, hw, depth, 0.36, 0.7, color);
    wallPicture(ctx.paint, x + nx * (depth + 0.0015), 0.53, z + nz * (depth + 0.0015), nx, nz, hw - 0.01, 0.16, PAINT_ATLAS.cabinet, color);
    // The lamps: lit like the ceiling's (see the fixture material), so they go out with the power.
    const [rx, rz] = [nz, -nx];
    for (let n = 0; n < 3; n++) {
        const lx = x + rx * (-0.07 + n * 0.035) + nx * (depth + 0.004);
        const lz = z + rz * (-0.07 + n * 0.035) + nz * (depth + 0.004);
        const lamp = n === 2 ? 0xffa21a : 0xff2a1a;
        ctx.fixtures.box(lx - 0.006, 0.648, lz - 0.006, lx + 0.006, 0.66, lz + 0.006, lamp);
    }
    // Conduit up out of it into the ceiling.
    b.finish(FINISH_GALVANISED, 0.5);
    tube(b, x + nx * 0.02, 0.7, z + nz * 0.02, x + nx * 0.02, WALL_HEIGHT, z + nz * 0.02, 0.012, 0x9ea4a5);
}

/** A tunnel's letter and number stencilled on the wall, like a street sign: where along which tunnel you are. */
function tunnelStencil(ctx, axis, p, s, side, surface, nx, nz, shift) {
    const [fx, fz] = frontCell(axis, p, s, side);
    const kx = lineAt(ctx.seed, FAMILY_Z, fx);
    const kz = lineAt(ctx.seed, FAMILY_X, fz);
    const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    const row = letters[((kz ?? Math.floor(fz / 8)) % letters.length + letters.length) % letters.length];
    const column = ((kx ?? Math.floor(fx / 8)) % 60 + 60) % 60 + 1;
    const text = `${row}${column}`;
    const [x, , z] = place(ctx, axis, s + shift, surface, 0);
    const width = 0.06 * 0.66;
    const [rx, rz] = [nz, -nx];
    for (let n = 0; n < text.length; n++) {
        const along = (n - (text.length - 1) / 2) * width;
        wallPicture(ctx.paint, x + rx * along + nx * 0.0015, 0.662, z + rz * along + nz * 0.0015, nx, nz, 0.03, 0.04, stencilRect(text[n]), INK);
    }
}

// ---------------------------------------------------------------------------------------------- doorways

/** A steel frame round every doorway the chunk's cells own (both sides of the wall). */
function doorFrames(ctx) {
    const { store, x0, z0 } = ctx;
    const b = ctx.pipes;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            for (const axis of [0, 1]) {
                if (store.edge(x, z, axis) !== EDGE_DOOR) continue;
                const color = FRAME_COLORS[hashInts(ctx.seed, 0xf2a, x, z, axis) % FRAME_COLORS.length];
                b.finish(FINISH_PAINT, 0.45 * hashFloat(ctx.seed, 0xf2b, x, z, axis));
                const plane = (axis === 0 ? x : z) + 0.5;
                const s = axis === 0 ? z : x;
                const depth = HALF_WALL + FRAME_DEPTH;
                for (const e of [-1, 1]) {
                    const s0 = s + e * DOOR_WIDTH / 2;
                    const s1 = s0 + e * FRAME_WIDTH;
                    const [ax, , az] = place(ctx, axis, Math.min(s0, s1), plane - depth, 0);
                    const [bx, , bz] = place(ctx, axis, Math.max(s0, s1), plane + depth, 0);
                    b.box(ax, 0, az, bx, DOOR_HEIGHT + FRAME_WIDTH * 0.7, bz, color);
                }
                const [ax, , az] = place(ctx, axis, s - DOOR_WIDTH / 2 - FRAME_WIDTH, plane - depth, 0);
                const [bx, , bz] = place(ctx, axis, s + DOOR_WIDTH / 2 + FRAME_WIDTH, plane + depth, 0);
                b.box(ax, DOOR_HEIGHT, az, bx, DOOR_HEIGHT + FRAME_WIDTH * 0.7, bz, color);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------- under the ceiling

/**
 * The pipes along under the ceiling of each tunnel (see ceilingBundle), for as far as it runs through the chunk, into
 * the wall where it ends; and the trapeze hangers they're on.
 */
function ceilingPipes(ctx) {
    const { seed, data, x0, z0 } = ctx;
    for (const family of [FAMILY_X, FAMILY_Z]) {
        const acrossFrom = family === FAMILY_X ? z0 : x0;
        const alongFrom = family === FAMILY_X ? x0 : z0;
        const flag = family === FAMILY_X ? CELL_X_TUNNEL : CELL_Z_TUNNEL;
        for (let a = 0; a < N; a++) {
            const k = lineAt(seed, family, acrossFrom + a);
            // The gallery has one down each side of it, and its rack of mains down the middle (see galleryRack).
            const gallery = family === FAMILY_Z && ctx.chunk.cx === 0 && ctx.chunk.cz === 0 && acrossFrom + a === -1;
            if (k === null && !gallery) continue;
            const space = gallery ? lineSpace(seed, FAMILY_Z, 0) ^ 0x5bd1e995 : lineSpace(seed, family, k);
            let b = 0;
            while (b < N) {
                const kind = data.kinds[family === FAMILY_X ? b * N + a : a * N + b];
                if (!(kind & flag)) {
                    b++;
                    continue;
                }
                let e = b;
                while (e + 1 < N && data.kinds[family === FAMILY_X ? (e + 1) * N + a : a * N + e + 1] & flag && openAlong(ctx, family, acrossFrom + a, alongFrom + e)) e++;
                bundleRun(ctx, family, acrossFrom + a, alongFrom + b, alongFrom + e, space);
                b = e + 1;
            }
        }
    }
}

/**
 * The gallery where you start: a rack of big mains along the middle, lower than the pipes of the tunnels crossing it
 * and clear of its lamps, on trapeze hangers across it. It's the first thing you see.
 */
const GALLERY_RACK = [
    [-0.48, 0.03, FINISH_LAGGED, 0xd2c7ad],
    [-0.36, 0.052, FINISH_LAGGED, 0xc9bda0],
    [-0.2, 0.044, FINISH_RUST, 0x6b3923],
    [-0.06, 0.03, FINISH_PAINT, 0x2f4a37],
    [0.08, 0.052, FINISH_CLAD, 0xb4b8ba],
    [0.24, 0.036, FINISH_PAINT, 0x74291e],
    [0.37, 0.022, FINISH_COPPER, 0xb56f40],
    [0.47, 0.03, FINISH_LAGGED, 0xd2c7ad],
];
const RACK_Y = 0.87;
function galleryRack(ctx) {
    const b = ctx.pipes;
    const from = -8.5;
    const to = 2.5 - HALF_WALL;
    for (const [x, r, finish, color] of GALLERY_RACK) {
        b.finish(finish, 0.5 + x);
        const y = RACK_Y - 0.052 + r;
        tube(b, x, y, from, x, y, to, r, color, from);
        // Flanged every few cells, the bare ones.
        if (finish === FINISH_RUST || finish === FINISH_PAINT) {
            for (let z = -7.5; z < 2; z += 3) band(b, x, y, z, 0, 0, 1, r * 1.3, 0.012, color);
        }
    }
    b.finish(FINISH_GALVANISED, 0.6);
    for (let z = -8; z < 2.4; z += 1.5) {
        b.box(-0.56, RACK_Y - 0.064, z - 0.012, 0.56, RACK_Y - 0.052, z + 0.012, STRUT);
        for (const x of [-0.55, 0.55]) b.box(x - 0.003, RACK_Y - 0.064, z - 0.003, x + 0.003, WALL_HEIGHT, z + 0.003, 0x4c5052);
    }
}

/** Whether the tunnel's open from cell `s` to the next along it. */
function openAlong(ctx, family, at, s) {
    return family === FAMILY_X ? ctx.store.edge(s, at, 0) === EDGE_NONE : ctx.store.edge(at, s, 1) === EDGE_NONE;
}

function bundleRun(ctx, family, at, s0, s1, space) {
    const bundle = ceilingBundle(space);
    const y0 = BUNDLE_Y[family];
    const b = ctx.pipes;
    // Ends: on into the next chunk, or into the wall at the end of the tunnel.
    const from = s0 - 0.5;
    const to = s1 + 0.5;
    const axis = family === FAMILY_X ? 1 : 0;
    let lowest = WALL_HEIGHT;
    for (const pipe of bundle) {
        const y = pipe.tray ? y0 + 0.005 : y0;
        b.finish(pipe.finish, hashFloat(space, 0xb0, pipe.o * 1000));
        if (pipe.tray) {
            const [ax, , az] = place(ctx, axis, from, at + pipe.o - pipe.r, 0);
            const [bx, , bz] = place(ctx, axis, to, at + pipe.o + pipe.r, 0);
            b.box(Math.min(ax, bx), y - 0.006, Math.min(az, bz), Math.max(ax, bx), y - 0.003, Math.max(az, bz), pipe.color);
            for (const e of [-1, 1]) {
                const [cx, , cz] = place(ctx, axis, from, at + pipe.o + e * pipe.r, 0);
                const [dx, , dz] = place(ctx, axis, to, at + pipe.o + e * pipe.r + e * 0.003, 0);
                b.box(Math.min(cx, dx), y - 0.006, Math.min(cz, dz), Math.max(cx, dx), y + 0.012, Math.max(cz, dz), pipe.color);
            }
            // Cables in it.
            b.finish(FINISH_PAINT, 0.3);
            for (let n = 0; n < 4; n++) {
                const [cx, , cz] = place(ctx, axis, from, at + pipe.o - pipe.r * 0.6 + n * pipe.r * 0.4, 0);
                const [dx, , dz] = place(ctx, axis, to, at + pipe.o - pipe.r * 0.6 + n * pipe.r * 0.4, 0);
                tube(b, cx, y - 0.0005, cz, dx, y - 0.0005, dz, 0.005, [0x1d1e1f, 0x3b3d3f, 0x8a5a1c, 0x1d1e1f][n], 0, 4);
            }
            lowest = Math.min(lowest, y - 0.006);
        } else {
            const [ax, ay, az] = place(ctx, axis, from, at + pipe.o, y);
            const [bx, by, bz] = place(ctx, axis, to, at + pipe.o, y);
            tube(b, ax, ay, az, bx, by, bz, pipe.r, pipe.color, from);
            lowest = Math.min(lowest, y - pipe.r);
        }
    }
    // Trapeze hangers every other cell, clear of the lamps (in the middle of the odd cells).
    b.finish(FINISH_GALVANISED, 0.5);
    const outs = bundle.map((pipe) => pipe.o);
    const lo = Math.min(...outs.map((o, n) => o - bundle[n].r)) - 0.012;
    const hi = Math.max(...outs.map((o, n) => o + bundle[n].r)) + 0.012;
    for (let s = s0; s <= s1; s++) {
        if ((s & 1) !== 0 || hashFloat(space, 0xb1, s) < 0.2) continue;
        const along = s + 0.3;
        const [ax, , az] = place(ctx, axis, along - 0.008, at + lo, 0);
        const [bx, , bz] = place(ctx, axis, along + 0.008, at + hi, 0);
        const y = lowest - 0.004;
        b.box(Math.min(ax, bx), y - 0.012, Math.min(az, bz), Math.max(ax, bx), y, Math.max(az, bz), STRUT);
        for (const o of [lo, hi]) {
            const [rx, , rz] = place(ctx, axis, along, at + o, 0);
            b.box(rx - 0.0025, y, rz - 0.0025, rx + 0.0025, WALL_HEIGHT, rz + 0.0025, 0x4c5052);
        }
    }
}

/** Each light slot's lamp, and the glow round it (see PipeDreamsData.fixtures). */
function lamps(ctx) {
    const { data, x0, z0 } = ctx;
    for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
        for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
            const kind = data.fixtures[pi * PANELS_PER_SIDE + pj];
            if (kind === FIXTURE_NONE) continue;
            const i = pi * 2 + 1;
            const j = pj * 2 + 1;
            const x = x0 + i - ctx.ox;
            const z = z0 + j - ctx.oz;
            const cell = data.kinds[i * N + j];
            if (kind === FIXTURE_CAGE) cageLamp(ctx, x, z);
            else if (kind === FIXTURE_SHADE) shadeLamp(ctx, x, z);
            else if (kind === FIXTURE_BULB) bareBulb(ctx, x, z);
            else if (kind === FIXTURE_BATTEN) batten(ctx, x, z, (cell & CELL_X_TUNNEL) !== 0 || !(cell & CELL_Z_TUNNEL));
        }
    }
}

// A bulb, from its tip at the top down: a pear, turned.
const BULB = [[0.009, 0], [0.017, -0.012], [0.021, -0.028], [0.019, -0.04], [0.012, -0.048], [0, -0.051]];

function bulbAt(ctx, x, top, z, scale = 1) {
    lathe(ctx.fixtures, x, z, BULB.map(([r, y]) => [r * scale, top + y * scale]), 7, LAMP_WHITE);
}

/** A bulkhead lamp: a stub of conduit down from the ceiling, a lampholder, the bulb, and a wire cage round it. */
function cageLamp(ctx, x, z) {
    const b = ctx.fixtures;
    b.box(x - 0.006, 0.955, z - 0.006, x + 0.006, WALL_HEIGHT, z + 0.006, 0x3a3c3e);
    lathe(b, x, z, [[0.03, 0.955], [0.032, 0.94], [0.014, 0.93]], 8, 0x2b2c2d);
    bulbAt(ctx, x, 0.93, z);
    // Four bars down round it and across under it, and a ring round its middle.
    for (let n = 0; n < 4; n++) {
        const angle = (n / 4) * Math.PI * 2 + Math.PI / 4;
        const cx = x + Math.cos(angle) * 0.028;
        const cz = z + Math.sin(angle) * 0.028;
        tube(b, cx, 0.938, cz, cx, 0.873, cz, 0.0016, CAGE, 0, 4);
    }
    hoop(b, x, 0.905, z, 0, 1, 0, 0.029, 0.0016, CAGE, 6);
    tube(b, x - 0.02, 0.8725, z - 0.02, x + 0.02, 0.8725, z + 0.02, 0.0015, CAGE, 0, 4);
    tube(b, x - 0.02, 0.8725, z + 0.02, x + 0.02, 0.8725, z - 0.02, 0.0015, CAGE, 0, 4);
    ctx.glows.spot(x, 0.905, z, 0.34, -1, 0.62, 1);
}

/** An enamel shade on a chain, dark green outside and white inside, and the bulb up in it. */
function shadeLamp(ctx, x, z) {
    const b = ctx.fixtures;
    b.box(x - 0.0025, 0.86, z - 0.0025, x + 0.0025, WALL_HEIGHT, z + 0.0025, 0x2b2c2d);
    const shade = [[0.014, 0.862], [0.03, 0.852], [0.062, 0.83], [0.085, 0.806], [0.092, 0.798]];
    lathe(b, x, z, shade, 10, SHADE_GREEN);
    lathe(b, x, z, shade.map(([r, y]) => [r - 0.002, y - 0.001]), 10, 0xf0ece0, true);
    bulbAt(ctx, x, 0.852, z, 0.9);
    ctx.glows.spot(x, 0.81, z, 0.5, -1, 0.55, 0.9);
}

/** A bare bulb hanging on its flex. */
function bareBulb(ctx, x, z) {
    const b = ctx.fixtures;
    b.box(x - 0.0015, 0.885, z - 0.0015, x + 0.0015, WALL_HEIGHT, z + 0.0015, 0x1f1f1f);
    lathe(b, x, z, [[0.006, 0.9], [0.01, 0.895], [0.01, 0.874], [0.008, 0.87]], 8, 0x3a3228);
    bulbAt(ctx, x, 0.872, z, 0.95);
    ctx.glows.spot(x, 0.85, z, 0.38, -1, 0.6, 1);
}

/** A fluorescent batten along the tunnel. */
function batten(ctx, x, z, alongX) {
    const b = ctx.fixtures;
    const half = 0.18;
    const [hx, hz] = alongX ? [half, 0.022] : [0.022, half];
    b.box(x - hx, 0.935, z - hz, x + hx, 0.955, z + hz, 0x8e9396);
    for (const e of [-1, 1]) {
        const rx = alongX ? x + e * (half - 0.05) : x;
        const rz = alongX ? z : z + e * (half - 0.05);
        b.box(rx - 0.002, 0.955, rz - 0.002, rx + 0.002, WALL_HEIGHT, rz + 0.002, 0x4c5052);
    }
    for (const e of [-1, 1]) {
        if (alongX) {
            const tz = z + e * 0.009;
            tubeInto(b, x - half + 0.02, 0.928, tz, x + half - 0.02, 0.928, tz);
        } else {
            const tx = x + e * 0.009;
            tubeInto(b, tx, 0.928, z - half + 0.02, tx, 0.928, z + half - 0.02);
        }
    }
    ctx.glows.spot(x, 0.92, z, 0.36, -1, 0.42, 0.55);
}

function tubeInto(b, ax, ay, az, bx, by, bz) {
    tube(b, ax, ay, az, bx, by, bz, 0.0065, LAMP_WHITE, 0, 8);
}

// ---------------------------------------------------------------------------------------------- the plant

/** A frame for building a machine in: along its front (f), to its left (l), and up. */
function frame(ctx, machine) {
    const fx = machine.dx;
    const fz = machine.dz;
    const lx = -fz;
    const lz = fx;
    const cx = machine.x - ctx.ox;
    const cz = machine.z - ctx.oz;
    return {
        fx,
        fz,
        lx,
        lz,
        /** A point `along` its front, `left` of its middle, `y` up. */
        at: (along, left, y) => [cx + fx * along + lx * left, y, cz + fz * along + lz * left],
        /** A box from (a0, l0, y0) to (a1, l1, y1) in its own terms. */
        box: (b, a0, l0, y0, a1, l1, y1, color) => {
            const xs = [cx + fx * a0 + lx * l0, cx + fx * a1 + lx * l1];
            const zs = [cz + fz * a0 + lz * l0, cz + fz * a1 + lz * l1];
            b.box(Math.min(...xs), y0, Math.min(...zs), Math.max(...xs), y1, Math.max(...zs), color);
        },
    };
}

function buildMachine(ctx, machine) {
    const random = mulberry32(machine.variant);
    if (machine.type === MACHINE_BOILER) boiler(ctx, machine, random);
    else if (machine.type === MACHINE_TANK) tank(ctx, machine, random);
    else if (machine.type === MACHINE_PUMP) pump(ctx, machine, random);
    else if (machine.type === MACHINE_HEADER) header(ctx, machine, random);
    // Its shadow on the floor.
    const alongX = machine.dx !== 0;
    const size = machine.type === MACHINE_BOILER ? [BOILER_LENGTH / 2, BOILER_RADIUS]
        : machine.type === MACHINE_HEADER ? [0.85, 0.12]
            : machine.type === MACHINE_TANK ? [tankRadius(machine), tankRadius(machine)] : [0.28, 0.13];
    rectShadow(ctx.shade, machine.x - ctx.ox, machine.z - ctx.oz, alongX ? size[0] : size[1], alongX ? size[1] : size[0]);
}

/**
 * A shell boiler on its plinth: a long lagged drum with the furnace in its front end, the fire showing through the
 * slots in the firebox door; gauges and a water glass on the front plate, the safety valve and the steam pipe on top,
 * and the flue up out of the back into the ceiling.
 */
function boiler(ctx, machine, random) {
    const b = ctx.pipes;
    const m = frame(ctx, machine);
    const L = BOILER_LENGTH / 2;
    const R = BOILER_RADIUS;
    const y = BOILER_Y;
    // The plinth.
    b.finish(FINISH_PAINT, 0.05);
    m.box(b, -L - 0.02, -R * 0.8, 0, L + 0.02, R * 0.8, 0.1, 0x6d6a64);
    // The shell, lagged, with its end plates.
    const [ax, , az] = m.at(-L, 0, 0);
    const [bx, , bz] = m.at(L, 0, 0);
    b.finish(FINISH_LAGGED, 0.3 + random() * 0.6);
    tube(b, ax, y, az, bx, y, bz, R, random() < 0.7 ? 0xcfc4a8 : 0xa9a397, 0, 16);
    b.finish(FINISH_IRON, 0.7);
    const [fx, , fz] = m.at(L + 0.012, 0, 0);
    band(b, fx, y, fz, m.fx, 0, m.fz, R + 0.012, 0.024, IRON, 'both', 24);
    const [kx, , kz] = m.at(-L - 0.01, 0, 0);
    band(b, kx, y, kz, m.fx, 0, m.fz, R + 0.008, 0.02, IRON, 'both', 24);
    // The firebox door: round, and slotted, with the fire behind it.
    const [dx, , dz] = m.at(L + 0.03, 0, 0);
    band(b, dx, FIRE_Y + 0.02, dz, m.fx, 0, m.fz, 0.1, 0.02, 0x1c1a19);
    const [wx, , wz] = m.at(L + 0.041, 0, 0);
    const phase = firePhase(...firePlace(machine));
    for (let n = 0; n < 3; n++) {
        const slotY = FIRE_Y - 0.015 + n * 0.022;
        fireSlot(ctx.fire, wx, slotY, wz, m.fx, m.fz, 0.055 - Math.abs(n - 1) * 0.012, 0.0065, phase);
    }
    // The handle across it.
    b.finish(FINISH_IRON, 0.5);
    m.box(b, L + 0.041, -0.07, FIRE_Y + 0.085, L + 0.051, 0.07, FIRE_Y + 0.095, 0x3a3634);
    ctx.glows.spot(wx + m.fx * 0.03, FIRE_Y + 0.01, wz + m.fz * 0.03, 0.42, 2 + phase, 0.9, 0.8);
    // Gauges up on the front plate, and the water glass.
    for (const left of [-0.1, 0.1]) {
        const [gx, , gz] = m.at(L + 0.03, left, 0);
        b.finish(FINISH_BRASS, 0.4);
        band(b, gx, y + 0.17, gz, m.fx, 0, m.fz, 0.034, 0.02, BRASS);
        dial(ctx.gauges, gx + m.fx * 0.0105, y + 0.17, gz + m.fz * 0.0105, m.fx, m.fz, 0.029, random());
    }
    const [sx, , sz] = m.at(L + 0.035, -0.19, 0);
    b.finish(FINISH_BRASS, 0.4);
    tube(b, sx, y - 0.02, sz, sx, y + 0.12, sz, 0.007, 0xc9d3cf, 0, 8);
    band(b, sx, y - 0.025, sz, 0, 1, 0, 0.011, 0.014, BRASS);
    band(b, sx, y + 0.125, sz, 0, 1, 0, 0.011, 0.014, BRASS);
    // On top: the safety valve at the back, the steam stop valve and its pipe up into the ceiling.
    const top = y + R;
    const [vx, , vz] = m.at(-L * 0.42, 0, 0);
    b.finish(FINISH_IRON, 0.6);
    tube(b, vx, top - 0.02, vz, vx, top + 0.1, vz, 0.03, IRON);
    band(b, vx, top + 0.1, vz, 0, 1, 0, 0.042, 0.016, IRON);
    tube(b, vx, top + 0.1, vz, vx, top + 0.15, vz, 0.012, BRASS);
    const [px, , pz] = m.at(L * 0.2, 0, 0);
    b.finish(FINISH_LAGGED, 0.5);
    tube(b, px, top - 0.02, pz, px, WALL_HEIGHT, pz, 0.045, 0xd8cdb2);
    b.finish(FINISH_IRON, 0.5);
    band(b, px, top + 0.14, pz, 0, 1, 0, 0.065, 0.06, IRON);
    const wheel = WHEEL_COLORS[Math.floor(random() * 2)];
    b.finish(FINISH_PAINT, 0.6);
    hoop(b, px, top + 0.21, pz, 0, 1, 0, 0.06, 0.005, wheel, 12);
    tube(b, px, top + 0.17, pz, px, top + 0.21, pz, 0.006, 0x8e9496, 0, 4);
    // The flue, out of the back and up.
    const [qx, , qz] = m.at(-L - 0.04, 0, 0);
    b.finish(FINISH_RUST, 0.8);
    m.box(b, -L - 0.12, -R * 0.75, 0.1, -L - 0.02, R * 0.75, top + 0.05, 0x3a2a22);
    tube(b, qx - m.fx * 0.02, top + 0.05, qz - m.fz * 0.02, qx - m.fx * 0.02, WALL_HEIGHT, qz - m.fz * 0.02, 0.075, 0x4a3326);
    // A feed pipe down the side into the floor.
    const side = random() < 0.5 ? -1 : 1;
    const [ex, , ez] = m.at(L * 0.5, side * (R + 0.03), 0);
    b.finish(FINISH_PAINT, 0.7);
    tube(b, ex, y, ez, ex, -0.01, ez, 0.018, 0x2f4a37);
    band(b, ex, 0.003, ez, 0, 1, 0, 0.026, 0.006, IRON);
}

/** One slot in a firebox door, the fire through it (see the fire material). */
function fireSlot(b, x, y, z, nx, nz, half, height, phase) {
    const rx = nz * half;
    const rz = -nx * half;
    const color = Math.floor(phase * 255);
    b.quad(x - rx, y - height, z - rz, x + rx, y - height, z + rz, x + rx, y + height, z + rz, x - rx, y + height, z - rz, nx, 0, nz, color, 0, 0, 1, 1);
}

/** A tank: a lagged or painted cylinder on legs, domed, a pipe up out of it and one out of its side into the floor. */
function tank(ctx, machine, random) {
    const b = ctx.pipes;
    const m = frame(ctx, machine);
    const r = tankRadius(machine);
    const h = 0.52 + random() * 0.3;
    const [cx, , cz] = m.at(0, 0, 0);
    const lagged = random() < 0.55;
    const color = lagged ? 0xd2c7ad : [0x8a2a20, 0x2f4a37, 0x7c7f7a][Math.floor(random() * 3)];
    b.finish(FINISH_IRON, 0.6);
    for (let n = 0; n < 4; n++) {
        const angle = (n / 4) * Math.PI * 2 + Math.PI / 4;
        const lx = cx + Math.cos(angle) * r * 0.75;
        const lz = cz + Math.sin(angle) * r * 0.75;
        b.box(lx - 0.012, 0, lz - 0.012, lx + 0.012, 0.1, lz + 0.012, IRON);
    }
    b.finish(lagged ? FINISH_LAGGED : FINISH_PAINT, 0.3 + random() * 0.6);
    tube(b, cx, 0.08, cz, cx, 0.08 + h, cz, r, color, 0, 16);
    disc(b, cx, 0.08, cz, 0, -1, 0, r, color, 16);
    const dome = [];
    for (let n = 0; n <= 4; n++) {
        const angle = (n / 4) * (Math.PI / 2);
        dome.push([r * Math.cos(angle) + 1e-4, 0.08 + h + r * 0.35 * Math.sin(angle)]);
    }
    lathe(b, cx, cz, dome.reverse(), 16, color);
    // Up into the ceiling, and a branch out to the floor with a valve.
    const top = 0.08 + h + r * 0.35;
    b.finish(FINISH_RUST, 0.6);
    tube(b, cx, top - 0.01, cz, cx, WALL_HEIGHT, cz, 0.03, 0x6b3923);
    const [ox, , oz] = m.at(r, 0, 0);
    b.finish(FINISH_PAINT, 0.6);
    tube(b, ox - m.fx * 0.02, 0.2, oz - m.fz * 0.02, ox + m.fx * 0.1, 0.2, oz + m.fz * 0.1, 0.02, 0x2e4b6c);
    bend(b, ox + m.fx * 0.1, 0.2, oz + m.fz * 0.1, m.fx, 0, m.fz, 0, -1, 0, 0.04, 0.02, 0x2e4b6c);
    tube(b, ox + m.fx * 0.14, 0.16, oz + m.fz * 0.14, ox + m.fx * 0.14, -0.01, oz + m.fz * 0.14, 0.02, 0x2e4b6c);
    // A gauge on its side, and a plate.
    const [gx, , gz] = m.at(r + 0.012, 0.0, 0);
    b.finish(FINISH_BRASS, 0.5);
    band(b, gx, 0.08 + h * 0.75, gz, m.fx, 0, m.fz, 0.026, 0.016, BRASS);
    dial(ctx.gauges, gx + m.fx * 0.0085, 0.08 + h * 0.75, gz + m.fz * 0.0085, m.fx, m.fz, 0.022, random());
}

/** A pump set on its bedplate: the motor, the coupling guard, the pump, a pipe up into the ceiling and one into the floor. */
function pump(ctx, machine, random) {
    const b = ctx.pipes;
    const m = frame(ctx, machine);
    b.finish(FINISH_IRON, 0.7);
    m.box(b, -0.28, -0.11, 0, 0.28, 0.11, 0.035, 0x2b2927);
    const color = [0x2e4b6c, 0x2f4a37, 0x6b7a50, 0x7c7f7a][Math.floor(random() * 4)];
    const [ax, , az] = m.at(-0.25, 0, 0);
    const [bx, , bz] = m.at(0, 0, 0);
    b.finish(FINISH_PAINT, 0.4 + random() * 0.4);
    tube(b, ax, 0.12, az, bx, 0.12, bz, 0.078, color, 0, 12);
    disc(b, ax, 0.12, az, -m.fx, 0, -m.fz, 0.078, color, 12);
    m.box(b, -0.2, -0.07, 0.035, -0.05, 0.07, 0.06, color);
    // The coupling guard.
    b.finish(FINISH_PAINT, 0.5);
    m.box(b, 0.0, -0.045, 0.08, 0.09, 0.045, 0.165, 0xd6a516);
    // The pump: its volute, the suction into the floor at the front and the delivery up.
    const [px, , pz] = m.at(0.16, 0, 0);
    b.finish(FINISH_IRON, 0.6);
    band(b, px, 0.13, pz, m.fx, 0, m.fz, 0.095, 0.075, 0x3a3d40);
    const [sx, , sz] = m.at(0.2, 0, 0);
    tube(b, sx, 0.13, sz, sx + m.fx * 0.05, 0.13, sz + m.fz * 0.05, 0.035, 0x3a3d40);
    bend(b, sx + m.fx * 0.05, 0.13, sz + m.fz * 0.05, m.fx, 0, m.fz, 0, -1, 0, 0.05, 0.035, 0x3a3d40);
    tube(b, sx + m.fx * 0.1, 0.08, sz + m.fz * 0.1, sx + m.fx * 0.1, -0.01, sz + m.fz * 0.1, 0.035, 0x3a3d40);
    b.finish(FINISH_PAINT, 0.6);
    const pipe = random() < 0.5 ? 0x2e4b6c : 0x2f4a37;
    tube(b, px, 0.2, pz, px, WALL_HEIGHT, pz, 0.028, pipe);
    valveUpright(ctx, px, 0.5, pz, 0.028, m.lx, m.lz, random());
    const [gx, , gz] = m.at(0.16, 0, 0);
    b.finish(FINISH_BRASS, 0.5);
    tube(b, gx, 0.32, gz, gx + m.lx * 0.06, 0.32, gz + m.lz * 0.06, 0.004, BRASS, 0, 4);
    band(b, gx + m.lx * 0.07, 0.32, gz + m.lz * 0.07, m.lx, 0, m.lz, 0.022, 0.014, 0x1f1f1f);
    dial(ctx.gauges, gx + m.lx * 0.078, 0.32, gz + m.lz * 0.078, m.lx, m.lz, 0.019, random());
}

/** A gate valve in an upright pipe, its spindle out sideways and the wheel on it. */
function valveUpright(ctx, x, y, z, r, nx, nz, roll) {
    const b = ctx.pipes;
    b.finish(FINISH_IRON, 0.6);
    band(b, x, y, z, 0, 1, 0, r * 1.5, 0.06, IRON);
    band(b, x, y - 0.034, z, 0, 1, 0, r * 1.8, 0.008, IRON);
    band(b, x, y + 0.034, z, 0, 1, 0, r * 1.8, 0.008, IRON);
    const out = r * 1.5 + 0.03;
    tube(b, x, y, z, x + nx * out, y, z + nz * out, 0.005, 0x8e9496, 0, 4);
    const wheel = WHEEL_COLORS[Math.floor(roll * WHEEL_COLORS.length)];
    b.finish(FINISH_PAINT, 0.6);
    hoop(b, x + nx * out, y, z + nz * out, nx, 0, nz, 0.034, 0.0045, wheel);
    for (let n = 0; n < 3; n++) {
        const angle = (n / 3) * Math.PI * 2 + roll * 3;
        const [rx, rz] = [nz, -nx];
        tube(b, x + nx * out, y, z + nz * out, x + nx * out + rx * Math.cos(angle) * 0.034, y + Math.sin(angle) * 0.034, z + nz * out + rz * Math.cos(angle) * 0.034, 0.003, wheel, 0, 4);
    }
}

/**
 * A valve header: a big pipe across on two stands, blanked off at each end, with branches up off it into the ceiling,
 * a valve with a red wheel on each.
 */
function header(ctx, machine, random) {
    const b = ctx.pipes;
    const m = frame(ctx, machine);
    const y = 0.4;
    const r = 0.055;
    const [ax, , az] = m.at(-0.8, 0, 0);
    const [bx, , bz] = m.at(0.8, 0, 0);
    const lagged = random() < 0.4;
    b.finish(lagged ? FINISH_LAGGED : FINISH_PAINT, 0.5 + random() * 0.4);
    const color = lagged ? 0xd2c7ad : [0x9b9e9f, 0x2f4a37, 0x74291e][Math.floor(random() * 3)];
    tube(b, ax, y, az, bx, y, bz, r, color, 0, 12);
    b.finish(FINISH_IRON, 0.6);
    for (const e of [-1, 1]) {
        const [ex, , ez] = m.at(e * 0.8, 0, 0);
        band(b, ex, y, ez, m.fx, 0, m.fz, r * 1.4, 0.02, IRON);
        m.box(b, e * 0.6 - 0.03, -0.06, 0, e * 0.6 + 0.03, 0.06, y - r, 0x3a3d40);
    }
    const count = 3 + Math.floor(random() * 3);
    for (let n = 0; n < count; n++) {
        const along = -0.62 + (n + 0.5) * (1.24 / count);
        const [px, , pz] = m.at(along, 0, 0);
        const pipe = [0x2e4b6c, 0x9b9e9f, 0x6b3923, 0x2f4a37][Math.floor(random() * 4)];
        b.finish(pipe === 0x6b3923 ? FINISH_RUST : FINISH_PAINT, 0.6);
        tube(b, px, y + r * 0.8, pz, px, WALL_HEIGHT, pz, 0.022, pipe);
        valveUpright(ctx, px, y + 0.17 + (n % 2) * 0.06, pz, 0.022, m.lx, m.lz, random());
    }
    const [gx, , gz] = m.at(0.7, 0, 0);
    b.finish(FINISH_BRASS, 0.5);
    tube(b, gx, y + r, gz, gx, y + r + 0.05, gz, 0.004, BRASS, 0, 4);
    band(b, gx, y + r + 0.07, gz, m.lx, 0, m.lz, 0.026, 0.016, BRASS);
    dial(ctx.gauges, gx + m.lx * 0.0085, y + r + 0.07, gz + m.lz * 0.0085, m.lx, m.lz, 0.022, random());
}

/** A soft shadow under something rectangular: dark under it, fading out past its edges (see chunkGeometry.js). */
function rectShadow(shade, x, z, hx, hz) {
    const y = 0.0012;
    const u = 3.5 / 4;
    const at = (lx, lz, v) => [x + lx, y, z + lz, 0, 1, 0, u, v];
    const inner = [[-hx + 0.08, -hz + 0.08], [hx - 0.08, -hz + 0.08], [hx - 0.08, hz - 0.08], [-hx + 0.08, hz - 0.08]];
    const outer = [[-hx - 0.12, -hz - 0.12], [hx + 0.12, -hz - 0.12], [hx + 0.12, hz + 0.12], [-hx - 0.12, hz + 0.12]];
    shade.orientedQuad(at(...inner[0], 0), at(...inner[1], 0), at(...inner[2], 0), at(...inner[3], 0));
    for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4;
        shade.orientedQuad(at(...inner[k], 0), at(...outer[k], 1), at(...outer[n], 1), at(...inner[n], 0));
    }
}

// ---------------------------------------------------------------------------------------------- leaks

/** The black stuff: a streak down the wall under where it drips, and a glossy puddle under that. */
function gooLeaks(ctx, drips) {
    for (const goo of drips) {
        const x = goo.x - ctx.ox;
        const z = goo.z - ctx.oz;
        const cellX = Math.round(goo.x);
        const cellZ = Math.round(goo.z);
        // The wall it's on: behind the pipe, half a cell from the cell's middle.
        const wx = goo.nx !== 0 ? cellX - goo.nx * (0.5 - HALF_WALL - 0.0015) - ctx.ox : x;
        const wz = goo.nz !== 0 ? cellZ - goo.nz * (0.5 - HALF_WALL - 0.0015) - ctx.oz : z;
        const height = goo.y;
        const pick = goo.variant & 1 ? PAINT_ATLAS.streakGoo : PAINT_ATLAS.streakGoo2;
        wallPicture(ctx.paint, wx, height / 2, wz, goo.nx, goo.nz, 0.05 * goo.size + 0.03, height / 2 + 0.01, pick, 0x0d0b0a);
        const radius = 0.09 + 0.1 * goo.size;
        const blob = (goo.variant >>> 1) & 1 ? PAINT_ATLAS.puddle : PAINT_ATLAS.puddle2;
        floorPicture(ctx.goo, x + goo.nx * 0.03, z + goo.nz * 0.03, radius, radius * 0.8, ((goo.variant >>> 3) & 255) / 40, blob, 0.0025);
    }
}

/** The grates in the floor the steam comes up through. */
function vents(ctx, leaks) {
    for (const leak of leaks) {
        if (!leak.vent || leak.y > 0.1) continue;
        floorPicture(ctx.paint, leak.x - ctx.ox, leak.z - ctx.oz, 0.13, 0.13, 0, PAINT_ATLAS.grate, 0.0022);
    }
}

// Puffs a leak is made of: a jet, a plume up through a grate (or a safety valve); and the drops at a time from where the
// black stuff drips.
const JET_PUFFS = 10;
const PLUME_PUFFS = 12;
const DRIPS = 2;
/** What a puff is, for the steam material: a jet, a plume, a safety valve's blowing off, a drop. */
const PUFF_JET = 0;
const PUFF_PLUME = 1;
const PUFF_VALVE = 2;
const PUFF_DROP = 3;

/**
 * The steam, and the drips: each leak a stream of puffs, each puff a quad the steam material turns to face the camera
 * and moves along (see pipeDreamsMaterials.js): out of the leak along its way, slowing, rising and spreading as it goes,
 * then gone; and from each of the black stuff's leaks, a drop swelling and falling now and then. Every vertex has where
 * it comes out (position), which corner it is, the way out and when the puff set off, and its size, how long a puff
 * lasts, what kind it is and how strong.
 */
function buildSteam(leaks, goo, ox, oz) {
    let count = goo.length * DRIPS;
    for (const leak of leaks) count += leak.vent ? PLUME_PUFFS : JET_PUFFS;
    if (count === 0) return null;
    const vertices = count * 4;
    const position = new Float32Array(vertices * 3);
    const corner = new Float32Array(vertices * 2);
    const puff = new Float32Array(vertices * 4);
    const shape = new Float32Array(vertices * 4);
    const index = new Uint16Array(count * 6);
    let v = 0;
    let q = 0;
    const emit = (x, y, z, dx, dy, dz, puffs, size, life, kind, strength) => {
        const random = mulberry32(hashInts(Math.round(x * 97), Math.round(z * 89), Math.round(y * 83), kind));
        for (let n = 0; n < puffs; n++) {
            const phase = (n + random() * 0.6) / puffs;
            const scale = kind === PUFF_DROP ? 1 : 0.8 + random() * 0.4;
            for (let c = 0; c < 4; c++) {
                position.set([x - ox, y, z - oz], v * 3);
                corner.set([c === 0 || c === 3 ? -1 : 1, c < 2 ? -1 : 1], v * 2);
                puff.set([dx, dy, dz, phase], v * 4);
                shape.set([size * scale, life, kind, strength], v * 4);
                v++;
            }
            const first = v - 4;
            index.set([first, first + 1, first + 2, first, first + 2, first + 3], q);
            q += 6;
        }
    };
    for (const leak of leaks) {
        if (leak.vent) emit(leak.x, leak.y, leak.z, 0, 1, 0, PLUME_PUFFS, 0.14, 3.2, leak.y > 0.1 ? PUFF_VALVE : PUFF_PLUME, leak.strength);
        else emit(leak.x, leak.y, leak.z, leak.dx, leak.dy, leak.dz, JET_PUFFS, 0.07 + 0.06 * leak.strength, 1.3 + 0.6 / leak.strength, PUFF_JET, leak.strength);
    }
    // (Each drop takes its time: a few seconds between them.)
    for (const drip of goo) emit(drip.x, drip.y, drip.z, 0, -1, 0, DRIPS, 0.0065 * (0.8 + 0.4 * drip.size), 5 + (drip.variant & 3), PUFF_DROP, 1);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('corner', new BufferAttribute(corner, 2));
    geometry.setAttribute('puff', new BufferAttribute(puff, 4));
    geometry.setAttribute('shape', new BufferAttribute(shape, 4));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    // The puffs travel up to a unit or so from their leak.
    geometry.boundingSphere.radius += 1.2;
    return geometry;
}
