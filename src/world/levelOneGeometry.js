import { BufferAttribute, BufferGeometry } from 'three';
import { CHUNK_SIZE, HALF_CHUNK, WALL_HEIGHT } from '../config.js';
import { PANELS_PER_SIDE } from './generator.js';
import { DIRECTIONS } from './grid.js';
import { GLYPH_PICTURES, GLYPH_TEXTURE, glyphRect } from './levelOneTextures.js';
import { BAY, CAR_LENGTH, CAR_WIDTH, FIXTURE_NONE, FIXTURE_X, LEVEL_ONE_PILLAR, levelOneDarkness } from './levelOne.js';
import { PROP_ATLAS, PROP_ATLAS_HEIGHT, PROP_ATLAS_WIDTH } from './props.js';
import { hashFloat, hashInts } from './random.js';

/*
 * What Level 1 has that Level 0 doesn't, as meshes for one chunk (see levelOne.js for where it all goes):
 *
 * - the beams under the slab, along every line of columns (drawn with the columns, which chunkGeometry.js builds,
 *   as the level's own pillars);
 * - the fluorescent battens hanging in the light slots (their tubes follow the slots' state, like Level 0's
 *   panels, in the fixture material);
 * - everything run along under the slab: white sprinkler pipes with their red heads, branches off them, the red
 *   fire main, cable trays, and the rods they hang from;
 * - the tubes fixed to some of the columns, each flickering on its own, and a glow round every light, which is
 *   what puts a halo behind a column with a tube on its far side;
 * - the stencilled bay code on every face of every column, and arrows painted on the floor;
 * - the cars.
 *
 * Pipes run the whole level on fixed lines, so they carry on from one chunk into the next (and through the walls,
 * the way pipes do). Positions are relative to the chunk's centre.
 */

const N = CHUNK_SIZE;
const HALF_COLUMN = LEVEL_ONE_PILLAR / 2;

/** The beams: how far down from the slab they come, and how wide they are. */
export const BEAM_BOTTOM = 0.9;
const BEAM_HALF = 0.07;

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
const INK = 0x1c1c1b;
const FLOOR_PAINT = 0xd8d6cc;

// Cars: colours they came in, faded.
const CAR_COLORS = [0x6d2420, 0x2b3d5c, 0xb8b6ae, 0x1f2224, 0x7c6f55, 0x2f4a3a, 0x5e6266];
const GLASS = 0x121619;
const RUBBER = 0x141414;
const TRIM = 0x2b2c2d;
const CAR_COVER = 0x5b6670;

/**
 * Level 1's own meshes for one chunk (its `shape.extras`; see levels.js), by the name of the material that draws
 * each: `fixtures`, `services`, `tubes`, `glows` and `paint`.
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {import('./generator.js').ChunkData} chunk
 * @param {{ pillars: import('./GeometryBuilder.js').GeometryBuilder, shade: import('./GeometryBuilder.js').GeometryBuilder }} builders
 *     The columns', to add the beams to (they're the same concrete), and the soft shadows', to add the cars' to.
 */
export function buildLevelOneGeometry(store, chunk, { pillars, shade }) {
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

    beams(pillars, x0, z0, ox, oz);
    battens(fixtures, glows, data.fixtures, x0, z0, ox, oz);
    pipes(services, x0, z0, ox, oz);

    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            if (!store.pillar(x, z)) continue;
            const cx = x + 0.5;
            const cz = z + 0.5;
            columnLabel(paint, cx - ox, cz - oz, x, z);
            columnTube(seed, services, tubes, glows, cx, cz, ox, oz);
        }
    }
    floorArrows(seed, paint, store, x0, z0, ox, oz);
    for (const car of data.cars) buildCar(services, shade, car, ox, oz);

    return {
        fixtures: fixtures.build(),
        services: services.build(),
        tubes: tubes.build(),
        glows: glows.build(),
        paint: paint.build(),
    };
}

// ---------------------------------------------------------------------------------------------- structure

/**
 * The beams: along every line of columns, both ways, under the slab. The ones along x run the chunk's width; the
 * ones along z stop against them.
 */
