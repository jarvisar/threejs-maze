import { CHUNK_SIZE, DOOR_HEIGHT, DOOR_WIDTH, HALF_CHUNK, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { ColorBuilder } from './ColorBuilder.js';
import { GeometryBuilder } from './GeometryBuilder.js';
import { DIRECTIONS, EDGE_DOOR, EDGE_NONE, EDGE_WALL, chunkCoord, mod } from './grid.js';
import { HEIGHT_STEP, stairSteps } from './ground.js';
import { COVE_STEPS, buildCoves, curvePoint } from './poolroomsCoves.js';
import { SKYLIGHT_HALF, SLOT_LAMP, SLOT_SKY, TILE, columnSpacing } from './poolrooms.js';
import { BALL, LIFEBUOY, RINGS } from './props.js';
import { hashFloat } from './random.js';
import { ZONE_BATHS, ZONE_DEEP } from './zones.js';

/*
 * What Level 37 has that Level 0 doesn't, as meshes for one chunk (see poolrooms.js for where it all goes):
 *
 * - the floor, tiled, at the height of each cell: the walkways, the flooded floors, the pools sunk into them and the
 *   stairs down, with the tiled walls of the pools wherever the floor drops (the level's walls go on down past the
 *   floor to meet them; see chunkGeometry.js), a rounded edge along the top of each drop, and a dark edge on every step;
 * - the water over all of it (one sheet at y = 0, left out over the dry walkways);
 * - the ceiling, tiled too, with the skylights let into it (a tiled well up to the glass) and round lights set in it;
 * - the round columns, curving out into the floor at their feet, and in the halls the arches between them, and an arch
 *   in every doorway;
 * - the arches over the narrow passages: a rib here and there, and in places a barrel vault;
 * - the coves where the walls meet the floor, the ceiling and each other (see poolroomsCoves.js);
 * - the lamps in the pools' walls, the ladders over their edges, and what's floating in them;
 * - a glow round every light, in the warm damp air (and round the lamps, under the water).
 *
 * Everything tiled is drawn by one material (the level's walls by the same shading), with texture coordinates in
 * world units along each surface, so the tiles line up from one surface to the next. Positions are relative to the
 * chunk's centre.
 */

const N = CHUNK_SIZE;

/** Where the glass is at the top of a skylight's well. */
export const SKY_TOP = 1.3;
/** A column's radius: twenty tiles round (about 90 cm across). */
export const COLUMN_RADIUS = (20 * TILE) / (2 * Math.PI);
const COLUMN_SIDES = 32;
/** The band round a column where the arches spring from it. */
const IMPOST_BOTTOM = 0.27;
const IMPOST_TOP = 0.3;
const IMPOST_OUT = 0.018;
/**
 * The arches between columns: where they spring from (low, just over the water), how high they rise (to the ceiling),
 * and half their thickness. They're a little pointed at the top.
 */
const ARCH_SPRING = 0.3;
const ARCH_CROWN = WALL_HEIGHT;
const ARCH_HALF = 0.075;
const ARCH_SEGMENTS = 18;
/** How far the arches' ribs swell below the vaults either side of them, and in how many steps across. */
const RIB = 0.024;
const RIB_STEPS = 2;
/** How far over the ceiling the flat ceiling hidden over a vault is (see vaultCover). */
const VAULT_COVER = 0.002;
/** The columns and arches are in a finer mosaic than the walls: their texture coordinates are stretched by this. */
const MOSAIC = 1.6;
/**
 * The rounded edge (the coping) along the top of every drop in the floor: how far the floor has to drop for one, how
 * big its nose is (two tiles round, over and back under), and steps round it, and round each half of a corner.
 */
const RIM_DROP = 0.05;
const COPING_RADIUS = (2 * TILE) / Math.PI;
const COPING_STEPS = 6;
const CORNER_TURN_STEPS = 2;
/** An arch fills the top of every doorway, springing from halfway up it. */
const DOOR_RADIUS = DOOR_WIDTH / 2;
export const DOOR_SPRING = DOOR_HEIGHT - DOOR_RADIUS;
const DOOR_SEGMENTS = 10;
const HALF_THICKNESS = WALL_THICKNESS / 2;

// The round lights set into the ceiling: the diffuser, and the trim round it.
const LIGHT_RADIUS = 0.045;
const TRIM_RADIUS = 0.06;
const LIGHT_SIDES = 16;
// Colours (the fixture material lights up whatever's brighter than 0.8 in red).
const LIGHT = 0xfdfcf6;
const TRIM = 0xa9adab;
const GLASS = 0xfffdf2;
const GLAZING_BAR = 0x9c9f9d;
const NOSING = 0x1b2c27;
const LENS = 0xe6fff4;
const CHROME = 0xc7ccd0;

/**
 * Level 37's own meshes for one chunk (its `shape.extras`; see levels.js), by the name of the material that draws
 * each: `tiles`, `water`, `fixtures`, `glows`, `trim`, `lamps`, `metal` and `floats`.
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {import('./generator.js').ChunkData} chunk
 * @returns {Record<string, import('three').BufferGeometry | null>}
 */
export function buildPoolroomsGeometry(store, chunk) {
    const x0 = chunk.cx * N - HALF_CHUNK;
    const z0 = chunk.cz * N - HALF_CHUNK;
    const ox = chunk.cx * N;
    const oz = chunk.cz * N;
    const data = /** @type {import('./poolrooms.js').PoolroomsData} */ (chunk.poolrooms);
    const tiles = tilesBuilder.reset();
    const water = waterBuilder.reset();
    const fixtures = fixturesBuilder.reset();
    const glows = glowsBuilder.reset();
    const trim = trimBuilder.reset();
    const lamps = lampsBuilder.reset();
    const metal = metalBuilder.reset();
    const floats = floatsBuilder.reset();

    floors(tiles, water, trim, store, x0, z0, ox, oz);
    const vaults = vaultsFor(store, chunk);
    ceiling(tiles, fixtures, glows, store, x0, z0, ox, oz, vaults);
    columns(tiles, store, vaults, x0, z0, ox, oz);
    doorways(tiles, store, x0, z0, ox, oz);
    passages(tiles, store, x0, z0, ox, oz);
    buildCoves(tiles, store, chunk.cx, chunk.cz);
    for (const lamp of data.lamps) poolLamp(lamps, glows, lamp, ox, oz);
    for (const ladder of chunk.ladders) buildLadder(metal, store, ladder, ox, oz);
    for (const floater of data.floats) buildFloater(floats, floater, ox, oz);

    return {
        tiles: tiles.build(),
        water: water.build(),
        fixtures: fixtures.build(),
        glows: glows.build(),
        trim: trim.build(),
        lamps: lamps.build(),
        metal: metal.build(),
        floats: floats.build(),
    };
}

/**
 * What an empty chunk outside a tape's walls (see footage/arena.js) builds of Level 37's own: only what finishes the
 * inside of the walls round the arena where they're this chunk's to build (see regionGrid.js), the coves along them,
 * and in the way out once it's open, the step down (or up) to the bare floor outside.
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {import('./generator.js').ChunkData} chunk
 * @returns {Record<string, import('three').BufferGeometry | null>}
 */
export function buildPoolroomsOutside(store, chunk) {
    const inside = (x, z) => !store.options.isVoid?.(chunkCoord(x), chunkCoord(z));
    const tiles = tilesBuilder.reset();
    const x0 = chunk.cx * N - HALF_CHUNK;
    const z0 = chunk.cz * N - HALF_CHUNK;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            for (const side of [0, 2]) {
                const [dx, dz] = DIRECTIONS[side];
                if (inside(x0 + i + dx, z0 + j + dz)) dropAcross(tiles, store, x0 + i, z0 + j, side, chunk.cx * N, chunk.cz * N);
            }
        }
    }
    buildCoves(tiles, store, chunk.cx, chunk.cz, inside);
    return { tiles: tiles.build() };
}

// ---------------------------------------------------------------------------------------------- the floor

// The cell last read by readCell: its floor's height and stair (see Ground), and the top of the stair.
let cellHeight = 0;
let cellStair = 0;
let cellTop = 0;

/** Reads cell (x, z)'s floor, from whichever chunk it's in, into cellHeight, cellStair and cellTop. */
function readCell(store, x, z) {
    const cx = chunkCoord(x);
    const cz = chunkCoord(z);
    const ground = store.getChunk(cx, cz).ground;
    if (!ground) {
        cellHeight = cellStair = cellTop = 0;
        return;
    }
    const k = (x - cx * N + HALF_CHUNK) * N + (z - cz * N + HALF_CHUNK);
    cellHeight = ground.heights[k];
    cellStair = ground.stairs[k];
    cellTop = ground.tops[k];
}

// A cell's floor along one of its edges, as pieces: [from, to, height] in threes, `from` and `to` along the edge
// from 0 at its low end (in x or z) to 1. Two of these, one each side of an edge (and one for a corner: see
// floorsRound), and space for every step.
const profileA = new Float64Array(3 * 64);
const profileB = new Float64Array(3 * 64);
const profileCorner = new Float64Array(3 * 64);
const breaks = new Float64Array(130);

/**
 * The floor of the cell just read (see readCell) along its side DIRECTIONS[side], into `out`: flat, or down a
 * stair's side step by step. The top and bottom edges of a stair are its first and last steps.
 * @returns {number} How many pieces.
 */
function profile(side, out) {
    const height = cellHeight * HEIGHT_STEP;
    if (cellStair === 0) {
        out[0] = 0;
        out[1] = 1;
        out[2] = height;
        return 1;
    }
    const down = cellStair - 1;
    const top = cellTop * HEIGHT_STEP;
    const drop = top - height;
    const n = stairSteps(drop);
    if (side === down || side === (down ^ 1)) {
        out[0] = 0;
        out[1] = 1;
        out[2] = side === down ? height : top - drop / n;
        return 1;
    }
    // Along the side, from the top of the stair or from the bottom.
    const forward = DIRECTIONS[down][0] + DIRECTIONS[down][1] > 0;
    for (let k = 0; k < n; k++) {
        const a = forward ? k / n : 1 - (k + 1) / n;
        out[k * 3] = a;
        out[k * 3 + 1] = a + 1 / n;
        out[k * 3 + 2] = top - (drop * (k + 1)) / n;
    }
    return n;
}

function heightIn(pieces, count, a) {
    for (let k = 0; k < count; k++) if (a >= pieces[k * 3] && a <= pieces[k * 3 + 1]) return pieces[k * 3 + 2];
    return pieces[(count - 1) * 3 + 2];
}

/**
 * The floor: each cell's top (or its stair's steps), the water over it, and a wall of tile wherever the floor steps
 * down from one cell to the next (at each cell's +x and +z edges, so every edge is built once, by the chunk its cell
 * is in).
 */
