import { BufferAttribute, BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    FURN_CABINET,
    FURN_CLOCK as OFFICE_CLOCK,
    FURN_COPIER,
    FURN_DESK,
    FURN_EXTINGUISHER,
    FURN_FRIDGE,
    FURN_ROUND_TABLE,
    FURN_SHELF,
    FURN_SOFA as OFFICE_SOFA,
    FURN_STACK,
    FURN_VENDING,
    FURN_WHITEBOARD,
} from './abandonedOfficeFurniture.js';
import { L_BOARD, L_CLOCK, L_SCREEN, L_VENDING, buildOfficePiece } from './abandonedOfficeGeometry.js';
import { ColorBuilder, PLAIN_U, PLAIN_V } from './ColorBuilder.js';
import {
    PROP_ARMCHAIR,
    PROP_BED,
    PROP_BINDERS,
    PROP_BOOKCASE,
    PROP_CABINET,
    PROP_CHAIRS,
    PROP_CHALKBOARD,
    PROP_CHESTERFIELD,
    PROP_CLOCK,
    PROP_CONSOLE,
    PROP_COPIER,
    PROP_DESK,
    PROP_EXTINGUISHER,
    PROP_FIREPLACE,
    PROP_FLOWERS,
    PROP_FRIDGE,
    PROP_MAHJONG,
    PROP_NAMES,
    PROP_NIGHTSTAND,
    PROP_PIANO,
    PROP_SIDE_TABLE,
    PROP_SOFA,
    PROP_TABLE,
    PROP_VENDING,
    PROP_WALL_CLOCK,
    PROP_WARDROBE,
    PROP_WHITEBOARD,
    PROP_WRITING_DESK,
} from './decorations.js';
import { PROP_ATLAS, PROP_ATLAS_HEIGHT, PROP_ATLAS_WIDTH } from './propAtlas.js';
import { hashInts } from './random.js';
import { buildHotelPiece } from './terrorHotelFurnishings.js';
import {
    FURN_ARMCHAIR,
    FURN_BED,
    FURN_BEVERLY,
    FURN_BOOKCASE,
    FURN_CENTRE_TABLE,
    FURN_CHALKBOARD,
    FURN_CLOCK,
    FURN_CONSOLE,
    FURN_FIREPLACE,
    FURN_NIGHTSTAND,
    FURN_PIANO,
    FURN_SIDE_TABLE,
    FURN_SOFA,
    FURN_WARDROBE,
    FURN_WRITING_DESK,
} from './terrorHotelFurniture.js';
import { HOTEL_ATLAS, HOTEL_ATLAS_SIZE } from './terrorHotelTextures.js';

/*
 * Level 4's and Level 5's furniture as props, for edit mode to put down on any level (see decorations.js): each piece
 * built by its own level's code (abandonedOfficeGeometry.js, terrorHotelFurnishings.js), on its own at the origin facing
 * +z, and made into a prop's template, coloured by its vertices like every other. What its level does in its shaders
 * (the grain of the wood, the weave of the fabric, the veins in the marble) comes out plain here. What's lit on it (a
 * vending machine's front, a lamp's shade) is a part of its own, drawn lit (see buildPropGlowGeometry in props.js), and
 * the pictures on it (a clock's face, the menu chalked on a blackboard) are drawn again in the props texture.
 *
 * Each comes in STYLES looks (its variant's low bits), each a variant of the piece its level would make.
 */

/** How many looks each piece comes in. */
export const STYLES = 8;

/**
 * @typedef {object} FurnitureKind
 * @property {'office' | 'hotel'} level Whose it is.
 * @property {number} type Its FURN_* there.
 * @property {(style: number) => number} variant The variant of the piece a look is.
 * @property {boolean} [lit] A lamp on it, on.
 * @property {boolean} [hung] It hangs on a wall: moved back to stand against it at z = 0 (see isHungProp).
 */

/**
 * A look's variant: its bits mixed up, and then the ones that matter to it set (`set`) and cleared (`clear`), so that
 * every look has what makes the piece what it is (a desk its computer, a vending machine its colour).
 */
