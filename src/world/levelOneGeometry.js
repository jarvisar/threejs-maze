import { Sphere, Vector3 } from 'three';
import { CHUNK_SIZE, HALF_CHUNK, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { ColorBuilder } from './ColorBuilder.js';
import { GeometryBuilder } from './GeometryBuilder.js';
import { PANELS_PER_SIDE } from './generator.js';
import { DIRECTIONS, EDGE_DOOR, EDGE_NONE, EDGE_WALL, mod } from './grid.js';
import { GLYPH_PICTURES, glyphRect } from './levelOneTextures.js';
import { BAY, FIXTURE_NONE, FIXTURE_X, LEVEL_ONE_PILLAR, STOP_NONE, aislesAlongX, isBaySpan, isColumnCorner, levelOneDarkness, spanOf } from './levelOne.js';
import { buildCar } from './levelOneCars.js';
import { aisleFittings, convexMirror, doorFrame, firePoint, stairCore, wheelStop } from './levelOneFittings.js';
import { OUTLET_HEIGHT, OUTLET_Y } from './outlets.js';
import { hashFloat, hashInts } from './random.js';
import { ZONE_PARKING, ZONE_SERVICE } from './zones.js';

/*
 * What Level 1 has that Level 0 doesn't, as meshes for one chunk (see levelOne.js for where it all goes):
 *
 * - the columns, their corners chamfered, and the beams under the slab along every line of them, with a haunch
 *   where each meets a column (all in the level's own pillars mesh, the same concrete)
 * - the fluorescent battens hanging in the light slots (their tubes follow the slots' state, like Level 0's panels,
 *   in the fixture material)
 * - everything run along under the slab: white sprinkler pipes with their red heads, branches off them, the red
 *   fire main, cable trays, and the rods they hang from
 * - the tubes fixed to some of the columns, each flickering on its own, and a glow round every light, which puts a
 *   halo behind a column with a tube on its far side
 * - the stencilled bay code on every face of every column, over the band of its block's colour, and arrows painted
 *   down the aisles (the bays' lines are the floor shader's, see levelOneShading.js)
 * - the cars (levelOneCars.js), the wheel stops in the bays, and the rest of the fittings (levelOneFittings.js):
 *   what hangs over the aisles, fire points, convex mirrors, conduits, steel frames round the doorways, and the
 *   stair cores, with their exit signs lit on a battery through a power cut
 *
 * Pipes run the whole level on fixed lines, so they carry on from one chunk into the next (and through the walls,
 * the way pipes do). Positions are relative to the chunk's centre.
 */

const N = CHUNK_SIZE;
const HALF_COLUMN = LEVEL_ONE_PILLAR / 2;

/** The beams: how far down from the slab they come, and how wide they are. */
export const BEAM_BOTTOM = 0.9;
const BEAM_HALF = 0.07;
/** The columns' chamfered corners, and the haunches under the beams where they meet them: how far out and down. */
const CHAMFER = 0.022;
const HAUNCH_OUT = 0.07;
const HAUNCH_DROP = 0.07;

// The battens: where they hang, and their parts.
const BATTEN_LENGTH = 0.36;
const BATTEN_TOP = 0.888;
const BATTEN_BOTTOM = 0.868;
const TUBE_Y = 0.862;
const TUBE_RADIUS = 0.0065;
const HOUSING = 0x8e9396;
const HANGER = 0x4c5052;
const TUBE = 0xf2f6ff;
const TUBE_END = 0x3a3d40;

// Pipes and trays, from the top down, each a layer of its own so none runs through another.
const BRANCH_Y = 0.891;
const BRANCH_RADIUS = 0.008;
const MAIN_Y = 0.87;
const MAIN_RADIUS = 0.011;
const TRAY_BOTTOM = 0.84;
const TRAY_LIP = 0.855;
const TRAY_HALF = 0.05;
const FIRE_Y = 0.818;
const FIRE_RADIUS = 0.018;
const PIPE_WHITE = 0xd4d6d2;
const SPRINKLER_RED = 0xb3261e;
const BRASS = 0xb08d3c;
const FIRE_RED = 0x9c2a1f;
const GALVANISED = 0x9aa0a3;
const CABLES = [0x1d1e1f, 0x3b3d3f, 0xb8621c, 0x1d1e1f];

// The tubes on the columns: how many columns have one, where on the column, and how bright their glow is.
const COLUMN_TUBE_CHANCE = 0.42;
const COLUMN_TUBE_BOTTOM = 0.28;
const COLUMN_TUBE_TOP = 0.72;

// Stencils: the size of a letter, and how high the bay code is on its column.
const LETTER_HEIGHT = 0.1;
const LETTER_WIDTH = 0.072;
// (The letters don't fill their cells in the glyph texture.)
const LETTER_SPACING = 0.66;
const LABEL_Y = 0.6;
const ROW_LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
// The frames round the doorways: painted steel, faded.
const DOOR_FRAMES = [0x4a4f52, 0x2f4a3d, 0x55504a, 0x3b4550];
// The stencils on the columns: dark on the yellow band, pale on the others (see columnBand).
const INK = 0x1c1c1b;
const PALE_INK = 0xdcdcd4;
const FLOOR_PAINT = 0xd8d6cc;

/**
 * Level 1's own meshes for one chunk (its `shape.extras`, see levels.js), by the name of the material that draws
 * each: `fixtures`, `services`, `tubes`, `glows`, `paint`, `lamps`, `exitGlows` and `lightboxes`.
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {import('./generator.js').ChunkData} chunk
 * @param {{ pillars: import('./GeometryBuilder.js').GeometryBuilder, shade: import('./GeometryBuilder.js').GeometryBuilder, pillarShade: (x: number, z: number, half: number) => void }} builders
 *     The columns' (and the beams', the same concrete), and the soft shadows', to add the cars' and the columns' to.
 */
export function buildLevelOneGeometry(store, chunk, { pillars, shade, pillarShade }) {
    const seed = store.seed;
    const x0 = chunk.cx * N - HALF_CHUNK;
    const z0 = chunk.cz * N - HALF_CHUNK;
    const ox = chunk.cx * N;
    const oz = chunk.cz * N;
    const data = /** @type {import('./levelOne.js').LevelOneData} */ (chunk.levelOne);
    const fixtures = fixturesBuilder.reset();
    const services = servicesBuilder.reset();
    const tubes = tubesBuilder.reset();
    const glows = glowsBuilder.reset();
    const paint = paintBuilder.reset();
    const lamps = lampsBuilder.reset();
    const exitGlows = exitGlowsBuilder.reset();
    const lightboxes = lightboxesBuilder.reset();

    beams(pillars, store, chunk, x0, z0, ox, oz);
    battens(fixtures, glows, data.fixtures, x0, z0, ox, oz);
    pipes(services, x0, z0, ox, oz);

    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            if (!store.pillar(x, z)) continue;
            const cx = x + 0.5;
            const cz = z + 0.5;
            column(pillars, cx - ox, cz - oz, isColumnCorner(x, z));
            pillarShade(cx - ox, cz - oz, HALF_COLUMN);
            // (No bay code on the face with a tube: it's fixed over the middle of it.)
            const tube = columnTube(seed, services, tubes, glows, cx, cz, ox, oz);
            columnLabel(paint, cx - ox, cz - oz, x, z, tube);
            columnFittings({ services, paint }, seed, store, chunk, x, z, tube, ox, oz);
        }
    }
    wallFittings({ services, paint }, seed, store, chunk, x0, z0, ox, oz);
    if (chunk.zone.type === ZONE_PARKING) {
        const core = data.core;
        aisleFittings({ services, paint, lightboxes }, seed, x0, z0, ox, oz, (x, z) => !core || x < core.x0 || z < core.z0 || x >= core.x0 + BAY || z >= core.z0 + BAY);
    }
    floorArrows(seed, paint, store, chunk, x0, z0, ox, oz);
    for (const bay of data.bays) if (bay.stop !== STOP_NONE) wheelStop(services, seed, bay, ox, oz);
    for (const car of data.cars) buildCar(services, shade, car, ox, oz, rectShadow);
    if (data.core) stairCore({ services, paint, lamps, exitGlows }, seed, data.core, chunk.props, ox, oz);

    return {
        fixtures: fixtures.build(CHUNK_BOUNDS),
        services: services.build(CHUNK_BOUNDS),
        tubes: tubes.build(CHUNK_BOUNDS),
        glows: glows.build(CHUNK_BOUNDS),
        paint: paint.build(CHUNK_BOUNDS),
        lamps: lamps.build(CHUNK_BOUNDS),
        exitGlows: exitGlows.build(CHUNK_BOUNDS),
        lightboxes: lightboxes.build(CHUNK_BOUNDS),
    };
}

