import { CHUNK_SIZE, HALF_CHUNK, PANEL_HALF_X, PANEL_HALF_Z, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { PROP_BALLOONS, PROP_CAKE, PROP_CHAIR, PROP_GUEST, PROP_HAT, PROP_PRESENTS } from './decorations.js';
import { PANELS_PER_SIDE, borderLine } from './generator.js';
import { DIRECTIONS, EDGE_NONE, EDGE_WALL, cellCoord, chunkKey } from './grid.js';
import { ventAt } from './outlets.js';
import { peelTop } from './peels.js';
import { hashFloat, hashInts, mulberry32 } from './random.js';
import { ZONE_HALLS, ZONE_MAZE, ZONE_OPEN, ZONE_PILLARS, ZONE_ROOMS } from './zones.js';

/*
 * Level Fun, the level dressed for a party. The Konami code toggles it, and a tape's way out leads here.
 *
 * Walls don't change. The dressing is laid over them per chunk from the seed and chunk coordinates, so the same
 * place always comes out the same. It covers gels over the lights, mirror balls, balloons, streamers, bunting,
 * cakes, presents, hats, =) scrawls and the odd guest. The spawn room gets a banner and extra decoration.
 *
 * This file only decides where things go. partyGeometry.js builds them, PartyLayer.js animates them, and
 * materials.js does the wallpaper, carpet confetti, gel colors and mirror ball light.
 */

const N = CHUNK_SIZE;
const HALF_THICKNESS = WALL_THICKNESS / 2;

/** Panel's fourth byte in ChunkData.lights outside Level Fun (no gel). */
export const GEL_NONE = 255;
/** Level Fun panel with no gel, left warm white. */
export const GEL_WHITE = 254;
/**
 * Bytes below GEL_HUES are a fixed hue, byte / GEL_HUES around the wheel. The next GEL_CYCLING values slowly cycle
 * color (see panelTint in materials.js), each starting (byte - GEL_HUES) / GEL_CYCLING of the way through.
 */
export const GEL_HUES = 192;
export const GEL_CYCLING = 32;

/** Colors for balloons, streamers, flags and confetti. */
export const PARTY_PALETTE = [0xe0303f, 0xf5892a, 0xf4cc2e, 0x3fae4f, 0x2f6fd6, 0x8a4fcf, 0xf0609e, 0x2cb8b0];

export const PARTY_CAKE = 0; // table with a cloth, birthday cake, plates and cups
export const PARTY_PRESENTS = 1; // one to three wrapped presents
export const PARTY_HAT = 2; // dropped party hat
export const PARTY_WEIGHT = 3; // weight a bunch of balloons is tied to

/** Level Fun props for edit mode (see PROP_CAKE in decorations.js). The guest only once it's been found. */
export const PARTY_DECORATIONS = [PROP_CAKE, PROP_PRESENTS, PROP_HAT, PROP_BALLOONS, PROP_GUEST];
/** Guests pop when you get this close (see PartyLayer.js). */
export const GUEST_POP = 0.42;

export const PARTY_COLORS = PARTY_PALETTE.length;
/** Balloon radius across and up at size 1 (about 30 cm across). */
export const BALLOON_RADIUS = 0.055;
export const BALLOON_HEIGHT = 0.066;
// Max reach of a balloon from its center at size 1, across and up, including its lean (see addBalloon in
// partyGeometry.js). DRIFT and DRIFT_UP are the max drift (see VERTEX_SWAY in materials.js).
const BALLOON_REACH = 0.057;
const BALLOON_REACH_UP = 0.067;
const DRIFT = 0.019;
const DRIFT_UP = 0.0066;
// Min gap between balloons, and max passes to push them apart (see settleBalloons). Plenty for the few in a cell.
const BALLOON_GAP = 0.004;
const SPREAD_PASSES = 200;
// How far a string strays from its line when bowed or curled, and how far a loose balloon's string end swings
// (see addBalloon in partyGeometry.js).
const STRING_REACH = 0.014;
const TAIL_SWING = 0.022;
/** Height of a streamer's ends on the walls. */
export const STREAMER_HEIGHT = WALL_HEIGHT - 0.022;
// How far a streamer's twisted strands reach from its center line, and a ribbon's curls and swinging end from its
// own (see addStreamer and addRibbon in partyGeometry.js). SAMPLE is the spacing of points checked along a
// streamer for clearance.
const STREAMER_REACH = 0.015;
const RIBBON_REACH = 0.034;
const SAMPLE = 0.02;
// Bunting end height and flag width. Flags hang 1.15x their width (see addBunting).
const BUNTING_HEIGHT = 0.95;
const BUNTING_FLAG = 0.055;
// Top of a guest's hat, and how far its head reaches out from its center (see createGuestGeometry).
const GUEST_TOP = 0.71;
const GUEST_HEAD = 0.07;
/** Number of =) styles drawn on walls. */
export const SCRAWL_STYLES = 3;
/** Banner in the spawn room. */
export const BANNER_TEXT = 'WELCOME TO LEVEL FUN =)';
/** Mirror ball center height, radius, and light range. */
export const DISCO_HEIGHT = 0.79;
export const DISCO_RADIUS = 0.066;
const DISCO_RANGE = 3;
// Spawn room cells (see stampSpawnRoom in generator.js). Only firstRoom dresses it. FIRST_ROOM_INSIDE is its
// inner wall faces, which its balloons stay within.
const SPAWN_ROOM = { x0: -3, x1: 3, z0: -3, z1: 2 };
const FIRST_ROOM_INSIDE = [-2.5 + HALF_THICKNESS, -2.5 + HALF_THICKNESS, 2.5 - HALF_THICKNESS, 1.5 - HALF_THICKNESS];
// Elsewhere a balloon stays within this of its cell's center, clear of the walls and any corner pillars.
const CELL_ROOM = 0.41;
// Bottom of a light panel (see createFixtureGeometry in chunkGeometry.js), with a little margin.
const PANEL_BOTTOM = WALL_HEIGHT - 0.015;
// Table against a wall: offset from the cell center, and its size.
const TABLE_OUT = 0.28;
export const TABLE_LENGTH = 0.34;
export const TABLE_DEPTH = 0.18;
const PRESENTS_HALF = 0.075;

/**
 * @typedef {object} PartyDressing A chunk's party dressing, in world coordinates.
 * @property {PartyThing[]} things On the floor.
 * @property {Balloon[]} balloons
 * @property {Streamer[]} streamers Crepe paper swags across a room.
 * @property {Ribbon[]} ribbons Curly ribbons hanging from the ceiling.
 * @property {Bunting[]} bunting Flags along a wall. The spawn room banner is one with letters.
 * @property {Scrawl[]} scrawls
 * @property {Disco[]} discos
 * @property {Guest[]} guests
 * @property {number[][]} boxes Player collision boxes as [minX, minZ, maxX, maxZ].
 */

/**
 * @typedef {object} PartyThing
 * @property {number} kind One of the PARTY_* constants.
 * @property {number} x
 * @property {number} z
 * @property {number} yaw Front faces +z at 0. A table's front is the side away from the wall.
 * @property {number} variant 32 bits for the details.
 */

/**
 * @typedef {object} Balloon
 * @property {number} x Center.
 * @property {number} y
 * @property {number} z
 * @property {number} color 0..PARTY_COLORS − 1
 * @property {number} size About 1.
 * @property {number} phase Picks its lean and how its string bows or curls.
 * @property {number} drift Drift phase. Shared within a bunch so they drift together and don't hit each other.
 * @property {{ x: number, y: number, z: number } | null} tie Where its string is tied. Null for a loose balloon
 *     up at the ceiling.
 * @property {number} tail How far a loose balloon's string hangs.
 */

/**
 * @typedef {object} Streamer
 * @property {number} ax One end, on a wall.
 * @property {number} az
 * @property {number} bx The other end.
 * @property {number} bz
 * @property {number} sag Drop at the middle.
 * @property {number[]} colors Colors of the two twisted strands.
 */

/**
 * @typedef {object} Ribbon
 * @property {number} x
 * @property {number} z
 * @property {number} length
 * @property {number} color
 * @property {number} phase
 */

/**
 * @typedef {object} Bunting
 * @property {number} ax One end, just off the wall.
 * @property {number} az
 * @property {number} bx The other end.
 * @property {number} bz
 * @property {number} nx Wall normal.
 * @property {number} nz
 * @property {number} y Height of the ends.
 * @property {number} sag
 * @property {number} flag Flag width.
 * @property {number} color First flag's color. The rest cycle through the palette from there.
 * @property {string | null} letters One per flag (a space leaves a gap), or null for plain flags.
 */

/**
 * @typedef {object} Scrawl
 * @property {number} x On the wall's face.
 * @property {number} y
 * @property {number} z
 * @property {number} nx Wall face normal.
 * @property {number} nz
 * @property {number} size
 * @property {number} angle Tilt from level.
 * @property {number} style 0..SCRAWL_STYLES − 1
 * @property {number} ink 0 black marker, 1 red crayon, 2 pink.
 */

/**
 * @typedef {object} Disco A mirror ball hanging from the ceiling.
 * @property {number} x
 * @property {number} y Center.
 * @property {number} z
 * @property {number} range Light range.
 * @property {number} phase Starting rotation.
 */

/**
 * @typedef {object} Guest A partygoer.
 * @property {number} x
 * @property {number} z
 * @property {number} yaw
 */

/**
 * Dresses a chunk for the party (sets `chunk.party`) and sets its light gels. Same world, walls and props always
 * give the same result.
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {import('./generator.js').ChunkData} chunk
 */
export function dressChunk(store, chunk) {
    // Nothing to dress outside a tape's walls.
    if (store.options.isVoid?.(chunk.cx, chunk.cz)) {
        chunk.party = null;
        return;
    }
    const seed = store.seed;
    setGels(seed, chunk);
    const dresser = new Dresser(store, chunk);
    if (chunk.cx === 0 && chunk.cz === 0) dresser.firstRoom();
    dresser.disco();
    dresser.table();
    dresser.presents();
    dresser.balloons();
    dresser.streamers();
    dresser.bunting();
    dresser.ribbons();
    dresser.hats();
    dresser.scrawls();
    // No guests in a tape's arena. It has its own thing in it.
    if (!store.options.isVoid) dresser.guests();
    dresser.clearRibbons();
    chunk.party = dresser.dressing;
}

/**
 * Edit-mode prop to party thing (see isPartyProp in decorations.js). A balloons prop becomes the weight, and
 * propBalloons adds the balloons.
 * @param {import('./decorations.js').Prop} prop
 * @returns {PartyThing & { y: number }}
 */
export function partyPropThing(prop) {
    return { kind: prop.type - PROP_CAKE, x: prop.x, z: prop.z, yaw: prop.yaw, variant: prop.variant, y: prop.y ?? 0 };
}

/**
 * Balloons for a balloons prop, seeded from its variant and rotated with it. They float at head height, above any
 * water the weight is sunk in.
 * @param {import('./decorations.js').Prop} prop
 * @returns {Balloon[]}
 */
export function propBalloons(prop) {
    if (prop.type !== PROP_BALLOONS) return [];
    const random = mulberry32(prop.variant);
    const count = 3 + Math.floor(random() * 3);
    const floor = prop.y ?? 0;
    const tie = { x: prop.x, y: floor + 0.022, z: prop.z };
    const cos = Math.cos(prop.yaw);
    const sin = Math.sin(prop.yaw);
    const start = random() * Math.PI * 2;
    const balloons = [];
    // Offsets from the weight, before rotating the bunch.
    const home = { x: 0, y: tie.y, z: 0 };
    for (let k = 0; k < count; k++) {
        const angle = start + (k / count) * Math.PI * 2 + random() * 0.4;
        const distance = 0.1 * (0.5 + random() * 0.5);
        balloons.push({
            x: Math.cos(angle) * distance,
            y: Math.max(floor, 0) + 0.6 + random() * 0.2,
            z: Math.sin(angle) * distance,
            color: Math.floor(random() * PARTY_COLORS),
            size: 0.9 + random() * 0.2,
            phase: random() * Math.PI * 2,
            drift: 0,
            tie: home,
            tail: 0,
        });
    }
    for (let pass = 0, moved = true; pass < SPREAD_PASSES && moved; pass++) {
        moved = false;
        for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) moved = inEachOthersWay(balloons[a], balloons[b], true, a + b) || moved;
    }
    for (const balloon of balloons) {
        const { x: lx, z: lz } = balloon;
        balloon.x = prop.x + cos * lx + sin * lz;
        balloon.z = prop.z + cos * lz - sin * lx;
        balloon.drift = balloons[0].phase;
        balloon.tie = tie;
    }
    return balloons;
}

