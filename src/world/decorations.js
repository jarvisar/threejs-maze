import { CHUNK_SIZE } from '../config.js';
import { DIRECTIONS, EDGE_WALL } from './grid.js';

/*
 * The few things that aren't walls: water damage, and objects left behind. Both are placed while a chunk
 * is generated, from the same random stream as its walls (after them, so the layouts of existing worlds
 * are unchanged), and both are rare on purpose. An office chair on its own in the middle of an empty
 * floor is unsettling; a room full of them is furniture.
 *
 * Everything here is positioned so it never gets in the way: props keep to the inside of their cell (the
 * walls, doorways and pillars are all on the cell's border) and the box the player collides with is small
 * enough to walk around in a one-cell maze passage.
 */

const N = CHUNK_SIZE;

export const PROP_CHAIR = 0; // an office chair, sometimes on its side
export const PROP_MONITOR = 1; // a dead CRT monitor on the floor
export const PROP_BOTTLES = 2; // one to three bottles of almond water
export const PROP_SIGN = 3; // a yellow "wet floor" sign
export const PROP_TILE = 4; // a sodden ceiling tile that has fallen and broken, under the hole it left
// Level 1's (see levelOneProps.js).
export const PROP_CRATES = 5; // one to three wooden supply crates
export const PROP_BOXES = 6; // a pile of cardboard boxes
export const PROP_PALLET = 7; // a wooden pallet, empty or loaded
export const PROP_BARREL = 8; // one or two steel drums, sometimes knocked over
export const PROP_CONE = 9; // a traffic cone or two
export const PROP_RACK = 10; // a bay of pallet racking with things on its shelves
// Level 37's, only put down in edit mode (the pools' own float about; see poolrooms.js).
export const PROP_LIFEBUOY = 11; // a red and white lifebuoy
export const PROP_RING = 12; // an inflatable ring
export const PROP_BALL = 13; // a beach ball
// Level Fun's, only put down in edit mode, once it's been found: the same things its party has (in the same order as
// PARTY_CAKE...; see party.js), drawn by its own meshes (partyGeometry.js).
export const PROP_CAKE = 14; // a table with a birthday cake on it
export const PROP_PRESENTS = 15; // one to three wrapped presents
export const PROP_HAT = 16; // a party hat
export const PROP_BALLOONS = 17; // a bunch of balloons tied down to a weight
// Level 2's (see pipeDreamsProps.js).
export const PROP_SHELF = 18; // a steel shelving unit against a wall, with whatever was left on it
export const PROP_TOOLBOX = 19; // a steel toolbox or two, one sometimes open
export const PROP_BUCKET = 20; // a galvanised bucket, or a mop bucket with its mop
export const PROP_CYLINDERS = 21; // one to three gas cylinders, one sometimes lying down
// Level 5's (see terrorHotelProps.js).
export const PROP_SUITCASE = 22; // a leather suitcase or two, or a trunk, with a hatbox now and then
export const PROP_TROLLEY = 23; // a room-service trolley, or just the tray, left outside a door
export const PROP_CART = 24; // a brass luggage cart, with cases on it
export const PROP_PALM = 25; // a palm in a brass planter
/**
 * A palm against a wall (this bit of its variant set; the low four are its shape): its fronds spread over the half in
 * front of it (its own +z), so nothing of it reaches back further than its pot's rim, PALM_BACK from its middle.
 */