// ---------------------------------------------------------------------------------------------- structure

/**
 * The beams: along every line of columns, both ways, under the slab. The ones along x run the chunk's width, the
 * ones along z stop against them. Both are in pieces cut wherever one meets another, so where one's underside ends
 * on another's, the two share its corners (and no pinholes open along the join).
 */
function beams(builder, store, chunk, x0, z0, ox, oz) {
    const lines = (from) => {
        const found = [];
        for (let c = from; c < from + N; c++) if (mod(c, BAY) === 1) found.push(c + 0.5);
        return found;
    };
    const xLines = lines(x0);
    const zLines = lines(z0);
    const lo = (c) => c - 0.5;
    const hi = (c) => c + N - 0.5;
    // A line of columns on the chunk's low edge is the chunk before's, and so is its beam, which reaches half its width
    // into this one (if the chunk before has beams at all: outside a tape's walls, it has none). One on its high edge is
    // this chunk's, and so is all of the crossing there.
    const before = (c, cx, cz) => mod(c - 1, BAY) === 1 && !store.options.isVoid?.(cx, cz);
    const onHigh = (c) => mod(c + N - 1, BAY) === 1;
    // The pieces from `from` to `to`, cut either side of every beam across it (`stop`: leaving out those inside them).
    const pieces = (from, to, across, stop, build) => {
        const cuts = [from, ...across.flatMap((c) => [c - BEAM_HALF, c + BEAM_HALF]), to].filter((s) => s >= from && s <= to);
        for (let k = 0; k < cuts.length - 1; k++) {
            const [s0, s1] = [cuts[k], cuts[k + 1]];
            if (s1 - s0 < 1e-4) continue;
            if (!stop || !across.some((c) => s0 >= c - BEAM_HALF - 1e-6 && s1 <= c + BEAM_HALF + 1e-6)) build(s0, s1);
        }
    };
    // Along x, at each z line, the whole way across.
    const xFrom = lo(x0) + (before(x0, chunk.cx - 1, chunk.cz) ? BEAM_HALF : 0);
    const xTo = hi(x0) + (onHigh(x0) ? BEAM_HALF : 0);
    for (const z of zLines) pieces(xFrom, xTo, xLines, false, (s0, s1) => beam(builder, 0, z - oz, s0 - ox, s1 - ox));
    // Along z, at each x line, between the ones along x.
    const zFrom = lo(z0) + (before(z0, chunk.cx, chunk.cz - 1) ? BEAM_HALF : 0);
    for (const x of xLines) pieces(zFrom, hi(z0), zLines, true, (s0, s1) => beam(builder, 1, x - ox, s0 - oz, s1 - oz));
}