function beams(builder, x0, z0, ox, oz) {
    const lines = (from) => {
        const found = [];
        for (let c = from; c < from + N; c++) if (mod(c, BAY) === 1) found.push(c + 0.5);
        return found;
    };
    const xLines = lines(x0);
    const zLines = lines(z0);
    const lo = (c) => c - 0.5;
    const hi = (c) => c + N - 0.5;
    // Along x, at each z line.
    for (const z of zLines) beam(builder, 0, z - oz, lo(x0) - ox, hi(x0) - ox);
    // Along z, at each x line, in pieces between the ones along x (and out to the chunk's edges).
    const stops = [lo(z0), ...zLines.flatMap((z) => [z - BEAM_HALF, z + BEAM_HALF]), hi(z0)];
    for (const x of xLines) {
        for (let k = 0; k < stops.length; k += 2) {
            if (stops[k + 1] - stops[k] > 1e-4) beam(builder, 1, x - ox, stops[k] - oz, stops[k + 1] - oz);
        }
    }
}

/**
 * One beam: its underside and two sides. Axis 0 runs along x at z = `at`, from `from` to `to`; axis 1 along z at
 * x = `at`.
 */
function beam(builder, axis, at, from, to) {
    const y0 = BEAM_BOTTOM;
    const y1 = WALL_HEIGHT;
    const a0 = at - BEAM_HALF;
    const a1 = at + BEAM_HALF;
    if (axis === 0) {
        builder.quad(from, y0, a0, to, y0, a0, to, y0, a1, from, y0, a1, 0, -1, 0, from, a0, to, a1);
        builder.quad(to, y0, a0, from, y0, a0, from, y1, a0, to, y1, a0, 0, 0, -1, -to, y0, -from, y1);
        builder.quad(from, y0, a1, to, y0, a1, to, y1, a1, from, y1, a1, 0, 0, 1, from, y0, to, y1);
    } else {
        builder.quad(a0, y0, to, a0, y0, from, a1, y0, from, a1, y0, to, 0, -1, 0, a0, -to, a1, -from);
        builder.quad(a0, y0, from, a0, y0, to, a0, y1, to, a0, y1, from, -1, 0, 0, from, y0, to, y1);
        builder.quad(a1, y0, to, a1, y0, from, a1, y1, from, a1, y1, to, 1, 0, 0, -to, y0, -from, y1);
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
    // Rods up to the slab, clear of the beams.
    const rods = (alongX, at, from, to, top) => {
        for (let s = Math.ceil((from - 0.75) / 1.5) * 1.5 + 0.75; s < to; s += 1.5) {
            if (mod(s - 1.5, BAY) < 0.2 || mod(s - 1.5, BAY) > BAY - 0.2) continue;
            const x = alongX ? s : at;
            const z = alongX ? at : s;
            builder.box(x - ox - 0.0025, top, z - oz - 0.0025, x - ox + 0.0025, WALL_HEIGHT, z - oz + 0.0025, HANGER);
        }
    };

    // Sprinkler mains along x, one a bay, with heads hanging from them.
    for (let z = Math.ceil((zFrom - 0.62) / BAY) * BAY + 0.62; z < zTo; z += BAY) {
        builder.cylinder(0, xFrom - ox, MAIN_Y, z - oz, xTo - ox, MAIN_RADIUS, 8, PIPE_WHITE);
        rods(true, z, xFrom, xTo, MAIN_Y + MAIN_RADIUS);
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
        builder.box(lx - TRAY_HALF, TRAY_BOTTOM, zFrom - oz, lx + TRAY_HALF, TRAY_BOTTOM + 0.003, zTo - oz, GALVANISED);
        for (const side of [-1, 1]) builder.box(lx + side * TRAY_HALF - 0.0015, TRAY_BOTTOM, zFrom - oz, lx + side * TRAY_HALF + 0.0015, TRAY_LIP, zTo - oz, GALVANISED);
        CABLES.forEach((color, k) => builder.cylinder(2, lx - 0.03 + k * 0.02, TRAY_BOTTOM + 0.009, zFrom - oz, zTo - oz, 0.006, 5, color));
        rods(false, x - TRAY_HALF + 0.004, zFrom, zTo, TRAY_BOTTOM);
        rods(false, x + TRAY_HALF - 0.004, zFrom, zTo, TRAY_BOTTOM);
    }
    // The fire main along x, every fourth bay, with a flange at every joint.
    for (let z = Math.ceil((zFrom - 8.1) / (BAY * 4)) * BAY * 4 + 8.1; z < zTo; z += BAY * 4) {
        builder.cylinder(0, xFrom - ox, FIRE_Y, z - oz, xTo - ox, FIRE_RADIUS, 10, FIRE_RED);
        for (let x = Math.ceil(xFrom / 2) * 2 + 1; x < xTo; x += 2) builder.cylinder(0, x - ox - 0.006, FIRE_Y, z - oz, x - ox + 0.006, FIRE_RADIUS + 0.006, 10, FIRE_RED);
        rods(true, z, xFrom, xTo, FIRE_Y + FIRE_RADIUS);
    }
}

// ---------------------------------------------------------------------------------------------- columns

/**
 * The column's bay code, stencilled on each of its faces: a letter for the row it's in and a number for the
 * column (so it goes C7, C8, C9 down an aisle).
 */
function columnLabel(paint, x, z, cellX, cellZ) {
    const row = Math.floor((cellZ - 1) / BAY);
    const column = Math.floor((cellX - 1) / BAY);
    const text = ROW_LETTERS[mod(row, ROW_LETTERS.length)] + String(mod(column, 60) + 1);
    const face = HALF_COLUMN + 0.0015;
    const width = text.length * LETTER_WIDTH * LETTER_SPACING;
    // Each face: its normal, and which way along it reads left to right, looking at it.
    for (const [nx, nz] of DIRECTIONS) {
        const rx = nz;
        const rz = -nx;
        for (let k = 0; k < text.length; k++) {
            const along = -width / 2 + (k + 0.5) * LETTER_WIDTH * LETTER_SPACING;
            const cx = x + nx * face + rx * along;
            const cz = z + nz * face + rz * along;
            paint.decal(cx, LABEL_Y, cz, nx, nz, LETTER_WIDTH / 2, LETTER_HEIGHT / 2, glyphRect(text[k]), INK);
        }
    }
}

/**
 * Now and then a tube fixed upright to one face of a column, in a narrow steel channel, with its glow. It's dead
 * where the lights round it are, and one in eight flickers.
 */
function columnTube(seed, services, tubes, glows, cx, cz, ox, oz) {
    if (hashFloat(seed, 0xc07e, cx * 2, cz * 2) >= COLUMN_TUBE_CHANCE) return;
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
}

/** Arrows painted on the floor in the middle of some bays, pointing along the aisle. Worn, like everything. */
function floorArrows(seed, paint, store, x0, z0, ox, oz) {
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            if (mod(x, BAY) !== 0 || mod(z, BAY) !== 0) continue;
            if (hashFloat(seed, 0xa770, x, z) >= 0.07) continue;
            // Only on open floor.
            if (store.propsAt(x, z).length > 0) continue;
            const turn = Math.floor(hashFloat(seed, 0xa771, x, z) * 4);
            paint.floorDecal(x - ox, z - oz, 0.22, 0.3, turn * Math.PI / 2, GLYPH_PICTURES.arrow, FLOOR_PAINT);
        }
    }
}