export const PALM_WALL = 0x10;
export const PALM_BACK = 0.082;
// Level 4's (see abandonedOfficeProps.js).
export const PROP_COOLER = 26; // a water cooler, its bottle full, half gone, empty or taken away
export const PROP_FICUS = 27; // an office plant in a pot, a ficus or a floor plant, green or dying
export const PROP_BIN = 28; // a waste bin, with paper in it or not, sometimes knocked over
export const PROP_FILES = 29; // files left on the floor: lever-arch files, archive boxes, loose paper
// The rest are only ever put down in edit mode, each level's in its own section of the tools (see `decorations` in
// levels.js). Level 0's: what someone brought in with them, and left.
export const PROP_TV = 30; // a television on its stand, a video under it, showing snow or a blue screen, or off
export const PROP_CAMCORDER = 31; // a camcorder on its tripod, still recording
export const PROP_LAMP = 32; // a standard lamp, on or off
export const PROP_NOTE = 33; // a note taped to a wall: one of a tape's (see noteTextures.js)
// Level 1's.
export const PROP_TYRES = 34; // car tyres, stacked, one sometimes leaning on the stack
export const PROP_BARRIER = 35; // a striped road barrier on its feet, its lamp flashing or not
export const PROP_JACK = 36; // a pallet jack, its handle up
// Level 2's.
export const PROP_VALVE = 37; // a pipe up out of the floor, a wheel valve on it, and a gauge
export const PROP_LOCKERS = 38; // two or three steel lockers, one sometimes open
export const PROP_WORK_LIGHT = 39; // a work light on its tripod, lit or dead
export const PROP_FUSE_BOX = 40; // a fuse box on a wall, its conduit up to the ceiling
// Level 4's: its furniture (see abandonedOfficeFurniture.js), made the way it is there (see furnitureProps.js), and
// what hangs on its walls.
export const PROP_DESK = 41; // a desk, its computer and its chair
export const PROP_VENDING = 42; // a vending machine, lit
export const PROP_CABINET = 43; // a filing cabinet, a drawer sometimes left open
export const PROP_COPIER = 44; // a photocopier
export const PROP_SOFA = 45; // a sofa, and a low table in front of it
export const PROP_FRIDGE = 46; // a tall fridge
export const PROP_CHAIRS = 47; // stacked chairs
export const PROP_TABLE = 48; // a small round table, and its chairs
export const PROP_BINDERS = 49; // a bookcase of binders
export const PROP_WHITEBOARD = 50; // on a wall
export const PROP_WALL_CLOCK = 51; // on a wall
export const PROP_EXTINGUISHER = 52; // on a wall, its sign over it
export const PROP_EXIT = 53; // an EXIT sign, lit, high on a wall
// Level 5's: its furniture (see terrorHotelFurniture.js), made the way it is there (see furnitureProps.js), and a
// portrait.
export const PROP_ARMCHAIR = 54; // a wingback
export const PROP_CHESTERFIELD = 55;
export const PROP_BED = 56; // a single or a double
export const PROP_NIGHTSTAND = 57; // with its lamp on
export const PROP_WARDROBE = 58;
export const PROP_PIANO = 59; // a grand piano and its stool
export const PROP_CLOCK = 60; // a long-case clock
export const PROP_SIDE_TABLE = 61; // a round lamp table, its lamp on
export const PROP_WRITING_DESK = 62; // and its chair
export const PROP_BOOKCASE = 63;
export const PROP_FIREPLACE = 64; // marble, cold, a mirror over it
export const PROP_CONSOLE = 65; // a half-round table, against a wall
export const PROP_CHALKBOARD = 66; // on its easel, the menu on it
export const PROP_FLOWERS = 67; // a round table, a tall vase of flowers on it
export const PROP_MAHJONG = 68; // the Beverly Room's table: drinks, and a game of mahjong left half played
export const PROP_PORTRAIT = 69; // in a gilt frame, on a wall
// Level 37's.
export const PROP_LOUNGER = 70; // a sun lounger, a towel on it now and then
export const PROP_POOL_CHAIR = 71; // a white plastic chair, or a stack of them
export const PROP_TOWELS = 72; // towels, folded, or one dropped
export const PROP_NOODLES = 73; // pool noodles
export const PROP_LIFEGUARD = 74; // a lifeguard's chair, a lifebuoy hung on it
// Level Fun's again (see PROP_CAKE): one of its guests, who turns to watch you and pops if you get too close, like the
// party's own, and is back a while later (see PartyLayer.js).
export const PROP_GUEST = 75;

export const PROP_NAMES = [
    'chair', 'monitor', 'bottles', 'sign', 'tile', 'crates', 'boxes', 'pallet', 'barrel', 'cone', 'rack', 'lifebuoy', 'ring', 'ball',
    'cake', 'presents', 'hat', 'balloons', 'shelf', 'toolbox', 'bucket', 'cylinders', 'suitcase', 'trolley', 'cart', 'palm',
    'cooler', 'plant', 'bin', 'files',
    'tv', 'camcorder', 'lamp', 'note',
    'tyres', 'barrier', 'pallet jack',
    'valve', 'lockers', 'work light', 'fuse box',
    'desk', 'vending machine', 'cabinet', 'copier', 'sofa', 'fridge', 'chairs', 'table', 'binders', 'whiteboard', 'wall clock',
    'extinguisher', 'exit sign',
    'armchair', 'chesterfield', 'bed', 'nightstand', 'wardrobe', 'piano', 'clock', 'side table', 'writing desk', 'bookcase',
    'fireplace', 'console', 'chalkboard', 'flowers', 'mahjong', 'portrait',
    'lounger', 'pool chair', 'towels', 'noodles', 'lifeguard chair',
    'partygoer',
];