/** Balloon's reach from its center along unit vector (ux, uy, uz). */
function reachAlong(balloon, ux, uy, uz) {
    return balloon.size * Math.sqrt(BALLOON_REACH * BALLOON_REACH * (ux * ux + uz * uz) + BALLOON_REACH_UP * BALLOON_REACH_UP * uy * uy);
}

/** How much closer than `gap` two balloons are at their nearest. 0 or less means they're clear. */
function shortfall(a, b, gap) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-9) return (a.size + b.size) * BALLOON_REACH_UP + gap;
    return reachAlong(a, dx / length, dy / length, dz / length) + reachAlong(b, dx / length, dy / length, dz / length) + gap - length;
}

/**
 * How far `other` intrudes on `balloon`'s string, as [shortfall, x, z] where (x, z) is the way to push it clear.
 * 0 or less means it's clear. A tied string runs from the tie up to the balloon. A loose one hangs from it.
 */
function onString(balloon, other, gap) {
    // Knot sits just under the balloon, leaning with it.
    const tie = balloon.tie;
    const under = (BALLOON_HEIGHT + 0.012) * balloon.size;
    const [lx, ly, lz] = tie ? [balloon.x - tie.x, balloon.y - tie.y, balloon.z - tie.z] : [0, 1, 0];
    const lean = Math.sqrt(lx * lx + ly * ly + lz * lz);
    const [kx, ky, kz] = [balloon.x - (lx / lean) * under, balloon.y - (ly / lean) * under, balloon.z - (lz / lean) * under];
    const [x0, y0, z0] = tie ? [tie.x, tie.y, tie.z] : [kx, ky - balloon.tail, kz];
    const [dx, dy, dz] = [kx - x0, ky - y0, kz - z0];
    const t = Math.min(Math.max(((other.x - x0) * dx + (other.y - y0) * dy + (other.z - z0) * dz) / (dx * dx + dy * dy + dz * dz), 0), 1);
    const [ox, oy, oz] = [other.x - (x0 + dx * t), other.y - (y0 + dy * t), other.z - (z0 + dz * t)];
    const d = Math.sqrt(ox * ox + oy * oy + oz * oz);
    const reach = d > 1e-9 ? reachAlong(other, ox / d, oy / d, oz / d) : BALLOON_REACH_UP * other.size;
    // A tied string drifts at most as much as the balloon (most near the knot). A loose one swings by TAIL_SWING.
    return [reach + STRING_REACH + (tie ? DRIFT : TAIL_SWING) + gap - d, ox, oz];
}