// ---------------------------------------------------------------------------------------------- cars

/**
 * A car someone left, a long time ago, in faded paint: a boxy saloon, glass gone dark with dust, tyres gone flat.
 * One in four is under a grey cover instead.
 * @param {import('./levelOne.js').Car} car
 */
function buildCar(builder, shade, car, ox, oz) {
    const v = car.variant;
    const covered = (v & 3) === 0;
    const body = covered ? CAR_COVER : CAR_COLORS[(v >>> 2) % CAR_COLORS.length];
    const flat = ((v >>> 6) & 3) === 0;
    const start = builder.vertexCount;
    const L = CAR_LENGTH / 2;
    const W = CAR_WIDTH / 2;
    const sink = flat ? 0.012 : 0;
    // Wheels first, so a cover goes over them.
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const wx = sx * (W - 0.035);
            const wz = sz * (L - 0.3);
            builder.cylinder(0, wx - 0.036, 0.085 - sink, wz, wx + 0.036, 0.085, 12, RUBBER, flat ? 0.8 : 1);
            if (!covered) builder.cylinder(0, wx + sx * 0.035 - 0.0025, 0.085 - sink, wz, wx + sx * 0.035 + 0.0025, 0.05, 10, 0x8c8f91);
        }
    }
    if (covered) {
        // A cover pulled over it: one rounded lump the shape of the car.
        builder.box(-W - 0.01, 0.06 - sink, -L - 0.01, W + 0.01, 0.34, L + 0.01, body);
        builder.box(-W + 0.03, 0.34, -L * 0.5, W - 0.03, 0.52, L * 0.35, body, 0.07);
    } else {
        builder.box(-W, 0.075 - sink, -L, W, 0.3, L, body);
        // Bonnet and boot a little lower than the waist, and the cabin: glass all round under the roof.
        builder.box(-W + 0.01, 0.3, L * 0.34, W - 0.01, 0.325, L - 0.02, body);
        builder.box(-W + 0.01, 0.3, -L + 0.02, W - 0.01, 0.33, -L * 0.52, body);
        builder.box(-W + 0.035, 0.3, -L * 0.5, W - 0.035, 0.5, L * 0.32, GLASS, 0.12);
        builder.box(-W + 0.04, 0.5, -L * 0.42, W - 0.04, 0.52, L * 0.22, body);
        // Bumpers, the grille and lamps, the number plates, tail lights.
        builder.box(-W + 0.005, 0.07 - sink, L - 0.01, W - 0.005, 0.13 - sink, L + 0.02, TRIM);
        builder.box(-W + 0.005, 0.07 - sink, -L - 0.02, W - 0.005, 0.13 - sink, -L + 0.01, TRIM);
        builder.picture(-W + 0.03, 0.15, L + 0.0005, W - 0.03, 0.27, 0, 1, PROP_ATLAS.grille);
        builder.picture(-0.09, 0.075 - sink, L + 0.0205, 0.09, 0.125 - sink, 0, 1, PROP_ATLAS.plate);
        builder.picture(-0.09, 0.075 - sink, -L - 0.0205, 0.09, 0.125 - sink, 0, -1, PROP_ATLAS.plate);
        for (const side of [-1, 1]) builder.box(side * (W - 0.08) - 0.05, 0.2, -L - 0.004, side * (W - 0.08) + 0.05, 0.25, -L + 0.002, 0x5a1612);
    }
    builder.transform(start, car.yaw, car.x - ox, car.z - oz);
    rectShadow(shade, car.x - ox, car.z - oz, W + 0.05, L + 0.05, car.yaw);
}

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

