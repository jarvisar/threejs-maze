import { CHUNK_SIZE } from '../config.js';
import { DIRECTIONS, EDGE_WALL } from './grid.js';

/*
 * Non-wall decorations: water damage and props left behind. Placed during chunk generation from the chunk's random
 * stream, after the walls so existing world layouts don't change. Both are rare on purpose. One office chair in an
 * empty room is unsettling, a room full of them is just furniture.
 *
 * Props stay inside their cell (walls, doorways and pillars are on the cell border) and their collision box is small
 * enough to walk around in a one-cell passage.
 */

const N = CHUNK_SIZE;

export const PROP_CHAIR = 0; // office chair, sometimes on its side
export const PROP_MONITOR = 1; // dead CRT monitor on the floor
export const PROP_BOTTLES = 2; // 1-3 bottles of almond water
export const PROP_SIGN = 3; // yellow "wet floor" sign
export const PROP_TILE = 4; // soaked ceiling tile that fell and broke, under the hole it left
// Level 1 (see levelOneProps.js).
export const PROP_CRATES = 5; // 1-3 wooden supply crates
export const PROP_BOXES = 6; // pile of cardboard boxes
export const PROP_PALLET = 7; // wooden pallet, empty or loaded
export const PROP_BARREL = 8; // 1 or 2 steel drums, sometimes knocked over
export const PROP_CONE = 9; // 1 or 2 traffic cones
export const PROP_RACK = 10; // pallet racking bay with stuff on the shelves
// Level 37, edit mode only. The pools' own floating props are in poolrooms.js.
export const PROP_LIFEBUOY = 11; // red and white lifebuoy
export const PROP_RING = 12; // inflatable ring
export const PROP_BALL = 13; // beach ball
// Level Fun, edit mode only once it's been found. Same things as its party, in the same order as PARTY_CAKE... (see
// party.js), drawn by its own meshes (partyGeometry.js).
export const PROP_CAKE = 14; // table with a birthday cake
export const PROP_PRESENTS = 15; // 1-3 wrapped presents
export const PROP_HAT = 16; // party hat
export const PROP_BALLOONS = 17; // bunch of balloons tied to a weight
// Level 2 (see pipeDreamsProps.js).
export const PROP_SHELF = 18; // steel shelving against a wall, with leftover stuff on it
export const PROP_TOOLBOX = 19; // 1 or 2 steel toolboxes, sometimes one open
export const PROP_BUCKET = 20; // galvanized bucket, or mop bucket with mop
export const PROP_CYLINDERS = 21; // 1-3 gas cylinders, sometimes one lying down
// Level 5 (see terrorHotelProps.js).
export const PROP_SUITCASE = 22; // 1 or 2 leather suitcases or a trunk, sometimes a hatbox
export const PROP_TROLLEY = 23; // room service trolley, or just the tray, outside a door
export const PROP_CART = 24; // brass luggage cart with cases
export const PROP_PALM = 25; // palm in a brass planter
/**
 * Variant bit for a palm against a wall (the low 4 bits are its shape). Its fronds spread over its front half (+z)
 * so nothing reaches back past the pot rim, PALM_BACK from its center.
 */