/**
 * True if two balloons overlap (or are closer than gapBetween allows) or one is in the way of the other's string.
 * With `move`, pushes them apart sideways and keeps their heights. `k` picks the direction when one is exactly
 * over the other.
 */
function inEachOthersWay(a, b, move, k) {
    if (Math.abs(b.x - a.x) > 0.5 || Math.abs(b.z - a.z) > 0.5) return false;
    const gap = gapBetween(a, b);
    let clash = false;
    // Pushes q along (x, z) by `by`. With p, each moves half and p goes the other way.
    const apart = (p, q, x, z, by) => {
        clash = true;
        if (!move) return;
        const length = Math.sqrt(x * x + z * z);
        const [ux, uz] = length > 1e-9 ? [x / length, z / length] : [Math.cos(k), Math.sin(k)];
        const share = p ? 0.5 : 1;
        if (p) {
            p.x -= ux * by * share;
            p.z -= uz * by * share;
        }
        q.x += ux * by * share;
        q.z += uz * by * share;
    };
    const short = shortfall(a, b, gap);
    if (short > 1e-9) apart(a, b, b.x - a.x, b.z - a.z, short);
    for (const [balloon, other] of [[a, b], [b, a]]) {
        const [by, x, z] = onString(balloon, other, gap);
        // Only the balloon in the way moves, off the string.
        if (by > 1e-9) apart(null, other, x, z, by);
    }
    return clash;
}

/**
 * Lowest point of any balloon over (x, z), including drift (see ChunkStore.headroomAt). Infinity if none.
 * @param {PartyDressing} dressing
 * @param {number} x
 * @param {number} z
 */
export function balloonsOver(dressing, x, z) {
    let lowest = Infinity;
    for (const balloon of dressing.balloons) {
        if (Math.hypot(balloon.x - x, balloon.z - z) > BALLOON_REACH * balloon.size + DRIFT) continue;
        lowest = Math.min(lowest, balloon.y - BALLOON_REACH_UP * balloon.size - DRIFT_UP);
    }
    return lowest;
}

/** Removes the party dressing and gels. */
export function undressChunk(chunk) {
    chunk.party = null;
    for (let k = 3; k < chunk.lights.length; k += 4) chunk.lights[k] = GEL_NONE;
}

/**
 * Sets the gel over each panel in the chunk. Some stay white, some cycle slowly, and the rest get mixed party colors
 * so no two rooms are lit quite the same.
 */
function setGels(seed, chunk) {
    const x0 = chunk.cx * N - HALF_CHUNK;
    const z0 = chunk.cz * N - HALF_CHUNK;
    for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
        for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
            const x = x0 + pi * 2 + 1;
            const z = z0 + pj * 2 + 1;
            chunk.lights[(pi * PANELS_PER_SIDE + pj) * 4 + 3] = gelAt(seed, x, z);
        }
    }
}

// Gel hues: reds, pinks, purples, blues and oranges. Greens, yellows and even cyan look sickly under the already
// yellow lights, so they're left out.
const GEL_COLORS = [0.985, 0.92, 0.85, 0.77, 0.69, 0.62, 0.57, 0.06, 0.1];

/** Gel for the panel above cell (x, z) in Level Fun (see GEL_*). */
export function gelAt(seed, x, z) {
    const roll = hashFloat(seed, 0xfe1, x, z);
    if (roll < 0.3) return GEL_WHITE;
    if (roll > 0.9) return GEL_HUES + Math.floor(hashFloat(seed, 0xfe2, x, z) * GEL_CYCLING);
    const pick = Math.floor(hashFloat(seed, 0xfe3, x, z) * GEL_COLORS.length);
    const hue = (GEL_COLORS[pick] + (hashFloat(seed, 0xfe4, x, z) - 0.5) * 0.04 + 1) % 1;
    return Math.min(Math.floor(hue * GEL_HUES), GEL_HUES - 1);
}

/** Dresses one chunk in a fixed order from its own random stream, so the level's generation isn't affected. */
class Dresser {
    /**
     * @param {import('./ChunkStore.js').ChunkStore} store
     * @param {import('./generator.js').ChunkData} chunk
     */
    constructor(store, chunk) {
        this.store = store;
        this.chunk = chunk;
        this.x0 = chunk.cx * N - HALF_CHUNK;
        this.z0 = chunk.cz * N - HALF_CHUNK;
        this.random = mulberry32(hashInts(store.seed, 0xf07, chunk.cx, chunk.cz));
        this.zone = chunk.zone.type;
        // West and south walls belong to the neighboring chunks. Read them from those chunks if loaded, otherwise
        // compute just the border line.
        const before = (dx, dz) => store.chunks.get(chunkKey(chunk.cx - dx, chunk.cz - dz));
        const westChunk = before(1, 0);
        const southChunk = before(0, 1);
        this.west = westChunk ? Uint8Array.from({ length: N }, (_, j) => westChunk.edgesX[(N - 1) * N + j]) : borderLine(store.seed, 0, chunk.cx, chunk.cz, store.options);
        this.south = southChunk ? Uint8Array.from({ length: N }, (_, i) => southChunk.edgesZ[i * N + N - 1]) : borderLine(store.seed, 1, chunk.cx, chunk.cz, store.options);
        // Occupied cells. Starts with the level's props and wet patches, then party things get added.
        this.taken = new Uint8Array(N * N);
        for (const prop of chunk.props) this.take(Math.round(prop.x) - this.x0, Math.round(prop.z) - this.z0);
        for (const leak of chunk.leaks) this.take(Math.round(leak.floorX) - this.x0, Math.round(leak.floorZ) - this.z0);
        /** @type {PartyDressing} */
        this.dressing = { things: [], balloons: [], streamers: [], ribbons: [], bunting: [], scrawls: [], discos: [], guests: [], boxes: [] };
        /** Bounds each balloon must stay in, as [minX, minZ, maxX, maxZ] (see settleBalloons). */
        this.rooms = [];
        /** Cell sides with bunting, keyed "x,z,dx,dz". */
        this.hung = new Set();
        /** @type {Guest | null} */
        this.firstGuest = null;
    }