const mixed = (salt, set = () => 0, clear = 0) => (style) => ((hashInts(salt, style, 0x5f17) & ~clear) | set(style)) >>> 0;

/**
 * Which props are which level's furniture. Made the first time it's wanted: this module and the levels' own are in a
 * loop of imports (through terrorHotelProps.js and props.js), and whichever is read first, the others' constants may not
 * be there yet while it's being put together.
 * @type {Map<number, FurnitureKind> | null}
 */
let kinds = null;

/** @returns {Map<number, FurnitureKind>} */
function furnitureKinds() {
    kinds ??= new Map([
        // A computer on it (its low three bits), and its chair (the next two), always.
        [PROP_DESK, { level: 'office', type: FURN_DESK, variant: mixed(0x4e01, (s) => 1 + (s % 7) | (1 + (s % 3)) << 4, 0x37) }],
        // Its colour, one of four.
        [PROP_VENDING, { level: 'office', type: FURN_VENDING, variant: mixed(0x4e02) }],
        // Its paint, and its third drawer open or not (the second and third bits).
        [PROP_CABINET, { level: 'office', type: FURN_CABINET, variant: mixed(0x4e03, (s) => (s & 1) | ((s & 2) ? 2 : 0), 7) }],
        [PROP_COPIER, { level: 'office', type: FURN_COPIER, variant: mixed(0x4e04) }],
        [PROP_SOFA, { level: 'office', type: OFFICE_SOFA, variant: mixed(0x4e05) }],
        [PROP_FRIDGE, { level: 'office', type: FURN_FRIDGE, variant: mixed(0x4e06) }],
        [PROP_CHAIRS, { level: 'office', type: FURN_STACK, variant: mixed(0x4e07) }],
        [PROP_TABLE, { level: 'office', type: FURN_ROUND_TABLE, variant: mixed(0x4e08) }],
        [PROP_BINDERS, { level: 'office', type: FURN_SHELF, variant: mixed(0x4e09) }],
        [PROP_WHITEBOARD, { level: 'office', type: FURN_WHITEBOARD, variant: mixed(0x4e0a), hung: true }],
        [PROP_WALL_CLOCK, { level: 'office', type: OFFICE_CLOCK, variant: mixed(0x4e0b), hung: true }],
        [PROP_EXTINGUISHER, { level: 'office', type: FURN_EXTINGUISHER, variant: mixed(0x4e0c), hung: true }],
        [PROP_ARMCHAIR, { level: 'hotel', type: FURN_ARMCHAIR, variant: mixed(0x5e01) }],
        [PROP_CHESTERFIELD, { level: 'hotel', type: FURN_SOFA, variant: mixed(0x5e02) }],
        // A single or a double (its low bit).
        [PROP_BED, { level: 'hotel', type: FURN_BED, variant: mixed(0x5e03, (s) => s & 1, 1) }],
        [PROP_NIGHTSTAND, { level: 'hotel', type: FURN_NIGHTSTAND, variant: mixed(0x5e04), lit: true }],
        [PROP_WARDROBE, { level: 'hotel', type: FURN_WARDROBE, variant: mixed(0x5e05) }],
        [PROP_PIANO, { level: 'hotel', type: FURN_PIANO, variant: mixed(0x5e06) }],
        [PROP_CLOCK, { level: 'hotel', type: FURN_CLOCK, variant: mixed(0x5e07) }],
        [PROP_SIDE_TABLE, { level: 'hotel', type: FURN_SIDE_TABLE, variant: mixed(0x5e08), lit: true }],
        [PROP_WRITING_DESK, { level: 'hotel', type: FURN_WRITING_DESK, variant: mixed(0x5e09) }],
        [PROP_BOOKCASE, { level: 'hotel', type: FURN_BOOKCASE, variant: mixed(0x5e0a) }],
        [PROP_FIREPLACE, { level: 'hotel', type: FURN_FIREPLACE, variant: mixed(0x5e0b) }],
        [PROP_CONSOLE, { level: 'hotel', type: FURN_CONSOLE, variant: mixed(0x5e0c) }],
        [PROP_CHALKBOARD, { level: 'hotel', type: FURN_CHALKBOARD, variant: mixed(0x5e0d) }],
        [PROP_FLOWERS, { level: 'hotel', type: FURN_CENTRE_TABLE, variant: mixed(0x5e0e) }],
        [PROP_MAHJONG, { level: 'hotel', type: FURN_BEVERLY, variant: mixed(0x5e0f) }],
    ]);
    return kinds;
}