export const PALM_WALL = 0x10;
export const PALM_BACK = 0.082;
// Level 4 (see abandonedOfficeProps.js).
export const PROP_COOLER = 26; // water cooler, bottle full, half, empty or missing
export const PROP_FICUS = 27; // potted ficus or floor plant, green or dying
export const PROP_BIN = 28; // waste bin, with or without paper, sometimes knocked over
export const PROP_FILES = 29; // lever-arch files, archive boxes and loose paper on the floor
// The rest are edit mode only, each level's in its own section of the tools (see `decorations` in levels.js).
// Level 0: things someone brought in and left.
export const PROP_TV = 30; // TV on a stand with a VCR, showing snow, a blue screen, or off
export const PROP_CAMCORDER = 31; // camcorder on a tripod, still recording
export const PROP_LAMP = 32; // floor lamp, on or off
export const PROP_NOTE = 33; // a tape's note taped to a wall (see noteTextures.js)
// Level 1.
export const PROP_TYRES = 34; // stacked car tires, sometimes one leaning on the stack
export const PROP_BARRIER = 35; // striped road barrier, lamp flashing or not
export const PROP_JACK = 36; // pallet jack, handle up
// Level 2.
export const PROP_VALVE = 37; // pipe out of the floor with a wheel valve and gauge
export const PROP_LOCKERS = 38; // 2 or 3 steel lockers, sometimes one open
export const PROP_WORK_LIGHT = 39; // work light on a tripod, lit or dead
export const PROP_FUSE_BOX = 40; // fuse box on a wall, conduit up to the ceiling
// Level 4 furniture (see abandonedOfficeFurniture.js), built the same way as there (see furnitureProps.js), plus
// wall items.
export const PROP_DESK = 41; // desk with computer and chair
export const PROP_VENDING = 42; // lit vending machine
export const PROP_CABINET = 43; // filing cabinet, sometimes a drawer open
export const PROP_COPIER = 44; // photocopier
export const PROP_SOFA = 45; // sofa with a coffee table
export const PROP_FRIDGE = 46; // tall fridge
export const PROP_CHAIRS = 47; // stacked chairs
export const PROP_TABLE = 48; // small round table with chairs
export const PROP_BINDERS = 49; // bookcase of binders
export const PROP_WHITEBOARD = 50; // on a wall
export const PROP_WALL_CLOCK = 51; // on a wall
export const PROP_EXTINGUISHER = 52; // on a wall with its sign above
export const PROP_EXIT = 53; // lit EXIT sign, high on a wall
// Level 5 furniture (see terrorHotelFurniture.js), built the same way as there (see furnitureProps.js), plus a
// portrait.
export const PROP_ARMCHAIR = 54; // wingback
export const PROP_CHESTERFIELD = 55;
export const PROP_BED = 56; // single or double
export const PROP_NIGHTSTAND = 57; // with its lamp on
export const PROP_WARDROBE = 58;
export const PROP_PIANO = 59; // grand piano and stool
export const PROP_CLOCK = 60; // grandfather clock
export const PROP_SIDE_TABLE = 61; // round lamp table, lamp on
export const PROP_WRITING_DESK = 62; // with its chair
export const PROP_BOOKCASE = 63;
export const PROP_FIREPLACE = 64; // cold marble fireplace with a mirror above
export const PROP_CONSOLE = 65; // half-round table against a wall
export const PROP_CHALKBOARD = 66; // menu board on an easel
export const PROP_FLOWERS = 67; // round table with a tall vase of flowers
export const PROP_MAHJONG = 68; // Beverly Room table with drinks and a half-played game of mahjong
export const PROP_PORTRAIT = 69; // gilt frame, on a wall
// Level 37.
export const PROP_LOUNGER = 70; // sun lounger, sometimes with a towel
export const PROP_POOL_CHAIR = 71; // white plastic chair, or a stack
export const PROP_TOWELS = 72; // folded towels, or one dropped
export const PROP_NOODLES = 73; // pool noodles
export const PROP_LIFEGUARD = 74; // lifeguard chair with a lifebuoy on it
// Level Fun again (see PROP_CAKE). A guest that turns to watch you and pops if you get too close, like the party's
// own, and comes back later (see PartyLayer.js).
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

/** True for Level Fun props, which are drawn with the party meshes (see partyGeometry.js). */
export function isPartyProp(type) {
    return type >= PROP_CAKE && type <= PROP_BALLOONS;
}

/**
 * True if a prop's pictures are only drawn once needed (see drawEditPictures in decorationTextures.js). That's the
 * edit-mode-only props from PROP_TV on, except the partygoer, which uses the party's.
 * @param {number} type
 */
export function usesEditPictures(type) {
    return type >= PROP_TV && type !== PROP_GUEST;
}

/** Props that hang on a wall instead of standing on the floor (see EditTool). You can't walk into them. */
const HUNG = new Set([PROP_NOTE, PROP_FUSE_BOX, PROP_WHITEBOARD, PROP_WALL_CLOCK, PROP_EXTINGUISHER, PROP_EXIT, PROP_PORTRAIT]);

/**
 * True if a prop hangs on a wall. It's built with its back on the wall at local z = 0, facing +z, at its hanging
 * height. It belongs to the cell on its side of the wall.
 * @param {number} type
 */
export function isHungProp(type) {
    return HUNG.has(type);
}