function floors(tiles, water, trim, store, x0, z0, ox, oz) {
    // A cell at a time (not in longer runs, whose edges the next row's would meet in the middle: see flatPiece).
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            const lx = x - ox;
            const lz = z - oz;
            const cuts = stairsBeside(store, x, z);
            readCell(store, x, z);
            if (cellStair !== 0 || cellHeight < 0) flatTop(water, lx - 0.5, lx + 0.5, lz - 0.5, lz + 0.5, 0);
            if (cellStair !== 0) stair(tiles, trim, store, x, z, lx, lz, cuts);
            else flatPiece(tiles, lx, lz, lx - 0.5, lx + 0.5, lz - 0.5, lz + 0.5, cellHeight * HEIGHT_STEP, 1, cuts);
        }
    }
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) for (const side of [0, 2]) dropAcross(tiles, store, x0 + i, z0 + j, side, ox, oz);
    }
}

/**
 * Where the floor steps down across cell (x, z)'s side DIRECTIONS[side] (0 or 2): the face of the step, and the rounded
 * edge along its top.
 */
function dropAcross(tiles, store, x, z, side, ox, oz) {
    // A wall on the edge hides it (the wall goes down to the bottom of the deepest pool).
    if (store.edge(x, z, side === 0 ? 0 : 1) === EDGE_WALL) return;
    const [dx, dz] = DIRECTIONS[side];
    readCell(store, x, z);
    const a = profile(side, profileA);
    readCell(store, x + dx, z + dz);
    const b = profile(side ^ 1, profileB);
    // (Nothing to build where the floor's flat across it.)
    if (a === 1 && b === 1 && profileA[2] === profileB[2]) return;
    // The corners at the edge's ends, where the faces across the edges round each meet the ends of this one's.
    const corners = [0, 1].map((end) => floorsRound(store, dx !== 0 ? x + 0.5 : x - 0.5 + end, dx !== 0 ? z - 0.5 + end : z + 0.5));
    if (side === 0) stepFaces(tiles, true, x + 0.5 - ox, z - 0.5 - oz, a, b, corners);
    else stepFaces(tiles, false, z + 0.5 - oz, x - 0.5 - ox, a, b, corners);
    coping(tiles, store, x, z, side, ox, oz);
}

/** The floor of each of the four cells round the corner at (px, pz), at the corner (a stair's step there). */
function floorsRound(store, px, pz) {
    const out = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        readCell(store, px + sx * 0.5, pz + sz * 0.5);
        // Along its side on the corner's line across x, at the corner's end of it.
        const count = profile(sx < 0 ? 0 : 1, profileCorner);
        out.push(heightIn(profileCorner, count, sz < 0 ? 1 - 1e-4 : 1e-4));
    }
    return out;
}

/**
 * The rounded edge along the top of a drop from one flat floor to another (into a pool, or off a walkway into the
 * flooded floor), on cell (x, z)'s side DIRECTIONS[side] (0 or 2), like the bullnose coping round a pool: the floor
 * rounds over the edge and back under it, standing a little out over the drop, tiled on from the floor. Where two meet
 * in a pool's corner they run into each other; round the end of a walkway, they turn the corner together (each doing
 * half); where one just stops (at a stair, or where the drop does), it's closed off.
 */
function coping(tiles, store, x, z, side, ox, oz) {
    const y = rimHeight(store, x, z, side);
    if (Number.isNaN(y)) return;
    const [dx, dz] = DIRECTIONS[side];
    edge.alongX = side === 2;
    edge.at = edge.alongX ? z + 0.5 - oz : x + 0.5 - ox;
    edge.down = store.flatFloor(x + dx, z + dz) < store.flatFloor(x, z) ? 1 : -1;
    edge.y = y;
    const middle = edge.alongX ? x - ox : z - oz;
    copingAlong(tiles, middle - 0.5, middle + 0.5);
    for (const dir of [-1, 1]) {
        // Straight on, where the next edge along the line has the same drop.
        if (rimHeight(store, edge.alongX ? x + dir : x, edge.alongX ? z : z + dir, side) === y) continue;
        // The edges across the line at this end: on the drop's side of it (a pool's other side), and on the floor's.
        const across = (towardsDrop) => {
            const beyond = towardsDrop === edge.down > 0;
            if (edge.alongX) return rimHeight(store, dir > 0 ? x : x - 1, beyond ? z + 1 : z, 0);
            return rimHeight(store, beyond ? x + 1 : x, dir > 0 ? z : z - 1, 2);
        };
        if (across(true) === y) continue;
        if (across(false) === y) copingTurn(tiles, middle + dir * 0.5, dir);
        else if (!cornerFilled(store, edge.alongX ? (dir > 0 ? x : x - 1) : x, edge.alongX ? z : (dir > 0 ? z : z - 1))) copingEnd(tiles, middle + dir * 0.5, dir);
    }
}

/**
 * The edge being built: along x (at z = `at`) or along z (at x = `at`), the floor on it at y, and dropping away across
 * it towards `down` (±1).
 */
const edge = { alongX: false, at: 0, down: 1, y: 0 };

/**
 * Point `k` of COPING_STEPS round the coping, from the top of its nose (where it carries on from the floor) over and
 * back under it, into `nose`: how far out over the drop it is, how far down from the floor, its normal (out and up),
 * and how far round it's come.
 */
function nosePoint(k) {
    const angle = Math.PI / 2 - (k / COPING_STEPS) * Math.PI;
    nose.out = COPING_RADIUS * Math.cos(angle);
    nose.down = COPING_RADIUS * (1 - Math.sin(angle));
    nose.normalOut = Math.cos(angle);
    nose.normalUp = Math.sin(angle);
    nose.round = COPING_RADIUS * (Math.PI / 2 - angle);
    return nose;
}

const nose = { out: 0, down: 0, normalOut: 0, normalUp: 0, round: 0 };

/** The coping along the edge being built, from s0 to s1 along it. */
function copingAlong(tiles, s0, s1) {
    tiles.patch(COPING_STEPS, 1, (k, j, target) => {
        const point = nosePoint(k);
        const s = j === 0 ? s0 : s1;
        placeOnEdge(target, point.out, s, edge.y - point.down, point.normalOut, 0, point.normalUp);
        // On from the floor's tiles, over the edge and round.
        const across = edge.at + edge.down * point.round;
        target[6] = edge.alongX ? s : across;
        target[7] = edge.alongX ? across : s;
    });
}

/** Half of the coping turning round the end of a walkway at `s`, the way `dir` along the edge: its nose swept round the corner. */
function copingTurn(tiles, s, dir) {
    tiles.patch(COPING_STEPS, CORNER_TURN_STEPS, (k, m, target) => {
        const point = nosePoint(k);
        const turn = (m / CORNER_TURN_STEPS) * (Math.PI / 4);
        const c = Math.cos(turn);
        const t = Math.sin(turn);
        placeOnEdge(target, point.out * c, s + dir * point.out * t, edge.y - point.down, point.normalOut * c, dir * point.normalOut * t, point.normalUp);
        const across = edge.at + edge.down * point.round;
        const along = s + dir * point.out * turn;
        target[6] = edge.alongX ? along : across;
        target[7] = edge.alongX ? across : along;
    });
}

/** The flat end of the coping where it stops at `s`, facing `dir` along the edge: tiled across it, and up. */
function copingEnd(tiles, s, dir) {
    tiles.patch(COPING_STEPS, 1, (k, j, target) => {
        const point = nosePoint(k);
        const out = j === 0 ? 0 : point.out;
        const y = edge.y - (j === 0 ? COPING_RADIUS : point.down);
        placeOnEdge(target, out, s, y, 0, dir, 0);
        target[6] = edge.at + edge.down * out;
        target[7] = y;
    });
}

/** Fills `target`'s position and normal: `out` over the drop from the edge being built, `along` it, at height y. */
function placeOnEdge(target, out, along, y, normalOut, normalAlong, normalUp) {
    const across = edge.at + edge.down * out;
    target[0] = edge.alongX ? along : across;
    target[1] = y;
    target[2] = edge.alongX ? across : along;
    target[3] = edge.alongX ? normalAlong : edge.down * normalOut;
    target[4] = normalUp;
    target[5] = edge.alongX ? edge.down * normalOut : normalAlong;
}

/**
 * The height of the rounded edge on cell (x, z)'s side DIRECTIONS[side], where the floor drops across it from one
 * flat floor to another (and not at a wall, or down a stair's side): the top of the drop. NaN where there isn't one.
 */
function rimHeight(store, x, z, side) {
    const [dx, dz] = DIRECTIONS[side];
    if (store.edge(x, z, side === 0 ? 0 : 1) === EDGE_WALL) return NaN;
    const here = store.flatFloor(x, z);
    const there = store.flatFloor(x + dx, z + dz);
    if (here === null || there === null || Math.abs(here - there) < RIM_DROP) return NaN;
    return Math.max(here, there);
}

/** Whether something stands on the corner of cell (x, z): a column, or a wall on any edge that meets there. */
function cornerFilled(store, x, z) {
    return store.pillar(x, z) || store.edge(x, z, 0) !== EDGE_NONE || store.edge(x, z, 1) !== EDGE_NONE
        || store.edge(x, z + 1, 0) !== EDGE_NONE || store.edge(x + 1, z, 1) !== EDGE_NONE;
}

/**
 * The faces where the floor either side of an edge is at different heights, facing the lower side. The edge runs
 * along z (at x = `plane`) if `acrossX`, else along x (at z = `plane`), from `start` for one unit. `corners` are the
 * floors round the corners at its ends (see floorsRound).
 */
function stepFaces(tiles, acrossX, plane, start, countA, countB, corners) {
    let count = 0;
    for (let k = 0; k < countA; k++) {
        breaks[count++] = profileA[k * 3];
        breaks[count++] = profileA[k * 3 + 1];
    }
    for (let k = 0; k < countB; k++) {
        breaks[count++] = profileB[k * 3];
        breaks[count++] = profileB[k * 3 + 1];
    }
    const sorted = breaks.subarray(0, count).sort();
    for (let k = 0; k < count - 1; k++) {
        const a0 = sorted[k];
        const a1 = sorted[k + 1];
        if (a1 - a0 < 1e-5) continue;
        const middle = (a0 + a1) / 2;
        const ha = heightIn(profileA, countA, middle);
        const hb = heightIn(profileB, countB, middle);
        if (Math.abs(ha - hb) < 1e-5) continue;
        // Facing the lower side: +x or +z if that's the far side (b).
        const facing = ha > hb ? 1 : -1;
        const low = Math.min(ha, hb);
        const high = Math.max(ha, hb);
        const s0 = start + a0;
        const s1 = start + a1;
        // Its ends, where it meets the next face along (and a stair's riser, or at a corner the faces round it): with a
        // corner at every height a floor is there.
        const ends = [a0, a1].map((a) => {
            const at = cornersAt(cornersAt([], profileA, countA, a, low, high), profileB, countB, a, low, high);
            if (a < 1e-6 || a > 1 - 1e-6) for (const y of corners[a < 0.5 ? 0 : 1]) addCorner(at, y, low, high);
            return at;
        });
        if (acrossX) uprightCorners(tiles, plane, s0, plane, s1, low, high, ends[0], ends[1], facing, 0);
        else uprightCorners(tiles, s0, plane, s1, plane, low, high, ends[0], ends[1], 0, facing);
    }
}