/**
 * A column at (x, z) (relative to the chunk): a copy of the one built once (see columnShape), moved into place, its
 * texture carried on with it.
 * @param {import('./GeometryBuilder.js').GeometryBuilder} b
 */
function column(b, x, z, gridded) {
    const shape = COLUMN_SHAPES[gridded ? 1 : 0];
    for (let k = 0; k < shape.length; k += 8) {
        const nx = shape[k + 3];
        const ny = shape[k + 4];
        const nz = shape[k + 5];
        // Up the sides the texture runs to the right, looking at it. On top, along x and z. The haunches have their own.
        const flat = ny > 0.99;
        const side = Math.abs(ny) < 1e-6;
        const u = shape[k + 6] + (flat ? x : side ? x * nz - z * nx : 0);
        const v = shape[k + 7] - (flat ? z : 0);
        b.vertex(shape[k] + x, shape[k + 1], shape[k + 2] + z, nx, ny, nz, u, v);
    }
}

/**
 * A column, round its middle, as [x, y, z, nx, ny, nz, u, v] for each corner of each quad: its corners chamfered
 * (the way concrete comes out of a mould), up to the slab, with its top (seen when flying over the level), and
 * `gridded`, on the grid, where the beams it holds up meet it with a haunch under each.
 */
function columnShape(gridded) {
    const b = new GeometryBuilder();
    columnInto(b, 0, 0, gridded);
    const shape = new Float32Array(b.vertexCount * 8);
    for (let i = 0; i < b.vertexCount; i++) {
        shape.set(b.positions.subarray(i * 3, i * 3 + 3), i * 8);
        shape.set(b.normals.subarray(i * 3, i * 3 + 3), i * 8 + 3);
        shape.set(b.uvs.subarray(i * 2, i * 2 + 2), i * 8 + 6);
    }
    return shape;
}