    // ------------------------------------------------------------------ the grid

    /** Edge between local cell (i, j) and its neighbor in direction (di, dj). */
    edge(i, j, di, dj) {
        const { edgesX, edgesZ } = this.chunk;
        if (di === 1) return edgesX[i * N + j];
        if (dj === 1) return edgesZ[i * N + j];
        if (di === -1) return i > 0 ? edgesX[(i - 1) * N + j] : this.west[j];
        return j > 0 ? edgesZ[i * N + j - 1] : this.south[i];
    }

    /** Sides of local cell (i, j) that have a wall. Doorways count as open. */
    wallsOf(i, j) {
        return DIRECTIONS.filter(([di, dj]) => this.edge(i, j, di, dj) === EDGE_WALL);
    }

    /** Number of fully open sides of local cell (i, j). */
    openSides(i, j) {
        return DIRECTIONS.filter(([di, dj]) => this.edge(i, j, di, dj) === EDGE_NONE).length;
    }

    inside(i, j) {
        return i >= 0 && j >= 0 && i < N && j < N;
    }

    free(i, j) {
        return this.inside(i, j) && !this.taken[i * N + j] && !this.inFirstRoom(i, j);
    }

    take(i, j) {
        if (this.inside(i, j)) this.taken[i * N + j] = 1;
    }

    inFirstRoom(i, j) {
        const x = this.x0 + i;
        const z = this.z0 + j;
        return x >= SPAWN_ROOM.x0 && x <= SPAWN_ROOM.x1 && z >= SPAWN_ROOM.z0 && z <= SPAWN_ROOM.z1;
    }

    /** A random local cell. */
    randomCell() {
        return [Math.floor(this.random() * N), Math.floor(this.random() * N)];
    }

    /** True if local cell (i, j) is under a light panel (both world coords odd). */
    underPanel(i, j) {
        return ((this.x0 + i) & 1) === 1 && ((this.z0 + j) & 1) === 1;
    }

    // ------------------------------------------------------------------ the first room

    /**
     * Spawn room. Banner over the doorway ahead, mirror ball in the middle, cake on the left wall with presents in
     * the corner, balloons and crossed streamers. A guest waits in the next room where you can see it through the
     * doorway. Only runs if the room is still as it was stamped.
     */
    firstRoom() {
        const d = this.dressing;
        const cell = (x, z) => [x - this.x0, z - this.z0];
        const wallTo = (x, z, dx, dz) => this.edge(...cell(x, z), dx, dz) !== EDGE_NONE;
        // Wall ahead (toward -z) with the doorway at x = -1.
        if (![-2, -1, 0, 1].every((x) => wallTo(x, -2, 0, -1))) return;
        const face = -2.5 + HALF_THICKNESS + 0.012;
        d.bunting.push({ ax: -2.38, az: face, bx: 1.38, bz: face, nx: 0, nz: 1, y: 0.968, sag: 0.036, flag: 0.15, color: 0, letters: BANNER_TEXT });
        d.discos.push({ x: 0, y: DISCO_HEIGHT, z: -0.5, range: 2.5, phase: 0 });

        // Cake on the left wall facing into the room, presents in the corner next to it.
        if (wallTo(-2, -1, -1, 0)) this.addTable(-2, -1, -1, 0, true);
        if (wallTo(-2, -2, -1, 0) && wallTo(-2, -2, 0, -1)) this.addPresents(-2.26, -2.26, 0.4);
        d.things.push({ kind: PARTY_HAT, x: 0.62, z: -1.35, yaw: 2.1, variant: 1 });
        d.things.push({ kind: PARTY_HAT, x: -0.9, z: 0.55, yaw: -0.7, variant: 6 });
        this.ceilingCluster(-2.2, -2.2, 5, 0.1, FIRST_ROOM_INSIDE);
        this.ceilingCluster(1.9, -1.5, 4, 0.14, FIRST_ROOM_INSIDE);
        this.ceilingCluster(1.6, 1.1, 3, 0.12, FIRST_ROOM_INSIDE);
        const wide = 2.5 - HALF_THICKNESS;
        if (wallTo(-2, -1, -1, 0) && wallTo(2, -1, 1, 0)) {
            d.streamers.push({ ax: -wide, az: -1.3, bx: wide, bz: -1.3, sag: 0.13, colors: [0, 4] });
            d.streamers.push({ ax: -wide, az: -0.62, bx: wide, bz: -0.62, sag: 0.1, colors: [2, 6] });
        }
        // Sags lower than the other two so it passes under them where they cross.
        if (wallTo(1, -2, 0, -1) && wallTo(1, 1, 0, 1)) d.streamers.push({ ax: 1.05, az: -wide, bx: 1.05, bz: 1.5 - HALF_THICKNESS, sag: 0.17, colors: [5, 1] });
        d.ribbons.push({ x: -0.5, z: 0.2, length: 0.26, color: 3, phase: 1.3 });
        d.ribbons.push({ x: 0.45, z: -1.9, length: 0.2, color: 6, phase: 4.1 });
        d.scrawls.push({ x: 2.5 - HALF_THICKNESS - 0.002, y: 0.46, z: -0.35, nx: -1, nz: 0, size: 0.16, angle: -0.12, style: 0, ink: 0 });

        // Guest in the next room, visible through the doorway. Added later in guests().
        this.firstGuest = !wallTo(-1, -3, 0, -1) ? { x: -1, z: -3.95, yaw: 0 } : { x: -1, z: -3.25, yaw: 0 };
    }

    // ------------------------------------------------------------------ the pieces

    /** Mirror ball, only where it's open all around since its light goes through walls. */
    disco() {
        const chance = this.zone === ZONE_OPEN || this.zone === ZONE_PILLARS ? 0.55 : this.zone === ZONE_ROOMS || this.zone === ZONE_HALLS ? 0.18 : 0;
        if (this.random() >= chance) return;
        const reach = DISCO_RANGE;
        for (let attempt = 0; attempt < 12; attempt++) {
            const i = 3 + Math.floor(this.random() * (N - 6));
            const j = 3 + Math.floor(this.random() * (N - 6));
            if (this.underPanel(i, j) || this.inFirstRoom(i, j) || !this.openAround(i, j, reach)) continue;
            const disco = { x: this.x0 + i, y: DISCO_HEIGHT, z: this.z0 + j, range: reach, phase: this.random() * Math.PI * 2 };
            // Can't hang from an air vent. Its random draws happen either way so the rest comes out the same.
            if (!ventAt(this.store.seed, disco.x, disco.z)) this.dressing.discos.push(disco);
            return;
        }
    }