/** Whether a prop is one of Level Fun's, drawn with the party (see partyGeometry.js) rather than with the rest. */
export function isPartyProp(type) {
    return type >= PROP_CAKE && type <= PROP_BALLOONS;
}

/**
 * Whether a prop's pictures are among those drawn only once they're wanted (see drawEditPictures in
 * decorationTextures.js): what only edit mode puts down, from PROP_TV on, but for a partygoer (the party's own).
 * @param {number} type
 */
export function usesEditPictures(type) {
    return type >= PROP_TV && type !== PROP_GUEST;
}

/** The props that hang on a wall rather than stand on the floor (see EditTool): nothing walks into them. */
const HUNG = new Set([PROP_NOTE, PROP_FUSE_BOX, PROP_WHITEBOARD, PROP_WALL_CLOCK, PROP_EXTINGUISHER, PROP_EXIT, PROP_PORTRAIT]);

/**
 * Whether a prop hangs on a wall. It's built with its back to the wall at its own z = 0 and its front towards +z, and
 * as high on it as it hangs, and it stands in the cell whose side of the wall it's on, up against it.
 * @param {number} type
 */
export function isHungProp(type) {
    return HUNG.has(type);
}

/**
 * How far each kind of prop that floats sits down in water: in a pool it floats at the surface rather than lying on
 * the bottom (see restingHeight).
 */
const PROP_DRAFT = new Map([[PROP_LIFEBUOY, 0.018], [PROP_RING, 0.028], [PROP_BALL, 0.013], [PROP_NOODLES, 0.012]]);
// Under deeper water than this you swim over a prop, not into it (you float once it's past your chin).
const SWIM_OVER = 0.43;

/**
 * Half-size of the square the player collides with, per prop type (0: you walk straight through). Level 1's props
 * come in shapes that aren't square; theirs is worked out from the variant (see solidHalfSize).
 */
export const PROP_SOLID_HALF = [0.1, 0.08, 0, 0.08, 0, 0.13, 0.1, 0.15, 0.08, 0.04, 0.3];

// How far a prop pushed up against a wall stands from the middle of its cell.
const AGAINST_WALL = 0.22;
// How far a wet floor sign stands from the middle of its cell, across from a fallen tile: the tile reaches 0.175 from
// where it lies and the sign 0.106 from where it stands, so this keeps them apart wherever the tile is.
const SIGN_FROM_TILE = 0.3;
// Where the spawn room is (see stampSpawnRoom); nothing is placed in it.
const SPAWN_ROOM = { x0: -3, x1: 3, z0: -3, z1: 2 };

/**
 * @typedef {object} Prop
 * @property {number} type One of the PROP_* constants.
 * @property {number} x World position of the prop's centre, on the floor.
 * @property {number} z
 * @property {number} yaw Rotation about y in radians; the prop's front faces +z at 0.
 * @property {number} variant A 32-bit value each kind of prop reads what it likes from (tipped over, how
 *     many bottles, which are lying down...).
 * @property {number[] | null} box What the player collides with, as [minX, minZ, maxX, maxZ]; null for
 *     something you walk straight through.
 * @property {number} [index] Where it comes in the list of props its chunk was generated with, which is how
 *     a removed one is remembered (see edits.js). Props put down in edit mode have none.
 * @property {number} [y] How high it stands: the floor under it, on a level whose floor isn't flat (see
 *     settleProp). Left out, 0.
 */

/**
 * @typedef {object} Leak
 * @property {number} x World position of the stain's centre on the ceiling.
 * @property {number} z
 * @property {number} radius Of the ceiling stain.
 * @property {number} floorX Centre of the wet patch on the carpet under it.
 * @property {number} floorZ
 * @property {number} floorRadius
 * @property {number} variant 32-bit, for picking pictures and rotations.
 */

/**
 * Chooses the props and leaks of one chunk.
 *
 * @param {() => number} random The chunk's random stream.
 * @param {(i: number, j: number, di: number, dj: number) => number} edgeBetween Type of the edge between
 *     local cell (i, j) and its neighbour in direction (di, dj).
 * @param {number} x0 World coordinates of the chunk's first cell.
 * @param {number} z0
 * @returns {{ props: Prop[], leaks: Leak[] }}
 */