// ---------------------------------------------------------------------------------------------- building

// The plain white corner of the props texture, for parts coloured by their vertices alone.
const PLAIN_U = ((PROP_ATLAS.plain[0] + PROP_ATLAS.plain[2]) / 2) / PROP_ATLAS_WIDTH;
const PLAIN_V = 1 - ((PROP_ATLAS.plain[1] + PROP_ATLAS.plain[3]) / 2) / PROP_ATLAS_HEIGHT;

/**
 * Collects coloured triangles into typed arrays, reused from chunk to chunk (like GeometryBuilder, but with a colour
 * per vertex, and optionally a second attribute: a tube's lamp, or a glow's size and source). Like GeometryBuilder,
 * it makes nothing per vertex or per face: the only allocations are the final arrays handed to the GPU.
 */
class ColorBuilder {
    /** @param {'lamp' | 'glow' | null} extra */
    constructor(extra = null) {
        this.extra = extra;
        this.size = 1024;
        this.positions = new Float32Array(this.size * 3);
        this.normals = new Float32Array(this.size * 3);
        this.uvs = new Float32Array(this.size * 2);
        this.colors = new Float32Array(this.size * 3);
        this.extras = new Float32Array(this.size * (extra === 'glow' ? 4 : 2));
        this.corners = new Float32Array(this.size * 2);
        this.indices = new Uint32Array(this.size * 3);
        this.vertexCount = 0;
        this.indexCount = 0;
        this._lampPattern = 0;
        this._lampBrightness = 1;
    }

    reset() {
        this.vertexCount = 0;
        this.indexCount = 0;
        return this;
    }

    /** The lamp the tubes added from now on belong to: its flicker pattern (0..1) and brightness. */
    lamp(pattern, brightness) {
        this._lampPattern = pattern;
        this._lampBrightness = brightness;
    }

    _grow() {
        this.size *= 2;
        const grow = (array, per) => {
            const larger = new Float32Array(this.size * per);
            larger.set(array);
            return larger;
        };
        this.positions = grow(this.positions, 3);
        this.normals = grow(this.normals, 3);
        this.uvs = grow(this.uvs, 2);
        this.colors = grow(this.colors, 3);
        this.extras = grow(this.extras, this.extra === 'glow' ? 4 : 2);
        this.corners = grow(this.corners, 2);
    }