    /** True if every edge within `reach` cells of local cell (i, j) is open. Pillars don't count. */
    openAround(i, j, reach) {
        for (let a = i - reach; a <= i + reach; a++) {
            for (let b = j - reach; b <= j + reach; b++) {
                if (!this.inside(a, b)) return false;
                if (a < i + reach && this.edge(a, b, 1, 0) !== EDGE_NONE) return false;
                if (b < j + reach && this.edge(a, b, 0, 1) !== EDGE_NONE) return false;
            }
        }
        return true;
    }

    /** Cake table against a wall, only in a cell open on the other three sides so it never blocks the way. */
    table() {
        const chance = this.zone === ZONE_MAZE ? 0.1 : this.zone === ZONE_ROOMS || this.zone === ZONE_HALLS ? 0.5 : 0.3;
        if (this.random() >= chance) return;
        for (let attempt = 0; attempt < 16; attempt++) {
            const [i, j] = this.randomCell();
            if (!this.free(i, j)) continue;
            const walls = this.wallsOf(i, j);
            if (walls.length !== 1 || this.openSides(i, j) !== 3) continue;
            this.addTable(this.x0 + i, this.z0 + j, walls[0][0], walls[0][1], false);
            return;
        }
    }

    /** Table in cell (x, z) against the wall on side (dx, dz), with the cake and balloons tied to the front corners. */
    addTable(x, z, dx, dz, first) {
        const d = this.dressing;
        const tx = x + dx * TABLE_OUT;
        const tz = z + dz * TABLE_OUT;
        const yaw = Math.atan2(-dx, -dz);
        d.things.push({ kind: PARTY_CAKE, x: tx, z: tz, yaw, variant: first ? 0x5 : (this.random() * 4294967296) >>> 0 });
        const along = TABLE_LENGTH / 2;
        const across = TABLE_DEPTH / 2;
        d.boxes.push(dx !== 0 ? [tx - across, tz - along, tx + across, tz + along] : [tx - along, tz - across, tx + along, tz + across]);
        // Front corners (away from the wall) where the balloons are tied.
        const ex = dz !== 0 ? along - 0.02 : 0;
        const ez = dx !== 0 ? along - 0.02 : 0;
        const fx = tx - dx * (across - 0.02);
        const fz = tz - dz * (across - 0.02);
        for (const side of [-1, 1]) this.bunch(fx + ex * side, 0.27, fz + ez * side, 2 + Math.floor(this.random() * 2), 0.07);
        this.take(x - this.x0, z - this.z0);
    }

    /** Presents against a wall or in a corner. */
    presents() {
        const count = this.random() < 0.55 ? 1 : this.random() < 0.3 ? 2 : 0;
        for (let n = 0; n < count; n++) {
            for (let attempt = 0; attempt < 12; attempt++) {
                const [i, j] = this.randomCell();
                if (!this.free(i, j) || this.openSides(i, j) < 2) continue;
                const walls = this.wallsOf(i, j);
                // One wall or a corner. Not between two facing walls where they'd block the way.
                const corner = walls.length === 2 && walls[0][0] * walls[1][0] + walls[0][1] * walls[1][1] === 0;
                if (walls.length !== 1 && !corner) continue;
                let ox = 0;
                let oz = 0;
                for (const [di, dj] of walls) {
                    ox += di * 0.3;
                    oz += dj * 0.3;
                }
                // With one wall, shift along it so it's not always centered.
                if (walls.length === 1) {
                    const along = (this.random() - 0.5) * 0.4;
                    if (walls[0][0] !== 0) oz += along;
                    else ox += along;
                }
                this.addPresents(this.x0 + i + ox, this.z0 + j + oz, this.random());
                this.take(i, j);
                break;
            }
        }
    }

    addPresents(x, z, turn) {
        const variant = (this.random() * 4294967296) >>> 0;
        this.dressing.things.push({ kind: PARTY_PRESENTS, x, z, yaw: (turn - 0.5) * 0.6, variant });
        this.dressing.boxes.push([x - PRESENTS_HALF, z - PRESENTS_HALF, x + PRESENTS_HALF, z + PRESENTS_HALF]);
    }

    /**
     * Bunches at the ceiling (mostly in corners, where they drift to), bunches tied to chairs, and sometimes one
     * tied to a weight.
     */
    balloons() {
        const clusters = (this.zone === ZONE_MAZE ? 1 : 3) + Math.floor(this.random() * 4);
        for (let n = 0; n < clusters; n++) {
            for (let attempt = 0; attempt < 8; attempt++) {
                const [i, j] = this.randomCell();
                if (this.inFirstRoom(i, j)) continue;
                const walls = this.wallsOf(i, j);
                let ox = 0;
                let oz = 0;
                if (walls.length >= 2 && walls[0][0] !== walls[1][0] && walls[0][1] !== walls[1][1] && this.random() < 0.8) {
                    // Push into the corner.
                    for (const [di, dj] of walls.slice(0, 2)) {
                        ox += di * 0.24;
                        oz += dj * 0.24;
                    }
                } else if (this.underPanel(i, j)) {
                    // Next to the light, not over it.
                    ox = (this.random() < 0.5 ? -1 : 1) * 0.32;
                    oz = (this.random() - 0.5) * 0.5;
                } else {
                    ox = (this.random() - 0.5) * 0.4;
                    oz = (this.random() - 0.5) * 0.4;
                }
                this.ceilingCluster(this.x0 + i + ox, this.z0 + j + oz, 2 + Math.floor(this.random() * 4), 0.08 + this.random() * 0.06);
                break;
            }
        }
        // Tied to the backs of upright chairs.
        for (const prop of this.chunk.props) {
            if (prop.type !== PROP_CHAIR || (prop.variant & 3) === 0 || this.random() >= 0.5) continue;
            const bx = prop.x - Math.sin(prop.yaw) * 0.09;
            const bz = prop.z - Math.cos(prop.yaw) * 0.09;
            this.bunch(bx, 0.33, bz, 2 + Math.floor(this.random() * 3), 0.08);
        }
        // Tied to a weight on the floor.
        const weights = this.random() < 0.5 ? 1 : 0;
        for (let n = 0; n < weights; n++) {
            for (let attempt = 0; attempt < 8; attempt++) {
                const [i, j] = this.randomCell();
                if (!this.free(i, j) || this.openSides(i, j) < 3) continue;
                const x = this.x0 + i + (this.random() - 0.5) * 0.3;
                const z = this.z0 + j + (this.random() - 0.5) * 0.3;
                this.dressing.things.push({ kind: PARTY_WEIGHT, x, z, yaw: this.random() * Math.PI, variant: Math.floor(this.random() * PARTY_COLORS) });
                this.bunch(x, 0.022, z, 3 + Math.floor(this.random() * 3), 0.1);
                this.take(i, j);
                break;
            }
        }
        this.settleBalloons();
    }