/** Builds a column at (x, z) (see columnShape). */
function columnInto(b, x, z, gridded) {
    const h = HALF_COLUMN;
    const c = CHAMFER;
    // Round it, seen from above, each face from one corner to the next with the column on its left.
    const ring = [[h, -h + c], [h, h - c], [h - c, h], [-h + c, h], [-h, h - c], [-h, -h + c], [-h + c, -h], [h - c, -h]];
    for (let k = 0; k < ring.length; k++) {
        const [px, pz] = ring[k];
        const [qx, qz] = ring[(k + 1) % ring.length];
        const length = Math.hypot(qx - px, qz - pz);
        const nx = (qz - pz) / length;
        const nz = -(qx - px) / length;
        // Its texture runs to the right, looking at it (up × normal), in the chunk's own coordinates.
        const u = (ax, az) => (x + ax) * nz - (z + az) * nx;
        b.quad(x + qx, 0, z + qz, x + px, 0, z + pz, x + px, WALL_HEIGHT, z + pz, x + qx, WALL_HEIGHT, z + qz, nx, 0, nz, u(qx, qz), 0, u(px, pz), WALL_HEIGHT);
    }
    const top = (k) => [x + ring[k][0], WALL_HEIGHT, z + ring[k][1], 0, 1, 0, x + ring[k][0], -(z + ring[k][1])];
    b.orientedQuad(top(0), top(1), top(4), top(5));
    b.orientedQuad(top(1), top(2), top(3), top(4));
    b.orientedQuad(top(5), top(6), top(7), top(0));
    if (!gridded) return;
    // The haunches: from its faces a little under the beams, out to their undersides.
    for (const [dx, dz] of DIRECTIONS) {
        const side = [dz, dx];
        const at = (out, across, y) => [x + dx * out + side[0] * across, y, z + dz * out + side[1] * across];
        const slope = Math.hypot(HAUNCH_OUT, HAUNCH_DROP);
        const n = [dx * HAUNCH_DROP / slope, -HAUNCH_OUT / slope, dz * HAUNCH_DROP / slope];
        const corner = (p, normal, uv) => [...p, ...normal, ...uv];
        const foot = BEAM_BOTTOM - HAUNCH_DROP;
        const p0 = at(h, -BEAM_HALF, foot);
        const p1 = at(h, BEAM_HALF, foot);
        const p2 = at(h + HAUNCH_OUT, BEAM_HALF, BEAM_BOTTOM);
        const p3 = at(h + HAUNCH_OUT, -BEAM_HALF, BEAM_BOTTOM);
        b.orientedQuad(corner(p0, n, [-BEAM_HALF, 0]), corner(p1, n, [BEAM_HALF, 0]), corner(p2, n, [BEAM_HALF, slope]), corner(p3, n, [-BEAM_HALF, slope]));
        // Its two sides, each a triangle (a quad with two corners at one point), in the planes of the beam's sides.
        for (const s of [-1, 1]) {
            const sn = [side[0] * s, 0, side[1] * s];
            const a = at(h, s * BEAM_HALF, foot);
            const bb = at(h + HAUNCH_OUT, s * BEAM_HALF, BEAM_BOTTOM);
            const top0 = at(h, s * BEAM_HALF, BEAM_BOTTOM);
            const uv = (p) => [p[0] * sn[2] - p[2] * sn[0], p[1]];
            b.orientedQuad(corner(a, sn, uv(a)), corner(bb, sn, uv(bb)), corner(top0, sn, uv(top0)), corner(top0, sn, uv(top0)));
        }
    }
}

/**
 * One beam: its underside, two sides and top (seen when flying over the level, like the walls' tops, a hair under
 * theirs and the columns', which it runs through, so theirs are the ones seen there). Axis 0 runs along x at
 * z = `at`, from `from` to `to`, axis 1 along z at x = `at`.
 */
function beam(builder, axis, at, from, to) {
    const y0 = BEAM_BOTTOM;
    const y1 = WALL_HEIGHT;
    const top = WALL_HEIGHT - 0.001;
    const a0 = at - BEAM_HALF;
    const a1 = at + BEAM_HALF;
    if (axis === 0) {
        builder.quad(from, y0, a0, to, y0, a0, to, y0, a1, from, y0, a1, 0, -1, 0, from, a0, to, a1);
        builder.quad(to, y0, a0, from, y0, a0, from, y1, a0, to, y1, a0, 0, 0, -1, -to, y0, -from, y1);
        builder.quad(from, y0, a1, to, y0, a1, to, y1, a1, from, y1, a1, 0, 0, 1, from, y0, to, y1);
        builder.quad(from, top, a1, to, top, a1, to, top, a0, from, top, a0, 0, 1, 0, from, -a1, to, -a0);
    } else {
        builder.quad(a0, y0, to, a0, y0, from, a1, y0, from, a1, y0, to, 0, -1, 0, -to, a0, -from, a1);
        builder.quad(a0, y0, from, a0, y0, to, a0, y1, to, a0, y1, from, -1, 0, 0, from, y0, to, y1);
        builder.quad(a1, y0, to, a1, y0, from, a1, y1, from, a1, y1, to, 1, 0, 0, -to, y0, -from, y1);
        builder.quad(a0, top, to, a1, top, to, a1, top, from, a0, top, from, 0, 1, 0, a0, -to, a1, -from);
    }
}

/**
 * The battens in the light slots that have one: a pressed-steel housing on two rods, with two tubes under it. And
 * the glow round each (it follows the slot's state, see materials.js).
 */