    vertex(x, y, z, nx, ny, nz, u, v, color) {
        if (this.vertexCount === this.size) this._grow();
        const i = this.vertexCount++;
        this.positions[i * 3] = x;
        this.positions[i * 3 + 1] = y;
        this.positions[i * 3 + 2] = z;
        this.normals[i * 3] = nx;
        this.normals[i * 3 + 1] = ny;
        this.normals[i * 3 + 2] = nz;
        this.uvs[i * 2] = u;
        this.uvs[i * 2 + 1] = v;
        this.colors[i * 3] = ((color >> 16) & 255) / 255;
        this.colors[i * 3 + 1] = ((color >> 8) & 255) / 255;
        this.colors[i * 3 + 2] = (color & 255) / 255;
        if (this.extra === 'lamp') {
            this.extras[i * 2] = this._lampPattern;
            this.extras[i * 2 + 1] = this._lampBrightness;
        }
        return i;
    }

    triangle(a, b, c) {
        if (this.indexCount + 3 > this.indices.length) {
            const larger = new Uint32Array(this.indices.length * 2);
            larger.set(this.indices);
            this.indices = larger;
        }
        const k = this.indexCount;
        this.indices[k] = a;
        this.indices[k + 1] = b;
        this.indices[k + 2] = c;
        this.indexCount = k + 3;
    }