/** Whether a prop is one of Level 4's or Level 5's pieces of furniture. @param {number} type */
export function isFurnitureProp(type) {
    return furnitureKinds().has(type);
}

/**
 * A look of a piece of furniture, as a prop's template (see cachedLit in props.js): what it's made of, and what of it is
 * lit (or null).
 * @param {number} type PROP_*
 * @param {number} style 0 .. STYLES − 1
 * @returns {{ solid: BufferGeometry, glow: BufferGeometry | null }}
 */
export function furnitureTemplate(type, style) {
    const kind = /** @type {FurnitureKind} */ (furnitureKinds().get(type));
    const variant = kind.variant(style);
    const solid = [];
    const glow = [];
    if (kind.level === 'office') {
        const furnishings = new ColorBuilder('finish');
        const displays = new ColorBuilder('light');
        buildOfficePiece({ furnishings, displays }, kind.type, variant);
        const made = furnishings.build();
        if (made) solid.push(plain(made));
        const lit = displays.build();
        if (lit) {
            for (const [shown, picture, glows, round] of officeDisplays()) {
                const faces = pictured(lit, shown, picture);
                if (faces) (glows ? glow : solid).push(round ? rounded(faces) : faces);
            }
            lit.dispose();
        }
    } else {
        const builders = { woodwork: new ColorBuilder('finish'), fittings: new ColorBuilder('light'), paint: new ColorBuilder(), dials: new ColorBuilder() };
        buildHotelPiece(builders, kind.type, variant, kind.lit === true);
        const woodwork = builders.woodwork.build();
        if (woodwork) solid.push(plain(woodwork));
        const fittings = builders.fittings.build();
        if (fittings) {
            // A lamp's shade, lit, is lit; the rest of the fittings (a candle, a bulb that's off) are like the woodwork.
            const [on, off] = splitByGlow(fittings);
            if (on) glow.push(on);
            if (off) solid.push(off);
        }
        const paint = builders.paint.build();
        const menu = paint && hotelPicture(paint, HOTEL_ATLAS.menu, PROP_ATLAS.menu);
        if (menu) solid.push(menu);
        paint?.dispose();
        const dials = builders.dials.build();
        if (dials) {
            solid.push(pictured(whitened(dials), null, PROP_ATLAS.clockFace));
            dials.dispose();
        }
    }
    const template = { solid: mergeAll(solid), glow: glow.length > 0 ? mergeAll(glow) : null };
    // What hangs on a wall has its back against it at z = 0 (as built, it's where its level's wall would be).
    if (kind.hung) {
        template.solid.computeBoundingBox();
        const back = /** @type {import('three').Box3} */ (template.solid.boundingBox).min.z;
        template.solid.translate(0, 0, -back);
        template.glow?.translate(0, 0, -back);
    }
    return template;
}

/** A name for a look of a piece: pieces with the same one look the same. */
export function furnitureKey(type, variant) {
    return `${PROP_NAMES[type]} ${variant % STYLES}`;
}

/**
 * What a Level 4 piece's lit faces show (see L_* in abandonedOfficeGeometry.js): the picture, and whether it's lit. (Made
 * when it's wanted, like furnitureKinds.) And whether it's round: a clock's face is a square in the displays (its level's
 * shader draws the round face in it), and a disc here.
 * @returns {[number[], number[], boolean, boolean][]}
 */
const officeDisplays = () => [
    [[L_VENDING], PROP_ATLAS.vending, true, false],
    [[L_SCREEN], PROP_ATLAS.snow, true, false],
    [[L_CLOCK], PROP_ATLAS.clockFace, false, true],
    [[L_BOARD], PROP_ATLAS.whiteboard, false, false],
];