export function placeDecorations(random, edgeBetween, x0, z0) {
    /** @type {Prop[]} */
    const props = [];
    /** @type {Leak[]} */
    const leaks = [];
    // Cells already holding something, plus a ring around them, so things don't crowd together.
    const taken = new Uint8Array(N * N);
    const free = (i, j) => {
        if (taken[i * N + j]) return false;
        const x = x0 + i;
        const z = z0 + j;
        return x < SPAWN_ROOM.x0 || x > SPAWN_ROOM.x1 || z < SPAWN_ROOM.z0 || z > SPAWN_ROOM.z1;
    };
    const take = (i, j) => {
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                const ii = i + di;
                const jj = j + dj;
                if (ii >= 0 && jj >= 0 && ii < N && jj < N) taken[ii * N + jj] = 1;
            }
        }
    };
    const variant = () => (random() * 4294967296) >>> 0;

    // Leaks: water has come through the ceiling and soaked the carpet underneath. The stain stays clear of
    // the light panels (above every cell with two odd coordinates) and the wet patch stays inside its cell,
    // so it never runs under a wall.
    const leakRoll = random();
    const leakCount = leakRoll < 0.55 ? 0 : leakRoll < 0.92 ? 1 : 2;
    for (let n = 0; n < leakCount; n++) {
        for (let attempt = 0; attempt < 10; attempt++) {
            const i = 1 + Math.floor(random() * (N - 2));
            const j = 1 + Math.floor(random() * (N - 2));
            const x = x0 + i;
            const z = z0 + j;
            if (((x & 1) && (z & 1)) || !free(i, j)) continue;
            const radius = 0.26 + random() * 0.2;
            const ox = (random() - 0.5) * 0.2;
            const oz = (random() - 0.5) * 0.2;
            // Someone has been by and put a sign next to it, now and then.
            const withSign = random() < 0.3;
            const floorRadius = withSign ? 0.17 + random() * 0.06 : 0.18 + random() * 0.17;
            // The drips land more or less straight down.
            const fx = clamp(ox + (random() - 0.5) * 0.1, floorRadius);
            const fz = clamp(oz + (random() - 0.5) * 0.1, floorRadius);
            const leak = { x: x + ox, z: z + oz, radius, floorX: x + fx, floorZ: z + fz, floorRadius, variant: variant() };
            leaks.push(leak);
            // A fallen tile lies on the wet patch, more or less under the hole (from the leak's own bits, so this
            // adds nothing to the random stream).
            const v = leak.variant;
            const fell = tileFell(leak);
            const tx = Math.max(-0.26, Math.min(0.26, fx * 0.6 + (((v >>> 23) & 15) / 15 - 0.5) * 0.12));
            const tz = Math.max(-0.26, Math.min(0.26, fz * 0.6 + (((v >>> 27) & 15) / 15 - 0.5) * 0.12));
            if (fell) props.push(makeProp(PROP_TILE, x + tx, z + tz, ((v >>> 12) & 255) / 256 * 2 * Math.PI, v));
            if (withSign) {
                // On the far side of the cell from the wet patch, so it stands at its edge rather than in it. Where a
                // tile has come down on the patch, straight across from the tile instead, far enough out to be clear
                // of it wherever it lies.
                const jx = (random() - 0.5) * 0.06;
                const jz = (random() - 0.5) * 0.06;
                const [ax, az] = fell ? [tx, tz] : [fx, fz];
                const length = Math.hypot(ax, az);
                const [ux, uz] = length > 0 ? [-ax / length, -az / length] : [1, 0];
                const sx = fell ? ux * SIGN_FROM_TILE : ux * 0.26 + jx;
                const sz = fell ? uz * SIGN_FROM_TILE : uz * 0.26 + jz;
                props.push(makeProp(PROP_SIGN, x + sx, z + sz, random() * Math.PI * 2, variant()));
            }
            take(i, j);
            break;
        }
    }

    // Loose objects. Most chunks have none.
    const propRoll = random();
    const propCount = propRoll < 0.6 ? 0 : propRoll < 0.92 ? 1 : 2;
    for (let n = 0; n < propCount; n++) {
        const typeRoll = random();
        const type = typeRoll < 0.3 ? PROP_CHAIR : typeRoll < 0.52 ? PROP_MONITOR : typeRoll < 0.8 ? PROP_BOTTLES : PROP_SIGN;
        for (let attempt = 0; attempt < 12; attempt++) {
            const i = Math.floor(random() * N);
            const j = Math.floor(random() * N);
            if (!free(i, j)) continue;
            const x = x0 + i;
            const z = z0 + j;
            const v = variant();
            // A chair on its side takes up most of the cell; it stays in the middle.
            const tipped = type === PROP_CHAIR && (v & 3) === 0;
            const walls = DIRECTIONS.filter(([di, dj]) => edgeBetween(i, j, di, dj) === EDGE_WALL);
            if (walls.length > 0 && !tipped && type !== PROP_SIGN && random() < 0.8) {
                // Pushed up against a wall, facing into the room.
                const [di, dj] = walls[Math.floor(random() * walls.length)];
                const along = (random() - 0.5) * 0.4;
                props.push(makeProp(
                    type,
                    x + di * AGAINST_WALL + (di === 0 ? along : 0),
                    z + dj * AGAINST_WALL + (dj === 0 ? along : 0),
                    Math.atan2(-di, -dj) + (random() - 0.5) * 0.5,
                    v,
                ));
            } else {
                props.push(makeProp(type, x + (random() - 0.5) * 0.2, z + (random() - 0.5) * 0.2, random() * Math.PI * 2, v));
            }
            take(i, j);
            break;
        }
    }

    return { props, leaks };
}