    /** Loose balloons at the ceiling around (x, z), kept within `room` (see settleBalloons). Defaults to their cell. */
    ceilingCluster(x, z, count, spread, room = cellRoom(x, z)) {
        const start = this.random() * Math.PI * 2;
        const first = this.dressing.balloons.length;
        for (let k = 0; k < count; k++) {
            const angle = start + k * 2.4 + this.random() * 0.5;
            const distance = k === 0 ? this.random() * 0.03 : spread * (0.55 + this.random() * 0.45);
            const size = 0.88 + this.random() * 0.24;
            this.dressing.balloons.push({
                x: x + Math.cos(angle) * distance,
                // Low enough that drift doesn't push it through the ceiling.
                y: WALL_HEIGHT - BALLOON_HEIGHT * size - DRIFT_UP - 0.002 - this.random() * 0.012,
                z: z + Math.sin(angle) * distance,
                color: Math.floor(this.random() * PARTY_COLORS),
                size,
                phase: this.random() * Math.PI * 2,
                drift: 0,
                tie: null,
                tail: 0.16 + this.random() * 0.22,
            });
            this.rooms.push(room);
        }
        this.driftTogether(first);
    }

    /** Bunch of balloons tied at (x, y, z), floating around head height within that cell. */
    bunch(x, y, z, count, spread) {
        const start = this.random() * Math.PI * 2;
        const tie = { x, y, z };
        const first = this.dressing.balloons.length;
        for (let k = 0; k < count; k++) {
            const angle = start + (k / count) * Math.PI * 2 + this.random() * 0.4;
            const distance = count === 1 ? 0 : spread * (0.5 + this.random() * 0.5);
            const size = 0.9 + this.random() * 0.2;
            this.dressing.balloons.push({
                x: x + Math.cos(angle) * distance,
                y: 0.6 + this.random() * 0.2,
                z: z + Math.sin(angle) * distance,
                color: Math.floor(this.random() * PARTY_COLORS),
                size,
                phase: this.random() * Math.PI * 2,
                drift: 0,
                tie,
                tail: 0,
            });
            this.rooms.push(cellRoom(x, z));
        }
        this.driftTogether(first);
    }

    /** Balloons from `first` on (one bunch) share the first one's drift phase. */
    driftTogether(first) {
        const balloons = this.dressing.balloons;
        for (let k = first; k < balloons.length; k++) balloons[k].drift = balloons[first].phase;
    }

    /**
     * Nudges balloons as little as needed so none overlap (or touch one drifting the other way) and each stays in its
     * room, clear of lights, mirror balls and streamers already placed. Any that still don't fit get dropped (a cell
     * only holds so many). Draws nothing from the random stream.
     */
    settleBalloons() {
        const balloons = this.dressing.balloons;
        for (let pass = 0, moved = true; pass < SPREAD_PASSES && moved; pass++) {
            moved = false;
            for (let a = 0; a < balloons.length; a++) {
                for (let b = a + 1; b < balloons.length; b++) moved = inEachOthersWay(balloons[a], balloons[b], true, a + b) || moved;
            }
            balloons.forEach((balloon, k) => {
                moved = this.keepClear(balloon, this.rooms[k]) || moved;
            });
        }
        const kept = [];
        const rooms = [];
        balloons.forEach((balloon, k) => {
            if (this.keepClear(balloon, this.rooms[k]) || kept.some((other) => inEachOthersWay(other, balloon, false, 0))) return;
            kept.push(balloon);
            rooms.push(this.rooms[k]);
        });
        this.dressing.balloons = kept;
        this.rooms = rooms;
    }

    /**
     * Moves a balloon back into its room ([minX, minZ, maxX, maxZ]) and out of any light panel, mirror ball or
     * streamer, allowing for drift.
     * @returns {boolean} Whether it moved.
     */
    keepClear(balloon, room) {
        const { x, z } = balloon;
        const across = BALLOON_REACH * balloon.size + DRIFT;
        const top = balloon.y + BALLOON_REACH_UP * balloon.size + DRIFT_UP;
        const bottom = balloon.y - BALLOON_REACH_UP * balloon.size - DRIFT_UP;
        balloon.x = Math.min(Math.max(balloon.x, room[0] + across), room[2] - across);
        balloon.z = Math.min(Math.max(balloon.z, room[1] + across), room[3] - across);
        // Push out of the rectangle centered on (cx, cz) with half sizes halfX and halfZ.
        const outOf = (cx, cz, halfX, halfZ = halfX) => {
            const dx = balloon.x - cx;
            const dz = balloon.z - cz;
            const clearX = halfX + across;
            const clearZ = halfZ + across;
            if (Math.abs(dx) >= clearX || Math.abs(dz) >= clearZ) return;
            if (clearX - Math.abs(dx) <= clearZ - Math.abs(dz)) balloon.x = cx + (dx < 0 ? -clearX : clearX);
            else balloon.z = cz + (dz < 0 ? -clearZ : clearZ);
        };
        if (top > PANEL_BOTTOM) outOf(2 * Math.round((balloon.x - 1) / 2) + 1, 2 * Math.round((balloon.z - 1) / 2) + 1, PANEL_HALF_X, PANEL_HALF_Z);
        for (const disco of this.dressing.discos) if (top > disco.y - DISCO_RADIUS) outOf(disco.x, disco.z, DISCO_RADIUS);
        for (const streamer of this.dressing.streamers) {
            const alongX = streamer.az === streamer.bz;
            const along = alongX ? balloon.x : balloon.z;
            const [a0, a1] = alongX ? [streamer.ax, streamer.bx] : [streamer.az, streamer.bz];
            if (along < a0 - across || along > a1 + across) continue;
            const y = swagHeight(streamer, (Math.min(Math.max(along, a0), a1) - a0) / (a1 - a0));
            if (y - STREAMER_REACH > top || y + STREAMER_REACH < bottom) continue;
            const line = alongX ? streamer.az : streamer.ax;
            const off = (alongX ? balloon.z : balloon.x) - line;
            const clear = across + STREAMER_REACH;
            if (Math.abs(off) >= clear) continue;
            if (alongX) balloon.z = line + (off < 0 ? -clear : clear);
            else balloon.x = line + (off < 0 ? -clear : clear);
        }
        return Math.abs(balloon.x - x) > 1e-9 || Math.abs(balloon.z - z) > 1e-9;
    }