/** A builder's geometry with only what a prop's template has, all of it plain white in the props texture. */
function plain(geometry) {
    const template = stripped(geometry);
    const uv = template.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, PLAIN_U, PLAIN_V);
    return template;
}

/** Only position, normal, uv and colour (see buildPropGeometry in props.js), indexed or not. */
function stripped(geometry) {
    const template = new BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'color']) template.setAttribute(name, geometry.attributes[name].clone());
    if (geometry.index) template.setIndex(geometry.index.clone());
    geometry.dispose();
    return template;
}

/**
 * The faces of an office piece's displays (each a quad, 0..1 across it and up it) whose kind is one of `kinds` (all of
 * them, for null), with `picture` across each, white; null if there are none.
 * @param {BufferGeometry} geometry
 * @param {number[] | null} kinds
 * @param {number[]} picture
 */
function pictured(geometry, kinds, picture) {
    const light = geometry.attributes.light;
    const index = /** @type {BufferAttribute} */ (geometry.index);
    const keep = [];
    for (let t = 0; t < index.count; t += 3) {
        const a = index.getX(t);
        if (kinds === null || kinds.includes(Math.round(light.getW(a)))) keep.push(index.getX(t), index.getX(t + 1), index.getX(t + 2));
    }
    if (keep.length === 0) return null;
    const faces = reindexed(geometry, keep);
    const [x0, y0, x1, y1] = picture;
    const uv = faces.attributes.uv;
    const color = faces.attributes.color;
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (x0 + uv.getX(i) * (x1 - x0)) / PROP_ATLAS_WIDTH, 1 - (y1 - uv.getY(i) * (y1 - y0)) / PROP_ATLAS_HEIGHT);
        color.setXYZ(i, 1, 1, 1);
    }
    return faces;
}

/**
 * Square faces (see pictured: four corners each, from its bottom left, anticlockwise) as the discs inside them, with the
 * picture across each the same way.
 * @param {BufferGeometry} squares
 */
function rounded(squares) {
    const position = squares.attributes.position;
    const normal = squares.attributes.normal;
    const uv = squares.attributes.uv;
    const sides = 24;
    const positions = [];
    const normals = [];
    const uvs = [];
    const index = [];
    for (let q = 0; q + 3 < position.count; q += 4) {
        const corner = (k) => [position.getX(q + k), position.getY(q + k), position.getZ(q + k)];
        const [a, b, , d] = [corner(0), corner(1), corner(2), corner(3)];
        const right = [0, 1, 2].map((c) => (b[c] - a[c]) / 2);
        const up = [0, 1, 2].map((c) => (d[c] - a[c]) / 2);
        const middle = [0, 1, 2].map((c) => a[c] + right[c] + up[c]);
        const [u0, v0, u1, v1] = [uv.getX(q), uv.getY(q), uv.getX(q + 2), uv.getY(q + 2)];
        const first = positions.length / 3;
        for (let k = 0; k <= sides; k++) {
            // The middle, then round the rim.
            const [x, y] = k === 0 ? [0, 0] : [Math.cos(((k - 1) / sides) * Math.PI * 2), Math.sin(((k - 1) / sides) * Math.PI * 2)];
            positions.push(...[0, 1, 2].map((c) => middle[c] + right[c] * x + up[c] * y));
            normals.push(normal.getX(q), normal.getY(q), normal.getZ(q));
            uvs.push(u0 + ((x + 1) / 2) * (u1 - u0), v0 + ((y + 1) / 2) * (v1 - v0));
        }
        for (let k = 1; k <= sides; k++) index.push(first, first + k, first + (k % sides) + 1);
    }
    squares.dispose();
    const disc = new BufferGeometry();
    disc.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    disc.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    disc.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    disc.setAttribute('color', new BufferAttribute(new Float32Array(positions.length).fill(1), 3));
    disc.setIndex(index);
    return disc;
}

