import { CHUNK_SIZE, HALF_CHUNK, WALL_HEIGHT } from '../config.js';
import { ColorBuilder } from './ColorBuilder.js';
import { PANELS_PER_SIDE } from './generator.js';
import { DIRECTIONS } from './grid.js';
import { GLYPH_PICTURES, glyphRect } from './levelOneTextures.js';
import { BAY, CAR_LENGTH, CAR_WIDTH, FIXTURE_NONE, FIXTURE_X, LEVEL_ONE_PILLAR, levelOneDarkness } from './levelOne.js';
import { PROP_ATLAS } from './props.js';
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

function mod(a, b) {
    return ((a % b) + b) % b;
}

// Building one chunk runs start to finish, so one set of builders serves every chunk.
const fixturesBuilder = new ColorBuilder();
const servicesBuilder = new ColorBuilder();
const tubesBuilder = new ColorBuilder('lamp');
const glowsBuilder = new ColorBuilder('glow');
const paintBuilder = new ColorBuilder();