    /**
     * A quad from four corners counter-clockwise as seen from the front, all with the same normal, with the picture
     * (u0, v0) → (u1, v1) across it (by default the plain white, for parts coloured by their vertices alone).
     */
    quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, color, u0 = PLAIN_U, v0 = PLAIN_V, u1 = PLAIN_U, v1 = PLAIN_V) {
        const first = this.vertex(ax, ay, az, nx, ny, nz, u0, v0, color);
        this.vertex(bx, by, bz, nx, ny, nz, u1, v0, color);
        this.vertex(cx, cy, cz, nx, ny, nz, u1, v1, color);
        this.vertex(dx, dy, dz, nx, ny, nz, u0, v1, color);
        this.triangle(first, first + 1, first + 2);
        this.triangle(first, first + 2, first + 3);
    }

    /**
     * An axis-aligned box. `round` bevels its top edges in by that much (a car cover's, a car's glass).
     */
    box(x0, y0, z0, x1, y1, z1, color, round = 0) {
        const t = round;
        // Top (inset by the rounding), then the sides, sloping in to it, then the bottom.
        this.quad(x0 + t, y1, z1 - t, x1 - t, y1, z1 - t, x1 - t, y1, z0 + t, x0 + t, y1, z0 + t, 0, 1, 0, color);
        // A sloping side's normal leans up by half: (out, 0.5), normalised.
        const out = t > 0 ? 1 / Math.hypot(1, 0.5) : 1;
        const up = t > 0 ? 0.5 * out : 0;
        this.quad(x0, y0, z1, x1, y0, z1, x1 - t, y1, z1 - t, x0 + t, y1, z1 - t, 0, up, out, color);
        this.quad(x1, y0, z0, x0, y0, z0, x0 + t, y1, z0 + t, x1 - t, y1, z0 + t, 0, up, -out, color);
        this.quad(x1, y0, z1, x1, y0, z0, x1 - t, y1, z0 + t, x1 - t, y1, z1 - t, out, up, 0, color);
        this.quad(x0, y0, z0, x0, y0, z1, x0 + t, y1, z1 - t, x0 + t, y1, z0 + t, -out, up, 0, color);
        this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0, color);
    }

    /**
     * A cylinder along an axis (0: x, 1: y, 2: z) from `from` to `to`, its middle at (x, y, z) in the other two, with
     * end caps. `squash` flattens it top to bottom (a flat tyre).
     */
    cylinder(axis, a, b, c, to, radius, sides, color, squash = 1) {
        // (a, b, c) is the start: for axis 0 that's (from, y, z); axis 1 (x, from, z); axis 2 (x, y, from).
        const from = axis === 0 ? a : axis === 1 ? b : c;
        const first = this.vertexCount;
        for (let k = 0; k <= sides; k++) {
            const angle = (k / sides) * Math.PI * 2;
            const u = Math.cos(angle);
            const w = Math.sin(angle);
            // Straight out from the axis: (0, w, u) round x, (u, 0, w) round y, (u, w, 0) round z.
            const nx = axis === 0 ? 0 : u;
            const ny = axis === 1 ? 0 : w;
            const nz = axis === 0 ? u : axis === 1 ? w : 0;
            this._around(axis, a, b, c, from, u, w, radius, squash, nx, ny, nz, color);
            this._around(axis, a, b, c, to, u, w, radius, squash, nx, ny, nz, color);
        }
        // Wound so the outside faces out, whichever axis (the angle runs the other way round x and y).
        const flip = axis !== 2;
        for (let k = 0; k < sides; k++) {
            const i = first + k * 2;
            if (flip) {
                this.triangle(i, i + 1, i + 3);
                this.triangle(i, i + 3, i + 2);
            } else {
                this.triangle(i, i + 2, i + 3);
                this.triangle(i, i + 3, i + 1);
            }
        }
        // Caps.
        for (let end = 0; end < 2; end++) {
            const t = end === 0 ? from : to;
            const sign = end === 0 ? -1 : 1;
            const nx = axis === 0 ? sign : 0;
            const ny = axis === 1 ? sign : 0;
            const nz = axis === 2 ? sign : 0;
            const centre = this._around(axis, a, b, c, t, 1, 0, 0, squash, nx, ny, nz, color);
            const ring = this.vertexCount;
            for (let k = 0; k < sides; k++) {
                const angle = (k / sides) * Math.PI * 2;
                this._around(axis, a, b, c, t, Math.cos(angle), Math.sin(angle), radius, squash, nx, ny, nz, color);
            }
            for (let k = 0; k < sides; k++) {
                const p = ring + k;
                const q = ring + ((k + 1) % sides);
                if ((sign > 0) !== flip) this.triangle(centre, p, q);
                else this.triangle(centre, q, p);
            }
        }
    }

    /** A vertex of a cylinder (see cylinder): `t` along its axis, and (u, w) times r round it. */
    _around(axis, a, b, c, t, u, w, r, squash, nx, ny, nz, color) {
        if (axis === 0) return this.vertex(t, b + w * r * squash, c + u * r, nx, ny, nz, PLAIN_U, PLAIN_V, color);
        if (axis === 1) return this.vertex(a + u * r, t, c + w * r, nx, ny, nz, PLAIN_U, PLAIN_V, color);
        return this.vertex(a + u * r, b + w * r * squash, t, nx, ny, nz, PLAIN_U, PLAIN_V, color);
    }

    /** A picture from the props texture, flat on the plane z = `z`, facing +z (normalZ 1) or −z. */
    picture(x0, y0, z, x1, y1, _nx, normalZ, [px0, py0, px1, py1]) {
        const u0 = px0 / PROP_ATLAS_WIDTH;
        const u1 = px1 / PROP_ATLAS_WIDTH;
        const v0 = 1 - py1 / PROP_ATLAS_HEIGHT;
        const v1 = 1 - py0 / PROP_ATLAS_HEIGHT;
        if (normalZ > 0) this.quad(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z, 0, 0, 1, 0xffffff, u0, v0, u1, v1);
        else this.quad(x1, y0, z, x0, y0, z, x0, y1, z, x1, y1, z, 0, 0, -1, 0xffffff, u0, v0, u1, v1);
    }

    /** Turns everything added since vertex `start` by yaw about y, then moves it by (dx, dz). */
    transform(start, yaw, dx, dz) {
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        for (let i = start; i < this.vertexCount; i++) {
            const x = this.positions[i * 3];
            const z = this.positions[i * 3 + 2];
            this.positions[i * 3] = x * cos + z * sin + dx;
            this.positions[i * 3 + 2] = z * cos - x * sin + dz;
            const nx = this.normals[i * 3];
            const nz = this.normals[i * 3 + 2];
            this.normals[i * 3] = nx * cos + nz * sin;
            this.normals[i * 3 + 2] = nz * cos - nx * sin;
        }
    }

    /**
     * A stencil on a vertical face whose normal is (nx, 0, nz), centred at (x, y, z), half-size hw × hh, showing
     * `rect` of the glyph texture.
     */
    decal(x, y, z, nx, nz, hw, hh, [gx0, gy0, gx1, gy1], color) {
        // Left to right, looking at it: (nz, −nx).
        const rx = nz * hw;
        const rz = -nx * hw;
        this.quad(
            x - rx, y - hh, z - rz,
            x + rx, y - hh, z + rz,
            x + rx, y + hh, z + rz,
            x - rx, y + hh, z - rz,
            nx, 0, nz, color,
            gx0 / GLYPH_TEXTURE, 1 - gy1 / GLYPH_TEXTURE, gx1 / GLYPH_TEXTURE, 1 - gy0 / GLYPH_TEXTURE,
        );
    }

    /** Paint on the floor, centred at (x, z), half-size hw × hl, turned by `angle`. */
    floorDecal(x, z, hw, hl, angle, [gx0, gy0, gx1, gy1], color) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const y = 0.0025;
        // The corners (∓hw, ±hl), turned: (u cos − v sin, u sin + v cos).
        this.quad(
            x - hw * cos - hl * sin, y, z - hw * sin + hl * cos,
            x + hw * cos - hl * sin, y, z + hw * sin + hl * cos,
            x + hw * cos + hl * sin, y, z + hw * sin - hl * cos,
            x - hw * cos + hl * sin, y, z - hw * sin - hl * cos,
            0, 1, 0, color,
            gx0 / GLYPH_TEXTURE, 1 - gy1 / GLYPH_TEXTURE, gx1 / GLYPH_TEXTURE, 1 - gy0 / GLYPH_TEXTURE,
        );
    }

    /**
     * A glow (see the glow material in materials.js): a quad the vertex shader turns to face the camera.
     * @param {number} size Its radius.
     * @param {number} source Its own flicker pattern (0..1), or −1 to follow its light slot.
     * @param {number} brightness
     * @param {number} stretch How much taller than wide.
     */
    spot(x, y, z, size, source, brightness, stretch) {
        const first = this.vertexCount;
        for (let k = 0; k < 4; k++) {
            const i = this.vertex(x, y, z, 0, 0, 1, 0, 0, 0xffffff);
            this.corners[i * 2] = SPOT_CORNERS[k * 2];
            this.corners[i * 2 + 1] = SPOT_CORNERS[k * 2 + 1];
            this.extras[i * 4] = size;
            this.extras[i * 4 + 1] = source;
            this.extras[i * 4 + 2] = brightness;
            this.extras[i * 4 + 3] = stretch;
        }
        this.triangle(first, first + 1, first + 2);
        this.triangle(first, first + 2, first + 3);
    }

    /** @returns {BufferGeometry | null} */
    build() {
        const count = this.vertexCount;
        if (count === 0) return null;
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(this.positions.slice(0, count * 3), 3));
        if (this.extra === 'glow') {
            geometry.setAttribute('corner', new BufferAttribute(this.corners.slice(0, count * 2), 2));
            geometry.setAttribute('glow', new BufferAttribute(this.extras.slice(0, count * 4), 4));
        } else {
            geometry.setAttribute('normal', new BufferAttribute(this.normals.slice(0, count * 3), 3));
            geometry.setAttribute('uv', new BufferAttribute(this.uvs.slice(0, count * 2), 2));
            geometry.setAttribute('color', new BufferAttribute(this.colors.slice(0, count * 3), 3));
            if (this.extra === 'lamp') geometry.setAttribute('lamp', new BufferAttribute(this.extras.slice(0, count * 2), 2));
        }
        const indices = this.indices.subarray(0, this.indexCount);
        geometry.setIndex(new BufferAttribute(count > 65535 ? indices.slice() : Uint16Array.from(indices), 1));
        geometry.computeBoundingSphere();
        // A glow's quad is a point until the shader spreads it out; make room for that.
        if (this.extra === 'glow' && geometry.boundingSphere) geometry.boundingSphere.radius += 0.8;
        return geometry;
    }
}

// A glow's four corners, counter-clockwise from the bottom left.
const SPOT_CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];

function mod(a, b) {
    return ((a % b) + b) % b;
}

// Building one chunk runs start to finish, so one set of builders serves every chunk.
const fixturesBuilder = new ColorBuilder();
const servicesBuilder = new ColorBuilder();
const tubesBuilder = new ColorBuilder('lamp');
const glowsBuilder = new ColorBuilder('glow');
const paintBuilder = new ColorBuilder();

