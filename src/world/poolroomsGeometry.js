import { CHUNK_SIZE, DOOR_HEIGHT, DOOR_WIDTH, HALF_CHUNK, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { ColorBuilder } from './ColorBuilder.js';
import { GeometryBuilder } from './GeometryBuilder.js';
import { PANELS_PER_SIDE } from './generator.js';
import { DIRECTIONS, EDGE_DOOR, EDGE_NONE, EDGE_WALL, chunkCoord } from './grid.js';
import { HEIGHT_STEP, stairSteps } from './ground.js';
import { SKYLIGHT_HALF, SLOT_LAMP, SLOT_SKY, TILE, columnSpacing } from './poolrooms.js';
import { ZONE_BATHS, ZONE_DEEP } from './zones.js';

/*
 * What Level 37 has that Level 0 doesn't, as meshes for one chunk (see poolrooms.js for where it all goes):
 *
 * - the floor, tiled, at the height of each cell: the walkways, the flooded floors, the pools sunk into them and the
 *   stairs down, with the tiled walls of the pools wherever the floor drops (the level's walls go on down past the
 *   floor to meet them; see chunkGeometry.js), and a dark edge on every step;
 * - the water over all of it (one sheet at y = 0, left out over the dry walkways);
 * - the ceiling, tiled too, with the skylights let into it (a tiled well up to the glass) and round lights set in it;
 * - the round columns, and in the halls the arches between them, and an arch in every doorway;
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
/** How far the arches hang below the vaults either side of them: a rib down each. */
const RIB = 0.024;
/** How finely a vault is built: steps across each cell (a skylight's opening falls on them). */
const VAULT_STEPS = 4;
/** The columns and arches are in a finer mosaic than the walls: their texture coordinates are stretched by this. */
const MOSAIC = 1.6;
/** The round portals down the narrow passages: their radius, the height of their middle, and their depth. */
const PORTAL_RADIUS = 0.5 - WALL_THICKNESS / 2;
const PORTAL_MIDDLE = 0.42;
const PORTAL_DEPTH = 0.2;
const PORTAL_SIDES = 12;
/** An arch fills the top of every doorway, springing from halfway up it. */
const DOOR_RADIUS = DOOR_WIDTH / 2;
const DOOR_SPRING = DOOR_HEIGHT - DOOR_RADIUS;
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
const LIFEBUOY = [0xd8331f, 0xf2f0ea];
const RINGS = [0xf2a7c3, 0x8fd3f0, 0xf7df7c, 0xb8e39a];
const BALL = [0xf2f0ea, 0xd8331f, 0xf2c230, 0x2f6fc4, 0xf2f0ea, 0x3aa35b];

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
    ceiling(tiles, fixtures, glows, chunk.lights, x0, z0, ox, oz, vaultsFor(store, chunk));
    columns(tiles, store, x0, z0, ox, oz);
    doorways(tiles, store, x0, z0, ox, oz);
    portals(tiles, store, chunk.lights, x0, z0, ox, oz);
    for (const lamp of data.lamps) poolLamp(lamps, glows, lamp, ox, oz);
    for (const ladder of data.ladders) buildLadder(metal, ladder, ox, oz);
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
// from 0 at its low end (in x or z) to 1. Two of these, one each side of an edge, and space for every step.
const profileA = new Float32Array(3 * 64);
const profileB = new Float32Array(3 * 64);
const breaks = new Float32Array(130);

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
    for (let i = 0; i < N; i++) {
        const x = x0 + i;
        const lx = x - ox;
        // Runs along z of flat floor at one height, and of water.
        let runStart = -1;
        let runHeight = 0;
        let waterStart = -1;
        for (let j = 0; j <= N; j++) {
            const z = z0 + j;
            let flat = null;
            let wet = false;
            if (j < N) {
                readCell(store, x, z);
                flat = cellStair === 0 ? cellHeight : null;
                wet = cellStair !== 0 || cellHeight < 0;
                if (cellStair !== 0) stair(tiles, trim, lx, z - oz);
            }
            if (runStart >= 0 && flat !== runHeight) {
                flatTop(tiles, lx - 0.5, lx + 0.5, z0 + runStart - 0.5 - oz, z - 0.5 - oz, runHeight * HEIGHT_STEP);
                runStart = -1;
            }
            if (flat !== null && runStart < 0) {
                runStart = j;
                runHeight = flat;
            }
            if (waterStart >= 0 && !wet) {
                flatTop(water, lx - 0.5, lx + 0.5, z0 + waterStart - 0.5 - oz, z - 0.5 - oz, 0);
                waterStart = -1;
            }
            if (wet && waterStart < 0) waterStart = j;
        }
    }
    // Where the floor steps down across an edge.
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            for (const side of [0, 2]) {
                // A wall on the edge hides it (the wall goes down to the bottom of the deepest pool).
                if (store.edge(x, z, side === 0 ? 0 : 1) === EDGE_WALL) continue;
                const [dx, dz] = DIRECTIONS[side];
                readCell(store, x, z);
                const a = profile(side, profileA);
                readCell(store, x + dx, z + dz);
                const b = profile(side ^ 1, profileB);
                if (side === 0) stepFaces(tiles, true, x + 0.5 - ox, z - 0.5 - oz, a, b);
                else stepFaces(tiles, false, z + 0.5 - oz, x - 0.5 - ox, a, b);
            }
        }
    }
}