/**
 * Adds to `out` the heights of a floor along an edge (`pieces`, see profile) just either side of `a` along it, that
 * are between y0 and y1: where anything meeting a face across the edge there has a corner partway up it.
 * @returns {number[]} `out`.
 */
function cornersAt(out, pieces, count, a, y0, y1) {
    for (const at of [a - 1e-4, a + 1e-4]) {
        if (at <= 0 || at >= 1) continue;
        addCorner(out, heightIn(pieces, count, at), y0, y1);
    }
    return out;
}

/** Adds height y to `out`, if it's between y0 and y1 and not there already. */
function addCorner(out, y, y0, y1) {
    if (y > y0 + 1e-6 && y < y1 - 1e-6 && !out.some((other) => Math.abs(other - y) < 1e-6)) out.push(y);
}

/**
 * A stair (the cell just read, (x, z), at lx, lz): its steps, the risers between them, and a dark tile on each edge.
 * `cuts` are where the stairs beside it meet it (see stairsBeside).
 */
function stair(tiles, trim, store, x, z, lx, lz, cuts) {
    const down = cellStair - 1;
    const [dx, dz] = DIRECTIONS[down];
    const low = cellHeight * HEIGHT_STEP;
    const top = cellTop * HEIGHT_STEP;
    const drop = top - low;
    const n = stairSteps(drop);
    // The floor beside it across its low end and its high end (in z, or x), which its risers meet (see stepFaces).
    const [lowSide, highSide] = dx !== 0 ? [3, 2] : [1, 0];
    readCell(store, x + DIRECTIONS[lowSide][0], z + DIRECTIONS[lowSide][1]);
    const countLow = profile(lowSide ^ 1, profileA);
    readCell(store, x + DIRECTIONS[highSide][0], z + DIRECTIONS[highSide][1]);
    const countHigh = profile(highSide ^ 1, profileB);
    // Along the stair: s from 0 (top edge) to 1 (bottom edge), in world terms.
    const along = (s) => -0.5 + s;
    for (let k = 0; k < n; k++) {
        const h = top - (drop * (k + 1)) / n;
        const s0 = along(k / n);
        const s1 = along((k + 1) / n);
        // The tread: across the whole cell, from s0 to s1 down the stair.
        const a = dx !== 0 ? lx + dx * s0 : lz + dz * s0;
        const b = dx !== 0 ? lx + dx * s1 : lz + dz * s1;
        if (dx !== 0) flatPiece(tiles, lx, lz, Math.min(a, b), Math.max(a, b), lz - 0.5, lz + 0.5, h, 1, cuts);
        else flatPiece(tiles, lx, lz, lx - 0.5, lx + 0.5, Math.min(a, b), Math.max(a, b), h, 1, cuts);
        if (k < n - 1) {
            // The riser down to the next step, facing down the stair, with a corner at its ends wherever the floor
            // beside it is (see stepFaces).
            const next = top - (drop * (k + 2)) / n;
            const at = dx + dz > 0 ? (k + 1) / n : 1 - (k + 1) / n;
            const ends = [cornersAt([], profileA, countLow, at, next, h), cornersAt([], profileB, countHigh, at, next, h)];
            if (dx !== 0) uprightCorners(tiles, lx + dx * s1, lz - 0.5, lx + dx * s1, lz + 0.5, next, h, ends[0], ends[1], dx, 0);
            else uprightCorners(tiles, lx - 0.5, lz + dz * s1, lx + 0.5, lz + dz * s1, next, h, ends[0], ends[1], 0, dz);
            // The dark edge along the front of the step.
            const e0 = along((k + 1) / n - 0.035);
            const y = h + 0.0009;
            if (dx !== 0) colouredTop(trim, lx + dx * e0, lx + dx * s1, lz - 0.5, lz + 0.5, y, NOSING);
            else colouredTop(trim, lx - 0.5, lx + 0.5, lz + dz * e0, lz + dz * s1, y, NOSING);
        }
    }
}

/**
 * Where the stairs beside cell (x, z) meet it in pieces, a step at a time (see flatPiece): for each of its sides, in
 * DIRECTIONS order, the points along it (from 0 at its low end to 1) between one step and the next. Null if there are
 * none. (It reads the cells beside it: see readCell.)
 * @returns {number[][] | null}
 */
function stairsBeside(store, x, z) {
    let splits = null;
    for (let side = 0; side < 4; side++) {
        const [dx, dz] = DIRECTIONS[side];
        readCell(store, x + dx, z + dz);
        if (cellStair === 0) continue;
        const count = profile(side ^ 1, profileB);
        for (let k = 0; k < count; k++) {
            if (profileB[k * 3] === 0) continue;
            splits ??= [[], [], [], []];
            splits[side].push(profileB[k * 3]);
        }
    }
    return splits;
}

/**
 * A flat piece of floor (facing 1) or ceiling (−1) from x0 to x1 and z0 to z1 in the cell with its middle at (lx, lz),
 * at height y, tiled by x and z. Where what's beside the cell meets it in pieces along a side (`cuts`: for each side,
 * in DIRECTIONS order, the points along it from its low end where they meet), the piece has a corner at each of
 * those on its own edges too, as a fan from its middle: an edge that met another in the middle of it would leave a
 * hairline crack there.
 * @param {number[][] | null} cuts
 */
function flatPiece(builder, lx, lz, x0, x1, z0, z1, y, facing, cuts) {
    // The cuts on its edge along the cell's side `side`, as points along it (in x or z).
    const on = (side) => {
        if (!cuts || cuts[side].length === 0) return [];
        const [dx, dz] = DIRECTIONS[side];
        const edge = dx > 0 ? x1 : dx < 0 ? x0 : dz > 0 ? z1 : z0;
        if (Math.abs(edge - (dx !== 0 ? lx + dx / 2 : lz + dz / 2)) > 1e-9) return [];
        const [from, to] = dx !== 0 ? [z0, z1] : [x0, x1];
        const start = (dx !== 0 ? lz : lx) - 0.5;
        return cuts[side].map((a) => start + a).filter((s) => s > from + 1e-9 && s < to - 1e-9);
    };
    const [px, nx, pz, nz] = [on(0), on(1), on(2), on(3)];
    if (px.length + nx.length + pz.length + nz.length === 0) {
        if (facing > 0) flatTop(builder, x0, x1, z0, z1, y);
        else underside(builder, x0, x1, z0, z1, y);
        return;
    }
    // Its edge all the way round, anticlockwise seen from above: along −z, up +x, back along +z and down −x.
    const ring = [[x0, z0]];
    for (const s of nz.sort((a, b) => a - b)) ring.push([s, z0]);
    ring.push([x1, z0]);
    for (const s of px.sort((a, b) => a - b)) ring.push([x1, s]);
    ring.push([x1, z1]);
    for (const s of pz.sort((a, b) => b - a)) ring.push([s, z1]);
    ring.push([x0, z1]);
    for (const s of nx.sort((a, b) => b - a)) ring.push([x0, s]);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    for (let k = 0; k < ring.length; k++) {
        const [ax, az] = ring[k];
        const [bx, bz] = ring[(k + 1) % ring.length];
        level(builder, mx, mz, ax, az, bx, bz, bx, bz, y, facing);
    }
}

/** A flat piece of floor facing up, from x0..x1, z0..z1 (either way round), tiled by x and z. */
function flatTop(builder, x0, x1, z0, z1, y) {
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    const c = Math.min(z0, z1);
    const d = Math.max(z0, z1);
    builder.quad(a, y, d, b, y, d, b, y, c, a, y, c, 0, 1, 0, a, d, b, c);
}

/** The same, in one colour. */
function colouredTop(builder, x0, x1, z0, z1, y, color) {
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    const c = Math.min(z0, z1);
    const d = Math.max(z0, z1);
    builder.quad(a, y, d, b, y, d, b, y, c, a, y, c, 0, 1, 0, color);
}

// ---------------------------------------------------------------------------------------------- the ceiling

/**
 * The ceiling: tiled, with a skylight let into it over the slots that have one (a tiled well up to the glass, with
 * glazing bars across it), and a round light set flush into it over the ones that have a light. And a glow round
 * each. In the halls, each bay between four columns is a vault (see vaultsFor): it comes down to the arches all
 * round it and rises to the ceiling in the middle, in two curves crossing. (Not where the sun comes in: a bay with a
 * skylight over it keeps its flat ceiling.)
 */
function ceiling(tiles, fixtures, glows, store, x0, z0, ox, oz, vaults) {
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            const lx = x - ox;
            const lz = z - oz;
            const bay = vaults?.bayOf(x, z) ?? null;
            const kind = slotAt(store, x, z);
            if (bay) {
                vaultCell(tiles, vaults, bay, x, z, ox, oz);
                vaultCover(tiles, store, vaults, x, z, lx, lz);
            } else if (kind === SLOT_SKY) {
                skylight(tiles, fixtures, glows, lx, lz);
            } else {
                flatPiece(tiles, lx, lz, lx - 0.5, lx + 0.5, lz - 0.5, lz + 0.5, WALL_HEIGHT, -1, skylightsBeside(store, x, z));
                if (kind === SLOT_LAMP) ceilingLight(fixtures, glows, lx, lz);
            }
        }
    }
}

/**
 * Over a vaulted cell (x, z), out of sight, a flat ceiling just clear of the vault's crown, and down to the ceiling
 * beside it where that isn't vaulted: all there is to see through the vault if you get your head into it by a column.
 * Its edges meet the ceiling beside it corner to corner (see flatPiece and skylightsBeside).
 */
function vaultCover(tiles, store, vaults, x, z, lx, lz) {
    const y = WALL_HEIGHT + VAULT_COVER;
    const cuts = skylightsBeside(store, x, z);
    flatPiece(tiles, lx, lz, lx - 0.5, lx + 0.5, lz - 0.5, lz + 0.5, y, -1, cuts);
    for (let side = 0; side < 4; side++) {
        const [dx, dz] = DIRECTIONS[side];
        if (vaults.bayOf(x + dx, z + dz)) continue;
        const points = [0, ...(cuts?.[side] ?? []), 1];
        for (let k = 0; k < points.length - 1; k++) {
            // Along the side, facing in.
            const [ax, az] = dx !== 0 ? [lx + dx / 2, lz - 0.5 + points[k]] : [lx - 0.5 + points[k], lz + dz / 2];
            const [bx, bz] = dx !== 0 ? [lx + dx / 2, lz - 0.5 + points[k + 1]] : [lx - 0.5 + points[k + 1], lz + dz / 2];
            upright(tiles, ax, WALL_HEIGHT, az, bx, WALL_HEIGHT, bz, bx, y, bz, ax, y, az, -dx, -dz);
        }
    }
}