/** Whether a leak has brought its ceiling tile down (decals.js leaves a hole; the tile is on the floor). */
export function tileFell(leak) {
    return ((leak.variant >>> 20) & 7) < 2;
}

/** Keeps a wet patch of the given radius, offset by `offset` from its cell's centre, inside the cell. */
function clamp(offset, radius) {
    const limit = 0.44 - radius;
    return Math.max(-limit, Math.min(limit, offset));
}

/**
 * Stands a prop on the floor at `ground` (Level 37's goes down into pools): on it, or floating at the surface if it
 * floats and the water's deep enough. Down where you'd swim over it, nothing stops you.
 * @param {Prop} prop
 * @param {number} ground
 */
export function settleProp(prop, ground) {
    const draft = PROP_DRAFT.get(prop.type);
    prop.y = draft === undefined ? ground : Math.max(ground, -draft);
    if (prop.y < -SWIM_OVER) prop.box = null;
}

/** @returns {Prop} */
export function makeProp(type, x, z, yaw, variant) {
    if (type >= PROP_CRATES) return { type, x, z, yaw, variant, box: turnedBox(x, z, yaw, solidHalfSize(type, variant)) };
    const half = PROP_SOLID_HALF[type];
    const box = half > 0 ? [x - half, z - half, x + half, z + half] : null;
    return { type, x, z, yaw, variant, box };
}

/**
 * What of one of the later levels' props is solid, as half its size across (its own x) and front to back (its own z),
 * a little inside what's drawn (see props.js for the shapes); null for something you walk through.
 * @param {number} type
 * @param {number} variant
 * @returns {[number, number] | null}
 */
export function solidHalfSize(type, variant) {
    switch (type) {
        case PROP_CRATES: {
            const arrangement = variant & 3;
            return arrangement === 1 || arrangement === 3 ? [0.22, 0.095] : [0.11, 0.095];
        }
        case PROP_BOXES:
            return [0.14, 0.11];
        case PROP_PALLET:
            return [0.22, 0.185];
        case PROP_BARREL:
            // Two, or one lying on its side, take up more.
            return (variant & 1) === 1 ? [0.2, 0.1] : ((variant >>> 1) & 3) === 0 ? [0.16, 0.1] : [0.1, 0.1];
        case PROP_CONE:
            // Standing: small, and solid enough to walk round. Knocked over: kicked out of the way.
            return ((variant >>> 2) & 3) === 0 ? null : [0.045, 0.045];
        case PROP_RACK:
            return [0.45, 0.16];
        // The same as the party's own (see TABLE_LENGTH and PRESENTS_HALF in party.js).
        case PROP_CAKE:
            return [0.17, 0.09];
        case PROP_PRESENTS:
            return [0.075, 0.075];
        case PROP_SHELF:
            return [0.31, 0.075];
        case PROP_TOOLBOX:
            return (variant & 1) === 1 ? [0.14, 0.05] : [0.085, 0.045];
        case PROP_BUCKET:
            return [0.055, 0.055];
        case PROP_CYLINDERS: {
            // One lying down takes up more.
            const count = 1 + (variant % 3);
            if (((variant >>> 2) & 3) === 0) return [0.23, 0.05 + 0.045 * (count - 1)];
            return [0.05 + 0.047 * (count - 1), 0.05];
        }
        case PROP_SUITCASE:
            // A trunk takes up more.
            return (variant & 3) === 0 ? [0.15, 0.09] : [0.13, 0.07];
        case PROP_TROLLEY:
            // Just the tray, on the floor: nothing to walk into.
            return (variant & 1) === 0 ? null : [0.15, 0.1];
        case PROP_CART:
            return [0.2, 0.11];
        case PROP_PALM:
            return [0.07, 0.07];
        case PROP_COOLER:
            // With a spare bottle beside it, it takes up more (the two are centred on what they cover).
            return ((variant >>> 2) & 1) === 1 ? [0.11, 0.06] : [0.06, 0.06];
        case PROP_FICUS:
            // The pot.
            return [0.05, 0.05];
        case PROP_BIN:
            // Knocked over: kicked out of the way.
            return ((variant >>> 5) & 3) === 0 ? null : [0.055, 0.055];
        case PROP_FILES:
            // Files on a box are only the box.
            return (variant & 3) === 3 ? [0.065, 0.055] : [0.12, 0.055];
        case PROP_LOCKERS:
            return [lockerCount(variant) * 0.055 - 0.005, 0.07];
        case PROP_BED:
            // A single's narrower (see furnitureHalf in terrorHotelFurniture.js).
            return (variant & 1) === 0 ? [0.19, 0.375] : [0.28, 0.375];
        default:
            return SOLID_HALF.get(type) ?? null;
    }
}