/**
 * How deep each floating prop sits in water. In a pool it floats at the surface instead of lying on the bottom
 * (see settleProp).
 */
const PROP_DRAFT = new Map([[PROP_LIFEBUOY, 0.018], [PROP_RING, 0.028], [PROP_BALL, 0.013], [PROP_NOODLES, 0.012]]);
// Deeper than this you swim over a prop instead of into it. You float once the water's past your chin.
const SWIM_OVER = 0.43;

/**
 * Half-size of each prop type's square collision box (0 = walk through). Props from PROP_CRATES on aren't square,
 * so theirs comes from the variant (see solidHalfSize).
 */
export const PROP_SOLID_HALF = [0.1, 0.08, 0, 0.08, 0, 0.13, 0.1, 0.15, 0.08, 0.04, 0.3];

// Distance from cell center for a prop pushed against a wall.
const AGAINST_WALL = 0.22;
// Wet floor sign distance from cell center, opposite a fallen tile. The tile reaches 0.175 from its center and the
// sign 0.106, so this keeps them apart wherever the tile is.
const SIGN_FROM_TILE = 0.3;
// Spawn room bounds (see stampSpawnRoom). Nothing is placed in it.
const SPAWN_ROOM = { x0: -3, x1: 3, z0: -3, z1: 2 };

/**
 * @typedef {object} Prop
 * @property {number} type One of the PROP_* constants.
 * @property {number} x World position of the prop's center, on the floor.
 * @property {number} z
 * @property {number} yaw Rotation about y in radians. Front faces +z at 0.
 * @property {number} variant 32-bit value each prop type reads its options from (tipped over, bottle count,
 *     which are lying down...).
 * @property {number[] | null} box Collision box as [minX, minZ, maxX, maxZ], or null to walk through.
 * @property {number} [index] Position in the chunk's generated prop list, used to remember removals (see
 *     edits.js). Edit mode props have none.
 * @property {number} [y] Floor height under it on levels with uneven floors (see settleProp). Defaults to 0.
 */

/**
 * @typedef {object} Leak
 * @property {number} x World position of the ceiling stain's center.
 * @property {number} z
 * @property {number} radius Of the ceiling stain.
 * @property {number} floorX Center of the wet carpet patch below.
 * @property {number} floorZ
 * @property {number} floorRadius
 * @property {number} variant 32-bit, for picking pictures and rotations.
 */

/**
 * Picks one chunk's props and leaks.
 *
 * @param {() => number} random The chunk's random stream.
 * @param {(i: number, j: number, di: number, dj: number) => number} edgeBetween Edge type between local cell
 *     (i, j) and its neighbor in direction (di, dj).
 * @param {number} x0 World coordinates of the chunk's first cell.
 * @param {number} z0
 * @returns {{ props: Prop[], leaks: Leak[] }}
 */