/** What's in the ceiling over cell (x, z): its light slot's (see SLOT_LAMP and so on), or 0 where it has none. */
function slotAt(store, x, z) {
    if ((x & 1) === 0 || (z & 1) === 0) return 0;
    return store.panelData(x, z)[store.panelOffset(x, z) + 3];
}

/**
 * Where the flat ceiling round a skylight beside cell (x, z) meets it, in pieces round the opening (see skylight and
 * flatPiece): for each side, the points along it. Null if there's no skylight beside it.
 * @returns {number[][] | null}
 */
function skylightsBeside(store, x, z) {
    let splits = null;
    for (let side = 0; side < 4; side++) {
        const [dx, dz] = DIRECTIONS[side];
        if (slotAt(store, x + dx, z + dz) !== SLOT_SKY) continue;
        splits ??= [[], [], [], []];
        splits[side].push(0.5 - SKYLIGHT_HALF, 0.5 + SKYLIGHT_HALF);
    }
    return splits;
}

/**
 * The vaults over a hall's bays, for a chunk of one (or null): the bay each cell is in, if it has one (see bayStands),
 * and what building them takes (see vaultCell).
 */
function vaultsFor(store, chunk) {
    const zone = chunk.zone;
    if (zone.type !== ZONE_BATHS && zone.type !== ZONE_DEEP) return null;
    const s = columnSpacing(zone);
    const offset = (zone.variant >>> 8) % s;
    const bays = new Map();
    return {
        /** Half a bay's width, from its middle to the arches round it. */
        edge: s / 2,
        /** The arches' curve, from the middle of a bay out to d: its height and slope (see bayCurve). */
        curve: bayCurve(s),
        /** How far along that curve it is from its crown, for its tiles (see arcLengths). */
        arc: arcLengths(archHalf(s)),
        /** Where across a bay, from its middle, the vault is built at (see vaultSamples). */
        samples: vaultSamples(s),
        /** The middle of the bay cell (x, z) is in, or null if it has no vault. */
        bayOf(x, z) {
            // The bay's columns stand on the corners of cells a and a + s (and c and c + s): see placeColumns.
            const a = x - 1 - mod(x - 1 - offset, s);
            const c = z - 1 - mod(z - 1 - offset, s);
            const key = a * 65536 + c;
            let bay = bays.get(key);
            if (bay === undefined) {
                bay = bayStands(store, zone, a, c, s) ? [a + 0.5 + s / 2, c + 0.5 + s / 2] : null;
                bays.set(key, bay);
            }
            return bay;
        },
    };
}

/** Half the span of the arches between columns `s` apart (they spring from the columns, a little in from their middles). */
function archHalf(s) {
    return s / 2 - COLUMN_RADIUS * 0.7;
}

/**
 * The arches' curve across a bay of columns `s` apart, from its middle out to d: [height, slope]. Past the arches'
 * springing, in the columns, it stays down at ARCH_SPRING.
 */
function bayCurve(s) {
    const half = archHalf(s);
    return (d) => (Math.abs(d) > half ? [ARCH_SPRING, 0] : archCurve(d / half, half));
}

/**
 * Whether the bay with columns on the corners of cells (a, c) and (a + s, c + s) is vaulted: it has all four, and an
 * arch between each two (see archSpan), it's all in `zone`'s hall (so the chunks either side of a border build it
 * alike), nothing's in it, and no skylight's over it (it would cut through the vault).
 */
function bayStands(store, zone, a, c, s) {
    if (!store.pillar(a, c) || !store.pillar(a + s, c) || !store.pillar(a, c + s) || !store.pillar(a + s, c + s)) return false;
    if (archSpan(store, a, c, true) !== s || archSpan(store, a, c, false) !== s || archSpan(store, a, c + s, true) !== s || archSpan(store, a + s, c, false) !== s) return false;
    for (const [x, z] of [[a + 1, c + 1], [a + s, c + 1], [a + 1, c + s], [a + s, c + s]]) if (!sameHall(store, zone, x, z)) return false;
    for (let x = a + 1; x <= a + s; x++) {
        for (let z = c + 1; z <= c + s; z++) if (slotAt(store, x, z) === SLOT_SKY) return false;
    }
    for (let x = a + 1; x <= a + s; x++) {
        for (let z = c; z <= c + s; z++) if (store.edge(x, z, 1) !== EDGE_NONE) return false;
    }
    for (let z = c + 1; z <= c + s; z++) {
        for (let x = a; x <= a + s; x++) if (store.edge(x, z, 0) !== EDGE_NONE) return false;
    }
    return true;
}

const samplesBySpacing = new Map();

/**
 * The points across a bay of columns `s` apart, from its middle, that its vault is built at, the same both ways across
 * it: the arches' own (so it meets them exactly, and its two curves meet exactly along its diagonals), and wherever its
 * cells and the ribs of the arches begin and end (so every piece of it meets the next at the same points, without a
 * crack). The arches round it are built at the same points (see arch).
 * @returns {Float64Array}
 */
function vaultSamples(s) {
    let samples = samplesBySpacing.get(s);
    if (samples) return samples;
    const half = archHalf(s);
    const edge = s / 2;
    const list = [edge, -edge, edge - ARCH_HALF, ARCH_HALF - edge];
    for (let k = 0; k <= ARCH_SEGMENTS; k++) list.push(-Math.cos((k / ARCH_SEGMENTS) * Math.PI) * half);
    for (let k = 0; k < s; k++) {
        const middle = k - (s - 1) / 2;
        list.push(middle - 0.5, middle + 0.5);
    }
    list.sort((a, b) => a - b);
    samples = Float64Array.from(list.filter((d, i) => i === 0 || d - list[i - 1] > 1e-9));
    samplesBySpacing.set(s, samples);
    return samples;
}

/**
 * How far along the curve of a vault it is from its crown, for its tiles to follow it: a function of the distance
 * across from the middle (past the curve, into the columns, it's flat).
 */
function arcLengths(half) {
    let table = arcTables.get(half);
    if (!table) {
        const steps = 256;
        table = new Float32Array(steps + 1);
        let previous = archCurve(0, half)[0];
        for (let k = 1; k <= steps; k++) {
            const y = archCurve(k / steps, half)[0];
            table[k] = table[k - 1] + Math.hypot(half / steps, y - previous);
            previous = y;
        }
        arcTables.set(half, table);
    }
    const steps = table.length - 1;
    return (d) => {
        const a = Math.abs(d) / half;
        if (a >= 1) return Math.sign(d) * (table[steps] + Math.abs(d) - half);
        const k = Math.min(Math.floor(a * steps), steps - 1);
        const f = a * steps - k;
        return Math.sign(d) * (table[k] + (table[k + 1] - table[k]) * f);
    };
}

const arcTables = new Map();

/**
 * The part of a bay's vault over cell (x, z) (see vaultsFor). A bay's vault is the arches' curve carried across it
 * both ways, and whichever is higher: over each quarter of it, between its diagonals, it's one of the two, a curved
 * ceiling the same all along it (only its height across it changes), and where the quarters meet, along the
 * diagonals, they meet in clean groins. Each quarter is built in strips across its curve, at the vault's samples, each
 * running straight from the groin out to the rib of the arch at the bay's edge, where the rib takes over.
 */
function vaultCell(tiles, vaults, bay, x, z, ox, oz) {
    // The cell, from the middle of the bay, along x and z.
    const low = [x - 0.5 - bay[0], z - 0.5 - bay[1]];
    const high = [low[0] + 1, low[1] + 1];
    for (const across of [0, 1]) {
        for (const side of [-1, 1]) {
            vault.vaults = vaults;
            vault.bay = bay;
            vault.across = across;
            vault.side = side;
            vault.ox = ox;
            vault.oz = oz;
            vaultQuarter(tiles, low, high);
        }
    }
}

/**
 * The quarter of a bay being built (see vaultQuarter): its curve runs `across` x (0) or z (1), and the quarter is on
 * the `side` (±1) of the middle the other way. Out along that way ("out", from the middle) it runs from the groin
 * (where out = |across|) to the rib at the bay's edge.
 */
const vault = { vaults: null, bay: [0, 0], across: 0, side: 1, ox: 0, oz: 0 };

/** The part of the quarter being built (see vault) that's over the cell from `low` to `high`. */
function vaultQuarter(tiles, low, high) {
    const { vaults, across, side } = vault;
    const { samples } = vaults;
    const along = 1 - across;
    // The cell, out from the middle, and out to the rib.
    const outLow = side > 0 ? low[along] : -high[along];
    const outHigh = Math.min(side > 0 ? high[along] : -low[along], vaults.edge - ARCH_HALF);
    for (let k = 0; k < samples.length - 1; k++) {
        const c0 = samples[k];
        const c1 = samples[k + 1];
        if (c0 < low[across] - 1e-9 || c1 > high[across] + 1e-9) continue;
        // From the groin (or the cell's edge) out to the rib (or the cell's edge).
        const start0 = Math.max(Math.abs(c0), outLow);
        const start1 = Math.max(Math.abs(c1), outLow);
        if (start0 < outHigh || start1 < outHigh) vaultStrip(tiles, c0, c1, start0, start1, outHigh);
    }
}

/** A strip of the quarter being built, from c0 to c1 across its curve, and out from start0 (at c0) and start1 (at c1) to end. */
function vaultStrip(tiles, c0, c1, start0, start1, end) {
    const { vaults, across } = vault;
    tiles.patch(1, 1, (i, j, target) => {
        const c = i === 0 ? c0 : c1;
        const out = j === 1 ? end : i === 0 ? start0 : start1;
        const [y, slope] = vaults.curve(c);
        const length = Math.hypot(slope, 1);
        placeInVault(c, out);
        target[0] = vaultAt.x;
        target[1] = y;
        target[2] = vaultAt.z;
        target[3] = across === 0 ? slope / length : 0;
        target[4] = -1 / length;
        target[5] = across === 0 ? 0 : slope / length;
        // Along the curve, and straight along the other way (see arch: its ribs are tiled the same).
        target[6] = (across === 0 ? vaults.arc(c) : vaultAt.x) * MOSAIC;
        target[7] = (across === 0 ? vaultAt.z : vaults.arc(c)) * MOSAIC;
    });
}