/**
 * The rest of the props only edit mode puts down that are solid, as solidHalfSize has them. Level 4's and Level 5's
 * furniture is as solid here as it is on its own level (see HALF in abandonedOfficeFurniture.js, and in
 * terrorHotelFurniture.js, a little in from what's drawn): the Beverly Room's table is only the table, and a desk and
 * a sofa are without the chair behind the one and the table in front of the other.
 */
const SOLID_HALF = new Map([
    [PROP_TV, [0.1, 0.07]],
    [PROP_CAMCORDER, [0.05, 0.05]],
    [PROP_LAMP, [0.045, 0.045]],
    [PROP_TYRES, [0.115, 0.115]],
    [PROP_BARRIER, [0.2, 0.05]],
    [PROP_JACK, [0.09, 0.24]],
    [PROP_VALVE, [0.06, 0.06]],
    [PROP_WORK_LIGHT, [0.05, 0.05]],
    [PROP_DESK, [0.26, 0.13]],
    [PROP_VENDING, [0.15, 0.15]],
    [PROP_CABINET, [0.075, 0.1]],
    [PROP_COPIER, [0.16, 0.12]],
    [PROP_SOFA, [0.26, 0.2]],
    [PROP_FRIDGE, [0.13, 0.12]],
    [PROP_CHAIRS, [0.1, 0.1]],
    [PROP_TABLE, [0.12, 0.12]],
    [PROP_BINDERS, [0.17, 0.07]],
    [PROP_ARMCHAIR, [0.14, 0.14]],
    [PROP_CHESTERFIELD, [0.395, 0.145]],
    [PROP_NIGHTSTAND, [0.07, 0.062]],
    [PROP_WARDROBE, [0.19, 0.1]],
    [PROP_PIANO, [0.26, 0.33]],
    [PROP_CLOCK, [0.1, 0.065]],
    [PROP_SIDE_TABLE, [0.08, 0.08]],
    [PROP_WRITING_DESK, [0.21, 0.19]],
    [PROP_BOOKCASE, [0.23, 0.075]],
    [PROP_FIREPLACE, [0.33, 0.08]],
    [PROP_CONSOLE, [0.14, 0.052]],
    [PROP_CHALKBOARD, [0.09, 0.06]],
    [PROP_FLOWERS, [0.19, 0.19]],
    [PROP_MAHJONG, [0.25, 0.25]],
    [PROP_LOUNGER, [0.11, 0.33]],
    [PROP_POOL_CHAIR, [0.09, 0.09]],
    [PROP_LIFEGUARD, [0.14, 0.14]],
]);

/** How many lockers stand in a row (see lockers in props.js). @param {number} variant */
export function lockerCount(variant) {
    return 2 + (variant & 1);
}

/** The axis-aligned box round a rectangle of half-size [hx, hz], turned by yaw, at (x, z). */
function turnedBox(x, z, yaw, half) {
    if (!half) return null;
    const cos = Math.abs(Math.cos(yaw));
    const sin = Math.abs(Math.sin(yaw));
    const hx = half[0] * cos + half[1] * sin;
    const hz = half[0] * sin + half[1] * cos;
    return [x - hx, z - hz, x + hx, z + hz];
}