    /** Streamers across a room wall to wall, along an open row of cells that stays inside the chunk. */
    streamers() {
        const count = (this.zone === ZONE_MAZE ? 0 : 1) + Math.floor(this.random() * 3);
        for (let n = 0; n < count; n++) {
            for (let attempt = 0; attempt < 10; attempt++) {
                const [i, j] = this.randomCell();
                if (this.inFirstRoom(i, j)) continue;
                const alongX = this.random() < 0.5;
                const [di, dj] = alongX ? [1, 0] : [0, 1];
                // Find the wall each way.
                let lo = 0;
                while (lo < 7 && this.inside(i - di * (lo + 1), j - dj * (lo + 1)) && this.edge(i - di * lo, j - dj * lo, -di, -dj) === EDGE_NONE) lo++;
                let hi = 0;
                while (hi < 7 && this.inside(i + di * (hi + 1), j + dj * (hi + 1)) && this.edge(i + di * hi, j + dj * hi, di, dj) === EDGE_NONE) hi++;
                const length = lo + hi + 1;
                if (length < 2 || length > 7) continue;
                if (this.edge(i - di * lo, j - dj * lo, -di, -dj) === EDGE_NONE || this.edge(i + di * hi, j + dj * hi, di, dj) === EDGE_NONE) continue;
                const across = (this.random() - 0.5) * 0.6;
                const from = (alongX ? this.x0 + i - lo : this.z0 + j - lo) - 0.5 + HALF_THICKNESS;
                const to = (alongX ? this.x0 + i + hi : this.z0 + j + hi) + 0.5 - HALF_THICKNESS;
                const at = (alongX ? this.z0 + j : this.x0 + i) + across;
                const first = Math.floor(this.random() * PARTY_COLORS);
                const colors = [first, (first + 2 + Math.floor(this.random() * (PARTY_COLORS - 3))) % PARTY_COLORS];
                const sag = Math.min(0.06 + 0.025 * length, 0.17);
                const streamer = alongX
                    ? { ax: from, az: at, bx: to, bz: at, sag, colors }
                    : { ax: at, az: from, bx: at, bz: to, sag, colors };
                // Skip it if it hits balloons, a mirror ball or another streamer. Its draws are already made so the
                // rest comes out the same.
                if (!this.inTheWay(streamer)) this.dressing.streamers.push(streamer);
                break;
            }
        }
    }

    /** Bunting along a straight run of wall. */
    bunting() {
        const count = (this.zone === ZONE_OPEN ? 0 : 1) + (this.random() < 0.5 ? 1 : 0);
        for (let n = 0; n < count; n++) {
            for (let attempt = 0; attempt < 12; attempt++) {
                const [i, j] = this.randomCell();
                if (this.inFirstRoom(i, j)) continue;
                const walls = DIRECTIONS.filter(([di, dj]) => this.edge(i, j, di, dj) !== EDGE_NONE);
                if (walls.length === 0) continue;
                const [wi, wj] = walls[Math.floor(this.random() * walls.length)];
                // Runs along the wall, on the other axis.
                const pi = wj !== 0 ? 1 : 0;
                const pj = wi !== 0 ? 1 : 0;
                const runs = (a, b) => this.inside(a, b) && this.edge(a, b, wi, wj) !== EDGE_NONE;
                let lo = 0;
                while (lo < 5 && runs(i - pi * (lo + 1), j - pj * (lo + 1)) && this.edge(i - pi * lo, j - pj * lo, -pi, -pj) === EDGE_NONE) lo++;
                let hi = 0;
                while (hi < 5 && runs(i + pi * (hi + 1), j + pj * (hi + 1)) && this.edge(i + pi * hi, j + pj * hi, pi, pj) === EDGE_NONE) hi++;
                if (lo + hi + 1 < 2) continue;
                // Just off the wall's face.
                const plane = (wi !== 0 ? this.x0 + i : this.z0 + j) + (wi + wj) * (0.5 - HALF_THICKNESS - 0.012);
                const from = (pi !== 0 ? this.x0 + i - lo : this.z0 + j - lo) - 0.5 + HALF_THICKNESS + 0.05;
                const to = (pi !== 0 ? this.x0 + i + hi : this.z0 + j + hi) + 0.5 - HALF_THICKNESS - 0.05;
                const bunting = pi !== 0
                    ? { ax: from, az: plane, bx: to, bz: plane, nx: 0, nz: -wj }
                    : { ax: plane, az: from, bx: plane, bz: to, nx: -wi, nz: 0 };
                const sag = 0.03 + 0.008 * (lo + hi);
                const color = Math.floor(this.random() * PARTY_COLORS);
                // Skip walls that already have bunting or peeling wallpaper reaching up into it. Its draws are
                // already made so the rest comes out the same.
                const lowest = BUNTING_HEIGHT - sag - BUNTING_FLAG * 1.15;
                const sides = [];
                for (let k = -lo; k <= hi; k++) sides.push([this.x0 + i + pi * k, this.z0 + j + pj * k]);
                if (sides.some(([x, z]) => this.hung.has(`${x},${z},${wi},${wj}`) || this.peelTop(x, z, wi, wj) > lowest)) break;
                for (const [x, z] of sides) this.hung.add(`${x},${z},${wi},${wj}`);
                this.dressing.bunting.push({ ...bunting, y: BUNTING_HEIGHT, sag, flag: BUNTING_FLAG, color, letters: null });
                break;
            }
        }
    }

    /** Curly ribbons hanging from the ceiling. */
    ribbons() {
        const count = Math.floor(this.random() * 4);
        for (let n = 0; n < count; n++) {
            const [i, j] = this.randomCell();
            if (this.inFirstRoom(i, j)) continue;
            // If there's a light, go beside it instead of under it, and stay clear of the wall past it.
            const [shift, spread] = this.underPanel(i, j) ? [0.27, 0.24] : [0, 0.3];
            this.dressing.ribbons.push({
                x: this.x0 + i + shift + (this.random() - 0.5) * spread,
                z: this.z0 + j + (this.random() - 0.5) * 0.3,
                length: 0.16 + this.random() * 0.2,
                color: Math.floor(this.random() * PARTY_COLORS),
                phase: this.random() * Math.PI * 2,
            });
        }
    }

    /** Party hats dropped on the floor. */
    hats() {
        const count = this.random() < 0.6 ? 1 + (this.random() < 0.3 ? 1 : 0) : 0;
        for (let n = 0; n < count; n++) {
            for (let attempt = 0; attempt < 8; attempt++) {
                const [i, j] = this.randomCell();
                if (!this.free(i, j)) continue;
                this.dressing.things.push({
                    kind: PARTY_HAT,
                    x: this.x0 + i + (this.random() - 0.5) * 0.5,
                    z: this.z0 + j + (this.random() - 0.5) * 0.5,
                    yaw: this.random() * Math.PI * 2,
                    variant: (this.random() * 4294967296) >>> 0,
                });
                this.take(i, j);
                break;
            }
        }
    }