// Where placeInVault put a point: x and z in the chunk.
const vaultAt = { x: 0, z: 0 };

/** Where the point `c` across the curve and `out` from the middle of the quarter being built is, into vaultAt. */
function placeInVault(c, out) {
    const { bay, across, side, ox, oz } = vault;
    // (In the chunk first, then across: the same sums as the arches' (see arch), so their points meet exactly.)
    vaultAt.x = bay[0] - ox + (across === 0 ? c : side * out);
    vaultAt.z = bay[1] - oz + (across === 0 ? side * out : c);
}

/** A flat piece of ceiling facing down, from x0..x1, z0..z1, tiled by x and z. */
function underside(builder, x0, x1, z0, z1, y) {
    builder.quad(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, 0, -1, 0, x0, z0, x1, z1);
}

/** A skylight over (lx, lz): the ceiling round the opening, the well up from it to the glass, and the glazing bars. */
function skylight(tiles, fixtures, glows, lx, lz) {
    const h = SKYLIGHT_HALF;
    const y = WALL_HEIGHT;
    // The ceiling round the opening, in eight pieces that all meet at their corners.
    const cuts = [-0.5, -h, h, 0.5];
    for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) if (a !== 1 || b !== 1) underside(tiles, lx + cuts[a], lx + cuts[a + 1], lz + cuts[b], lz + cuts[b + 1], y);
    }
    // The well, facing in.
    for (const [sx, sz, nx, nz] of [[-h, 0, 1, 0], [h, 0, -1, 0], [0, -h, 0, 1], [0, h, 0, -1]]) {
        const [ax, az] = sx !== 0 ? [sx, -h] : [-h, sz];
        const [bx, bz] = sx !== 0 ? [sx, h] : [h, sz];
        upright(tiles, lx + ax, y, lz + az, lx + bx, y, lz + bz, lx + bx, SKY_TOP, lz + bz, lx + ax, SKY_TOP, lz + az, nx, nz);
    }
    // The glass, as bright as the sky behind it, and the bars across it (their shadow is in the sunlight; see
    // poolSun in poolroomsShading.js).
    fixtures.quad(lx - h, SKY_TOP, lz - h, lx + h, SKY_TOP, lz - h, lx + h, SKY_TOP, lz + h, lx - h, SKY_TOP, lz + h, 0, -1, 0, GLASS);
    const bar = 0.012;
    fixtures.box(lx - bar, SKY_TOP - 0.03, lz - h, lx + bar, SKY_TOP - 0.001, lz + h, GLAZING_BAR);
    fixtures.box(lx - h, SKY_TOP - 0.03, lz - bar, lx + h, SKY_TOP - 0.001, lz + bar, GLAZING_BAR);
    glows.spot(lx, WALL_HEIGHT + 0.02, lz, 0.62, -1, 0.34, 0.8);
}

/** A round light set into the ceiling at (lx, lz), with its trim, and its glow. */
function ceilingLight(fixtures, glows, lx, lz) {
    disc(fixtures, lx, WALL_HEIGHT - 0.0015, lz, 0, -1, 0, TRIM_RADIUS, TRIM);
    disc(fixtures, lx, WALL_HEIGHT - 0.003, lz, 0, -1, 0, LIGHT_RADIUS, LIGHT);
    glows.spot(lx, WALL_HEIGHT - 0.03, lz, 0.32, -1, 0.38, 1);
}

/** A flat disc of radius r at (x, y, z) facing (nx, ny, nz), which is one of the axes. */
function disc(builder, x, y, z, nx, ny, nz, r, color) {
    const centre = builder.vertex(x, y, z, nx, ny, nz, 0, 0, color);
    const first = builder.vertexCount;
    for (let k = 0; k < LIGHT_SIDES; k++) {
        const angle = (k / LIGHT_SIDES) * Math.PI * 2;
        const c = Math.cos(angle) * r;
        const s = Math.sin(angle) * r;
        // In the plane across the normal.
        const px = ny !== 0 ? x + c : nz !== 0 ? x + c : x;
        const py = ny !== 0 ? y : y + s;
        const pz = ny !== 0 ? z + s : nz !== 0 ? z : z + c;
        builder.vertex(px, py, pz, nx, ny, nz, 0, 0, color);
    }
    // Wound to face along the normal: in the xz plane (c, s) is counter-clockwise seen from −y, and so on.
    const flip = ny > 0 || nx > 0 || nz < 0;
    for (let k = 0; k < LIGHT_SIDES; k++) {
        const a = first + k;
        const b = first + ((k + 1) % LIGHT_SIDES);
        if (flip) builder.triangle(centre, b, a);
        else builder.triangle(centre, a, b);
    }
}

// ---------------------------------------------------------------------------------------------- columns and arches

/**
 * The columns: round, tiled, down to the floor round them (to the bottom of the pool, for one standing in it), with
 * a band round them where the arches spring. In a hall, an arch from each to the next along the grid, both ways,
 * wherever nothing stands between them.
 */
function columns(tiles, store, vaults, x0, z0, ox, oz) {
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            if (!store.pillar(x, z)) continue;
            let bottom = Infinity;
            for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                readCell(store, x + dx, z + dz);
                bottom = Math.min(bottom, cellHeight * HEIGHT_STEP);
            }
            const cx = x + 0.5 - ox;
            const cz = z + 0.5 - oz;
            column(tiles, cx, cz, bottom - 0.01);
            columnFoot(tiles, store, x, z, cx, cz);
            // Arches to the next column along +x and +z.
            for (const alongX of [true, false]) {
                const step = archSpan(store, x, z, alongX);
                if (step === 0) continue;
                // Its faces show only where there's no vault on that side.
                const open = (dx, dz) => !vaults?.bayOf(x + dx, z + dz);
                const faces = alongX ? [open(1, 0), open(1, 1)] : [open(0, 1), open(1, 1)];
                arch(tiles, alongX, alongX ? cz : cx, alongX ? x + 0.5 + step / 2 - ox : z + 0.5 + step / 2 - oz, step, faces);
            }
        }
    }
}

/**
 * How many cells along x (or z) the arch from the column on the corner of cell (x, z) spans, to the next column: 2 or
 * 3, or 0 where there's no arch: a wall's in the way (on its line, or coming up to it between the columns), the next
 * column's only a cell away or more than three, or it's another hall's.
 */
function archSpan(store, x, z, alongX) {
    for (let step = 1; step <= 3; step++) {
        const nx = alongX ? x + step : x;
        const nz = alongX ? z : z + step;
        // The edge the arch passes over (the line between cells z and z + 1, or x and x + 1).
        if (store.edge(alongX ? nx : x, alongX ? z : nz, alongX ? 1 : 0) !== EDGE_NONE) return 0;
        if (store.pillar(nx, nz)) return step >= 2 && sameHall(store, zoneOf(store, x, z), nx, nz) ? step : 0;
        // The edges across its line, either side of it, where no column stands.
        if (store.edge(nx, nz, alongX ? 0 : 1) !== EDGE_NONE || store.edge(alongX ? nx : nx + 1, alongX ? nz + 1 : nz, alongX ? 0 : 1) !== EDGE_NONE) return 0;
    }
    return 0;
}

/** The zone of the chunk cell (x, z) is in. */
function zoneOf(store, x, z) {
    return store.getChunk(chunkCoord(x), chunkCoord(z)).zone;
}

/** Whether cell (x, z) is in `zone`'s hall: a chunk of the same kind of zone, and of the same region of it. */
function sameHall(store, zone, x, z) {
    const other = zoneOf(store, x, z);
    return other.type === zone.type && other.variant === zone.variant;
}

/** One column at (cx, cz), from `bottom` to the ceiling. */
function column(tiles, cx, cz, bottom) {
    const r = COLUMN_RADIUS;
    cylinder(tiles, cx, cz, r, bottom, IMPOST_BOTTOM);
    cylinder(tiles, cx, cz, r, IMPOST_TOP, WALL_HEIGHT);
    // The band: a ring standing out from the shaft, with its top and underside.
    const out = r + IMPOST_OUT;
    cylinder(tiles, cx, cz, out, IMPOST_BOTTOM, IMPOST_TOP);
    ring(tiles, cx, cz, r, out, IMPOST_TOP, 1);
    ring(tiles, cx, cz, r, out, IMPOST_BOTTOM, -1);
}

// The cells round a column on the corner of cell (x, z), a quarter of it in each, anticlockwise from +x +z (the way the
// angle round it goes: see cylinder).
const QUARTERS = [[1, 1], [0, 1], [0, 0], [1, 0]];
// (Half as many steps round as the column has sides: the foot curves in to meet it, and no one could tell.)
const QUARTER_STEPS = COLUMN_SIDES / 8;
/** How big the curve at a column's foot is: two of the mosaic's tiles round (the walls' would make it a bell). */
const FOOT_RADIUS = (2 * TILE) / MOSAIC / (Math.PI / 2);

/**
 * Where the column on the corner of cell (x, z) meets the floor: the floor's cove, swept round its foot, a quarter at a
 * time (each quarter stands in a different cell, whose floor can be at a different height), and closed off wherever
 * the next quarter's floor isn't at the same height.
 */
function columnFoot(tiles, store, x, z, cx, cz) {
    for (let q = 0; q < 4; q++) {
        const y = quarterFloor(store, x, z, q);
        if (y === null) continue;
        const a0 = (q * Math.PI) / 2;
        const a1 = a0 + Math.PI / 2;
        tiles.patch(COVE_STEPS, QUARTER_STEPS, (k, m, target) => {
            const point = curvePoint(k, FOOT_RADIUS);
            const angle = a0 + ((a1 - a0) * m) / QUARTER_STEPS;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const r = COLUMN_RADIUS + point.out;
            target[0] = cx + c * r;
            target[1] = y + point.rise;
            target[2] = cz + s * r;
            target[3] = c * point.normalOut;
            target[4] = point.normalUp;
            target[5] = s * point.normalOut;
            // On from the column's tiles (see cylinder), round it and down.
            target[6] = -angle * COLUMN_RADIUS * MOSAIC;
            target[7] = (y + FOOT_RADIUS - point.round) * MOSAIC;
        });
        if (quarterFloor(store, x, z, (q + 3) % 4) !== y) footEnd(tiles, cx, cz, y, a0, -1);
        if (quarterFloor(store, x, z, (q + 1) % 4) !== y) footEnd(tiles, cx, cz, y, a1, 1);
    }
}

/** The floor under quarter q of the column on the corner of cell (x, z) (null on a stair). */
function quarterFloor(store, x, z, q) {
    return store.flatFloor(x + QUARTERS[q][0], z + QUARTERS[q][1]);
}

/**
 * The flat end of a quarter of a column's foot, at `angle` round it, facing on round it (`dir` 1) or back (−1): upright,
 * in line with the step between the two floors, and tiled like it.
 */