function battens(fixtures, glows, slots, x0, z0, ox, oz) {
    for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
        for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
            const kind = slots[pi * PANELS_PER_SIDE + pj];
            if (kind === FIXTURE_NONE) continue;
            const x = x0 + pi * 2 + 1 - ox;
            const z = z0 + pj * 2 + 1 - oz;
            const alongX = kind === FIXTURE_X;
            const half = BATTEN_LENGTH / 2;
            // Housing, end caps, rods.
            orientedBox(fixtures, alongX, x, z, 0, half, 0.026, BATTEN_BOTTOM, BATTEN_TOP, HOUSING);
            for (const end of [-1, 1]) {
                orientedBox(fixtures, alongX, x, z, end * (half - 0.012), 0.012, 0.02, TUBE_Y - 0.009, BATTEN_BOTTOM, TUBE_END);
                orientedBox(fixtures, alongX, x, z, end * (half - 0.05), 0.002, 0.002, BATTEN_TOP, WALL_HEIGHT, HANGER);
            }
            // Two tubes.
            for (const side of [-1, 1]) {
                const tx = alongX ? x : x + side * 0.011;
                const tz = alongX ? z + side * 0.011 : z;
                if (alongX) fixtures.cylinder(0, tx - half + 0.024, TUBE_Y, tz, tx + half - 0.024, TUBE_RADIUS, 6, TUBE);
                else fixtures.cylinder(2, tx, TUBE_Y, tz - half + 0.024, tz + half - 0.024, TUBE_RADIUS, 6, TUBE);
            }
            glows.spot(x, TUBE_Y - 0.01, z, 0.36, -1, 0.42, 0.55);
        }
    }
}

/** A box `half` long along the batten's axis and `halfAcross` across it, centred `along` from (x, z). */
function orientedBox(builder, alongX, x, z, along, half, halfAcross, y0, y1, color) {
    const cx = alongX ? x + along : x;
    const cz = alongX ? z : z + along;
    const hx = alongX ? half : halfAcross;
    const hz = alongX ? halfAcross : half;
    builder.box(cx - hx, y0, cz - hz, cx + hx, y1, cz + hz, color);
}

/**
 * Everything that runs under the slab: sprinkler mains along x in every bay with a red head every so often, white
 * branches along z, a cable tray along z now and then, the red fire main along x now and then, and the rods it all
 * hangs from. On fixed lines through the whole level.
 */
function pipes(builder, x0, z0, ox, oz) {
    const xFrom = x0 - 0.5;
    const xTo = x0 + N - 0.5;
    const zFrom = z0 - 0.5;
    const zTo = z0 + N - 0.5;
    // Rods up to the slab, clear of the beams, from `bottom`: the middle of a pipe (so they meet it, however its sides
    // are turned), or the floor of a tray.
    const rods = (alongX, at, from, to, bottom) => {
        for (let s = Math.ceil((from - 0.75) / 1.5) * 1.5 + 0.75; s < to; s += 1.5) {
            if (mod(s - 1.5, BAY) < 0.2 || mod(s - 1.5, BAY) > BAY - 0.2) continue;
            const x = alongX ? s : at;
            const z = alongX ? at : s;
            builder.box(x - ox - 0.0025, bottom, z - oz - 0.0025, x - ox + 0.0025, WALL_HEIGHT, z - oz + 0.0025, HANGER);
        }
    };

    // Sprinkler mains along x, one a bay, with heads hanging from them.
    for (let z = Math.ceil((zFrom - 0.62) / BAY) * BAY + 0.62; z < zTo; z += BAY) {
        builder.cylinder(0, xFrom - ox, MAIN_Y, z - oz, xTo - ox, MAIN_RADIUS, 8, PIPE_WHITE);
        rods(true, z, xFrom, xTo, MAIN_Y);
        for (let x = Math.ceil((xFrom - 0.3) / 1.2) * 1.2 + 0.3; x < xTo; x += 1.2) {
            builder.cylinder(1, x - ox, MAIN_Y - MAIN_RADIUS - 0.012, z - oz, MAIN_Y - MAIN_RADIUS + 0.002, 0.0045, 6, SPRINKLER_RED);
            builder.cylinder(1, x - ox, MAIN_Y - MAIN_RADIUS - 0.015, z - oz, MAIN_Y - MAIN_RADIUS - 0.012, 0.009, 8, BRASS);
        }
    }
    // White branches along z, every other bay.
    for (let x = Math.ceil((xFrom - 0.45) / (BAY * 2)) * BAY * 2 + 0.45; x < xTo; x += BAY * 2) {
        builder.cylinder(2, x - ox, BRANCH_Y, zFrom - oz, zTo - oz, BRANCH_RADIUS, 6, PIPE_WHITE);
    }
    // Cable trays along z, every fourth bay.
    for (let x = Math.ceil((xFrom - 4) / (BAY * 4)) * BAY * 4 + 4; x < xTo; x += BAY * 4) {
        const lx = x - ox;
        // (The bottom between the lips, not under them.)
        builder.box(lx - TRAY_HALF + 0.0015, TRAY_BOTTOM, zFrom - oz, lx + TRAY_HALF - 0.0015, TRAY_BOTTOM + 0.003, zTo - oz, GALVANISED);
        for (const side of [-1, 1]) builder.box(lx + side * TRAY_HALF - 0.0015, TRAY_BOTTOM, zFrom - oz, lx + side * TRAY_HALF + 0.0015, TRAY_LIP, zTo - oz, GALVANISED);
        CABLES.forEach((color, k) => builder.cylinder(2, lx - 0.03 + k * 0.02, TRAY_BOTTOM + 0.009, zFrom - oz, zTo - oz, 0.006, 5, color));
        rods(false, x - TRAY_HALF + 0.004, zFrom, zTo, TRAY_BOTTOM + 0.003);
        rods(false, x + TRAY_HALF - 0.004, zFrom, zTo, TRAY_BOTTOM + 0.003);
    }
    // The fire main along x, every fourth bay, with a flange at every joint.
    for (let z = Math.ceil((zFrom - 8.1) / (BAY * 4)) * BAY * 4 + 8.1; z < zTo; z += BAY * 4) {
        builder.cylinder(0, xFrom - ox, FIRE_Y, z - oz, xTo - ox, FIRE_RADIUS, 10, FIRE_RED);
        for (let x = Math.ceil(xFrom / 2) * 2 + 1; x < xTo; x += 2) builder.cylinder(0, x - ox - 0.006, FIRE_Y, z - oz, x - ox + 0.006, FIRE_RADIUS + 0.006, 10, FIRE_RED);
        rods(true, z, xFrom, xTo, FIRE_Y);
    }
}

