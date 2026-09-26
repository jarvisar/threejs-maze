import { CHUNK_SIZE, HALF_CHUNK, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { PROP_CHAIR } from './decorations.js';
import { PANELS_PER_SIDE, borderLine } from './generator.js';
import { EDGE_NONE, EDGE_WALL, chunkKey } from './grid.js';
import { hashFloat, hashInts, mulberry32 } from './random.js';
import { ZONE_HALLS, ZONE_MAZE, ZONE_OPEN, ZONE_PILLARS, ZONE_ROOMS } from './zones.js';

/*
 * Level Fun: the level dressed for a party. The Konami code turns it on and off, and it's where the way out
 * of a tape leads.
 *
 * The walls stay where they are. What changes is laid over them, chunk by chunk, from the seed and the
 * chunk's own coordinates (so the same place is always dressed the same way): gels over the lights, a mirror
 * ball where there's room for one to throw its light about, balloons against the ceiling and tied to things,
 * streamers across rooms, bunting along walls, a cake on a table, presents, hats on the floor, =) drawn on
 * the walls, and now and then a guest. The room every world starts in is done up specially, with a banner.
 *
 * This only works out where everything goes; partyGeometry.js builds it and PartyLayer.js runs the parts that
 * move. The materials (materials.js) do the rest: the wallpaper, confetti in the carpet, the gels' colours
 * and the mirror balls' light.
 */

const N = CHUNK_SIZE;
const HALF_THICKNESS = WALL_THICKNESS / 2;

/** A light panel's fourth byte (see ChunkData.lights) everywhere but Level Fun: no gel. */
export const GEL_NONE = 255;
/** In Level Fun, a panel left white (a warm white). */
export const GEL_WHITE = 254;
/**
 * Bytes below this are a gel's hue, as byte / GEL_HUES of the way round; the GEL_CYCLING above it, a gel whose
 * colour changes slowly (see panelTint in materials.js), each starting from a different point,
 * (byte − GEL_HUES) / GEL_CYCLING of the way through.
 */
export const GEL_HUES = 192;
export const GEL_CYCLING = 32;

/** The colours the balloons, streamers, flags and confetti come in. */
export const PARTY_PALETTE = [0xe0303f, 0xf5892a, 0xf4cc2e, 0x3fae4f, 0x2f6fd6, 0x8a4fcf, 0xf0609e, 0x2cb8b0];

export const PARTY_CAKE = 0; // a table with a cloth over it, a birthday cake, plates and cups
export const PARTY_PRESENTS = 1; // one to three wrapped presents
export const PARTY_HAT = 2; // a party hat someone dropped
export const PARTY_WEIGHT = 3; // what a bunch of balloons is tied down to

/** How many colours there are (see PARTY_PALETTE). */
export const PARTY_COLORS = PARTY_PALETTE.length;
/** A balloon's radius across and up, at size 1 (about 30 cm across). */
export const BALLOON_RADIUS = 0.055;
export const BALLOON_HEIGHT = 0.066;
/** The kinds of =) drawn on the walls. */
export const SCRAWL_STYLES = 3;
/** What the banner in the first room says. */
export const BANNER_TEXT = 'WELCOME TO LEVEL FUN =)';
/** How high a mirror ball's middle hangs, and how far its light reaches. */
export const DISCO_HEIGHT = 0.79;
const DISCO_RANGE = 3;
// The room every world starts in (see stampSpawnRoom in generator.js), and what's only done up there.
const SPAWN_ROOM = { x0: -3, x1: 3, z0: -3, z1: 2 };
// A table against a wall: its middle this far from the middle of its cell, and its size.
const TABLE_OUT = 0.28;
export const TABLE_LENGTH = 0.34;
export const TABLE_DEPTH = 0.18;
const PRESENTS_HALF = 0.075;

const DIRECTIONS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/**
 * @typedef {object} PartyDressing Everything a chunk has for the party, in world coordinates.
 * @property {PartyThing[]} things On the floor.
 * @property {Balloon[]} balloons
 * @property {Streamer[]} streamers Swags of crêpe paper across a room.
 * @property {Ribbon[]} ribbons Curly ribbons hanging from the ceiling.
 * @property {Bunting[]} bunting Flags along a wall (the banner in the first room is one, with letters).
 * @property {Scrawl[]} scrawls
 * @property {Disco[]} discos
 * @property {Guest[]} guests
 * @property {number[][]} boxes What the player collides with, as [minX, minZ, maxX, maxZ].
 */

/**
 * @typedef {object} PartyThing
 * @property {number} kind One of the PARTY_* constants.
 * @property {number} x
 * @property {number} z
 * @property {number} yaw Its front faces +z at 0 (a table's front is the side away from the wall).
 * @property {number} variant 32 bits for the details.
 */

/**
 * @typedef {object} Balloon
 * @property {number} x Where its middle is.
 * @property {number} y
 * @property {number} z
 * @property {number} color 0..PARTY_COLORS − 1
 * @property {number} size About 1.
 * @property {number} phase Where in its drifting it starts.
 * @property {{ x: number, y: number, z: number } | null} tie Where its string is tied, or null for one that
 *     got away and is up against the ceiling, trailing its string.
 * @property {number} tail For one against the ceiling, how far its string hangs.
 */

/**
 * @typedef {object} Streamer
 * @property {number} ax One end, on a wall.
 * @property {number} az
 * @property {number} bx The other.
 * @property {number} bz
 * @property {number} sag How far it hangs down in the middle.
 * @property {number[]} colors The two strands twisted together.
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
 * @property {number} bx The other.
 * @property {number} bz
 * @property {number} nx The way the wall faces.
 * @property {number} nz
 * @property {number} y How high the ends are.
 * @property {number} sag
 * @property {number} flag How wide each flag is.
 * @property {number} color The first flag's colour; they go round the colours from there.
 * @property {string | null} letters One to a flag (a space leaves a gap), or null for plain flags.
 */

/**
 * @typedef {object} Scrawl
 * @property {number} x On the wall's face.
 * @property {number} y
 * @property {number} z
 * @property {number} nx The way the face looks.
 * @property {number} nz
 * @property {number} size
 * @property {number} angle How far it's drawn off level.
 * @property {number} style 0..SCRAWL_STYLES − 1
 * @property {number} ink 0 black marker, 1 red crayon, 2 pink.
 */

/**
 * @typedef {object} Disco A mirror ball hanging from the ceiling.
 * @property {number} x
 * @property {number} y Its middle.
 * @property {number} z
 * @property {number} range How far its light reaches.
 * @property {number} phase Which way it's turned to start with.
 */

/**
 * @typedef {object} Guest One of the partygoers.
 * @property {number} x
 * @property {number} z
 * @property {number} yaw
 */

/**
 * Dresses a chunk for the party (sets `chunk.party`) and puts gels over its lights. The same chunk of the
 * same world, with the same walls and props, always comes out the same.
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {import('./generator.js').ChunkData} chunk
 */
export function dressChunk(store, chunk) {
    // Outside a tape's walls there's nothing to dress.
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
    // A tape's arena has its own thing in it.
    if (!store.options.isVoid) dresser.guests();
    chunk.party = dresser.dressing;
}

/** Takes the party down again: no gels, nothing laid over the chunk. */
export function undressChunk(chunk) {
    chunk.party = null;
    for (let k = 3; k < chunk.lights.length; k += 4) chunk.lights[k] = GEL_NONE;
}

/**
 * The gel over each of a chunk's panels. A few stay white, a few go slowly round the colours, and the rest are
 * party colours, mixed up so no two rooms are lit quite the same.
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

// The colours gels come in, as hues: reds, pinks, purples, blues and oranges. (Greens and yellows, and even cyan,
// under lights that are yellow to begin with, just look ill.)
const GEL_COLORS = [0.985, 0.92, 0.85, 0.77, 0.69, 0.62, 0.57, 0.06, 0.1];

/** The gel over the panel above cell (x, z) in Level Fun (see GEL_*). */
export function gelAt(seed, x, z) {
    const roll = hashFloat(seed, 0xfe1, x, z);
    if (roll < 0.3) return GEL_WHITE;
    if (roll > 0.9) return GEL_HUES + Math.floor(hashFloat(seed, 0xfe2, x, z) * GEL_CYCLING);
    const pick = Math.floor(hashFloat(seed, 0xfe3, x, z) * GEL_COLORS.length);
    const hue = (GEL_COLORS[pick] + (hashFloat(seed, 0xfe4, x, z) - 0.5) * 0.04 + 1) % 1;
    return Math.min(Math.floor(hue * GEL_HUES), GEL_HUES - 1);
}

/** Works out one chunk's dressing, in order, from a random stream of its own (so none of the level's change). */
class Dresser {
    /**
     * @param {import('./ChunkStore.js').ChunkStore} store
     * @param {import('./generator.js').ChunkData} chunk
     */
    constructor(store, chunk) {
        this.chunk = chunk;
        this.x0 = chunk.cx * N - HALF_CHUNK;
        this.z0 = chunk.cz * N - HALF_CHUNK;
        this.random = mulberry32(hashInts(store.seed, 0xf07, chunk.cx, chunk.cz));
        this.zone = chunk.zone.type;
        // The walls on the chunk's low sides belong to the chunks before it; ask them if they're there, or
        // work them out, rather than generating them from in here.
        const before = (dx, dz) => store.chunks.get(chunkKey(chunk.cx - dx, chunk.cz - dz));
        const westChunk = before(1, 0);
        const southChunk = before(0, 1);
        this.west = westChunk ? Uint8Array.from({ length: N }, (_, j) => westChunk.edgesX[(N - 1) * N + j]) : borderLine(store.seed, 0, chunk.cx, chunk.cz, store.options);
        this.south = southChunk ? Uint8Array.from({ length: N }, (_, i) => southChunk.edgesZ[i * N + N - 1]) : borderLine(store.seed, 1, chunk.cx, chunk.cz, store.options);
        // Cells something's standing in already (the level's props and wet patches, then the party's own).
        this.taken = new Uint8Array(N * N);
        for (const prop of chunk.props) this.take(Math.round(prop.x) - this.x0, Math.round(prop.z) - this.z0);
        for (const leak of chunk.leaks) this.take(Math.round(leak.floorX) - this.x0, Math.round(leak.floorZ) - this.z0);
        /** @type {PartyDressing} */
        this.dressing = { things: [], balloons: [], streamers: [], ribbons: [], bunting: [], scrawls: [], discos: [], guests: [], boxes: [] };
        /** @type {Guest | null} */
        this.firstGuest = null;
    }

    // ------------------------------------------------------------------ the grid

    /** The edge between local cell (i, j) and its neighbour in direction (di, dj). */
    edge(i, j, di, dj) {
        const { edgesX, edgesZ } = this.chunk;
        if (di === 1) return edgesX[i * N + j];
        if (dj === 1) return edgesZ[i * N + j];
        if (di === -1) return i > 0 ? edgesX[(i - 1) * N + j] : this.west[j];
        return j > 0 ? edgesZ[i * N + j - 1] : this.south[i];
    }

    /** The sides of local cell (i, j) with a wall (a doorway counts as open). */
    wallsOf(i, j) {
        return DIRECTIONS.filter(([di, dj]) => this.edge(i, j, di, dj) === EDGE_WALL);
    }

    /** How many sides of local cell (i, j) are completely open. */
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

    /** Whether local cell (i, j) has a light panel over it (both world coordinates odd). */
    underPanel(i, j) {
        return ((this.x0 + i) & 1) === 1 && ((this.z0 + j) & 1) === 1;
    }

    // ------------------------------------------------------------------ the first room

    /**
     * The room every world starts in: the banner over the doorway ahead, a mirror ball in the middle, the cake
     * along the left wall with presents in the corner, balloons, streamers criss-crossing, and a guest waiting
     * in the next room, where it can be seen through the doorway. Only if the room is still as it was stamped.
     */
    firstRoom() {
        const d = this.dressing;
        const cell = (x, z) => [x - this.x0, z - this.z0];
        const wallTo = (x, z, dx, dz) => this.edge(...cell(x, z), dx, dz) !== EDGE_NONE;
        // The wall ahead (towards −z), with the doorway at x = −1.
        if (![-2, -1, 0, 1].every((x) => wallTo(x, -2, 0, -1))) return;
        const face = -2.5 + HALF_THICKNESS + 0.012;
        d.bunting.push({ ax: -2.38, az: face, bx: 1.38, bz: face, nx: 0, nz: 1, y: 0.968, sag: 0.036, flag: 0.15, color: 0, letters: BANNER_TEXT });
        d.discos.push({ x: 0, y: DISCO_HEIGHT, z: -0.5, range: 2.5, phase: 0 });

        // The cake against the left wall, facing into the room, and presents in the corner by it.
        if (wallTo(-2, -1, -1, 0)) this.addTable(-2, -1, -1, 0, true);
        if (wallTo(-2, -2, -1, 0) && wallTo(-2, -2, 0, -1)) this.addPresents(-2.26, -2.26, 0.4);
        d.things.push({ kind: PARTY_HAT, x: 0.62, z: -1.35, yaw: 2.1, variant: 1 });
        d.things.push({ kind: PARTY_HAT, x: -0.9, z: 0.55, yaw: -0.7, variant: 6 });
        this.ceilingCluster(-2.2, -2.2, 5, 0.1);
        this.ceilingCluster(1.9, -1.5, 4, 0.14);
        this.ceilingCluster(1.6, 1.1, 3, 0.12);
        const wide = 2.5 - HALF_THICKNESS;
        if (wallTo(-2, -1, -1, 0) && wallTo(2, -1, 1, 0)) {
            d.streamers.push({ ax: -wide, az: -1.3, bx: wide, bz: -1.3, sag: 0.13, colors: [0, 4] });
            d.streamers.push({ ax: -wide, az: -0.62, bx: wide, bz: -0.62, sag: 0.1, colors: [2, 6] });
        }
        if (wallTo(1, -2, 0, -1) && wallTo(1, 1, 0, 1)) d.streamers.push({ ax: 1.05, az: -wide, bx: 1.05, bz: 1.5 - HALF_THICKNESS, sag: 0.12, colors: [5, 1] });
        d.ribbons.push({ x: -0.5, z: 0.2, length: 0.26, color: 3, phase: 1.3 });
        d.ribbons.push({ x: 0.45, z: -1.9, length: 0.2, color: 6, phase: 4.1 });
        d.scrawls.push({ x: 2.5 - HALF_THICKNESS - 0.002, y: 0.46, z: -0.35, nx: -1, nz: 0, size: 0.16, angle: -0.12, style: 0, ink: 0 });

        // Waiting in the next room, where it can be seen through the doorway (put in with the other guests).
        this.firstGuest = !wallTo(-1, -3, 0, -1) ? { x: -1, z: -3.95, yaw: 0 } : { x: -1, z: -3.25, yaw: 0 };
    }

    // ------------------------------------------------------------------ the pieces

    /** A mirror ball, where there's open floor all round for its light (which goes through walls) to land on. */
    disco() {
        const chance = this.zone === ZONE_OPEN || this.zone === ZONE_PILLARS ? 0.55 : this.zone === ZONE_ROOMS || this.zone === ZONE_HALLS ? 0.18 : 0;
        if (this.random() >= chance) return;
        const reach = DISCO_RANGE;
        for (let attempt = 0; attempt < 12; attempt++) {
            const i = 3 + Math.floor(this.random() * (N - 6));
            const j = 3 + Math.floor(this.random() * (N - 6));
            if (this.underPanel(i, j) || this.inFirstRoom(i, j) || !this.openAround(i, j, reach)) continue;
            this.dressing.discos.push({ x: this.x0 + i, y: DISCO_HEIGHT, z: this.z0 + j, range: reach, phase: this.random() * Math.PI * 2 });
            return;
        }
    }

    /** Whether every edge within `reach` cells of local cell (i, j) is open (pillars don't count). */
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

    /** The cake, on a table against a wall, in a cell open on its other three sides (so it never blocks the way). */
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

    /**
     * A table in cell (x, z), against its wall on side (dx, dz), with the cake on it and balloons tied to its
     * front corners.
     */
    addTable(x, z, dx, dz, first) {
        const d = this.dressing;
        const tx = x + dx * TABLE_OUT;
        const tz = z + dz * TABLE_OUT;
        const yaw = Math.atan2(-dx, -dz);
        d.things.push({ kind: PARTY_CAKE, x: tx, z: tz, yaw, variant: first ? 0x5 : (this.random() * 4294967296) >>> 0 });
        const along = TABLE_LENGTH / 2;
        const across = TABLE_DEPTH / 2;
        d.boxes.push(dx !== 0 ? [tx - across, tz - along, tx + across, tz + along] : [tx - along, tz - across, tx + along, tz + across]);
        // The front corners, where the balloons are tied: the side away from the wall, at either end.
        const ex = dz !== 0 ? along - 0.02 : 0;
        const ez = dx !== 0 ? along - 0.02 : 0;
        const fx = tx - dx * (across - 0.02);
        const fz = tz - dz * (across - 0.02);
        for (const side of [-1, 1]) this.bunch(fx + ex * side, 0.27, fz + ez * side, 2 + Math.floor(this.random() * 2), 0.07);
        this.take(x - this.x0, z - this.z0);
    }

    /** Presents against a wall, or better, in a corner. */
    presents() {
        const count = this.random() < 0.55 ? 1 : this.random() < 0.3 ? 2 : 0;
        for (let n = 0; n < count; n++) {
            for (let attempt = 0; attempt < 12; attempt++) {
                const [i, j] = this.randomCell();
                if (!this.free(i, j) || this.openSides(i, j) < 2) continue;
                const walls = this.wallsOf(i, j);
                // Against one wall, or in a corner (not between two walls facing each other, in the way).
                const corner = walls.length === 2 && walls[0][0] * walls[1][0] + walls[0][1] * walls[1][1] === 0;
                if (walls.length !== 1 && !corner) continue;
                let ox = 0;
                let oz = 0;
                for (const [di, dj] of walls) {
                    ox += di * 0.3;
                    oz += dj * 0.3;
                }
                // Only one wall: along it a bit, so it isn't always dead centre.
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
     * Balloons: bunches against the ceiling (in the corners, where they drift to, and elsewhere), bunches tied
     * to chairs, and a few tied down on their own.
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
                    // Into the corner.
                    for (const [di, dj] of walls.slice(0, 2)) {
                        ox += di * 0.24;
                        oz += dj * 0.24;
                    }
                } else if (this.underPanel(i, j)) {
                    // Beside the light rather than over it.
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
        // Tied to the backs of chairs that are standing up.
        for (const prop of this.chunk.props) {
            if (prop.type !== PROP_CHAIR || (prop.variant & 3) === 0 || this.random() >= 0.5) continue;
            const bx = prop.x - Math.sin(prop.yaw) * 0.09;
            const bz = prop.z - Math.cos(prop.yaw) * 0.09;
            this.bunch(bx, 0.33, bz, 2 + Math.floor(this.random() * 3), 0.08);
        }
        // Tied down to a weight on the floor.
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
    }

    /** A few balloons up against the ceiling around (x, z), trailing their strings. */
    ceilingCluster(x, z, count, spread) {
        const start = this.random() * Math.PI * 2;
        for (let k = 0; k < count; k++) {
            const angle = start + k * 2.4 + this.random() * 0.5;
            const distance = k === 0 ? this.random() * 0.03 : spread * (0.55 + this.random() * 0.45);
            const size = 0.88 + this.random() * 0.24;
            this.dressing.balloons.push({
                x: x + Math.cos(angle) * distance,
                y: WALL_HEIGHT - BALLOON_HEIGHT * size - 0.002 - this.random() * 0.012,
                z: z + Math.sin(angle) * distance,
                color: Math.floor(this.random() * PARTY_COLORS),
                size,
                phase: this.random() * Math.PI * 2,
                tie: null,
                tail: 0.16 + this.random() * 0.22,
            });
        }
    }

    /** A bunch of balloons on strings tied at (x, y, z), floating around head height. */
    bunch(x, y, z, count, spread) {
        const start = this.random() * Math.PI * 2;
        const tie = { x, y, z };
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
                tie,
                tail: 0,
            });
        }
    }

    /**
     * Streamers swagged across a room from wall to wall, along a row of cells with nothing in between, the
     * whole way inside the chunk.
     */
    streamers() {
        const count = (this.zone === ZONE_MAZE ? 0 : 1) + Math.floor(this.random() * 3);
        for (let n = 0; n < count; n++) {
            for (let attempt = 0; attempt < 10; attempt++) {
                const [i, j] = this.randomCell();
                if (this.inFirstRoom(i, j)) continue;
                const alongX = this.random() < 0.5;
                const [di, dj] = alongX ? [1, 0] : [0, 1];
                // Out to the wall each way.
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
                this.dressing.streamers.push(alongX
                    ? { ax: from, az: at, bx: to, bz: at, sag, colors }
                    : { ax: at, az: from, bx: at, bz: to, sag, colors });
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
                // Along the wall: the other axis.
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
                this.dressing.bunting.push({ ...bunting, y: 0.95, sag: 0.03 + 0.008 * (lo + hi), flag: 0.055, color: Math.floor(this.random() * PARTY_COLORS), letters: null });
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
            const shift = this.underPanel(i, j) ? 0.3 : 0;
            this.dressing.ribbons.push({
                x: this.x0 + i + shift + (this.random() - 0.5) * 0.3,
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

    /** =) drawn on the walls, now and then. */
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

    /** Now and then, one of the guests, standing where it can be seen from a way off. */
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
}