/**
 * The faces where the floor either side of an edge is at different heights, facing the lower side. The edge runs
 * along z (at x = `plane`) if `acrossX`, else along x (at z = `plane`), from `start` for one unit.
 */
function stepFaces(tiles, acrossX, plane, start, countA, countB) {
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
        if (acrossX) upright(tiles, plane, low, s0, plane, low, s1, plane, high, s1, plane, high, s0, facing, 0);
        else upright(tiles, s0, low, plane, s1, low, plane, s1, high, plane, s0, high, plane, 0, facing);
    }
}

/** A stair (the cell just read, at lx, lz): its steps, the risers between them, and a dark tile on each edge. */
function stair(tiles, trim, lx, lz) {
    const down = cellStair - 1;
    const [dx, dz] = DIRECTIONS[down];
    const low = cellHeight * HEIGHT_STEP;
    const top = cellTop * HEIGHT_STEP;
    const drop = top - low;
    const n = stairSteps(drop);
    // Along the stair: s from 0 (top edge) to 1 (bottom edge), in world terms.
    const along = (s) => -0.5 + s;
    for (let k = 0; k < n; k++) {
        const h = top - (drop * (k + 1)) / n;
        const s0 = along(k / n);
        const s1 = along((k + 1) / n);
        // The tread: across the whole cell, from s0 to s1 down the stair.
        if (dx !== 0) flatTop(tiles, lx + dx * s0, lx + dx * s1, lz - 0.5, lz + 0.5, h);
        else flatTop(tiles, lx - 0.5, lx + 0.5, lz + dz * s0, lz + dz * s1, h);
        if (k < n - 1) {
            // The riser down to the next step, facing down the stair.
            const next = top - (drop * (k + 2)) / n;
            if (dx !== 0) upright(tiles, lx + dx * s1, next, lz - 0.5, lx + dx * s1, next, lz + 0.5, lx + dx * s1, h, lz + 0.5, lx + dx * s1, h, lz - 0.5, dx, 0);
            else upright(tiles, lx - 0.5, next, lz + dz * s1, lx + 0.5, next, lz + dz * s1, lx + 0.5, h, lz + dz * s1, lx - 0.5, h, lz + dz * s1, 0, dz);
            // The dark edge along the front of the step.
            const e0 = along((k + 1) / n - 0.035);
            const y = h + 0.0009;
            if (dx !== 0) colouredTop(trim, lx + dx * e0, lx + dx * s1, lz - 0.5, lz + 0.5, y, NOSING);
            else colouredTop(trim, lx - 0.5, lx + 0.5, lz + dz * e0, lz + dz * s1, y, NOSING);
        }
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
 * round it and rises to the ceiling in the middle, in two curves crossing, with the skylights cut through it.
 */
function ceiling(tiles, fixtures, glows, lights, x0, z0, ox, oz, vaults) {
    const slot = (i, j) => ((i & 1) && (j & 1) ? lights[(((i - 1) >> 1) * PANELS_PER_SIDE + ((j - 1) >> 1)) * 4 + 3] : 0);
    const y = WALL_HEIGHT;
    for (let i = 0; i < N; i++) {
        const lx = x0 + i - ox;
        let runStart = -1;
        for (let j = 0; j <= N; j++) {
            const bay = j < N && vaults ? vaults.bayOf(x0 + i, z0 + j) : null;
            const sky = j < N && slot(i, j) === SLOT_SKY;
            const plain = j < N && !sky && !bay;
            if (runStart >= 0 && !plain) {
                underside(tiles, lx - 0.5, lx + 0.5, z0 + runStart - 0.5 - oz, z0 + j - 0.5 - oz, y);
                runStart = -1;
            }
            if (plain && runStart < 0) runStart = j;
            if (j === N) continue;
            const lz = z0 + j - oz;
            const kind = slot(i, j);
            if (bay) vaultCell(tiles, vaults, bay, x0 + i, z0 + j, ox, oz, kind === SLOT_SKY);
            if (kind === SLOT_SKY) skylight(tiles, fixtures, glows, lx, lz, bay ? (dx, dz) => vaults.height(bay, x0 + i + dx, z0 + j + dz) : null);
            else if (kind === SLOT_LAMP && !bay) ceilingLight(fixtures, glows, lx, lz);
        }
    }
}

/**
 * The vaults over a hall's bays, for a chunk of one (or null): the bay each cell is in, if it has one (four columns
 * round it, with nothing between them, so an arch on every side), and the height of the vault anywhere in it: the
 * curve of the arches (archCurve) across it one way and the other, whichever is higher, so the two cross along its
 * diagonals and come down into the columns.
 */
function vaultsFor(store, chunk) {
    const zone = chunk.zone;
    if (zone.type !== ZONE_BATHS && zone.type !== ZONE_DEEP) return null;
    const s = columnSpacing(zone);
    const offset = (zone.variant >>> 8) % s;
    const half = s / 2 - COLUMN_RADIUS * 0.7;
    const bays = new Map();
    const arc = arcLengths(half);
    const curveAt = (d) => (Math.abs(d) >= half ? [ARCH_SPRING, 0] : archCurve(d / half, half));
    return {
        half,
        /** The middle of the bay cell (x, z) is in, or null if it has no vault. */
        bayOf(x, z) {
            // The bay's columns stand on the corners of cells a and a + s (and c and c + s): see placeColumns.
            const a = x - 1 - mod(x - 1 - offset, s);
            const c = z - 1 - mod(z - 1 - offset, s);
            const key = a * 65536 + c;
            let bay = bays.get(key);
            if (bay === undefined) {
                bay = bayStands(store, a, c, s) ? [a + 0.5 + s / 2, c + 0.5 + s / 2] : null;
                bays.set(key, bay);
            }
            return bay;
        },
        height(bay, x, z) {
            return Math.max(curveAt(x - bay[0])[0], curveAt(z - bay[1])[0]);
        },
        /** Height, slopes (the higher curve's; the other's is 0), and texture along it, at (x, z). */
        sample(bay, x, z, out) {
            const dx = x - bay[0];
            const dz = z - bay[1];
            const [yx, sx] = curveAt(dx);
            const [yz, sz] = curveAt(dz);
            out.alongX = yx >= yz;
            out.y = Math.max(yx, yz);
            out.slopeX = sx;
            out.slopeZ = sz;
            out.arcX = arc(dx);
            out.arcZ = arc(dz);
        },
    };
}

/** Whether the bay with columns on the corners of cells (a, c) and (a + s, c + s) has them all, and nothing in it. */
function bayStands(store, a, c, s) {
    if (!store.pillar(a, c) || !store.pillar(a + s, c) || !store.pillar(a, c + s) || !store.pillar(a + s, c + s)) return false;
    for (let x = a + 1; x <= a + s; x++) {
        for (let z = c; z <= c + s; z++) if (store.edge(x, z, 1) !== EDGE_NONE) return false;
    }
    for (let z = c + 1; z <= c + s; z++) {
        for (let x = a; x <= a + s; x++) if (store.edge(x, z, 0) !== EDGE_NONE) return false;
    }
    return true;
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
const vaultPoint = { alongX: true, y: 0, slopeX: 0, slopeZ: 0, arcX: 0, arcZ: 0 };
const vaultCorners = new Float32Array(4 * 8);

/**
 * One cell of a vault (see vaultsFor), in VAULT_STEPS × VAULT_STEPS pieces facing down, each lit and tiled along
 * whichever of the two curves it's on. The curves cross along the bay's diagonals, which run corner to corner
 * through the pieces they cross: those pieces are split along that line, a half on each curve, so the groin is a
 * clean edge (a whole piece on one curve would cut it into steps). With a skylight, the middle is left open for its
 * well.
 */
function vaultCell(tiles, vaults, bay, x, z, ox, oz, sky) {
    const n = VAULT_STEPS;
    const c = vaultCorners;
    for (let p = 0; p < n; p++) {
        for (let q = 0; q < n; q++) {
            if (sky && p > 0 && p < n - 1 && q > 0 && q < n - 1) continue;
            const xa = x - 0.5 + p / n;
            const za = z - 0.5 + q / n;
            const xb = xa + 1 / n;
            const zb = za + 1 / n;
            const dx = xa + 0.5 / n - bay[0];
            const dz = za + 0.5 / n - bay[1];
            if (Math.abs(Math.abs(dx) - Math.abs(dz)) < 1e-6) {
                // On the groin: it runs from (xa, za) to (xb, zb), or from (xb, za) to (xa, zb).
                const rising = dx * dz > 0;
                const [ex, ez, fx, fz] = rising ? [xa, za, xb, zb] : [xb, za, xa, zb];
                for (const [gx, gz] of rising ? [[xb, za], [xa, zb]] : [[xa, za], [xb, zb]]) {
                    // Which curve this half is on: the one higher at its middle.
                    vaults.sample(bay, (ex + fx + gx) / 3, (ez + fz + gz) / 3, vaultPoint);
                    const alongX = vaultPoint.alongX;
                    vaultCorner(vaults, bay, ex, ez, alongX, ox, oz, 0);
                    vaultCorner(vaults, bay, gx, gz, alongX, ox, oz, 8);
                    vaultCorner(vaults, bay, fx, fz, alongX, ox, oz, 16);
                    vaultCorner(vaults, bay, fx, fz, alongX, ox, oz, 24);
                    smooth(tiles, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], c[12], c[13], c[14], c[15],
                        c[16], c[17], c[18], c[19], c[20], c[21], c[22], c[23], c[24], c[25], c[26], c[27], c[28], c[29], c[30], c[31]);
                }
                continue;
            }
            // Which curve this piece is on: the one higher at its middle.
            vaults.sample(bay, xa + 0.5 / n, za + 0.5 / n, vaultPoint);
            const alongX = vaultPoint.alongX;
            vaultCorner(vaults, bay, xa, za, alongX, ox, oz, 0);
            vaultCorner(vaults, bay, xb, za, alongX, ox, oz, 8);
            vaultCorner(vaults, bay, xb, zb, alongX, ox, oz, 16);
            vaultCorner(vaults, bay, xa, zb, alongX, ox, oz, 24);
            smooth(tiles, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], c[12], c[13], c[14], c[15],
                c[16], c[17], c[18], c[19], c[20], c[21], c[22], c[23], c[24], c[25], c[26], c[27], c[28], c[29], c[30], c[31]);
        }
    }
}

/** A corner of a piece of vault at (cx, cz), on the curve along x or along z: into vaultCorners from k. */
function vaultCorner(vaults, bay, cx, cz, alongX, ox, oz, k) {
    vaults.sample(bay, cx, cz, vaultPoint);
    const sx = alongX ? vaultPoint.slopeX : 0;
    const sz = alongX ? 0 : vaultPoint.slopeZ;
    const length = Math.hypot(sx, 1, sz);
    vaultCorners[k] = cx - ox;
    vaultCorners[k + 1] = vaultPoint.y;
    vaultCorners[k + 2] = cz - oz;
    vaultCorners[k + 3] = sx / length;
    vaultCorners[k + 4] = -1 / length;
    vaultCorners[k + 5] = sz / length;
    vaultCorners[k + 6] = (alongX ? vaultPoint.arcX : cx - ox) * MOSAIC;
    vaultCorners[k + 7] = (alongX ? cz - oz : vaultPoint.arcZ) * MOSAIC;
}

/** A flat piece of ceiling facing down, from x0..x1, z0..z1, tiled by x and z. */
function underside(builder, x0, x1, z0, z1, y) {
    builder.quad(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, 0, -1, 0, x0, z0, x1, z1);
}

/**
 * A skylight over (lx, lz): the ceiling round the opening (unless it's in a vault, which leaves its own opening), the
 * well up from it (from the vault, `under` gives the vault's height at a point from the middle), the glass, and the
 * glazing bars.
 */
function skylight(tiles, fixtures, glows, lx, lz, under) {
    const h = SKYLIGHT_HALF;
    const y = WALL_HEIGHT;
    if (!under) {
        underside(tiles, lx - 0.5, lx - h, lz - 0.5, lz + 0.5, y);
        underside(tiles, lx + h, lx + 0.5, lz - 0.5, lz + 0.5, y);
        underside(tiles, lx - h, lx + h, lz - 0.5, lz - h, y);
        underside(tiles, lx - h, lx + h, lz + h, lz + 0.5, y);
    }
    // The well, facing in: down its sides in two pieces each (a vault's height changes along them).
    const bottom = (dx, dz) => (under ? under(dx, dz) : y);
    for (const [sx, sz, nx, nz] of [[-h, 0, 1, 0], [h, 0, -1, 0], [0, -h, 0, 1], [0, h, 0, -1]]) {
        for (const [a0, a1] of [[-h, 0], [0, h]]) {
            const [ax, az] = sx !== 0 ? [sx, a0] : [a0, sz];
            const [bx, bz] = sx !== 0 ? [sx, a1] : [a1, sz];
            upright(tiles, lx + ax, bottom(ax, az), lz + az, lx + bx, bottom(bx, bz), lz + bz, lx + bx, SKY_TOP, lz + bz, lx + ax, SKY_TOP, lz + az, nx, nz);
        }
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
function columns(tiles, store, x0, z0, ox, oz) {
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
            // Arches to the next column along +x and +z, up to three cells away.
            for (const alongX of [true, false]) {
                for (let step = 1; step <= 3; step++) {
                    const nx = alongX ? x + step : x;
                    const nz = alongX ? z : z + step;
                    // The edge the arch passes over (the line between cells z and z + 1, or x and x + 1).
                    if (store.edge(alongX ? nx : x, alongX ? z : nz, alongX ? 1 : 0) !== EDGE_NONE) break;
                    if (!store.pillar(nx, nz)) continue;
                    if (step >= 2) arch(tiles, alongX, alongX ? cz : cx, (alongX ? cx : cz) + COLUMN_RADIUS * 0.7, (alongX ? cx : cz) + step - COLUMN_RADIUS * 0.7);
                    break;
                }
            }
        }
    }
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
 * An arch from `from` to `to` along x (at z = `at`) or along z (at x = `at`): springing straight up from the columns
 * at ARCH_SPRING, and rising to the ceiling in a tall curve that comes to a soft point at the top, with its faces up to
 * the ceiling either side.
 */
function arch(tiles, alongX, at, from, to) {
    const half = (to - from) / 2;
    const middle = (from + to) / 2;
    // Hanging a little below the vaults either side, as a rib.
    const curve = (u) => {
        const [y, slope] = archCurve(u, half);
        return [y - RIB, slope];
    };
    const place = (along, across) => (alongX ? [along, at + across] : [at + across, along]);
    const u0 = (k) => -Math.cos((k / ARCH_SEGMENTS) * Math.PI);
    for (let k = 0; k < ARCH_SEGMENTS; k++) {
        const ua = u0(k);
        const ub = u0(k + 1);
        const [ya, sa] = curve(ua);
        const [yb, sb] = curve(ub);
        const aa = middle + ua * half;
        const ab = middle + ub * half;
        // Underneath: facing down, and in towards the middle.
        const la = Math.hypot(sa, 1);
        const lb = Math.hypot(sb, 1);
        const [na, nya] = [sa / la, -1 / la];
        const [nb, nyb] = [sb / lb, -1 / lb];
        const [p0x, p0z] = place(aa, -ARCH_HALF);
        const [p1x, p1z] = place(ab, -ARCH_HALF);
        const [q1x, q1z] = place(ab, ARCH_HALF);
        const [q0x, q0z] = place(aa, ARCH_HALF);
        smooth(tiles,
            p0x, ya, p0z, alongX ? na : 0, nya, alongX ? 0 : na, aa * MOSAIC, -ARCH_HALF * MOSAIC,
            p1x, yb, p1z, alongX ? nb : 0, nyb, alongX ? 0 : nb, ab * MOSAIC, -ARCH_HALF * MOSAIC,
            q1x, yb, q1z, alongX ? nb : 0, nyb, alongX ? 0 : nb, ab * MOSAIC, ARCH_HALF * MOSAIC,
            q0x, ya, q0z, alongX ? na : 0, nya, alongX ? 0 : na, aa * MOSAIC, ARCH_HALF * MOSAIC);
        // Its two faces, from the curve up to the ceiling.
        for (const side of [-1, 1]) {
            const [ax, az] = place(aa, side * ARCH_HALF);
            const [bx, bz] = place(ab, side * ARCH_HALF);
            upright(tiles, ax, ya, az, bx, yb, bz, bx, WALL_HEIGHT, bz, ax, WALL_HEIGHT, az, alongX ? 0 : side, alongX ? side : 0, MOSAIC);
        }
    }
}

/**
 * The narrow passages: every cell with a wall down both its sides has a round portal in the middle of it, the circle
 * as wide as the passage and half under the water, so a passage is a line of them going away into the dark. (Not
 * under a skylight, and not in a pool.)
 */
function portals(tiles, store, lights, x0, z0, ox, oz) {
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            if ((i & 1) && (j & 1) && lights[(((i - 1) >> 1) * PANELS_PER_SIDE + ((j - 1) >> 1)) * 4 + 3] === SLOT_SKY) continue;
            readCell(store, x, z);
            if (cellStair !== 0 || cellHeight < -8) continue;
            const floor = cellHeight * HEIGHT_STEP;
            const wallsX = store.edge(x - 1, z, 0) === EDGE_WALL && store.edge(x, z, 0) === EDGE_WALL;
            const wallsZ = store.edge(x, z - 1, 1) === EDGE_WALL && store.edge(x, z, 1) === EDGE_WALL;
            if (wallsX === wallsZ) continue;
            // The passage runs along z between walls across x, or along x.
            portal(tiles, wallsX, x - ox, z - oz, floor);
        }
    }
}