// ---------------------------------------------------------------------------------------------- columns

/**
 * The column's bay code, stencilled on each of its faces (but `skip`, one of DIRECTIONS, or −1): a letter for the row
 * it's in and a number for the column (so it goes C7, C8, C9 down an aisle). The first two you see are C7 and C8, well
 * away from where the letters and numbers go round again.
 */
function columnLabel(paint, x, z, cellX, cellZ, skip) {
    const row = Math.floor((cellZ - 1) / BAY) + 3;
    const column = Math.floor((cellX - 1) / BAY) + 7;
    const text = ROW_LETTERS[mod(row, ROW_LETTERS.length)] + String(mod(column, 60) + 1);
    const face = HALF_COLUMN + 0.0015;
    const width = text.length * LETTER_WIDTH * LETTER_SPACING;
    // Each face: its normal, and which way along it reads left to right, looking at it.
    for (const [side, [nx, nz]] of DIRECTIONS.entries()) {
        if (side === skip) continue;
        const rx = nz;
        const rz = -nx;
        for (let k = 0; k < text.length; k++) {
            const along = -width / 2 + (k + 0.5) * LETTER_WIDTH * LETTER_SPACING;
            const cx = x + nx * face + rx * along;
            const cz = z + nz * face + rz * along;
            paint.decal(cx, LABEL_Y, cz, nx, nz, LETTER_WIDTH / 2, LETTER_HEIGHT / 2, glyphRect(text[k]), columnBand(cellX, cellZ) === 0 ? INK : PALE_INK);
        }
    }
}

/**
 * Now and then a fire point on one of a column's faces (not the one with a tube on it), or in the car park a convex
 * mirror on one of its corners. Only on a column standing clear of the walls, with nothing in front of it.
 */
function columnFittings(builders, seed, store, chunk, x, z, tube, ox, oz) {
    if (!isColumnCorner(x, z)) return;
    for (const [ex, ez, axis] of [[x, z, 0], [x, z + 1, 0], [x, z, 1], [x + 1, z, 1]]) if (store.edge(ex, ez, axis) !== EDGE_NONE) return;
    const cx = x + 0.5;
    const cz = z + 0.5;
    const h = hashFloat(seed, 0xf19e, cx * 2, cz * 2);
    if (h < 0.09) {
        const face = (tube + 1 + Math.floor(hashFloat(seed, 0xf19f, cx * 2, cz * 2) * 3)) % 4;
        const [nx, nz] = DIRECTIONS[tube < 0 ? Math.floor(h / 0.0225) : face];
        const px = cx + nx * HALF_COLUMN;
        const pz = cz + nz * HALF_COLUMN;
        if (clearInFront(chunk, px, pz, nx, nz)) firePoint(builders, px - ox, pz - oz, [nx, nz]);
    } else if (h < 0.14 && chunk.zone.type === ZONE_PARKING) {
        const k = Math.floor(hashFloat(seed, 0xf1a0, cx * 2, cz * 2) * 4);
        const dir = [[1, 1], [-1, 1], [-1, -1], [1, -1]][k];
        const corner = HALF_COLUMN - CHAMFER / 2;
        convexMirror(builders, cx + dir[0] * corner - ox, cz + dir[1] * corner - oz, dir);
    }
}

/**
 * What's on the walls: a steel frame round every doorway (the stair core's has its own), a conduit up the wall from most
 * of the junction boxes, and now and then a fire point, off the middle of the wall (the other way from a junction box),
 * with nothing standing in front of it: more in the corridors than the car park.
 */