export function placeDecorations(random, edgeBetween, x0, z0) {
    /** @type {Prop[]} */
    const props = [];
    /** @type {Leak[]} */
    const leaks = [];
    // Taken cells plus a ring around them, so things don't crowd together.
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

    // Leaks are a ceiling stain with wet carpet below. Stains avoid the light panels (over cells with both coords
    // odd) and the wet patch stays inside its cell so it never runs under a wall.
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
            // Sometimes there's a wet floor sign next to it.
            const withSign = random() < 0.3;
            const floorRadius = withSign ? 0.17 + random() * 0.06 : 0.18 + random() * 0.17;
            // Drips land roughly straight down.
            const fx = clamp(ox + (random() - 0.5) * 0.1, floorRadius);
            const fz = clamp(oz + (random() - 0.5) * 0.1, floorRadius);
            const leak = { x: x + ox, z: z + oz, radius, floorX: x + fx, floorZ: z + fz, floorRadius, variant: variant() };
            leaks.push(leak);
            // A fallen tile lies on the wet patch, roughly under the hole. Uses the leak's variant bits so it adds
            // nothing to the random stream.
            const v = leak.variant;
            const fell = tileFell(leak);
            const tx = Math.max(-0.26, Math.min(0.26, fx * 0.6 + (((v >>> 23) & 15) / 15 - 0.5) * 0.12));
            const tz = Math.max(-0.26, Math.min(0.26, fz * 0.6 + (((v >>> 27) & 15) / 15 - 0.5) * 0.12));
            if (fell) props.push(makeProp(PROP_TILE, x + tx, z + tz, ((v >>> 12) & 255) / 256 * 2 * Math.PI, v));
            if (withSign) {
                // Opposite side of the cell from the wet patch, so it's at the edge and not in it. If a tile fell,
                // put it directly opposite the tile, far enough out to clear it.
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
            // A chair on its side takes up most of the cell, so it stays in the middle.
            const tipped = type === PROP_CHAIR && (v & 3) === 0;
            const walls = DIRECTIONS.filter(([di, dj]) => edgeBetween(i, j, di, dj) === EDGE_WALL);
            if (walls.length > 0 && !tipped && type !== PROP_SIGN && random() < 0.8) {
                // Against a wall, facing into the room.
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

/** True if a leak's ceiling tile fell. decals.js leaves a hole and the tile is on the floor. */
export function tileFell(leak) {
    return ((leak.variant >>> 20) & 7) < 2;
}

/** Clamps a wet patch's offset from cell center so the patch stays inside the cell. */
function clamp(offset, radius) {
    const limit = 0.44 - radius;
    return Math.max(-limit, Math.min(limit, offset));
}

/**
 * Sets a prop's height on uneven ground like Level 37's pools. Floating props sit at the surface when the water's
 * deep enough. Where you'd swim over it, it loses its collision box.
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
 * Solid half-size of a later level's prop as [local x, local z], a little inside what's drawn (shapes are in
 * props.js). Null if you walk through it.
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
            // Two drums, or one lying down, take up more room.
            return (variant & 1) === 1 ? [0.2, 0.1] : ((variant >>> 1) & 3) === 0 ? [0.16, 0.1] : [0.1, 0.1];
        case PROP_CONE:
            // Standing it's small and solid, so you walk around it. Knocked over, you just kick it aside.
            return ((variant >>> 2) & 3) === 0 ? null : [0.045, 0.045];
        case PROP_RACK:
            return [0.45, 0.16];
        // Same as the party's (see TABLE_LENGTH and PRESENTS_HALF in party.js).
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
            // Just a tray on the floor, nothing to walk into.
            return (variant & 1) === 0 ? null : [0.15, 0.1];
        case PROP_CART:
            return [0.2, 0.11];
        case PROP_PALM:
            return [0.07, 0.07];
        case PROP_COOLER:
            // A spare bottle beside it takes up more room. The pair is centered on what they cover.
            return ((variant >>> 2) & 1) === 1 ? [0.11, 0.06] : [0.06, 0.06];
        case PROP_FICUS:
            // The pot.
            return [0.05, 0.05];
        case PROP_BIN:
            // Knocked over, you just kick it aside.
            return ((variant >>> 5) & 3) === 0 ? null : [0.055, 0.055];
        case PROP_FILES:
            // Files on a box, only the box is solid.
            return (variant & 3) === 3 ? [0.065, 0.055] : [0.12, 0.055];
        case PROP_LOCKERS:
            return [lockerCount(variant) * 0.055 - 0.005, 0.07];
        case PROP_BED:
            // Singles are narrower (see furnitureHalf in terrorHotelFurniture.js).
            return (variant & 1) === 0 ? [0.19, 0.375] : [0.28, 0.375];
        default:
            return SOLID_HALF.get(type) ?? null;
    }
}

/**
 * Solid half-sizes for the remaining edit-mode props (see solidHalfSize). Level 4 and 5 furniture matches its own
 * level (HALF in abandonedOfficeFurniture.js and terrorHotelFurniture.js). The mahjong table is just the table, the
 * desk leaves out its chair and the sofa leaves out its coffee table.
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

/** Lockers in a row (see lockers in props.js). @param {number} variant */
export function lockerCount(variant) {
    return 2 + (variant & 1);
}

/** Axis-aligned box around a rectangle of half-size [hx, hz] rotated by yaw, at (x, z). */
function turnedBox(x, z, yaw, half) {
    if (!half) return null;
    const cos = Math.abs(Math.cos(yaw));
    const sin = Math.abs(Math.sin(yaw));
    const hx = half[0] * cos + half[1] * sin;
    const hz = half[0] * sin + half[1] * cos;
    return [x - hx, z - hz, x + hx, z + hz];
}