/**
 * One round portal in a passage at (lx, lz), running along z if `alongZ` (else along x): the frame between the circle
 * and the passage's walls, floor and ceiling, front and back, and the curved inside of it.
 */
function portal(tiles, alongZ, lx, lz, floor) {
    const R = PORTAL_RADIUS;
    const cy = PORTAL_MIDDLE;
    const half = 0.5 - WALL_THICKNESS / 2;
    const bottom = floor - 0.01;
    // Where (across, y) is, at `along` from the portal's middle.
    const at = (across, y, along) => (alongZ ? [lx + across, y, lz + along] : [lx + along, y, lz + across]);
    // The edge of the passage all the way round, as (across, y), from the bottom left, round by the ceiling, and
    // where on the circle each of its points is joined to (the same angle from the middle).
    const edge = [];
    const sides = PORTAL_SIDES;
    for (let k = 0; k < sides; k++) edge.push([-half, bottom + ((WALL_HEIGHT - bottom) * k) / sides]);
    for (let k = 0; k < sides; k++) edge.push([-half + (2 * half * k) / sides, WALL_HEIGHT]);
    for (let k = 0; k < sides; k++) edge.push([half, WALL_HEIGHT - ((WALL_HEIGHT - bottom) * k) / sides]);
    for (let k = 0; k < sides; k++) edge.push([half - (2 * half * k) / sides, bottom]);
    const onCircle = edge.map(([a, y]) => {
        const angle = Math.atan2(y - cy, a);
        return [Math.cos(angle) * R, cy + Math.sin(angle) * R, angle];
    });
    const d = PORTAL_DEPTH / 2;
    for (let k = 0; k < edge.length; k++) {
        const n = (k + 1) % edge.length;
        const [ea, ey] = edge[k];
        const [fa, fy] = edge[n];
        const [ca, cyy] = onCircle[k];
        const [da, dy] = onCircle[n];
        // The frame, front and back.
        for (const face of [-1, 1]) {
            const [ax, ay, az] = at(ea, ey, face * d);
            const [bx, by, bz] = at(fa, fy, face * d);
            const [cx, cy2, cz] = at(da, dy, face * d);
            const [dx, dy2, dz] = at(ca, cyy, face * d);
            upright(tiles, ax, ay, az, bx, by, bz, cx, cy2, cz, dx, dy2, dz, alongZ ? 0 : face, alongZ ? face : 0);
        }
        // The inside of the circle, facing in.
        let a0 = onCircle[k][2];
        let a1 = onCircle[n][2];
        if (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
        if (a0 - a1 > Math.PI) a0 -= Math.PI * 2;
        const [p0x, p0y, p0z] = at(ca, cyy, -d);
        const [p1x, p1y, p1z] = at(da, dy, -d);
        const [q1x, q1y, q1z] = at(da, dy, d);
        const [q0x, q0y, q0z] = at(ca, cyy, d);
        const inward = (a) => (alongZ ? [-Math.cos(a), -Math.sin(a), 0] : [0, -Math.sin(a), -Math.cos(a)]);
        const [m0x, m0y, m0z] = inward(a0);
        const [m1x, m1y, m1z] = inward(a1);
        smooth(tiles,
            p0x, p0y, p0z, m0x, m0y, m0z, a0 * R * MOSAIC, -d * MOSAIC,
            p1x, p1y, p1z, m1x, m1y, m1z, a1 * R * MOSAIC, -d * MOSAIC,
            q1x, q1y, q1z, m1x, m1y, m1z, a1 * R * MOSAIC, d * MOSAIC,
            q0x, q0y, q0z, m0x, m0y, m0z, a0 * R * MOSAIC, d * MOSAIC);
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
        // The faces either side, from the curve up to the top of the doorway.
        for (const side of [-1, 1]) {
            const [ax, , az] = place(a0, 0, side * HALF_THICKNESS);
            const [bx, , bz] = place(a1, 0, side * HALF_THICKNESS);
            upright(tiles, ax, y0, az, bx, y1, bz, bx, DOOR_HEIGHT, bz, ax, DOOR_HEIGHT, az, axis === 0 ? side : 0, axis === 0 ? 0 : side);
        }
    }
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
function buildLadder(metal, ladder, ox, oz) {
    const r = 0.0085;
    const top = 0.21;
    const bottom = Math.max(ladder.depth * HEIGHT_STEP, -0.46);
    const back = -0.09;
    const front = 0.045;
    const alongX = ladder.nz !== 0;
    for (const side of [-0.075, 0.075]) {
        // Positions: `out` from the edge into the pool, `side` along it.
        const at = (out) => [ladder.x - ox + ladder.nx * out + (alongX ? side : 0), ladder.z - oz + ladder.nz * out + (alongX ? 0 : side)];
        const [bx, bz] = at(back);
        const [fx, fz] = at(front);
        metal.cylinder(1, bx, 0.012, bz, top, r, 8, CHROME);
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
 * like the walls: along it (by z if it faces across x, else by x) and up it, `scale` times finer (the mosaic).
 */
function upright(builder, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, nz, scale = 1) {
    const facing = ((by - ay) * (cz - az) - (bz - az) * (cy - ay)) * nx + ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * nz;
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

function mod(a, b) {
    return ((a % b) + b) % b;
}