function wallFittings(builders, seed, store, chunk, x0, z0, ox, oz) {
    const share = chunk.zone.type === ZONE_SERVICE ? 0.07 : 0.035;
    const core = chunk.levelOne.core;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            for (const axis of [0, 1]) {
                const edge = store.edge(x, z, axis);
                if (edge === EDGE_DOOR) {
                    const owner = core && (axis === 0 ? core.dx !== 0 && x === core.doorX + Math.min(core.dx, 0) && z === core.doorZ : core.dz !== 0 && z === core.doorZ + Math.min(core.dz, 0) && x === core.doorX);
                    if (!owner) doorFrame(builders.services, x, z, axis, ox, oz, DOOR_FRAMES[hashInts(seed, 0xd00f, x * 2 + axis, z) % DOOR_FRAMES.length]);
                }
                if (edge !== EDGE_WALL) continue;
                for (const side of [1, -1]) {
                    const outlet = store.outlet(x, z, axis, side);
                    if (outlet !== null && hashFloat(seed, 0xc0d1, x * 4 + axis * 2 + (side > 0 ? 1 : 0), z) < 0.65) conduit(builders.services, x, z, axis, side, outlet, ox, oz);
                    if (hashFloat(seed, 0xf1e0, x * 4 + axis * 2 + (side > 0 ? 1 : 0), z) >= share) continue;
                    const offset = outlet === null ? 0.18 : outlet > 0 ? -0.25 : 0.25;
                    const nx = axis === 0 ? side : 0;
                    const nz = axis === 0 ? 0 : side;
                    const px = axis === 0 ? x + 0.5 + side * (WALL_THICKNESS / 2) : x + offset;
                    const pz = axis === 0 ? z + offset : z + 0.5 + side * (WALL_THICKNESS / 2);
                    if (clearInFront(chunk, px, pz, nx, nz)) firePoint(builders, px - ox, pz - oz, [nx, nz]);
                }
            }
        }
    }
}

/** A conduit up the wall from a junction box (on the edge's `side`, `along` from its middle) to the slab. */
function conduit(b, x, z, axis, side, along, ox, oz) {
    const out = (axis === 0 ? x : z) + 0.5 + side * (WALL_THICKNESS / 2 + 0.008);
    const at = (axis === 0 ? z : x) + along;
    const [cx, cz] = axis === 0 ? [out - ox, at - oz] : [at - ox, out - oz];
    b.cylinder(1, cx, OUTLET_Y + OUTLET_HEIGHT / 2, cz, WALL_HEIGHT, 0.0055, 6, 0x8c9092);
    // The saddles holding it to the wall.
    for (let y = 0.26; y < 0.8; y += 0.26) b.cylinder(1, cx, y, cz, y + 0.01, 0.0075, 6, 0x6c7072);
}

/** Whether nothing's left on the floor, parked or built in front of a face at (px, pz) facing (nx, nz). */
function clearInFront(chunk, px, pz, nx, nz) {
    const box = [px + Math.min(0, nx * 0.09) - Math.abs(nz) * 0.07, pz + Math.min(0, nz * 0.09) - Math.abs(nx) * 0.07, px + Math.max(0, nx * 0.09) + Math.abs(nz) * 0.07, pz + Math.max(0, nz * 0.09) + Math.abs(nx) * 0.07];
    const hit = (a) => a[0] < box[2] && a[2] > box[0] && a[1] < box[3] && a[3] > box[1];
    // (What's solid, by its box. The rest, what's round where it stands: working out the shape of a bay of racking is slow.)
    return !chunk.props.some((prop) => hit(prop.box ?? [prop.x - 0.15, prop.z - 0.15, prop.x + 0.15, prop.z + 0.15])) && !(chunk.solids ?? []).some(hit);
}

/**
 * Which colour the band round the column on cell (x, z)'s corner is: one to a block of the car park (see BLOCK in
 * levelOne.js), and the column shader works it out the same way (see FRAGMENT_L1_COLUMN).
 */
function columnBand(x, z) {
    return mod(Math.floor((x - 13) / 24) + 3 * Math.floor((z - 13) / 24), 4);
}

/**
 * Now and then a tube fixed upright to one face of a column, in a narrow steel channel, with its glow. It's dead
 * where the lights round it are, and one in eight flickers.
 * @returns {number} The face it's on (one of DIRECTIONS), or −1 for none.
 */