function footEnd(tiles, cx, cz, y, angle, dir) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    tiles.patch(COVE_STEPS, 1, (k, j, target) => {
        const point = curvePoint(k, FOOT_RADIUS);
        const r = COLUMN_RADIUS + (j === 0 ? 0 : point.out);
        const px = cx + c * r;
        const py = y + (j === 0 ? 0 : point.rise);
        const pz = cz + s * r;
        target[0] = px;
        target[1] = py;
        target[2] = pz;
        target[3] = -s * dir;
        target[4] = 0;
        target[5] = c * dir;
        // (The step it's in line with runs along x or along z.)
        target[6] = Math.abs(c) > 0.5 ? px : pz;
        target[7] = py;
    });
}

/** The side of a cylinder round (cx, cz), from y0 to y1, tiled round it (one unit of texture per unit round). */
function cylinder(tiles, cx, cz, r, y0, y1) {
    for (let k = 0; k < COLUMN_SIDES; k++) {
        const a0 = (k / COLUMN_SIDES) * Math.PI * 2;
        const a1 = ((k + 1) / COLUMN_SIDES) * Math.PI * 2;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const c1 = Math.cos(a1);
        const s1 = Math.sin(a1);
        const u0 = a0 * r;
        const u1 = a1 * r;
        // Counter-clockwise seen from outside: round from angle a1 to a0 at the bottom, then up.
        tiles.vertex(cx + c1 * r, y0, cz + s1 * r, c1, 0, s1, -u1 * MOSAIC, y0 * MOSAIC);
        tiles.vertex(cx + c0 * r, y0, cz + s0 * r, c0, 0, s0, -u0 * MOSAIC, y0 * MOSAIC);
        tiles.vertex(cx + c0 * r, y1, cz + s0 * r, c0, 0, s0, -u0 * MOSAIC, y1 * MOSAIC);
        tiles.vertex(cx + c1 * r, y1, cz + s1 * r, c1, 0, s1, -u1 * MOSAIC, y1 * MOSAIC);
    }
}

/** A flat ring round (cx, cz) from radius r0 to r1 at height y, facing up (1) or down (−1). */
function ring(tiles, cx, cz, r0, r1, y, facing) {
    for (let k = 0; k < COLUMN_SIDES; k++) {
        const a0 = (k / COLUMN_SIDES) * Math.PI * 2;
        const a1 = ((k + 1) / COLUMN_SIDES) * Math.PI * 2;
        const p = [
            [cx + Math.cos(a0) * r1, cz + Math.sin(a0) * r1],
            [cx + Math.cos(a1) * r1, cz + Math.sin(a1) * r1],
            [cx + Math.cos(a1) * r0, cz + Math.sin(a1) * r0],
            [cx + Math.cos(a0) * r0, cz + Math.sin(a0) * r0],
        ];
        level(tiles, p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1], y, facing);
    }
}

/**
 * The arch between two columns `step` cells apart, along x (at z = `at`) or along z (at x = `at`), with its middle at
 * `middle`: springing straight up from the columns at ARCH_SPRING, and rising to the ceiling in a tall curve that comes
 * to a soft point at the top. Its underside is a rib: it swells a little below the vaults either side and rounds back
 * into them without a crease, tiled on from them; and where there's no vault on a side (`faces`: the −1 side, then the
 * +1 side), its face goes up from there to the ceiling. It's built at the same points along it as the vaults (see
 * vaultSamples), so they meet exactly.
 */
function arch(tiles, alongX, at, middle, step, faces) {
    const half = archHalf(step);
    const arc = arcLengths(half);
    const samples = vaultSamples(step).filter((d) => Math.abs(d) <= half + 1e-9);
    const place = (along, across) => (alongX ? [along, at + across] : [at + across, along]);
    tiles.patch(samples.length - 1, RIB_STEPS, (k, m, target) => {
        const d = samples[k];
        const [y, slope] = archCurve(d / half, half);
        // Across the rib, from one edge (−1) to the other (1): how far it swells below the curve there, and its slope.
        const t = (2 * m) / RIB_STEPS - 1;
        const swell = (RIB * (1 + Math.cos(Math.PI * t))) / 2;
        const swellSlope = (RIB * Math.PI * Math.sin(Math.PI * t)) / (2 * ARCH_HALF);
        const length = Math.hypot(slope, 1, swellSlope);
        const [x, z] = place(middle + d, t * ARCH_HALF);
        target[0] = x;
        target[1] = y - swell;
        target[2] = z;
        target[3] = (alongX ? slope : swellSlope) / length;
        target[4] = -1 / length;
        target[5] = (alongX ? swellSlope : slope) / length;
        // As the vaults either side are (see vaultStrip).
        target[6] = (alongX ? arc(d) : x) * MOSAIC;
        target[7] = (alongX ? z : arc(d)) * MOSAIC;
    });
    // Its two faces, from the rib's edges up to the ceiling.
    for (let k = 0; k < samples.length - 1; k++) {
        const ya = archCurve(samples[k] / half, half)[0];
        const yb = archCurve(samples[k + 1] / half, half)[0];
        for (const side of [-1, 1]) {
            if (!faces[(side + 1) / 2]) continue;
            const [ax, az] = place(middle + samples[k], side * ARCH_HALF);
            const [bx, bz] = place(middle + samples[k + 1], side * ARCH_HALF);
            upright(tiles, ax, ya, az, bx, yb, bz, bx, WALL_HEIGHT, bz, ax, WALL_HEIGHT, az, alongX ? 0 : side, alongX ? side : 0, MOSAIC);
        }
    }
}

/**
 * The curve of the arches and the vaults: at u = −1 (one spring) .. 0 (the crown) .. 1 (the other), over a half-span of
 * `half`, its height and its slope. It springs straight up from ARCH_SPRING and rounds over at the ceiling.
 * @returns {[number, number]}
 */
export function archCurve(u, half) {
    const a = Math.min(Math.abs(u), 0.99999);
    const base = 1 - a * a;
    const rise = ARCH_CROWN - ARCH_SPRING;
    const y = ARCH_SPRING + rise * base ** 0.6;
    const slope = a < 1e-6 ? 0 : (-rise * 0.6 * base ** -0.4 * 2 * a * Math.sign(u)) / half;
    return [y, slope];
}

/** The arch in the top of each doorway: its two faces, flush with the wall's, and the curve under it. */
function doorways(tiles, store, x0, z0, ox, oz) {
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            for (const axis of [0, 1]) {
                if (store.edge(x, z, axis) !== EDGE_DOOR) continue;
                // The wall's plane and the middle of the doorway along it.
                const plane = (axis === 0 ? x : z) + 0.5 - (axis === 0 ? ox : oz);
                const middle = (axis === 0 ? z - oz : x - ox);
                doorArch(tiles, axis, plane, middle);
            }
        }
    }
}

function doorArch(tiles, axis, plane, middle) {
    const place = (along, y, across) => (axis === 0 ? [plane + across, y, middle + along] : [middle + along, y, plane + across]);
    const u = middle;
    for (let k = 0; k < DOOR_SEGMENTS; k++) {
        const t0 = (k / DOOR_SEGMENTS) * Math.PI;
        const t1 = ((k + 1) / DOOR_SEGMENTS) * Math.PI;
        // From one side of the opening (along = −r) over the top to the other.
        const a0 = -Math.cos(t0) * DOOR_RADIUS;
        const a1 = -Math.cos(t1) * DOOR_RADIUS;
        const y0 = DOOR_SPRING + Math.sin(t0) * DOOR_RADIUS;
        const y1 = DOOR_SPRING + Math.sin(t1) * DOOR_RADIUS;
        // Underneath, facing in and down towards the middle of the circle.
        const n0 = [Math.cos(t0), -Math.sin(t0)];
        const n1 = [Math.cos(t1), -Math.sin(t1)];
        const [p0x, , p0z] = place(a0, 0, -HALF_THICKNESS);
        const [p1x, , p1z] = place(a1, 0, -HALF_THICKNESS);
        const [q1x, , q1z] = place(a1, 0, HALF_THICKNESS);
        const [q0x, , q0z] = place(a0, 0, HALF_THICKNESS);
        const along = (n) => (axis === 0 ? [0, n[1], n[0]] : [n[0], n[1], 0]);
        const [m0x, m0y, m0z] = along(n0);
        const [m1x, m1y, m1z] = along(n1);
        smooth(tiles,
            p0x, y0, p0z, m0x, m0y, m0z, u + a0, -HALF_THICKNESS,
            p1x, y1, p1z, m1x, m1y, m1z, u + a1, -HALF_THICKNESS,
            q1x, y1, q1z, m1x, m1y, m1z, u + a1, HALF_THICKNESS,
            q0x, y0, q0z, m0x, m0y, m0z, u + a0, HALF_THICKNESS);
        // The faces either side, from the curve up to the top of the doorway: each half a fan from the top corner over
        // it, so along the top they have only their corners and the crown, where the wall over the doorway meets them.
        for (const side of [-1, 1]) {
            const [ax, , az] = place(a0, 0, side * HALF_THICKNESS);
            const [bx, , bz] = place(a1, 0, side * HALF_THICKNESS);
            const [cx, , cz] = place(a0 + a1 < 0 ? -DOOR_RADIUS : DOOR_RADIUS, 0, side * HALF_THICKNESS);
            upright(tiles, cx, DOOR_HEIGHT, cz, ax, y0, az, bx, y1, bz, bx, y1, bz, axis === 0 ? side : 0, axis === 0 ? 0 : side);
        }
    }
}

// ---------------------------------------------------------------------------------------------- the passages

/*
 * The narrow passages, a cell wide with a wall down each side, are arched over. The arch springs from the walls at an
 * angle, a little way over your head, and rounds over below the ceiling: part of a circle wider than the passage (one
 * that only just fitted between the walls would all but touch them, halfway down, and look it). Here and there it
 * carries on for a few cells, a barrel vault over the passage; in the rest, every other cell or so, it stands across
 * the passage as a rib, its edges rounded over. It's tiled like the walls, on from their tiles: it springs from them
 * between two rows, and its rows run up from there on both sides to meet at the crown. Never on a stair, in a pool, or
 * under a light (it would cut it in two).
 */

/** How far over the passage's floor the arch springs from its walls (as near as a row of their tiles allows), and its crown. */
const BARREL_SPRING = 0.65;
const BARREL_CROWN = 0.88;
/** Half the passage's width, wall to wall. */
const PASSAGE_HALF = 0.5 - HALF_THICKNESS;
/**
 * The rounded lip where a rib's face (or the end of a barrel vault) turns under: a tile round, dying away over the last
 * two tiles to each wall, so the arch meets them in a clean line rather than a knob.
 */