    /** Occasional =) on the walls. */
    scrawls() {
        const count = this.random() < 0.45 ? 1 + (this.random() < 0.25 ? 1 : 0) : 0;
        for (let n = 0; n < count; n++) {
            for (let attempt = 0; attempt < 10; attempt++) {
                const [i, j] = this.randomCell();
                if (this.inFirstRoom(i, j)) continue;
                const walls = this.wallsOf(i, j);
                if (walls.length === 0) continue;
                const [wi, wj] = walls[Math.floor(this.random() * walls.length)];
                const along = (this.random() - 0.5) * 0.5;
                const out = 0.5 - HALF_THICKNESS - 0.002;
                const size = 0.1 + this.random() * 0.12;
                const inkRoll = this.random();
                this.dressing.scrawls.push({
                    x: this.x0 + i + wi * out + (wi === 0 ? along : 0),
                    y: 0.3 + this.random() * 0.34,
                    z: this.z0 + j + wj * out + (wj === 0 ? along : 0),
                    nx: -wi,
                    nz: -wj,
                    size,
                    angle: (this.random() - 0.5) * 0.45,
                    style: Math.floor(this.random() * SCRAWL_STYLES),
                    ink: inkRoll < 0.6 ? 0 : inkRoll < 0.85 ? 1 : 2,
                });
                break;
            }
        }
    }

    /** Occasional guest, standing somewhere open so it can be seen from far off. */
    guests() {
        if (this.firstGuest) this.dressing.guests.push(this.firstGuest);
        if (this.random() >= 0.3) return;
        for (let attempt = 0; attempt < 12; attempt++) {
            const [i, j] = this.randomCell();
            if (!this.free(i, j) || this.openSides(i, j) < 3) continue;
            this.dressing.guests.push({
                x: this.x0 + i + (this.random() - 0.5) * 0.2,
                z: this.z0 + j + (this.random() - 0.5) * 0.2,
                yaw: this.random() * Math.PI * 2,
            });
            this.take(i, j);
            return;
        }
    }

    // ------------------------------------------------------------------ clearance

    /** True if a streamer would hit or touch a balloon, mirror ball or another streamer. */
    inTheWay(streamer) {
        const { balloons, discos, streamers } = this.dressing;
        const steps = Math.ceil((Math.abs(streamer.bx - streamer.ax) + Math.abs(streamer.bz - streamer.az)) / SAMPLE);
        for (let k = 0; k <= steps; k++) {
            const [x, y, z] = swagPoint(streamer, k / steps);
            for (const balloon of balloons) {
                const [dx, dy, dz] = [x - balloon.x, y - balloon.y, z - balloon.z];
                const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (d < 0.3 && d < reachAlong(balloon, dx / d, dy / d, dz / d) + DRIFT + STREAMER_REACH + SAMPLE) return true;
            }
            for (const disco of discos) {
                if (y + STREAMER_REACH > disco.y - DISCO_RADIUS && across(x - disco.x, z - disco.z) < DISCO_RADIUS + STREAMER_REACH + SAMPLE) return true;
            }
            for (const other of streamers) {
                const [ox, oy, oz] = nearestOf(other, x, z);
                if (Math.sqrt((x - ox) ** 2 + (y - oy) ** 2 + (z - oz) ** 2) < 2 * STREAMER_REACH + SAMPLE) return true;
            }
        }
        return false;
    }

    /** Top of the peeling wallpaper on side (wi, wj) of cell (x, z) (see peelTop in peels.js), or -Infinity if none. */
    peelTop(x, z, wi, wj) {
        if (this.edge(x - this.x0, z - this.z0, wi, wj) !== EDGE_WALL) return -Infinity;
        return peelTop(this.store, wi < 0 ? x - 1 : x, wj < 0 ? z - 1 : z, wi !== 0 ? 0 : 1, wi + wj < 0 ? 1 : -1) ?? -Infinity;
    }

    /**
     * Drops any ribbon that hangs through a balloon, streamer, mirror ball or guest's head (edit-mode guests too).
     * Runs last, so removing one doesn't change anything drawn after it.
     */
    clearRibbons() {
        const { balloons, streamers, discos } = this.dressing;
        const guests = [...this.dressing.guests, ...this.chunk.props.filter((prop) => prop.type === PROP_GUEST)];
        this.dressing.ribbons = this.dressing.ribbons.filter((ribbon) => {
            const bottom = WALL_HEIGHT - 0.002 - ribbon.length;
            const away = (x, z) => across(x - ribbon.x, z - ribbon.z);
            return !balloons.some((b) => b.y + BALLOON_REACH_UP * b.size + DRIFT_UP > bottom && away(b.x, b.z) < BALLOON_REACH * b.size + DRIFT + RIBBON_REACH)
                && !streamers.some((s) => {
                    const [x, y, z] = nearestOf(s, ribbon.x, ribbon.z);
                    return y + STREAMER_REACH > bottom && away(x, z) < STREAMER_REACH + RIBBON_REACH;
                })
                && !discos.some((d) => away(d.x, d.z) < DISCO_RADIUS + RIBBON_REACH)
                && !guests.some((g) => bottom < (g.y ?? 0) + GUEST_TOP && away(g.x, g.z) < GUEST_HEAD + RIBBON_REACH);
        });
    }
}


/** Bounds for a balloon placed at (x, z), as [minX, minZ, maxX, maxZ] (see CELL_ROOM). */
function cellRoom(x, z) {
    const cx = cellCoord(x);
    const cz = cellCoord(z);
    return [cx - CELL_ROOM, cz - CELL_ROOM, cx + CELL_ROOM, cz + CELL_ROOM];
}

/** Min gap between two balloons. Bigger if they don't drift together. */
function gapBetween(a, b) {
    return a.drift === b.drift ? BALLOON_GAP : BALLOON_GAP + 2 * DRIFT;
}

/** Length of (x, z). */
function across(x, z) {
    return Math.sqrt(x * x + z * z);
}

/** Streamer height at t (0..1) along it. */
function swagHeight(streamer, t) {
    return STREAMER_HEIGHT - streamer.sag * 4 * t * (1 - t);
}

/** Point on a streamer's center line at t (0..1) along it. */
function swagPoint(streamer, t) {
    return [streamer.ax + (streamer.bx - streamer.ax) * t, swagHeight(streamer, t), streamer.az + (streamer.bz - streamer.az) * t];
}

/** Point on a streamer nearest to (x, z) horizontally. Streamers run along x or z. */
function nearestOf(streamer, x, z) {
    const alongX = streamer.az === streamer.bz;
    const [a0, a1] = alongX ? [streamer.ax, streamer.bx] : [streamer.az, streamer.bz];
    const along = Math.min(Math.max(alongX ? x : z, a0), a1);
    const y = swagHeight(streamer, (along - a0) / (a1 - a0));
    return alongX ? [along, y, streamer.az] : [streamer.ax, y, along];
}