function columnTube(seed, services, tubes, glows, cx, cz, ox, oz) {
    if (hashFloat(seed, 0xc07e, cx * 2, cz * 2) >= COLUMN_TUBE_CHANCE) return -1;
    const face = Math.floor(hashFloat(seed, 0xc07f, cx * 2, cz * 2) * 4);
    const [nx, nz] = DIRECTIONS[face];
    const dead = hashFloat(seed, 0xc080, cx * 2, cz * 2) < 0.1 + 0.9 * levelOneDarkness(seed, cx, cz);
    const pattern = hashFloat(seed, 0xc081, cx * 2, cz * 2) < 0.12 ? 1 + (hashInts(seed, 0xc082, cx * 2, cz * 2) % 255) : 0;
    const x = cx - ox + nx * (HALF_COLUMN + 0.014);
    const z = cz - oz + nz * (HALF_COLUMN + 0.014);
    // The channel behind it.
    const bx = cx - ox + nx * (HALF_COLUMN + 0.006);
    const bz = cz - oz + nz * (HALF_COLUMN + 0.006);
    const across = 0.016;
    services.box(bx - (nz !== 0 ? across : 0.006), COLUMN_TUBE_BOTTOM - 0.02, bz - (nx !== 0 ? across : 0.006), bx + (nz !== 0 ? across : 0.006), COLUMN_TUBE_TOP + 0.02, bz + (nx !== 0 ? across : 0.006), HOUSING);
    tubes.lamp(pattern / 255, dead ? 0 : 1);
    tubes.cylinder(1, x, COLUMN_TUBE_BOTTOM, z, COLUMN_TUBE_TOP, 0.0075, 6, TUBE);
    if (!dead) glows.spot(x + nx * 0.02, (COLUMN_TUBE_BOTTOM + COLUMN_TUBE_TOP) / 2, z + nz * 0.02, 0.5, pattern / 255, 0.8, 1.35);
    return face;
}

/**
 * Arrows painted down the middle of the car park's aisles, now and then: one way down one aisle and the other way down
 * the next, the way the traffic went round. Worn, like everything.
 */
function floorArrows(seed, paint, store, chunk, x0, z0, ox, oz) {
    if (chunk.levelOne.bays.length === 0) return;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            const alongX = aislesAlongX(seed, x, z);
            const across = alongX ? z : x;
            const s = spanOf(across);
            if (isBaySpan(s) || across !== s * BAY + 3 || mod(alongX ? x : z, BAY) !== 0) continue;
            if (hashFloat(seed, 0xa770, x, z) >= 0.3) continue;
            // Only on open floor, and not in the walled-in bay (its cells have no bays either side to tell).
            if (store.propsAt(x, z).length > 0 || chunk.solids.some(([a, b, c, d]) => c > x - 0.5 && a < x + 0.5 && d > z - 0.5 && b < z + 0.5)) continue;
            const core = chunk.levelOne.core;
            if (core && x >= core.x0 && x < core.x0 + BAY && z >= core.z0 && z < core.z0 + BAY) continue;
            const way = ((s >> 1) & 1) === 0 ? 1 : -1;
            // (The picture points at −z unturned.)
            const angle = alongX ? way * Math.PI / 2 : way > 0 ? Math.PI : 0;
            paint.floorDecal(x - ox, z - oz, 0.2, 0.34, angle, GLYPH_PICTURES.arrow, FLOOR_PAINT);
        }
    }
}

// ---------------------------------------------------------------------------------------------- cars

/** A soft shadow under something rectangular: dark under it, fading out past its edges (see chunkGeometry.js). */
function rectShadow(shade, x, z, hx, hz, yaw) {
    const y = 0.0012;
    const u = 3.5 / 4;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const at = (lx, lz, v) => [x + lx * cos + lz * sin, y, z - lx * sin + lz * cos, 0, 1, 0, u, v];
    const inner = [[-hx + 0.1, -hz + 0.1], [hx - 0.1, -hz + 0.1], [hx - 0.1, hz - 0.1], [-hx + 0.1, hz - 0.1]];
    const outer = [[-hx - 0.12, -hz - 0.12], [hx + 0.12, -hz - 0.12], [hx + 0.12, hz + 0.12], [-hx - 0.12, hz + 0.12]];
    shade.orientedQuad(at(...inner[0], 0), at(...inner[1], 0), at(...inner[2], 0), at(...inner[3], 0));
    for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4;
        shade.orientedQuad(at(...inner[k], 0), at(...outer[k], 1), at(...outer[n], 1), at(...inner[n], 0));
    }
}

// Where everything a chunk builds is (what's on its borders reaches a little over them): given, it saves the builders
// working it out from every vertex.
const CHUNK_BOUNDS = new Sphere(new Vector3(0, WALL_HEIGHT / 2, 0), Math.hypot(HALF_CHUNK + 1, HALF_CHUNK + 1, WALL_HEIGHT / 2 + 0.1));

// The two columns (see columnShape): off the grid (put there in edit mode), and on it, with its haunches.
const COLUMN_SHAPES = [columnShape(false), columnShape(true)];

// Building one chunk runs start to finish, so one set of builders serves every chunk.
const fixturesBuilder = new ColorBuilder();
const servicesBuilder = new ColorBuilder();
const tubesBuilder = new ColorBuilder('lamp');
const glowsBuilder = new ColorBuilder('glow');
const paintBuilder = new ColorBuilder();
const lampsBuilder = new ColorBuilder();
const exitGlowsBuilder = new ColorBuilder('glow');
const lightboxesBuilder = new ColorBuilder();