const LIP_RADIUS = TILE / (Math.PI / 2);
const LIP_FADE = 2 * TILE;
const LIP_STEPS = 3;
/** Steps round the arch. */
const BARREL_STEPS = 16;
/** How thick a rib is, at its thinnest and its thickest. */
const RIB_THIN = 0.12;
const RIB_THICK = 0.26;
/** How much of the passages is barrel-vaulted (decided three cells at a time), and how often a rib stands in the rest. */
const BARREL_CHANCE = 0.3;
const RIB_CHANCE = 0.75;
/** A passage's floor can't be any lower than this (in a pool, it isn't one). */
const PASSAGE_LOWEST = -8 * HEIGHT_STEP;

// What's in a passage's cell (see readPassage).
const PASSAGE_EMPTY = 0;
const PASSAGE_RIB = 1;
const PASSAGE_BARREL = 2;

// What readPassage found: what's in the cell, which way its passage runs, and the height of its floor.
let passageKind = PASSAGE_EMPTY;
let passageAlongZ = false;
let passageFloor = 0;

/** The ribs and the barrel vaults in the passages of one chunk. */
function passages(tiles, store, x0, z0, ox, oz) {
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            readPassage(store, x, z);
            const kind = passageKind;
            const alongZ = passageAlongZ;
            const floor = passageFloor;
            if (kind === PASSAGE_RIB) {
                setBarrel(alongZ, x - ox, z - oz, floor);
                const half = (RIB_THIN + (RIB_THICK - RIB_THIN) * hashFloat(store.seed, 0x37e3, x, z)) / 2;
                barrelUnderside(tiles, -half + LIP_RADIUS, half - LIP_RADIUS);
                barrelFace(tiles, -half, -1);
                barrelFace(tiles, half, 1);
            } else if (kind === PASSAGE_BARREL) {
                // A face at either end where the next cell along doesn't carry it on.
                const dx = alongZ ? 0 : 1;
                const dz = 1 - dx;
                const back = !carriesOn(store, x - dx, z - dz, alongZ, floor);
                const front = !carriesOn(store, x + dx, z + dz, alongZ, floor);
                setBarrel(alongZ, x - ox, z - oz, floor);
                barrelUnderside(tiles, back ? LIP_RADIUS - 0.5 : -0.5, front ? 0.5 - LIP_RADIUS : 0.5);
                if (back) barrelFace(tiles, -0.5, -1);
                if (front) barrelFace(tiles, 0.5, 1);
            }
        }
    }
}

/** Whether cell (x, z) carries on a barrel vault over a passage running the same way, with its floor at the same height. */
function carriesOn(store, x, z, alongZ, floor) {
    readPassage(store, x, z);
    return passageKind === PASSAGE_BARREL && passageAlongZ === alongZ && passageFloor === floor;
}

/**
 * What's in cell (x, z), if it's a narrow passage (a wall down both its sides): a stretch of barrel vault, a rib, or
 * nothing, into passageKind, and which way it runs and the height of its floor into passageAlongZ and passageFloor.
 */
function readPassage(store, x, z) {
    passageKind = PASSAGE_EMPTY;
    const floor = store.flatFloor(x, z);
    if (floor === null || floor < PASSAGE_LOWEST) return;
    const wallsX = store.edge(x - 1, z, 0) === EDGE_WALL && store.edge(x, z, 0) === EDGE_WALL;
    const wallsZ = store.edge(x, z - 1, 1) === EDGE_WALL && store.edge(x, z, 1) === EDGE_WALL;
    if (wallsX === wallsZ || underLight(store, x, z)) return;
    passageAlongZ = wallsX;
    passageFloor = floor;
    const along = wallsX ? z : x;
    const across = wallsX ? x : z;
    if (hashFloat(store.seed, 0x37e1, across, Math.floor(along / 3), wallsX ? 1 : 0) < BARREL_CHANCE) passageKind = PASSAGE_BARREL;
    else if ((along & 1) === 0 && hashFloat(store.seed, 0x37e2, x, z) < RIB_CHANCE) passageKind = PASSAGE_RIB;
}

/** Whether there's a light or a skylight in the ceiling over cell (x, z). */
function underLight(store, x, z) {
    const slot = slotAt(store, x, z);
    return slot === SLOT_LAMP || slot === SLOT_SKY;
}

/**
 * @typedef {object} BarrelShape The arch over a passage with its floor at one height (see barrelShape).
 * @property {number} radius Its circle's.
 * @property {number} middle The height of the circle's middle.
 * @property {number} spring The angle round the circle (from across the passage, up over the top) where it springs from
 *     the wall on that side; on the other side it's π − spring.
 * @property {Float64Array} angles The angles round it it's built at.
 */

/** The piece of barrel vault being built: which way its passage runs, the middle of its cell, and its shape. */
const barrel = { alongZ: false, x: 0, z: 0, shape: /** @type {BarrelShape} */ (null) };

function setBarrel(alongZ, x, z, floor) {
    barrel.alongZ = alongZ;
    barrel.x = x;
    barrel.z = z;
    barrel.shape = barrelShape(floor);
}

const shapesByFloor = new Map();

/**
 * The arch over a passage with its floor at `floor`: the circle through its crown and the lines on the walls where it
 * springs from them, and the angles round it that it's built at: from wall to wall in even steps, and also at the crown
 * (where the rows of tiles from either side meet), where the lip has grown to its full size, and where its face meets
 * the corners of the ceiling, so its pieces meet exactly.
 * @returns {BarrelShape}
 */
function barrelShape(floor) {
    let shape = shapesByFloor.get(floor);
    if (shape) return shape;
    const springHeight = Math.round((floor + BARREL_SPRING) / TILE) * TILE;
    const crown = floor + BARREL_CROWN;
    const rise = crown - springHeight;
    const radius = (PASSAGE_HALF ** 2 + rise ** 2) / (2 * rise);
    const middle = crown - radius;
    const spring = Math.acos(PASSAGE_HALF / radius);
    const list = [];
    for (let k = 0; k <= BARREL_STEPS; k++) list.push(spring + ((Math.PI - 2 * spring) * k) / BARREL_STEPS);
    const lipFull = spring + LIP_FADE / radius;
    const above = WALL_HEIGHT - middle;
    for (const angle of [Math.PI / 2, lipFull, Math.PI - lipFull, Math.atan2(above, PASSAGE_HALF), Math.atan2(above, -PASSAGE_HALF)]) {
        if (angle > spring && angle < Math.PI - spring) list.push(angle);
    }
    shape = { radius, middle, spring, angles: Float64Array.from(list.sort((a, b) => a - b)) };
    shapesByFloor.set(floor, shape);
    return shape;
}

/**
 * How far round the arch it is to `angle` from where it springs from the nearer wall: the tiles' rows run from each wall
 * up to the crown.
 */
function roundFromWall(angle) {
    const { radius, spring } = barrel.shape;
    return radius * Math.min(angle - spring, Math.PI - spring - angle);
}

/** How far the lip stands out from the underside at `angle` round the arch: all but nothing at the walls. */
function lipAt(angle) {
    return LIP_RADIUS * Math.max(0.02, Math.min(1, roundFromWall(angle) / LIP_FADE));
}

/** The underside of the barrel vault, along its passage from s0 to s1 (from the middle of its cell), tiled round and along it. */
function barrelUnderside(tiles, s0, s1) {
    const { radius, angles } = barrel.shape;
    tiles.patch(angles.length - 1, 1, (k, j, target) => {
        const c = Math.cos(angles[k]);
        const s = Math.sin(angles[k]);
        const along = j === 0 ? s0 : s1;
        barrelPlace(target, c * radius, s * radius, along, -c, -s, 0, roundFromWall(angles[k]), alongAt(along));
    });
}

/**
 * A face of the barrel vault across its passage at `at` (from the middle of its cell), facing `dir` along it (±1):
 * tiled like the walls, from the walls and the ceiling in to the arch, where the lip rounds over from it onto the
 * underside.
 */
function barrelFace(tiles, at, dir) {
    const { radius, middle, angles } = barrel.shape;
    const inner = at - dir * LIP_RADIUS;
    tiles.patch(angles.length - 1, LIP_STEPS, (k, m, target) => {
        const c = Math.cos(angles[k]);
        const s = Math.sin(angles[k]);
        // A quarter of a circle, or near the walls, where the lip dies away, of a flattened one (an ellipse).
        const lip = lipAt(angles[k]);
        const bend = (m / LIP_STEPS) * (Math.PI / 2);
        const r = radius + lip * (1 - Math.cos(bend));
        const inward = LIP_RADIUS * Math.cos(bend);
        const forward = lip * Math.sin(bend);
        const length = Math.hypot(inward, forward);
        barrelPlace(target, c * r, s * r, inner + dir * LIP_RADIUS * Math.sin(bend), (-c * inward) / length, (-s * inward) / length, (dir * forward) / length,
            roundFromWall(angles[k]), alongAt(inner) + dir * LIP_RADIUS * bend);
    });
    tiles.patch(angles.length - 1, 1, (k, j, target) => {
        const c = Math.cos(angles[k]);
        const s = Math.sin(angles[k]);
        // Out to the walls or the ceiling, whichever it meets first. (At the walls, both its ends are the same point.)
        const edge = Math.min(Math.abs(c) > 1e-9 ? PASSAGE_HALF / Math.abs(c) : Infinity, (WALL_HEIGHT - middle) / s);
        const r = j === 0 ? Math.min(radius + lipAt(angles[k]), edge) : edge;
        barrelPlace(target, c * r, s * r, at, 0, 0, dir, acrossAt(c * r), middle + s * r);
    });
}

/**
 * Fills `target` with a corner of the barrel vault: `across` its passage and `up` from the middle of its circle, `along`
 * it from the middle of its cell, with a normal (across, up, along) and texture coordinates.
 */
function barrelPlace(target, across, up, along, normalAcross, normalUp, normalAlong, u, v) {
    target[0] = barrel.x + (barrel.alongZ ? across : along);
    target[1] = barrel.shape.middle + up;
    target[2] = barrel.z + (barrel.alongZ ? along : across);
    target[3] = barrel.alongZ ? normalAcross : normalAlong;
    target[4] = normalUp;
    target[5] = barrel.alongZ ? normalAlong : normalAcross;
    target[6] = u;
    target[7] = v;
}

/** The chunk's own coordinate along the barrel vault's passage (so the tiles line up with the walls')... */
function alongAt(along) {
    return (barrel.alongZ ? barrel.z : barrel.x) + along;
}

/** ... and across it. */
function acrossAt(across) {
    return (barrel.alongZ ? barrel.x : barrel.z) + across;
}

// ---------------------------------------------------------------------------------------------- in the water