/** A Level 5 clock's dial, its colour (which its level's shader reads the time from) made white. */
function whitened(geometry) {
    const color = geometry.attributes.color;
    for (let i = 0; i < color.count; i++) color.setXYZ(i, 1, 1, 1);
    // (With a light attribute for pictured, which reads its kind: none, so every face is kept.)
    geometry.setAttribute('light', new BufferAttribute(new Float32Array(color.count * 4), 4));
    return geometry;
}

/** A Level 5 piece's fittings, in two: what's lit (its glow over 0), and what isn't. */
function splitByGlow(geometry) {
    const light = geometry.attributes.light;
    const index = /** @type {BufferAttribute} */ (geometry.index);
    const on = [];
    const off = [];
    for (let t = 0; t < index.count; t += 3) (light.getZ(index.getX(t)) > 0 ? on : off).push(index.getX(t), index.getX(t + 1), index.getX(t + 2));
    const parts = [on.length > 0 ? reindexed(geometry, on) : null, off.length > 0 ? plain(reindexed(geometry, off)) : null];
    if (parts[0]) {
        const uv = parts[0].attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, PLAIN_U, PLAIN_V);
    }
    geometry.dispose();
    return parts;
}

/**
 * What of a Level 5 piece's paint is `from` in its level's paint atlas (see terrorHotelTextures.js), moved to `to` in the
 * props texture and a little further off the face it's on (props aren't drawn over what's under them the way the paint
 * is); null if none of it is.
 */
function hotelPicture(geometry, from, to) {
    const size = HOTEL_ATLAS_SIZE;
    const [u0, v0, u1, v1] = [from[0] / size, 1 - from[3] / size, from[2] / size, 1 - from[1] / size];
    const uv = geometry.attributes.uv;
    const index = /** @type {BufferAttribute} */ (geometry.index);
    const keep = [];
    for (let t = 0; t < index.count; t += 3) {
        const a = index.getX(t);
        const [u, v] = [uv.getX(a), uv.getY(a)];
        if (u >= u0 - 1e-6 && u <= u1 + 1e-6 && v >= v0 - 1e-6 && v <= v1 + 1e-6) keep.push(a, index.getX(t + 1), index.getX(t + 2));
    }
    if (keep.length === 0) return null;
    const faces = reindexed(geometry, keep);
    const [x0, y0, x1, y1] = to;
    const position = faces.attributes.position;
    const normal = faces.attributes.normal;
    const fuv = faces.attributes.uv;
    for (let i = 0; i < fuv.count; i++) {
        const s = (fuv.getX(i) - u0) / (u1 - u0);
        const t = (fuv.getY(i) - v0) / (v1 - v0);
        fuv.setXY(i, (x0 + s * (x1 - x0)) / PROP_ATLAS_WIDTH, 1 - (y1 - t * (y1 - y0)) / PROP_ATLAS_HEIGHT);
        position.setXYZ(i, position.getX(i) + normal.getX(i) * 0.0012, position.getY(i) + normal.getY(i) * 0.0012, position.getZ(i) + normal.getZ(i) * 0.0012);
    }
    return faces;
}

/** Some of a geometry's triangles (by their corners), as a geometry of their own with only the corners they use. */
function reindexed(geometry, corners) {
    const map = new Map();
    const order = [];
    const index = corners.map((corner) => {
        let k = map.get(corner);
        if (k === undefined) {
            k = order.length;
            map.set(corner, k);
            order.push(corner);
        }
        return k;
    });
    const result = new BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'color', 'light']) {
        const from = geometry.attributes[name];
        if (!from) continue;
        const size = from.itemSize;
        const array = new Float32Array(order.length * size);
        order.forEach((corner, k) => {
            for (let c = 0; c < size; c++) array[k * size + c] = from.array[corner * size + c];
        });
        result.setAttribute(name, new BufferAttribute(array, size));
    }
    result.setIndex(index);
    return result;
}

/** Merges templates made above into one (each only position, normal, uv and colour). */
function mergeAll(parts) {
    const ready = parts.map((part) => (part.attributes.light ? stripped(part) : part));
    const merged = /** @type {BufferGeometry} */ (mergeGeometries(ready));
    for (const part of ready) part.dispose();
    return merged;
}