/** A lamp in a pool's wall: its lens, the ring round it, and its glow in the water. */
function poolLamp(lamps, glows, lamp, ox, oz) {
    const x = lamp.x - ox + lamp.nx * 0.002;
    const z = lamp.z - oz + lamp.nz * 0.002;
    disc(lamps, x, lamp.y, z, lamp.nx, 0, lamp.nz, 0.05, CHROME);
    disc(lamps, x + lamp.nx * 0.002, lamp.y, z + lamp.nz * 0.002, lamp.nx, 0, lamp.nz, 0.038, LENS);
    glows.spot(x + lamp.nx * 0.06, lamp.y, z + lamp.nz * 0.06, 0.42, 0, 0.9, 1);
}

/**
 * A ladder over a pool's edge: two chrome rails, up from the walkway, over the edge and down into the water, with
 * steps between them under it.
 */
function buildLadder(metal, store, ladder, ox, oz) {
    const r = 0.0085;
    const top = 0.21;
    const bottom = Math.max(ladder.depth * HEIGHT_STEP, -0.46);
    // (Standing in the walkway, whether it's dry or flooded.)
    const foot = (store.flatFloor(ladder.x - ladder.nx * 0.5, ladder.z - ladder.nz * 0.5) ?? 0) - 0.004;
    const back = -0.09;
    const front = 0.045;
    const alongX = ladder.nz !== 0;
    for (const side of [-0.075, 0.075]) {
        // Positions: `out` from the edge into the pool, `side` along it.
        const at = (out) => [ladder.x - ox + ladder.nx * out + (alongX ? side : 0), ladder.z - oz + ladder.nz * out + (alongX ? 0 : side)];
        const [bx, bz] = at(back);
        const [fx, fz] = at(front);
        metal.cylinder(1, bx, foot, bz, top, r, 8, CHROME);
        metal.cylinder(1, fx, bottom, fz, top, r, 8, CHROME);
        if (alongX) metal.cylinder(2, bx, top, Math.min(bz, fz), Math.max(bz, fz), r, 8, CHROME);
        else metal.cylinder(0, Math.min(bx, fx), top, bz, Math.max(bx, fx), r, 8, CHROME);
    }
    for (let y = -0.1; y > bottom + 0.05; y -= 0.12) {
        const cx = ladder.x - ox + ladder.nx * (front + 0.012);
        const cz = ladder.z - oz + ladder.nz * (front + 0.012);
        if (alongX) metal.box(cx - 0.075, y - 0.006, cz - 0.02, cx + 0.075, y, cz + 0.02, CHROME);
        else metal.box(cx - 0.02, y - 0.006, cz - 0.075, cx + 0.02, y, cz + 0.075, CHROME);
    }
}

/** Something floating: a lifebuoy, an inflatable ring or a beach ball, half in the water. */
function buildFloater(floats, floater, ox, oz) {
    const v = floater.variant;
    const x = floater.x - ox;
    const z = floater.z - oz;
    floats.drift(x, z, ((v >>> 8) & 255) / 255 * Math.PI * 2, (((v >>> 16) & 255) / 255 - 0.5) * 0.06);
    if (floater.kind === 2) {
        sphere(floats, x, 0.042, z, 0.055, (k) => BALL[k % BALL.length]);
        return;
    }
    const buoy = floater.kind === 0;
    const colour = RINGS[v % RINGS.length];
    torus(floats, x, buoy ? 0.012 : 0.008, z, buoy ? 0.1 : 0.11, buoy ? 0.03 : 0.036, (k) => (buoy ? LIFEBUOY[Math.floor(k / 6) % 2] : colour));
}

/** A ring lying flat round (x, y, z), in 24 pieces round, coloured piece by piece. */
function torus(builder, x, y, z, major, minor, colorOf) {
    const around = 24;
    const across = 8;
    for (let a = 0; a < around; a++) {
        for (let b = 0; b < across; b++) {
            const color = colorOf(a);
            const first = builder.vertexCount;
            for (const [da, db] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
                const u = ((a + da) / around) * Math.PI * 2;
                const w = ((b + db) / across) * Math.PI * 2;
                const nx = Math.cos(w) * Math.cos(u);
                const ny = Math.sin(w);
                const nz = Math.cos(w) * Math.sin(u);
                const r = major + minor * Math.cos(w);
                builder.vertex(x + r * Math.cos(u), y + minor * ny, z + r * Math.sin(u), nx, ny, nz, 0, 0, color);
            }
            // Outward-facing: u round y is clockwise seen from above, w round the tube upward from outside.
            builder.triangle(first, first + 2, first + 1);
            builder.triangle(first, first + 3, first + 2);
        }
    }
}

/** A ball at (x, y, z), its gores coloured one by one. */
function sphere(builder, x, y, z, r, colorOf) {
    const around = 18;
    const up = 10;
    for (let a = 0; a < around; a++) {
        for (let b = 0; b < up; b++) {
            const color = colorOf(Math.floor(a / 3));
            const first = builder.vertexCount;
            for (const [da, db] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
                const u = ((a + da) / around) * Math.PI * 2;
                const w = ((b + db) / up) * Math.PI - Math.PI / 2;
                const nx = Math.cos(w) * Math.cos(u);
                const ny = Math.sin(w);
                const nz = Math.cos(w) * Math.sin(u);
                builder.vertex(x + r * nx, y + r * ny, z + r * nz, nx, ny, nz, 0, 0, color);
            }
            builder.triangle(first, first + 2, first + 1);
            builder.triangle(first, first + 3, first + 2);
        }
    }
}

// ---------------------------------------------------------------------------------------------- building

/**
 * An upright quad from four corners in order round it, facing (nx, 0, nz) whichever way round they're given, tiled
 * like the walls: along it (by z if it faces across x, else by x) and up it, `scale` times finer (the mosaic). (Which
 * way round they go is worked out across its diagonals, so it's right where two corners are one point, as at the top
 * of a doorway's arch.)
 */
function upright(builder, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, nz, scale = 1) {
    const facing = ((cy - ay) * (dz - bz) - (cz - az) * (dy - by)) * nx + ((cx - ax) * (dy - by) - (cy - ay) * (dx - bx)) * nz;
    const acrossX = nx !== 0;
    const s = scale;
    builder.vertex(ax, ay, az, nx, 0, nz, (acrossX ? az : ax) * s, ay * s);
    if (facing >= 0) {
        builder.vertex(bx, by, bz, nx, 0, nz, (acrossX ? bz : bx) * s, by * s);
        builder.vertex(cx, cy, cz, nx, 0, nz, (acrossX ? cz : cx) * s, cy * s);
        builder.vertex(dx, dy, dz, nx, 0, nz, (acrossX ? dz : dx) * s, dy * s);
    } else {
        builder.vertex(dx, dy, dz, nx, 0, nz, (acrossX ? dz : dx) * s, dy * s);
        builder.vertex(cx, cy, cz, nx, 0, nz, (acrossX ? cz : cx) * s, cy * s);
        builder.vertex(bx, by, bz, nx, 0, nz, (acrossX ? bz : bx) * s, by * s);
    }
}

/**
 * An upright rectangle from (ax, az) to (bx, bz) and from y0 to y1, facing (nx, 0, nz), with a corner also at each of
 * the heights `atA` up its end at a and `atB` up its end at b: as a fan from its middle where it has any (see
 * flatPiece), so what meets it there partway up meets it corner to corner.
 */
function uprightCorners(builder, ax, az, bx, bz, y0, y1, atA, atB, nx, nz) {
    if (atA.length + atB.length === 0) {
        upright(builder, ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, nx, nz);
        return;
    }
    // Its edge all the way round: along the bottom, up end b, back along the top and down end a.
    const ring = [[ax, y0, az], [bx, y0, bz]];
    for (const y of [...atB].sort((p, q) => p - q)) ring.push([bx, y, bz]);
    ring.push([bx, y1, bz], [ax, y1, az]);
    for (const y of [...atA].sort((p, q) => q - p)) ring.push([ax, y, az]);
    const mx = (ax + bx) / 2;
    const my = (y0 + y1) / 2;
    const mz = (az + bz) / 2;
    for (let k = 0; k < ring.length; k++) {
        const [px, py, pz] = ring[k];
        const [qx, qy, qz] = ring[(k + 1) % ring.length];
        upright(builder, mx, my, mz, px, py, pz, qx, qy, qz, qx, qy, qz, nx, nz);
    }
}

/** A flat quad at height y from four corners (x, z) in order round it, facing up (1) or down (−1), tiled by x and z. */
function level(builder, ax, az, bx, bz, cx, cz, dx, dz, y, facing) {
    // Which way round the corners go, seen from above: (b − a) × (c − a) upward is counter-clockwise.
    const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    builder.vertex(ax, y, az, 0, facing, 0, ax, az);
    if (up * facing >= 0) {
        builder.vertex(bx, y, bz, 0, facing, 0, bx, bz);
        builder.vertex(cx, y, cz, 0, facing, 0, cx, cz);
        builder.vertex(dx, y, dz, 0, facing, 0, dx, dz);
    } else {
        builder.vertex(dx, y, dz, 0, facing, 0, dx, dz);
        builder.vertex(cx, y, cz, 0, facing, 0, cx, cz);
        builder.vertex(bx, y, bz, 0, facing, 0, bx, bz);
    }
}

/** A quad with a normal and texture coordinates at each corner, in order round it, facing the way they do. */
function smooth(builder, ax, ay, az, anx, any, anz, au, av, bx, by, bz, bnx, bny, bnz, bu, bv, cx, cy, cz, cnx, cny, cnz, cu, cv, dx, dy, dz, dnx, dny, dnz, du, dv) {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const facing = (uy * vz - uz * vy) * (anx + cnx) + (uz * vx - ux * vz) * (any + cny) + (ux * vy - uy * vx) * (anz + cnz);
    builder.vertex(ax, ay, az, anx, any, anz, au, av);
    if (facing >= 0) {
        builder.vertex(bx, by, bz, bnx, bny, bnz, bu, bv);
        builder.vertex(cx, cy, cz, cnx, cny, cnz, cu, cv);
        builder.vertex(dx, dy, dz, dnx, dny, dnz, du, dv);
    } else {
        builder.vertex(dx, dy, dz, dnx, dny, dnz, du, dv);
        builder.vertex(cx, cy, cz, cnx, cny, cnz, cu, cv);
        builder.vertex(bx, by, bz, bnx, bny, bnz, bu, bv);
    }
}

// Building one chunk runs start to finish, so one set of builders serves every chunk.
const tilesBuilder = new GeometryBuilder();
const waterBuilder = new GeometryBuilder();
const fixturesBuilder = new ColorBuilder();
const glowsBuilder = new ColorBuilder('glow');
const trimBuilder = new ColorBuilder();
const lampsBuilder = new ColorBuilder();
const metalBuilder = new ColorBuilder();
const floatsBuilder = new ColorBuilder('drift');
