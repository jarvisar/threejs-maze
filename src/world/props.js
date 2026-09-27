import {
    Box3,
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    CylinderGeometry,
    Float32BufferAttribute,
    LatheGeometry,
    Quaternion,
    SphereGeometry,
    TorusGeometry,
    Vector2,
    Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    PROP_BALL,
    PROP_BARREL,
    PROP_BIN,
    PROP_BOTTLES,
    PROP_BOXES,
    PROP_BUCKET,
    PROP_CART,
    PROP_CHAIR,
    PROP_CONE,
    PROP_COOLER,
    PROP_CRATES,
    PROP_CYLINDERS,
    PROP_FICUS,
    PROP_FILES,
    PROP_HAT,
    PROP_LIFEBUOY,
    PROP_MONITOR,
    PROP_NAMES,
    PROP_PALLET,
    PROP_PALM,
    PROP_RACK,
    PROP_RING,
    PROP_SHELF,
    PROP_SIGN,
    PROP_SUITCASE,
    PROP_TILE,
    PROP_TOOLBOX,
    PROP_TROLLEY,
    isPartyProp,
} from './decorations.js';
import { insideOut } from './GeometryBuilder.js';
import { partyPropTemplate } from './partyGeometry.js';
import { mulberry32 } from './random.js';

/*
 * The objects left lying around (see decorations.js for where they go): built from boxes and cylinders,
 * coloured by their vertices, with a small drawn texture for the parts that need a picture (the print on
 * the wet-floor sign, a monitor's screen, a bottle's label). Every prop in a chunk is merged into one mesh.
 *
 * Sizes are in world units: 1 unit is 2.7 m (a chair seat is about 0.17 up).
 */

/** The props texture (drawn in decorationTextures.js): where each picture is, in pixels. Level 1's are on the right. */
export const PROP_ATLAS_WIDTH = 1024;
export const PROP_ATLAS_HEIGHT = 512;
export const PROP_ATLAS = {
    sign: [0, 0, 256, 256],
    monitor: [256, 0, 512, 256],
    label: [0, 256, 256, 320],
    // A ceiling tile, face up: the part that broke off is the bottom 40%.
    tile: [352, 256, 512, 496],
    // Solid white, for parts coloured by their vertices alone.
    plain: [304, 304, 336, 336],
    // Level 1: a supply crate's side, plain and stencilled, and its lid; cardboard, with tape, and with a label;
    // a pallet's boards; a drum's hazard label; boxes shrink-wrapped on a pallet; racking's wire decking; paper
    // sacks; and a car's number plate, grille and lights.
    crate: [512, 0, 640, 128],
    crateStencil: [640, 0, 768, 128],
    crateTop: [768, 0, 896, 128],
    wood: [896, 0, 1024, 128],
    cardboard: [512, 128, 640, 256],
    cardboardLabel: [640, 128, 768, 256],
    cardboardTop: [768, 128, 896, 256],
    drumLabel: [896, 128, 1024, 256],
    wrap: [512, 256, 640, 384],
    decking: [640, 256, 768, 384],
    sack: [768, 256, 896, 384],
    plate: [896, 256, 1024, 320],
    grille: [896, 320, 1024, 384],
    // Level 2: the labels round a row of tins, and the spines of a row of box files.
    tins: [0, 320, 128, 384],
    spines: [128, 320, 256, 384],
};

const FABRIC = 0x2b2b2f;
const PLASTIC = 0x1e1e20;
const CASTER = 0x141414;
const METAL = 0x54575c;
const BEIGE = 0xc9bd9c;
const BEIGE_DARK = 0xb4a888;
const BOTTLE = 0xe3e9e4;
const CAP = 0x2f63a8;
const YELLOW = 0xf1c21b;
const YELLOW_DARK = 0xd4a812;
const WHITE = 0xffffff;
const TILE_EDGE = 0x8f8a7c;
// A tile's face: its picture is drawn light, like the ceiling's, but it lies facing the overhead light.
const TILE_FACE = 0xbdb8aa;
const TILE_CRUMB = 0x6c685d;

// How far the sign's two boards lean on each other, in radians from upright.
const SIGN_LEAN = 0.28;

// What goes into a chunk's props mesh, three entries a piece: the prop, a template, and how far up it goes.
/** @type {any[]} */
const _pieces = [];

/**
 * One mesh with every prop of a chunk, positioned relative to the chunk's centre (ox, oz). Each template is copied
 * straight into place in arrays of exactly the right size, rather than copied, moved and then merged: a storage
 * chunk of Level 1 has a thousand pieces or so, and doing that to each showed up as a hitch.
 * @param {import('./decorations.js').Prop[]} props
 * @param {number} ox
 * @param {number} oz
 * @returns {import('three').BufferGeometry | null}
 */
export function buildPropGeometry(props, ox, oz) {
    if (props.length === 0) return null;
    const pieces = _pieces;
    pieces.length = 0;
    let vertices = 0;
    let indices = 0;
    for (const prop of props) {
        // (Level Fun's are drawn with the party; see partyGeometry.js.)
        if (isPartyProp(prop.type)) continue;
        // A rack goes in as its pieces, without making the whole of it (see rackPieces).
        if (prop.type === PROP_RACK) for (const { geometry, y } of rackPieces(prop.variant)) pieces.push(prop, geometry, y);
        else pieces.push(prop, templateFor(prop), 0);
    }
    for (let k = 1; k < pieces.length; k += 3) {
        const geometry = pieces[k];
        vertices += geometry.attributes.position.count;
        indices += geometry.index ? geometry.index.count : geometry.attributes.position.count;
    }
    const position = new Float32Array(vertices * 3);
    const normal = new Float32Array(vertices * 3);
    const uv = new Float32Array(vertices * 2);
    const color = new Float32Array(vertices * 3);
    const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    let v = 0;
    let i = 0;
    for (let k = 0; k < pieces.length; k += 3) {
        const prop = pieces[k];
        const { attributes, index: from } = pieces[k + 1];
        // (Up onto the floor under it, where that isn't at 0.)
        const lift = pieces[k + 2] + (prop.y ?? 0);
        // Turned by its yaw about y (as Matrix4.makeRotationY), then moved into place.
        const cos = Math.cos(prop.yaw);
        const sin = Math.sin(prop.yaw);
        const dx = prop.x - ox;
        const dz = prop.z - oz;
        const p = attributes.position.array;
        const n = attributes.normal.array;
        const count = attributes.position.count;
        for (let a = 0; a < count; a++) {
            const s = a * 3;
            const t = (v + a) * 3;
            position[t] = cos * p[s] + sin * p[s + 2] + dx;
            position[t + 1] = p[s + 1] + lift;
            position[t + 2] = cos * p[s + 2] - sin * p[s] + dz;
            normal[t] = cos * n[s] + sin * n[s + 2];
            normal[t + 1] = n[s + 1];
            normal[t + 2] = cos * n[s + 2] - sin * n[s];
        }
        uv.set(attributes.uv.array, v * 2);
        color.set(attributes.color.array, v * 3);
        if (from) for (let a = 0; a < from.count; a++) index[i++] = from.array[a] + v;
        else for (let a = 0; a < count; a++) index[i++] = v + a;
        v += count;
    }
    pieces.length = 0;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('normal', new BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    geometry.setAttribute('color', new BufferAttribute(color, 3));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    return geometry;
}

/** @type {Map<string, import('three').BufferGeometry>} */
const templates = new Map();

function cached(key, build, soften = true) {
    let geometry = templates.get(key);
    if (!geometry) {
        geometry = build();
        if (soften) softenTops(geometry);
        templates.set(key, geometry);
    }
    return geometry;
}

// How much of the overhead light the tops of things catch. It lights nothing but upward faces, so at full
// strength every top glares next to the walls and sides around it.
const UPWARD_LIGHT = 0.45;

/** Tips upward-facing normals towards the horizontal (see UPWARD_LIGHT). */
function softenTops(geometry) {
    const normals = geometry.attributes.normal;
    for (let i = 0; i < normals.count; i++) {
        const y = normals.getY(i);
        if (y <= 0) continue;
        let x = normals.getX(i);
        let z = normals.getZ(i);
        let flat = Math.hypot(x, z);
        // Straight up has no way of its own to lean; any will do.
        if (flat < 1e-4) {
            x = 0.6;
            z = 0.8;
            flat = 1;
        }
        const ny = y * UPWARD_LIGHT;
        const scale = Math.sqrt(1 - ny * ny) / flat;
        normals.setXYZ(i, x * scale, ny, z * scale);
    }
    return geometry;
}

// Radius of the soft shadow on the carpet under each kind of prop (see chunkGeometry.js).
const SHADOW_RADIUS = [0.14, 0.11, 0.06, 0.13, 0.14, 0.2, 0.17, 0.25, 0.14, 0.08, 0.36, 0.13, 0.14, 0.06, 0.2, 0.1, 0.045, 0.03, 0.34, 0.11, 0.07, 0.14, 0.17, 0.16, 0.24, 0.11, 0.11, 0.11, 0.08, 0.17];

/** @param {import('./decorations.js').Prop} prop */
export function propShadowRadius(prop) {
    if (prop.type === PROP_CRATES && ((prop.variant & 3) === 1 || (prop.variant & 3) === 3)) return 0.27;
    if (prop.type === PROP_BARREL && (prop.variant & 1) === 1) return 0.22;
    // A water cooler with a spare bottle beside it, and a bin on its side.
    if (prop.type === PROP_COOLER && ((prop.variant >>> 2) & 1) === 1) return 0.15;
    if (prop.type === PROP_BIN && ((prop.variant >>> 5) & 3) === 0) return 0.11;
    return prop.type === PROP_CHAIR && (prop.variant & 3) === 0 ? 0.2 : SHADOW_RADIUS[prop.type];
}

/**
 * A prop's shape in its own frame: standing on the floor at the origin, its front towards +z. Props that look
 * the same share it (all but bottles and racks), so it mustn't be changed.
 * @param {import('./decorations.js').Prop} prop
 */
export function templateFor(prop) {
    if (isPartyProp(prop.type)) return partyPropTemplate(prop);
    switch (prop.type) {
        case PROP_CHAIR:
            return (prop.variant & 3) === 0 ? cached('chair-tipped', tippedChair) : cached('chair', chair);
        case PROP_MONITOR:
            return cached('monitor', monitor);
        case PROP_SIGN:
            return cached('sign', sign);
        case PROP_TILE:
            return cached('tile', fallenTile);
        case PROP_CRATES:
            return cached(`crates ${prop.variant & 0xff}`, () => crates(prop.variant & 0xff));
        case PROP_BOXES:
            return cached(`boxes ${prop.variant & 0x3f}`, () => cardboardBoxes(prop.variant & 0x3f));
        case PROP_PALLET:
            return cached(`pallet ${prop.variant & 0xf}`, () => pallet(prop.variant & 0xf));
        case PROP_BARREL:
            return cached(`barrel ${prop.variant & 0x3f}`, () => barrels(prop.variant & 0x3f));
        case PROP_CONE:
            return cached(`cone ${prop.variant & 0xf}`, () => cones(prop.variant & 0xf));
        case PROP_RACK:
            // Made fresh, like bottles: its pieces are shared (and already softened).
            return rack(prop.variant);
        case PROP_LIFEBUOY:
            return cached('lifebuoy', lifebuoy);
        case PROP_RING:
            return cached(`ring ${prop.variant % RINGS.length}`, () => ring(prop.variant % RINGS.length));
        case PROP_BALL:
            return cached('ball', ball);
        case PROP_SHELF:
            return cached(`shelf ${prop.variant & 0xff}`, () => shelf(prop.variant & 0xff));
        case PROP_TOOLBOX:
            return cached(`toolbox ${prop.variant & 7}`, () => toolboxes(prop.variant & 7));
        case PROP_BUCKET:
            return cached(`bucket ${prop.variant & 3}`, () => bucket(prop.variant & 3));
        case PROP_CYLINDERS:
            return cached(`cylinders ${prop.variant & 0x3f}`, () => cylinders(prop.variant & 0x3f));
        case PROP_SUITCASE:
            return cached(`suitcase ${prop.variant & 0xff}`, () => suitcases(prop.variant & 0xff));
        case PROP_TROLLEY:
            return cached(`trolley ${prop.variant & 0x3f}`, () => trolley(prop.variant & 0x3f));
        case PROP_CART:
            return cached(`cart ${prop.variant & 0xff}`, () => luggageCart(prop.variant & 0xff));
        case PROP_PALM:
            return cached(`palm ${prop.variant & 0x1f}`, () => palm(prop.variant & 0x1f));
        case PROP_COOLER:
            return cached(`cooler ${prop.variant & 0x7f}`, () => waterCooler(prop.variant & 0x7f));
        case PROP_FICUS:
            return cached(`plant ${prop.variant & 0xff}`, () => officePlant(prop.variant & 0xff));
        case PROP_BIN:
            return cached(`bin ${prop.variant & 0x7f}`, () => wasteBin(prop.variant & 0x7f));
        case PROP_FILES:
            return cached(`files ${prop.variant & 0xff}`, () => officeFiles(prop.variant & 0xff));
        default:
            return softenTops(bottles(prop.variant));
    }
}

/** A name for a prop's shape: props with the same one look the same, until they're turned and moved. */
export function propShapeKey(prop) {
    if (isPartyProp(prop.type)) return `${PROP_NAMES[prop.type]} ${prop.variant}`;
    switch (prop.type) {
        case PROP_CHAIR:
            return (prop.variant & 3) === 0 ? 'chair-tipped' : 'chair';
        case PROP_BOTTLES:
            return `bottles ${prop.variant}`;
        case PROP_CRATES:
            return `crates ${prop.variant & 0xff}`;
        case PROP_BOXES:
            return `boxes ${prop.variant & 0x3f}`;
        case PROP_PALLET:
            return `pallet ${prop.variant & 0xf}`;
        case PROP_BARREL:
            return `barrel ${prop.variant & 0x3f}`;
        case PROP_CONE:
            return `cone ${prop.variant & 0xf}`;
        case PROP_RACK:
            return `rack ${rackLoads(prop.variant)}`;
        case PROP_RING:
            return `ring ${prop.variant % RINGS.length}`;
        case PROP_SHELF:
            return `shelf ${prop.variant & 0xff}`;
        case PROP_TOOLBOX:
            return `toolbox ${prop.variant & 7}`;
        case PROP_BUCKET:
            return `bucket ${prop.variant & 3}`;
        case PROP_CYLINDERS:
            return `cylinders ${prop.variant & 0x3f}`;
        case PROP_SUITCASE:
            return `suitcase ${prop.variant & 0xff}`;
        case PROP_TROLLEY:
            return `trolley ${prop.variant & 0x3f}`;
        case PROP_CART:
            return `cart ${prop.variant & 0xff}`;
        case PROP_PALM:
            return `palm ${prop.variant & 0x1f}`;
        case PROP_COOLER:
            return `cooler ${prop.variant & 0x7f}`;
        case PROP_FICUS:
            return `plant ${prop.variant & 0xff}`;
        case PROP_BIN:
            return `bin ${prop.variant & 0x7f}`;
        case PROP_FILES:
            return `files ${prop.variant & 0xff}`;
        default:
            return PROP_NAMES[prop.type];
    }
}

/** @type {Map<string, readonly number[]>} */
const bounds = new Map();
// Bottles come in too many arrangements to keep them all.
const MAX_BOUNDS = 64;
const _box = new Box3();

/**
 * The box a prop fits in, in its own frame (see templateFor): [minX, minY, minZ, maxX, maxY, maxZ].
 * @param {import('./decorations.js').Prop} prop
 * @returns {readonly number[]}
 */
export function propBounds(prop) {
    const key = propShapeKey(prop);
    let box = bounds.get(key);
    if (!box) {
        _box.setFromBufferAttribute(/** @type {import('three').BufferAttribute} */ (templateFor(prop).attributes.position));
        box = [_box.min.x, _box.min.y, _box.min.z, _box.max.x, _box.max.y, _box.max.z];
        if (bounds.size >= MAX_BOUNDS) bounds.delete(bounds.keys().next().value);
        bounds.set(key, box);
    }
    return box;
}

/**
 * The rectangle a prop covers on the floor, as [minX, minZ, maxX, maxZ] in world coordinates: its box
 * turned by its yaw, and boxed again.
 * @param {import('./decorations.js').Prop} prop
 */
export function propFootprint(prop) {
    const [x0, , z0, x1, , z1] = propBounds(prop);
    const cos = Math.cos(prop.yaw);
    const sin = Math.sin(prop.yaw);
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const x of [x0, x1]) {
        for (const z of [z0, z1]) {
            // Turned about y the way buildPropGeometry turns it.
            const tx = x * cos + z * sin;
            const tz = z * cos - x * sin;
            minX = Math.min(minX, tx);
            maxX = Math.max(maxX, tx);
            minZ = Math.min(minZ, tz);
            maxZ = Math.max(maxZ, tz);
        }
    }
    return [prop.x + minX, prop.z + minZ, prop.x + maxX, prop.z + maxZ];
}

/**
 * A variant as someone would leave the prop on purpose: a chair on its feet, bottles standing up (how many,
 * and which way they're turned, still vary). The other props look the same whatever the variant.
 * @param {number} type
 * @param {number} variant
 */
export function uprightVariant(type, variant) {
    if (type === PROP_CHAIR && (variant & 3) === 0) return (variant | 1) >>> 0;
    // A cone the right way up (see cones()), and a party hat (see hatLying in partyGeometry.js).
    if (type === PROP_CONE && ((variant >>> 2) & 3) === 0) return (variant | 4) >>> 0;
    if (type === PROP_HAT) return (variant & ~1) >>> 0;
    // Gas cylinders standing up (see cylinders()).
    if (type === PROP_CYLINDERS && ((variant >>> 2) & 3) === 0) return (variant | 4) >>> 0;
    // A waste bin standing up (see wasteBin()).
    if (type === PROP_BIN && ((variant >>> 5) & 3) === 0) return (variant | 0x20) >>> 0;
    // A palm standing on its own, not against a wall (see palm()).
    if (type === PROP_PALM) return (variant & ~PALM_WALL) >>> 0;
    // Bottle k lies down when bits 4 + k and 5 + k are both clear (see bottles()); bits 5 and 6 cover all three.
    if (type === PROP_BOTTLES) return (variant | 0x60) >>> 0;
    return variant;
}

// ---------------------------------------------------------------------------------------------- props

/** An office chair: five-star base on casters, gas column, padded seat and back, armrests. */
function chair() {
    const parts = [];
    const step = (2 * Math.PI) / 5;
    for (let k = 0; k < 5; k++) {
        const angle = k * step + step / 2;
        parts.push(paint(new BoxGeometry(0.022, 0.014, 0.115).translate(0, 0.012, 0.0575).rotateY(angle), PLASTIC));
        parts.push(paint(new CylinderGeometry(0.012, 0.012, 0.014, 8).rotateZ(Math.PI / 2).translate(0, 0.012, 0.112).rotateY(angle), CASTER));
    }
    parts.push(paint(new CylinderGeometry(0.011, 0.014, 0.135, 10).translate(0, 0.085, 0), METAL));
    parts.push(paint(new BoxGeometry(0.185, 0.032, 0.175).translate(0, 0.165, 0), FABRIC));
    parts.push(paint(new BoxGeometry(0.03, 0.1, 0.018).translate(0, 0.215, -0.085), PLASTIC));
    // The back leans away a little.
    parts.push(paint(new BoxGeometry(0.175, 0.17, 0.03).translate(0, 0.085, 0).rotateX(-0.14).translate(0, 0.245, -0.088), FABRIC));
    for (const side of [-1, 1]) {
        parts.push(paint(new BoxGeometry(0.014, 0.075, 0.014).translate(side * 0.1, 0.215, 0.01), PLASTIC));
        parts.push(paint(new BoxGeometry(0.024, 0.014, 0.11).translate(side * 0.1, 0.257, 0.01), PLASTIC));
    }
    return merge(parts);
}

/**
 * The same chair knocked over, resting on its base and the top of its back. Most of it lies to one side of its base,
 * so it's centred on what it covers, like the other props (see decorations.js).
 */
function tippedChair() {
    const geometry = chair().clone().rotateZ(Math.PI / 2).rotateX(-0.4);
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    return geometry.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
}

/** A CRT monitor sitting on the floor, screen dark: the face, a body that steps in towards the back, a stand. */
function monitor() {
    const front = paint(new BoxGeometry(0.15, 0.135, 0.03).translate(0, 0.0975, 0.045), BEIGE);
    paintFace(front, 4, WHITE, PROP_ATLAS.monitor);
    return merge([
        front,
        paint(new BoxGeometry(0.138, 0.124, 0.06).translate(0, 0.096, 0), BEIGE),
        paint(new BoxGeometry(0.11, 0.1, 0.07).translate(0, 0.093, -0.06), BEIGE_DARK),
        paint(new BoxGeometry(0.1, 0.03, 0.09).translate(0, 0.015, 0.005), BEIGE_DARK),
    ]);
}

/** A bottle of almond water, standing, with the label around its middle. */
function bottle() {
    return merge([
        paint(new CylinderGeometry(0.0135, 0.0125, 0.07, 12).translate(0, 0.035, 0), BOTTLE),
        paint(new CylinderGeometry(0.007, 0.0135, 0.012, 12).translate(0, 0.076, 0), BOTTLE),
        paint(new CylinderGeometry(0.0065, 0.007, 0.01, 12).translate(0, 0.087, 0), BOTTLE),
        paint(new CylinderGeometry(0.0085, 0.0085, 0.011, 10).translate(0, 0.0975, 0), CAP),
        paint(new CylinderGeometry(0.0141, 0.0141, 0.028, 12, 1, true).translate(0, 0.036, 0), WHITE, PROP_ATLAS.label),
    ]);
}

/** One to three bottles together, some of them knocked over. */
function bottles(variant) {
    const count = 1 + ((variant >>> 2) % 3);
    const spread = count === 1 ? 0 : 0.035;
    const parts = [];
    for (let k = 0; k < count; k++) {
        const geometry = cached('bottle', bottle, false).clone();
        const lying = ((variant >>> (4 + k)) & 3) === 0;
        const angle = (((variant >>> (8 + k * 5)) & 31) / 32) * 2 * Math.PI;
        // (On its label, the widest part of it.)
        if (lying) geometry.rotateX(Math.PI / 2).translate(0, 0.0141, 0);
        geometry.rotateY(angle);
        geometry.translate(Math.cos(k * 2.1 + angle) * spread, 0, Math.sin(k * 2.1 + angle) * spread);
        parts.push(geometry);
    }
    return merge(parts);
}

/**
 * A folding "wet floor" sign: two boards leaning on each other, printed on the outside. Their inner faces meet at the
 * top, inside the hinge, rather than passing through each other there (and the hinge is a hair wider than they are, so
 * its ends aren't in the same planes as their edges).
 */
function sign() {
    const board = paint(new BoxGeometry(0.15, 0.25, 0.006), YELLOW);
    paintFace(board, 4, WHITE, PROP_ATLAS.sign);
    const front = board.translate(0, 0.125, 0).rotateX(-SIGN_LEAN).translate(0, 0, 0.25 * Math.sin(SIGN_LEAN) + 0.003 * Math.cos(SIGN_LEAN));
    const back = front.clone().rotateY(Math.PI);
    const hinge = paint(new BoxGeometry(0.156, 0.014, 0.024).translate(0, 0.25 * Math.cos(SIGN_LEAN), 0), YELLOW_DARK);
    return grounded(merge([front, back, hinge]));
}

/**
 * A ceiling tile that came down and broke in two: the bigger piece flat, the smaller one knocked askew and
 * propped on its edge, with a few crumbs of it round about. (Tiles are 1/6 by 1/4 of a unit.)
 */
function fallenTile() {
    const [x0, y0, x1, y1] = PROP_ATLAS.tile;
    const split = y0 + (y1 - y0) * 0.6;
    const big = paint(new BoxGeometry(1 / 6, 0.01, 0.15), TILE_EDGE);
    paintFace(big, 2, TILE_FACE, [x0, y0, x1, split]);
    const small = paint(new BoxGeometry(1 / 6, 0.01, 0.1), TILE_EDGE);
    paintFace(small, 2, TILE_FACE, [x0, split, x1, y1]);
    const parts = [
        big.translate(0, 0.005, -0.05),
        small.rotateX(0.12).rotateY(0.35).translate(0.03, 0.011, 0.09),
    ];
    for (const [cx, cz, size] of [[-0.1, 0.05, 0.012], [0.1, -0.02, 0.009], [0.12, 0.12, 0.01]]) {
        parts.push(paint(new BoxGeometry(size, size * 0.5, size * 0.8).rotateY(cx * 20).translate(cx, size * 0.25, cz), TILE_CRUMB));
    }
    return merge(parts);
}

// ---------------------------------------------------------------------------------------------- Level 1

// Level 1's props (see levelOneProps.js). The colours the pictures are multiplied by are near white, so the
// pictures show as drawn, a little different from one to the next.
const CRATE_TINTS = [0xffffff, 0xf2eadc, 0xe6ddcf, 0xfff6e6];
const CARDBOARD_TINTS = [0xffffff, 0xf0e6d6, 0xe2d6c2];
const PALLET_WOOD = 0xc2a57a;
const PALLET_WOOD_LIGHT = 0xd6c09b;
const DRUM_COLORS = [0x2c4f8f, 0x8a2a20, 0x2f3133, 0x7a4f2e];
const DRUM_TOP = 0x3a3c3e;
const CONE_ORANGE = 0xe4501c;
const CONE_BASE = 0x2a2522;
const CONE_BAND = 0xefefe8;
const RACK_UPRIGHT = 0x2d5a9c;
const RACK_BEAM = 0xd9621f;
const DECKING = 0xb9bcbf;
const WRAP = 0xf4f6f8;
const SACK = 0xe8dfcc;

/**
 * A wooden supply crate standing on the floor at the origin: plank sides with their frame and nails drawn on,
 * and the lid a different picture. With `stencil`, its front is printed.
 */
function crate(w, h, d, tint, stencil) {
    const box = paint(new BoxGeometry(w, h, d), tint, PROP_ATLAS.crate);
    paintFace(box, 2, tint, PROP_ATLAS.crateTop);
    paintFace(box, 3, tint, PROP_ATLAS.crateTop);
    if (stencil) paintFace(box, 4, tint, PROP_ATLAS.crateStencil);
    return box.translate(0, h / 2, 0);
}

/**
 * One to three supply crates: on their own, side by side, one on another, or two with a third on top. They're
 * the same few sizes, since they're all the same kind of crate.
 */
function crates(variant) {
    const arrangement = variant & 3;
    const tint = (k) => CRATE_TINTS[(variant >>> (2 + k)) & 3];
    const stencil = (k) => ((variant >>> (5 + k)) & 1) === 1;
    const turn = (k) => (((variant >>> (3 + k * 2)) & 7) / 7 - 0.5) * 0.12;
    const parts = [];
    if (arrangement === 0) {
        parts.push(crate(0.21, 0.19, 0.19, tint(0), stencil(0)).rotateY(turn(0)));
    } else if (arrangement === 1) {
        parts.push(crate(0.21, 0.19, 0.19, tint(0), stencil(0)).rotateY(turn(0)).translate(-0.113, 0, 0));
        parts.push(crate(0.2, 0.17, 0.18, tint(1), stencil(1)).rotateY(turn(1)).translate(0.112, 0, 0.004));
    } else if (arrangement === 2) {
        parts.push(crate(0.21, 0.19, 0.19, tint(0), stencil(0)));
        parts.push(crate(0.19, 0.17, 0.17, tint(1), false).rotateY(turn(1) * 2).translate(0.005, 0.19, -0.004));
    } else {
        parts.push(crate(0.21, 0.19, 0.19, tint(0), stencil(0)).translate(-0.113, 0, 0));
        parts.push(crate(0.21, 0.19, 0.19, tint(1), stencil(1)).rotateY(turn(1) * 0.5).translate(0.113, 0, 0));
        parts.push(crate(0.2, 0.18, 0.18, tint(2), false).rotateY(turn(2) * 2).translate((((variant >>> 7) & 1) - 0.5) * 0.1, 0.19, 0));
    }
    return merge(parts);
}

/** A cardboard box, taped across the top, sometimes with a label on its front. */
function cardboardBox(w, h, d, tint, label) {
    const box = paint(new BoxGeometry(w, h, d), tint, PROP_ATLAS.cardboard);
    paintFace(box, 2, tint, PROP_ATLAS.cardboardTop);
    if (label) paintFace(box, 4, tint, PROP_ATLAS.cardboardLabel);
    return box.translate(0, h / 2, 0);
}

/** Two to four cardboard boxes of a few sizes, stacked up however they were put down. */
function cardboardBoxes(variant) {
    const r = mulberry32(variant * 7919 + 17);
    const tint = () => CARDBOARD_TINTS[Math.floor(r() * CARDBOARD_TINTS.length)];
    const parts = [];
    // A bottom row of one or two, then something on top.
    const two = (variant & 1) === 1;
    const ah = 0.1 + r() * 0.06;
    parts.push(cardboardBox(0.15 + r() * 0.05, ah, 0.13 + r() * 0.07, tint(), r() < 0.5).rotateY((r() - 0.5) * 0.2).translate(two ? -0.08 : 0, 0, 0));
    let top = ah;
    if (two) {
        const bh = 0.09 + r() * 0.07;
        parts.push(cardboardBox(0.13 + r() * 0.03, bh, 0.12 + r() * 0.06, tint(), r() < 0.5).rotateY((r() - 0.5) * 0.3).translate(0.09, 0, (r() - 0.5) * 0.04));
        top = Math.min(ah, bh);
    }
    if (((variant >>> 1) & 3) !== 0) {
        const ch = 0.08 + r() * 0.06;
        parts.push(cardboardBox(0.12 + r() * 0.04, ch, 0.1 + r() * 0.05, tint(), false).rotateY((r() - 0.5) * 0.7).translate((r() - 0.5) * 0.06 - (two ? 0.03 : 0), top, (r() - 0.5) * 0.04));
        if (((variant >>> 3) & 3) === 0) {
            parts.push(cardboardBox(0.09, 0.06, 0.08, tint(), false).rotateY(r() * 3).translate((r() - 0.5) * 0.05, top + ch, 0));
        }
    }
    return merge(parts);
}

/**
 * A wooden pallet: boards across three bearers. Sometimes empty; otherwise loaded with a shrink-wrapped block of
 * boxes, four small crates, or paper sacks.
 */
function pallet(variant) {
    const W = 0.44;
    const D = 0.37;
    const parts = [];
    for (const z of [-0.16, 0, 0.16]) parts.push(paint(new BoxGeometry(W, 0.035, 0.035).translate(0, 0.0175, z), PALLET_WOOD, PROP_ATLAS.wood));
    for (let k = 0; k < 7; k++) {
        const x = -W / 2 + 0.03 + k * ((W - 0.06) / 6);
        parts.push(paint(new BoxGeometry(0.055, 0.011, D).translate(x, 0.0405, 0), k % 3 === 1 ? PALLET_WOOD_LIGHT : PALLET_WOOD, PROP_ATLAS.wood));
    }
    const load = (variant >>> 2) & 3;
    const deck = 0.046;
    if (load === 1) {
        const block = paint(new BoxGeometry(0.4, 0.3, 0.33), WRAP, PROP_ATLAS.wrap);
        paintFace(block, 2, WRAP, PROP_ATLAS.cardboardTop);
        parts.push(block.translate(0, deck + 0.15, 0));
    } else if (load === 2) {
        for (const [x, z, k] of [[-0.105, -0.085, 0], [0.105, -0.085, 1], [-0.105, 0.085, 2], [0.105, 0.085, 3]]) {
            parts.push(crate(0.19, 0.15, 0.16, CRATE_TINTS[(variant + k) & 3], false).translate(x, deck, z));
        }
    } else if (load === 3) {
        for (let layer = 0; layer < 3; layer++) {
            for (const z of [-0.085, 0.085]) {
                const sack = paint(new BoxGeometry(0.38, 0.055, 0.16), SACK, PROP_ATLAS.sack);
                parts.push(sack.rotateY(((layer + (z > 0 ? 1 : 0)) % 2) * 0.05 - 0.025).translate(0, deck + 0.0275 + layer * 0.055, z));
            }
        }
    }
    return merge(parts);
}

/** A steel drum, standing: ribbed, with a lid and its bung, and sometimes a hazard label. */
function drum(color, label) {
    const R = 0.1;
    const H = 0.31;
    const parts = [
        paint(new CylinderGeometry(R, R, H, 18).translate(0, H / 2, 0), color),
        paint(new CylinderGeometry(R + 0.004, R + 0.004, 0.012, 18).translate(0, H * 0.34, 0), color),
        paint(new CylinderGeometry(R + 0.004, R + 0.004, 0.012, 18).translate(0, H * 0.67, 0), color),
        paint(new CylinderGeometry(R + 0.003, R + 0.003, 0.01, 18).translate(0, H - 0.005, 0), color),
        paint(new CylinderGeometry(R - 0.004, R - 0.004, 0.004, 18).translate(0, H + 0.001, 0), DRUM_TOP),
        paint(new CylinderGeometry(0.012, 0.012, 0.008, 8).translate(0.05, H + 0.005, 0.02), DRUM_TOP),
    ];
    if (label) {
        // (With its back to the drum, for a look in behind its edge.)
        const sheet = paint(new CylinderGeometry(R + 0.0015, R + 0.0015, 0.1, 18, 1, true, -0.5, 1), WHITE, PROP_ATLAS.drumLabel).translate(0, H * 0.5, 0);
        parts.push(sheet, insideOut(sheet));
    }
    return merge(parts);
}

/** One or two steel drums; a lone one sometimes knocked over. */
function barrels(variant) {
    const color = (k) => DRUM_COLORS[(variant >>> (3 + k * 2)) & 3];
    if ((variant & 1) === 1) {
        return merge([
            drum(color(0), ((variant >>> 1) & 1) === 1).rotateY(0.4).translate(-0.103, 0, 0),
            drum(color(1), false).rotateY(-1.1).translate(0.103, 0, 0.01),
        ]);
    }
    const geometry = drum(color(0), ((variant >>> 2) & 1) === 1);
    if (((variant >>> 1) & 3) === 0) return grounded(geometry.rotateZ(Math.PI / 2)).translate(0.155, 0, 0);
    return geometry;
}

/** A traffic cone, standing on its square base: orange, with two white bands. */
function cone() {
    const H = 0.25;
    const radiusAt = (y) => 0.05 - (y / H) * 0.041;
    // (Closed at its ends, so there's no seeing down between it and the cone.)
    const band = (y, height) => paint(new CylinderGeometry(radiusAt(y + height) + 0.0012, radiusAt(y) + 0.0012, height, 16, 1).translate(0, 0.012 + y + height / 2, 0), CONE_BAND);
    return merge([
        paint(new BoxGeometry(0.13, 0.012, 0.13).translate(0, 0.006, 0), CONE_BASE),
        paint(new CylinderGeometry(0.009, 0.05, H, 16).translate(0, 0.012 + H / 2, 0), CONE_ORANGE),
        band(0.1, 0.035),
        band(0.165, 0.025),
    ]);
}

/** One or two cones, the first sometimes knocked over. */
function cones(variant) {
    const tipped = ((variant >>> 2) & 3) === 0;
    const upright = () => cached('cone', cone, false).clone();
    // On its side, tipped towards its point until that and the edge of its base are both on the floor (half the base,
    // less the point's radius, over the height between them: see cone()), and far enough over that its point is clear
    // of the base of the one standing beside it.
    const lie = Math.PI / 2 + Math.atan((0.065 - 0.009) / 0.25);
    const first = tipped ? grounded(upright().rotateZ(lie)).translate(0.17, 0, 0) : upright();
    if ((variant & 1) === 0) return first;
    return merge([first, upright().rotateY(0.7).translate(-0.14, 0, 0.06)]);
}

// Pallet racking: a bay's length and depth, the uprights' height, and the heights of its two shelves.
const RACK_LENGTH = 0.9;
const RACK_DEPTH = 0.32;
const RACK_HEIGHT = 0.68;
const RACK_SHELVES = [0.23, 0.46];

/** The frame of a bay of racking: blue uprights braced at each end, orange beams, and wire decking. */
function rackFrame() {
    const parts = [];
    const x = RACK_LENGTH / 2 - 0.012;
    const z = RACK_DEPTH / 2 - 0.012;
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) parts.push(paint(new BoxGeometry(0.022, RACK_HEIGHT, 0.022).translate(sx * x, RACK_HEIGHT / 2, sz * z), RACK_UPRIGHT));
        // The bracing between the front and back uprights: a zigzag up the end.
        for (let k = 0; k < 4; k++) {
            const y0 = 0.04 + k * 0.155;
            const y1 = y0 + 0.155;
            const length = Math.hypot(y1 - y0, 2 * z);
            const brace = new BoxGeometry(0.008, length, 0.008).rotateX(Math.atan2(2 * z, y1 - y0) * (k % 2 === 0 ? 1 : -1));
            parts.push(paint(brace.translate(sx * x, (y0 + y1) / 2, 0), RACK_UPRIGHT));
        }
        parts.push(paint(new BoxGeometry(0.03, 0.006, RACK_DEPTH + 0.02).translate(sx * x, 0.003, 0), RACK_UPRIGHT));
    }
    for (const y of RACK_SHELVES) {
        for (const sz of [-1, 1]) parts.push(paint(new BoxGeometry(RACK_LENGTH - 0.02, 0.026, 0.014).translate(0, y - 0.013, sz * z), RACK_BEAM));
        parts.push(paint(new BoxGeometry(RACK_LENGTH - 0.05, 0.005, RACK_DEPTH - 0.03).translate(0, y + 0.0025, 0), DECKING, PROP_ATLAS.decking));
    }
    return merge(parts);
}

/**
 * The loads on a rack's three shelves (the floor and two up), from its variant: three bits each. One too tall for the
 * room under the shelf above changes places with the top shelf's, if that fits where it was, or else isn't there.
 */
function rackLoads(variant) {
    const loads = [0, 1, 2].map((shelf) => (variant >>> (2 + shelf * 3)) & 7);
    for (let shelf = 0; shelf < 2; shelf++) {
        if (fitsOnShelf(loads[shelf], shelf)) continue;
        if (fitsOnShelf(loads[2], shelf)) [loads[shelf], loads[2]] = [loads[2], loads[shelf]];
        else loads[shelf] = 5; // (nothing)
    }
    return loads[0] | (loads[1] << 3) | (loads[2] << 6);
}

/** Whether a load fits on a shelf (0 the floor) under the decking of the one above; anything goes on the top one. */
function fitsOnShelf(load, shelf) {
    const geometry = rackLoadGeometry(load, shelf === 0);
    if (!geometry || shelf === 2) return true;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    return SHELF_TOPS[shelf] + /** @type {import('three').Box3} */ (geometry.boundingBox).max.y <= RACK_SHELVES[shelf];
}

/**
 * What's on one shelf of the racking, standing on it at the origin: crates, boxes, a wrapped pallet load, drums
 * (on the floor; a crate higher up), sacks, or nothing (loads 5 and 7).
 * @returns {import('three').BufferGeometry | null}
 */
function rackLoad(load, floor) {
    switch (load) {
        case 0:
            return merge([crate(0.2, 0.18, 0.2, 0xffffff, false).translate(-0.2, 0, 0), crate(0.2, 0.18, 0.2, 0xf2eadc, true).rotateY(0.05).translate(0.04, 0, 0), crate(0.19, 0.17, 0.19, 0xe6ddcf, false).translate(0.27, 0, 0.01)]);
        case 1:
            return merge([crate(0.21, 0.19, 0.19, 0xfff6e6, true).translate(-0.12, 0, 0), crate(0.21, 0.19, 0.19, 0xffffff, false).rotateY(-0.04).translate(0.13, 0, 0)]);
        case 2:
            return merge([cardboardBoxes(0x13).translate(-0.18, 0, 0), cardboardBoxes(0x2a).translate(0.2, 0, 0)]);
        case 3: {
            const height = floor ? 0.26 : 0.19;
            const block = paint(new BoxGeometry(0.4, height, 0.28), WRAP, PROP_ATLAS.wrap);
            paintFace(block, 2, WRAP, PROP_ATLAS.cardboardTop);
            return block.translate(0.06, height / 2, 0);
        }
        case 4:
            // (Drums lie end to end along the bay, as drums are racked: standing, they'd go up through the shelf.)
            return floor
                ? merge([
                    grounded(drum(DRUM_COLORS[0], true).translate(0, -0.155, 0).rotateZ(Math.PI / 2)).translate(-0.17, 0, 0),
                    grounded(drum(DRUM_COLORS[2], false).translate(0, -0.155, 0).rotateZ(-Math.PI / 2)).translate(0.17, 0, 0),
                ])
                : crate(0.2, 0.18, 0.2, 0xffffff, false).translate(-0.1, 0, 0);
        case 6: {
            const parts = [];
            for (let layer = 0; layer < 3; layer++) parts.push(paint(new BoxGeometry(0.36, 0.05, 0.24), SACK, PROP_ATLAS.sack).rotateY(layer * 0.04 - 0.04).translate(0, 0.025 + layer * 0.05, 0));
            return merge(parts);
        }
        default:
            return null;
    }
}

/**
 * A rack's pieces, each a template standing at the origin, and how far up it goes: the frame, and what's on each
 * of its three shelves (the floor and two up). There are 512 ways to load a rack, too many to keep a template of
 * each, so chunks are built from the pieces (see buildPropGeometry); only an outline or a box needs a whole one.
 * @returns {{ geometry: import('three').BufferGeometry, y: number }[]}
 */
function rackPieces(variant) {
    const loads = rackLoads(variant);
    const pieces = [{ geometry: cached('rack-frame', rackFrame), y: 0 }];
    for (let shelf = 0; shelf < 3; shelf++) {
        const geometry = rackLoadGeometry((loads >>> (shelf * 3)) & 7, shelf === 0);
        if (geometry) pieces.push({ geometry, y: SHELF_TOPS[shelf] });
    }
    return pieces;
}

/** The template of what's on a shelf (see rackLoad), or null for nothing. */
function rackLoadGeometry(load, floor) {
    if (load === 5 || load === 7) return null;
    return cached(`rack-load ${load} ${floor}`, () => /** @type {import('three').BufferGeometry} */ (rackLoad(load, floor)));
}

// Where the loads stand: the floor, and on each shelf's decking.
const SHELF_TOPS = [0, ...RACK_SHELVES.map((y) => y + 0.005)];

/** A bay of pallet racking, with whatever's on its three shelves, in one piece. */
function rack(variant) {
    return merge(rackPieces(variant).map(({ geometry, y }) => geometry.clone().translate(0, y, 0)));
}

// ---------------------------------------------------------------------------------------------- Level 37

// The colours of the pools' own (see poolroomsGeometry.js).
export const LIFEBUOY = [0xd8331f, 0xf2f0ea];
export const RINGS = [0xf2a7c3, 0x8fd3f0, 0xf7df7c, 0xb8e39a];
export const BALL = [0xf2f0ea, 0xd8331f, 0xf2c230, 0x2f6fc4, 0xf2f0ea, 0x3aa35b];

/** A tube round in a ring, lying flat on the floor, in `colors.length` stretches of colour going round. */
function lyingRing(radius, tube, colors) {
    const arc = (Math.PI * 2) / colors.length;
    const parts = colors.map((hex, k) => paint(new TorusGeometry(radius, tube, 8, Math.ceil(24 / colors.length), arc).rotateZ(k * arc), hex));
    return merge(parts).rotateX(-Math.PI / 2).translate(0, tube, 0);
}

/** A lifebuoy: red and white by quarters. */
function lifebuoy() {
    return lyingRing(0.1, 0.03, [...LIFEBUOY, ...LIFEBUOY]);
}

/** An inflatable ring, all one colour. */
function ring(color) {
    return lyingRing(0.11, 0.036, [RINGS[color]]);
}

/** A beach ball, its gores in turn. */
function ball() {
    const r = 0.055;
    const gore = (Math.PI * 2) / BALL.length;
    return merge(BALL.map((hex, k) => paint(new SphereGeometry(r, 3, 10, k * gore, gore), hex))).translate(0, r, 0);
}

// ---------------------------------------------------------------------------------------------- Level 2's

const SHELF_STEEL = [0x5d6a61, 0x7c7f7a, 0x44505b];
const TOOLBOX_COLORS = [0xa3261c, 0x24477a, 0xa3261c, 0x3d3f41];
const GALVANISED = 0x9ea4a5;
const MOP_BUCKET = 0xd6a516;
const CYLINDER_COLORS = [0x6b1f1c, 0x1f1f1f, 0x2d5a3a, 0x8c8f91, 0x23406c, 0x6b1f1c];
const CYLINDER_SHOULDERS = [0x6b1f1c, 0xe8e6de, 0x2d5a3a, 0x1f1f1f, 0x23406c, 0xb8912c];
const BRASS = 0xb08d3c;
const JAR = 0x9aa89a;
const BINDERS = [0x2b3e66, 0x6d2622, 0x2f4f36, 0x1f1f20, 0x86702e];

/**
 * A steel shelving unit, back to the wall (at −z): four angle posts and four shelves, with whatever was left on them:
 * cardboard boxes, tins, jars, rows of box files, and once in a while an old computer.
 */
function shelf(variant) {
    const W = 0.62;
    const D = 0.14;
    const H = 0.66;
    const steel = SHELF_STEEL[variant % SHELF_STEEL.length];
    const r = mulberry32(variant * 2654435761 + 7);
    const parts = [];
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) parts.push(paint(new BoxGeometry(0.014, H, 0.014).translate(sx * (W / 2 - 0.007), H / 2, sz * (D / 2 - 0.007)), steel));
    }
    const levels = [0.035, 0.225, 0.415, 0.605];
    for (const y of levels) parts.push(paint(new BoxGeometry(W, 0.008, D).translate(0, y, 0), steel));
    let computer = (variant & 31) === 0;
    for (let k = 0; k < levels.length; k++) {
        const floor = levels[k] + 0.004;
        const room = k < levels.length - 1 ? levels[k + 1] - floor - 0.012 : 0.07;
        let x = -W / 2 + 0.015 + r() * 0.03;
        while (x < W / 2 - 0.06) {
            const roll = r();
            if (computer && room > 0.15 && k < 2) {
                parts.push(cached('monitor', monitor).clone().scale(0.9, 0.9, 0.85).rotateY((r() - 0.5) * 0.2).translate(x + 0.07, floor, 0.002));
                x += 0.16;
                computer = false;
            } else if (roll < 0.26 && room > 0.08) {
                const w = 0.09 + r() * 0.07;
                if (x + w > W / 2 - 0.015) break;
                const h = Math.min(room - 0.004, 0.07 + r() * 0.08);
                parts.push(cardboardBox(w, h, 0.1 + r() * 0.025, CARDBOARD_TINTS[Math.floor(r() * CARDBOARD_TINTS.length)], r() < 0.4).rotateY((r() - 0.5) * 0.12).translate(x + w / 2, floor, (r() - 0.5) * 0.015));
                x += w + 0.01 + r() * 0.02;
            } else if (roll < 0.46) {
                // A few tins, in a row or stacked.
                const count = 2 + Math.floor(r() * 3);
                for (let n = 0; n < count && x < W / 2 - 0.03; n++) {
                    const stack = room > 0.08 && r() < 0.3 ? 2 : 1;
                    const z = (r() - 0.5) * 0.04;
                    for (let s = 0; s < stack; s++) {
                        // (The label all the way round, its picture's strip of colours.)
                        parts.push(paint(new CylinderGeometry(0.018, 0.018, 0.034, 7, 1).translate(x + 0.02, floor + 0.017 + s * 0.035, z), WHITE, PROP_ATLAS.tins));
                    }
                    x += 0.041;
                }
                x += 0.02;
            } else if (roll < 0.58 && room > 0.1) {
                // Box files on end, the last one leaning.
                const count = 3 + Math.floor(r() * 5);
                const lean = r() < 0.4 ? 0.12 : 0;
                for (let n = 0; n < count && x < W / 2 - 0.04; n++) {
                    const color = BINDERS[Math.floor(r() * BINDERS.length)];
                    const book = paint(new BoxGeometry(0.022, 0.095, 0.09), color);
                    paintFace(book, 4, color, PROP_ATLAS.spines);
                    parts.push(book.translate(0, 0.0475, 0).rotateZ(n === count - 1 ? -lean : 0).translate(x + 0.011, floor, 0.004));
                    x += 0.023;
                }
                x += 0.02;
            } else if (roll < 0.68) {
                // Jars of something, gone cloudy.
                const count = 1 + Math.floor(r() * 3);
                for (let n = 0; n < count && x < W / 2 - 0.03; n++) {
                    const h = 0.04 + r() * 0.02;
                    const z = (r() - 0.5) * 0.04;
                    parts.push(paint(new CylinderGeometry(0.02, 0.02, h, 7).translate(x + 0.021, floor + h / 2, z), JAR));
                    parts.push(paint(new CylinderGeometry(0.019, 0.019, 0.008, 7).translate(x + 0.021, floor + h + 0.004, z), [0x3d3f41, 0x8a2a20, BRASS][Math.floor(r() * 3)]));
                    x += 0.044;
                }
                x += 0.015;
            } else {
                // Nothing here.
                x += 0.05 + r() * 0.1;
            }
        }
    }
    return merge(parts);
}

/** A steel cantilever toolbox with its handle up, or left open with its tray out. */
function toolbox(color, w, open) {
    const h = 0.062;
    const d = 0.068;
    const parts = [
        paint(new BoxGeometry(w, h, d).translate(0, h / 2, 0), color),
        paint(new BoxGeometry(w + 0.004, 0.006, d + 0.004).translate(0, h * 0.72, 0), color),
    ];
    for (const s of [-1, 1]) parts.push(paint(new BoxGeometry(0.012, 0.012, 0.004).translate(s * w * 0.3, h * 0.6, d / 2 + 0.002), 0xb4b8ba));
    if (open) {
        // The lid swung back, the tray out, and a spanner and a screwdriver in it.
        parts.push(paint(new BoxGeometry(w, 0.006, d).translate(0, 0.003, d / 2).rotateX(-1.9).translate(0, h, -d / 2), color));
        parts.push(paint(new BoxGeometry(w * 0.96, 0.018, d * 0.5).translate(0, h + 0.012, d * 0.2), color));
        parts.push(paint(new BoxGeometry(w * 0.7, 0.006, 0.012).rotateY(0.2).translate(0, h + 0.024, d * 0.18), 0x8e9496));
        parts.push(paint(new BoxGeometry(0.05, 0.012, 0.014).translate(-w * 0.2, h + 0.026, d * 0.3), 0xc9391f));
    } else {
        parts.push(paint(new BoxGeometry(0.008, 0.028, 0.008).translate(-w * 0.32, h + 0.014, 0), 0x2b2c2d));
        parts.push(paint(new BoxGeometry(0.008, 0.028, 0.008).translate(w * 0.32, h + 0.014, 0), 0x2b2c2d));
        parts.push(paint(new BoxGeometry(w * 0.72, 0.01, 0.014).translate(0, h + 0.03, 0), 0x2b2c2d));
    }
    return merge(parts);
}

/** A toolbox, sometimes open; sometimes a second, smaller one beside it. */
function toolboxes(variant) {
    const color = (k) => TOOLBOX_COLORS[(variant >>> (1 + k)) & 3];
    const open = ((variant >>> 2) & 1) === 1;
    if ((variant & 1) === 0) return toolbox(color(0), 0.16, open);
    return merge([toolbox(color(0), 0.16, open).translate(-0.06, 0, 0), toolbox(color(1), 0.11, false).rotateY(0.5).translate(0.09, 0, 0.01)]);
}

/** A galvanised bucket with a little dark water in it, or a yellow mop bucket, its wringer and its mop. */
function bucket(variant) {
    if ((variant & 1) === 0) {
        const down = (variant & 2) === 0;
        const side = paint(new CylinderGeometry(0.05, 0.039, 0.095, 16, 1, true).translate(0, 0.0475, 0), GALVANISED);
        return merge([
            side,
            insideOut(side),
            paint(new CylinderGeometry(0.039, 0.039, 0.004, 16).translate(0, 0.002, 0), GALVANISED),
            paint(new CylinderGeometry(0.045, 0.045, 0.002, 16).translate(0, 0.05, 0), 0x16140f),
            paint(new TorusGeometry(0.051, 0.003, 4, 16).rotateX(Math.PI / 2).translate(0, 0.094, 0), GALVANISED),
            paint(new TorusGeometry(0.05, 0.0018, 4, 12, Math.PI).rotateX(down ? 1.35 : 0.2).translate(0, 0.094, 0), 0x6f7476),
        ]);
    }
    const parts = [
        paint(new BoxGeometry(0.17, 0.085, 0.12).translate(0, 0.05, 0), MOP_BUCKET),
        paint(new BoxGeometry(0.16, 0.002, 0.11).translate(0, 0.07, 0), 0x2a2620),
        paint(new BoxGeometry(0.065, 0.06, 0.11).translate(0.05, 0.12, 0), 0x6f7476),
        paint(new BoxGeometry(0.01, 0.07, 0.01).translate(0.05, 0.18, 0.048), 0x6f7476),
    ];
    for (const [x, z] of [[-0.07, -0.05], [0.07, -0.05], [-0.07, 0.05], [0.07, 0.05]]) parts.push(paint(new BoxGeometry(0.014, 0.014, 0.014).translate(x, 0.007, z), 0x1c1c1c));
    // The mop, leaning on the wringer.
    parts.push(paint(new CylinderGeometry(0.004, 0.004, 0.52, 6).translate(0, 0.26, 0).rotateZ(-0.35).translate(-0.03, 0.03, 0), (variant & 2) === 0 ? 0x2a4f8a : 0x7a7d78));
    parts.push(paint(new CylinderGeometry(0.03, 0.022, 0.035, 8).translate(-0.03, 0.07, 0), 0x9c968a));
    return merge(parts);
}

/** A gas cylinder standing on the floor: its body, a shoulder in another colour, the valve and its guard. */
function gasCylinder(color, shoulder) {
    const R = 0.042;
    const H = 0.34;
    // The guard round the valve, open at the top.
    const guard = paint(new CylinderGeometry(0.02, 0.022, 0.035, 10, 1, true).translate(0, H + 0.06, 0), 0x2b2c2d);
    return merge([
        paint(new CylinderGeometry(R, R, H, 14).translate(0, H / 2, 0), color),
        paint(new CylinderGeometry(R * 0.55, R, 0.04, 14).translate(0, H + 0.02, 0), shoulder),
        paint(new CylinderGeometry(0.008, 0.008, 0.02, 8).translate(0, H + 0.05, 0), BRASS),
        paint(new BoxGeometry(0.02, 0.012, 0.012).translate(0.01, H + 0.054, 0), BRASS),
        guard,
        insideOut(guard),
    ]);
}

/** One to three gas cylinders side by side, the first sometimes lying down. */
function cylinders(variant) {
    const count = 1 + (variant % 3);
    const lying = ((variant >>> 2) & 3) === 0;
    const parts = [];
    for (let k = 0; k < count; k++) {
        const kind = (variant >>> (3 + k)) % CYLINDER_COLORS.length;
        const one = gasCylinder(CYLINDER_COLORS[kind], CYLINDER_SHOULDERS[kind]);
        if (k === 0 && lying) parts.push(grounded(one.rotateZ(Math.PI / 2)).translate(0.2, 0, count > 1 ? 0.048 : 0));
        else if (lying) parts.push(one.rotateY(k * 1.7).translate((k - 1 - (count - 2) / 2) * 0.094, 0, -0.048));
        else parts.push(one.rotateY(k * 1.7).translate((k - (count - 1) / 2) * 0.094, 0, 0));
    }
    return merge(parts);
}

// ---------------------------------------------------------------------------------------------- Level 5's

const LEATHERS = [0x5a3420, 0x7a4a2a, 0x3a1f1a, 0x2a2a2e, 0x6b2a22, 0x8a6a45];
const STRAP = 0x2a1d14;
const HOTEL_BRASS = 0xb8903a;
const LINEN = 0xece6d8;
const SILVER = 0xc9ccce;
const ROSE = 0x9a1420;
const CARPET_RED = 0x6e1616;
const TYRE = 0x161616;
const PALM_GREENS = [0x2e5a2a, 0x355f2c, 0x3b6a30, 0x2a4f27, 0x41702f];

/**
 * A leather suitcase lying flat, its front (handle and catches) towards +z: two straps round it and brass corners.
 * @param {number} w
 * @param {number} h
 * @param {number} d
 * @param {number} color
 */
function suitcase(w, h, d, color) {
    const parts = [paint(new BoxGeometry(w, h, d).translate(0, h / 2, 0), color)];
    // The lid's seam, a darker band round it a little above the middle.
    parts.push(paint(new BoxGeometry(w + 0.002, 0.004, d + 0.002).translate(0, h * 0.62, 0), STRAP));
    for (const s of [-1, 1]) {
        parts.push(paint(new BoxGeometry(0.014, h + 0.004, d + 0.004).translate(s * w * 0.3, h / 2, 0), STRAP));
        parts.push(paint(new BoxGeometry(0.012, 0.012, 0.004).translate(s * w * 0.18, h * 0.62, d / 2 + 0.002), HOTEL_BRASS));
    }
    // The handle, on the front.
    parts.push(paint(new BoxGeometry(0.06, 0.008, 0.016).translate(0, h * 0.62, d / 2 + 0.012), STRAP));
    for (const s of [-1, 1]) parts.push(paint(new BoxGeometry(0.008, 0.011, 0.012).translate(s * 0.027, h * 0.62, d / 2 + 0.006), HOTEL_BRASS));
    return merge(parts);
}

/** A steamer trunk: dark, with wooden slats round it and brass at its corners. */
function trunk(color) {
    const w = 0.3;
    const h = 0.17;
    const d = 0.17;
    const parts = [paint(new BoxGeometry(w, h, d).translate(0, h / 2, 0), color)];
    for (const y of [0.035, h - 0.035]) parts.push(paint(new BoxGeometry(w + 0.006, 0.014, d + 0.006).translate(0, y, 0), 0x7a5a36));
    for (const s of [-1, 1]) parts.push(paint(new BoxGeometry(0.014, h + 0.006, d + 0.01).translate(s * w * 0.33, h / 2, 0), 0x7a5a36));
    for (const sx of [-1, 1]) {
        for (const sy of [0, 1]) {
            parts.push(paint(new BoxGeometry(0.024, 0.024, d + 0.01).translate(sx * (w / 2 - 0.008), sy ? h - 0.008 : 0.008, 0), HOTEL_BRASS));
        }
    }
    parts.push(paint(new BoxGeometry(0.03, 0.03, 0.006).translate(0, h * 0.72, d / 2 + 0.004), HOTEL_BRASS));
    return merge(parts);
}

/** A striped hatbox. */
function hatbox() {
    return merge([
        paint(new CylinderGeometry(0.068, 0.068, 0.075, 16).translate(0, 0.0375, 0), 0xd9cdb0),
        paint(new CylinderGeometry(0.071, 0.071, 0.018, 16).translate(0, 0.068, 0), 0x6b2a3a),
    ]);
}

/**
 * Luggage left in a corridor or a room: a suitcase, two stacked, one stood on end against one lying down, or a
 * trunk; and now and then a hatbox on top.
 */
function suitcases(variant) {
    const color = (k) => LEATHERS[(variant >>> (2 + 3 * k)) % LEATHERS.length];
    const arrangement = variant & 3;
    const parts = [];
    let top = 0;
    if (arrangement === 0) {
        parts.push(trunk(0x2e2a24 + ((variant >>> 2) & 1) * 0x101010));
        top = 0.17;
    } else if (arrangement === 1) {
        parts.push(suitcase(0.26, 0.075, 0.17, color(0)));
        top = 0.075;
    } else if (arrangement === 2) {
        parts.push(suitcase(0.26, 0.075, 0.17, color(0)));
        parts.push(suitcase(0.22, 0.065, 0.15, color(1)).rotateY(0.15).translate(0.01, 0.075, 0));
        top = 0.14;
    } else {
        parts.push(suitcase(0.24, 0.07, 0.16, color(0)).translate(0.04, 0, 0));
        // Stood on end, its handle up.
        parts.push(suitcase(0.2, 0.06, 0.15, color(1)).rotateZ(Math.PI / 2).translate(-0.1, 0.1, -0.005));
        top = 0.07;
    }
    if ((variant >>> 7) & 1 && arrangement !== 3) parts.push(hatbox().translate(0.02, top, 0));
    return merge(parts);
}

/** A silver cloche on its plate. */
function cloche(x, y, z) {
    return merge([
        paint(new CylinderGeometry(0.052, 0.052, 0.005, 14).translate(x, y + 0.0025, z), 0xf1ede4),
        paint(new SphereGeometry(0.042, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1).translate(x, y + 0.005, z), SILVER),
        paint(new SphereGeometry(0.008, 6, 4).translate(x, y + 0.045, z), SILVER),
    ]);
}

/**
 * Room service: a trolley under a white cloth, a covered plate on it, a rose in a bud vase and a bottle in its bucket;
 * or just the tray, put down outside the door, the cloche still on.
 */
function trolley(variant) {
    const parts = [];
    if ((variant & 1) === 0) {
        parts.push(paint(new BoxGeometry(0.2, 0.01, 0.14).translate(0, 0.005, 0), SILVER));
        parts.push(cloche(-0.03, 0.01, 0));
        parts.push(paint(new BoxGeometry(0.03, 0.006, 0.06).rotateY(0.3).translate(0.065, 0.013, 0.01), LINEN));
        parts.push(paint(new CylinderGeometry(0.012, 0.009, 0.04, 8).translate(0.07, 0.03, -0.04), 0xd8dde0));
        return merge(parts);
    }
    const w = 0.3;
    const d = 0.2;
    const h = 0.27;
    // The cloth, hanging nearly to the floor, and the castors under it.
    parts.push(paint(new BoxGeometry(w, h - 0.035, d).translate(0, 0.035 + (h - 0.035) / 2, 0), LINEN));
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            parts.push(paint(new CylinderGeometry(0.014, 0.014, 0.012, 8).rotateX(Math.PI / 2).translate(sx * (w / 2 - 0.03), 0.014, sz * (d / 2 - 0.03)), TYRE));
            parts.push(paint(new BoxGeometry(0.01, 0.02, 0.01).translate(sx * (w / 2 - 0.03), 0.03, sz * (d / 2 - 0.03)), SILVER));
        }
    }
    parts.push(cloche(-0.06, h, 0.01));
    // A rose in a bud vase.
    parts.push(paint(new CylinderGeometry(0.008, 0.014, 0.07, 8).translate(0.05, h + 0.035, -0.05), 0xdfe6e4));
    parts.push(paint(new CylinderGeometry(0.0015, 0.0015, 0.05, 4).translate(0.05, h + 0.09, -0.05), 0x2e5a2a));
    parts.push(paint(new SphereGeometry(0.013, 8, 6).translate(0.05, h + 0.118, -0.05), ROSE));
    if ((variant >>> 1) & 1) {
        // A bottle in an ice bucket.
        parts.push(paint(new CylinderGeometry(0.03, 0.024, 0.07, 12).translate(0.09, h + 0.035, 0.04), SILVER));
        parts.push(paint(new CylinderGeometry(0.014, 0.016, 0.11, 8).rotateZ(0.2).translate(0.085, h + 0.08, 0.04), 0x1d3322));
        parts.push(paint(new CylinderGeometry(0.006, 0.008, 0.03, 6).rotateZ(0.2).translate(0.074, h + 0.142, 0.04), 0xb8903a));
    } else {
        parts.push(paint(new CylinderGeometry(0.014, 0.01, 0.045, 8).translate(0.1, h + 0.0225, 0.05), 0xd8dde0));
        parts.push(paint(new CylinderGeometry(0.014, 0.01, 0.045, 8).translate(0.07, h + 0.0225, 0.07), 0xd8dde0));
    }
    return merge(parts);
}

/**
 * A brass luggage cart: a carpeted deck on four wheels, a hoop of brass over it with a rail for coats, and cases on
 * the deck.
 */
function luggageCart(variant) {
    const w = 0.4;
    const d = 0.2;
    const deck = 0.07;
    const top = 0.56;
    const parts = [paint(new BoxGeometry(w, 0.025, d).translate(0, deck - 0.0125, 0), HOTEL_BRASS)];
    parts.push(paint(new BoxGeometry(w - 0.02, 0.004, d - 0.02).translate(0, deck + 0.002, 0), CARPET_RED));
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            parts.push(paint(new CylinderGeometry(0.024, 0.024, 0.014, 10).rotateX(Math.PI / 2).translate(sx * (w / 2 - 0.035), 0.024, sz * (d / 2 - 0.02)), TYRE));
        }
        // An upright at each end, up to the hoop.
        parts.push(paint(new CylinderGeometry(0.007, 0.007, top - deck + 0.01, 8).translate(sx * (w / 2 - 0.01), (deck - 0.01 + top) / 2, 0), HOTEL_BRASS));
    }
    // The hoop: half a circle, squashed, from one upright to the other; and the rail across under it.
    parts.push(paint(new TorusGeometry(w / 2 - 0.01, 0.007, 5, 16, Math.PI).scale(1, 0.45, 1).translate(0, top, 0), HOTEL_BRASS));
    parts.push(paint(new CylinderGeometry(0.005, 0.005, w - 0.02, 6).rotateZ(Math.PI / 2).translate(0, top - 0.02, 0), HOTEL_BRASS));
    // What's on it.
    const load = variant & 3;
    const color = (k) => LEATHERS[(variant >>> (2 + 3 * k)) % LEATHERS.length];
    if (load !== 0) parts.push(suitcase(0.24, 0.07, 0.15, color(0)).rotateY(Math.PI).translate(-0.05, deck + 0.004, 0));
    if (load >= 2) parts.push(suitcase(0.2, 0.06, 0.14, color(1)).rotateY(0.1).translate(-0.04, deck + 0.074, 0));
    if (load === 3) parts.push(suitcase(0.16, 0.055, 0.13, color(2)).rotateZ(Math.PI / 2).translate(0.15, deck + 0.084, 0));
    return merge(parts);
}

/**
 * A palm against a wall (this bit of its variant set; the low four are its shape): its fronds spread over the half in
 * front of it (its own +z), so nothing of it reaches back further than its pot's rim, PALM_BACK from its middle.
 */
export const PALM_WALL = 0x10;
export const PALM_BACK = 0.082;

/**
 * A kentia palm in a brass planter: its stems up out of the soil, and fronds arching out and down all round (or, against
 * a wall, all round the front of it), each a rib with its leaflets either side (both faces of each: a leaf is seen from
 * below as often as from above).
 */
function palm(variant) {
    const r = mulberry32((variant & 0xf) * 2654435761 + 19);
    const wall = (variant & PALM_WALL) !== 0;
    const potTop = 0.13;
    const parts = [
        paint(new CylinderGeometry(0.075, 0.056, potTop, 16).translate(0, potTop / 2, 0), HOTEL_BRASS),
        paint(new TorusGeometry(0.075, 0.006, 5, 16).rotateX(Math.PI / 2).translate(0, potTop, 0), HOTEL_BRASS),
        paint(new CylinderGeometry(0.07, 0.07, 0.006, 14).translate(0, potTop - 0.012, 0), 0x2a1f16),
    ];
    const { leaf, geometry } = foliage();
    const stems = 3 + Math.floor(r() * 2);
    for (let s = 0; s < stems; s++) {
        const angle = r() * Math.PI * 2;
        parts.push(paint(new CylinderGeometry(0.005, 0.007, 0.12, 5).rotateZ(0.2).rotateY(angle).translate(Math.cos(angle) * 0.01, potTop + 0.05, Math.sin(angle) * 0.01), 0x5a4a2a));
    }
    const fronds = 7 + Math.floor(r() * 3);
    for (let f = 0; f < fronds; f++) {
        // (Against a wall, over the half in front, clear of the wall either side: nothing reaches back past the pot.)
        const theta = wall ? 0.35 + ((f + 0.5) / fronds) * (Math.PI - 0.7) + (r() - 0.5) * 0.3 : (f / fronds) * Math.PI * 2 + (r() - 0.5) * 0.5;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        const length = 0.24 + r() * 0.12;
        const lift = 1.1 + r() * 0.6;
        const droop = 2.2 + r() * 1.2;
        const y0 = potTop + 0.08 + r() * 0.06;
        const green = PALM_GREENS[Math.floor(r() * PALM_GREENS.length)];
        // The rib: out along theta, up and over.
        const at = (t) => {
            const out = t * length;
            return [cos * out, y0 + lift * out - droop * out * out, sin * out];
        };
        const steps = 9;
        for (let k = 1; k <= steps; k++) {
            const t = k / steps;
            const p = at(t);
            const q = at(t - 1 / steps);
            // The rib itself, a thin sliver.
            leaf(q, p, [q[0] - sin * 0.004, q[1], q[2] + cos * 0.004], 0x4a5a2a);
            if (k < 2) continue;
            const along = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
            const leafLength = 0.1 * (1 - t * 0.65);
            for (const side of [-1, 1]) {
                // Out to the side, swept forward, hanging down.
                const dx = -sin * side * 0.75 + along[0] * 2.2;
                const dz = cos * side * 0.75 + along[2] * 2.2;
                const dy = -0.45 - t * 0.3;
                const n = Math.hypot(dx, dy, dz);
                const tip = [p[0] + (dx / n) * leafLength, p[1] + (dy / n) * leafLength, p[2] + (dz / n) * leafLength];
                const back = [p[0] - along[0] * 0.7, p[1] - along[1] * 0.7, p[2] - along[2] * 0.7];
                leaf(p, tip, back, green);
            }
        }
    }
    parts.push(geometry());
    return merge(parts);
}

// ---------------------------------------------------------------------------------------------- Level 4's

const COOLER_BODIES = [0xd3cfc3, 0xc9c6bc, 0xb4b5b1, 0xd6cfbc];
const COOLER_TOP = 0x9d9e9a;
const COOLER_BASE = 0x4c4d4b;
const WATER = 0x3b74a8;
const BOTTLE_EMPTY = 0xa6c0d0;
const BOTTLE_CAP = 0x2b5d9e;
const TAP_BLUE = 0x2c5a96;
const TAP_RED = 0xa3322a;
const PAPER_CUP = 0xe6e3d8;
const POTS = [0x6b6c6a, 0x93573a, 0xcdcac0, 0x3a3b3c];
const SOIL = 0x2b2219;
const DRY_SOIL = 0x54432f;
const BARK = 0x5e5142;
const LEAF_GREENS = [0x2c5528, 0x36622f, 0x294a25, 0x3f6c35, 0x325a2a];
const LEAF_YELLOWS = [0x9c8f3e, 0xa8963f, 0x8c863a];
const LEAF_BROWNS = [0x6b4f2e, 0x5b4328, 0x7a5c34, 0x846436];
const BIN_COLORS = [0x55585a, 0x232425, 0x2b4f85, 0x7d7a70];
const PAPERS = [0xe2ded2, 0xd7d3c6, 0xe6dc9e, 0xd2d8d9];
// Paper in the shadow down inside a bin.
const PAPER_SHADOW = 0xb3afa3;
const OFFICE_BINDERS = [0x2b3e66, 0x6d2622, 0x2f4f36, 0x1f1f20, 0x86702e, 0x62656a, 0x46395a, 0x2a5a72];
const BINDER_PAGES = 0xcdc8b8;
const ARCHIVE_WHITE = 0xd4cfc1;

// A 19-litre water bottle standing on its base, as [radius, height] up its side: two ribs round it, the shoulder, and
// the neck (left open: it's inside the cooler, or under its cap).
const BOTTLE_PROFILE = [
    [0, 0], [0.038, 0.003], [0.047, 0.012], [0.048, 0.045], [0.051, 0.052], [0.048, 0.059], [0.048, 0.1],
    [0.051, 0.107], [0.048, 0.114], [0.047, 0.135], [0.04, 0.155], [0.027, 0.167], [0.016, 0.172], [0.015, 0.195],
];
const BOTTLE_HEIGHT = 0.195;

/**
 * A water bottle standing on its base, `fill` of it water: from the neck down if it's to go upside down on a cooler,
 * from the base up if not. Where there's no water it's paler, the plastic on its own.
 */
function waterBottle(fill, upsideDown) {
    const bottle = paint(new LatheGeometry(BOTTLE_PROFILE.map(([r, y]) => new Vector2(r, y)), 12), BOTTLE_EMPTY);
    const position = bottle.attributes.position;
    const color = bottle.attributes.color;
    const r = ((WATER >> 16) & 255) / 255;
    const g = ((WATER >> 8) & 255) / 255;
    const b = (WATER & 255) / 255;
    for (let i = 0; i < position.count; i++) {
        const y = position.getY(i);
        const wet = upsideDown ? y >= BOTTLE_HEIGHT * (1 - fill) : y <= BOTTLE_HEIGHT * fill;
        if (fill > 0 && wet) color.setXYZ(i, r, g, b);
    }
    return bottle;
}

/**
 * An office water cooler, its front (a cold tap and a hot one, over the drip tray) towards +z, and its bottle upside
 * down on top: full, half gone, empty, or taken away. Now and then a stack of paper cups up there beside the bottle, a
 * cup left on the tray, and a spare bottle on the floor next to it.
 */
function waterCooler(variant) {
    const W = 0.12;
    const D = 0.12;
    const top = 0.35;
    const front = D / 2;
    const body = COOLER_BODIES[(variant >>> 5) & 3];
    const parts = [
        paint(new BoxGeometry(W - 0.008, 0.014, D - 0.008).translate(0, 0.007, 0), COOLER_BASE),
        paint(new BoxGeometry(W, top - 0.026, D).translate(0, 0.014 + (top - 0.026) / 2, 0), body),
        paint(new BoxGeometry(W + 0.004, 0.012, D + 0.004).translate(0, top - 0.006, 0), COOLER_TOP),
        // The collar the bottle's neck goes down into.
        paint(new CylinderGeometry(0.03, 0.034, 0.012, 12).translate(0, top + 0.006, 0), COOLER_TOP),
        // The cupboard door below, a shade darker than the rest (every channel of every body is well over 0x0c), and a
        // badge up near the top.
        paint(new BoxGeometry(W - 0.024, 0.17, 0.002).translate(0, 0.115, front + 0.001), body - 0x0c0c0c),
        paint(new BoxGeometry(0.034, 0.008, 0.002).translate(0, 0.322, front + 0.001), 0x3a3b3d),
        // The alcove the taps are in, in shadow, and the drip tray at the bottom of it with its grille.
        paint(new BoxGeometry(0.086, 0.07, 0.003).translate(0, 0.272, front + 0.0015), 0x7d7c77),
        // (What stands out of the alcove starts at its face, not in it: nothing shares a face with it.)
        paint(new BoxGeometry(0.074, 0.008, 0.03).translate(0, 0.241, front + 0.018), COOLER_BASE),
        paint(new BoxGeometry(0.066, 0.001, 0.024).translate(0, 0.2455, front + 0.018), 0x2a2b2a),
    ];
    for (const [x, hex] of [[-0.022, TAP_BLUE], [0.022, TAP_RED]]) {
        parts.push(paint(new BoxGeometry(0.014, 0.014, 0.018).translate(x, 0.292, front + 0.012), hex));
        parts.push(paint(new CylinderGeometry(0.0035, 0.0035, 0.012, 6).translate(x, 0.281, front + 0.016), hex));
    }
    const bottle = variant & 3;
    if (bottle !== 3) {
        // Upside down, its neck in the collar.
        parts.push(waterBottle([0.94, 0.45, 0][bottle], true).rotateX(Math.PI).translate(0, top - 0.01 + BOTTLE_HEIGHT, 0));
    }
    if ((variant >>> 3) & 1) {
        // Cups stacked upside down in the corner, clear of the bottle.
        for (let k = 0; k < 5; k++) parts.push(paint(new CylinderGeometry(0.0085, 0.011, 0.02, 8).translate(-0.043, top + 0.01 + k * 0.006, 0.043), PAPER_CUP));
    }
    if ((variant >>> 4) & 1) parts.push(paint(new CylinderGeometry(0.011, 0.008, 0.022, 8).translate(0.022, 0.257, front + 0.018), PAPER_CUP));
    const cooler = merge(parts);
    if (((variant >>> 2) & 1) === 0) return cooler;
    // A spare, still sealed, stood on the floor beside it; the two together centred on what they cover.
    const spare = merge([
        waterBottle(0.85, false),
        paint(new CylinderGeometry(0.0165, 0.0165, 0.012, 10).translate(0, BOTTLE_HEIGHT - 0.004, 0), BOTTLE_CAP),
    ]);
    return merge([cooler.translate(-0.05, 0, 0), spare.translate(0.078, 0, -0.012)]);
}

/** A thin rod from a to b ([x, y, z] each), `r0` thick at a and `r1` at b: a trunk, or (`open` at its ends) a branch. */
function rod(a, b, r0, r1, sides, hex, open = false) {
    const along = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const length = along.length();
    const geometry = new CylinderGeometry(r1, r0, length, sides, 1, open).translate(0, length / 2, 0);
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), along.normalize()));
    return paint(geometry.translate(a[0], a[1], a[2]), hex);
}

/**
 * A small leaf, from `base` along `dir` (a unit vector): a diamond, widest a little way along, its two halves turned
 * down a little either side of the middle (by `fold` of its width).
 */
function blade(leaf, base, dir, length, width, hex, fold = 0.15) {
    let sx = -dir[2];
    let sz = dir[0];
    const flat = Math.hypot(sx, sz);
    // Pointing straight up or down: any way across will do.
    if (flat < 1e-6) [sx, sz] = [1, 0];
    else [sx, sz] = [sx / flat, sz / flat];
    const tip = [base[0] + dir[0] * length, base[1] + dir[1] * length, base[2] + dir[2] * length];
    const mid = [base[0] + dir[0] * length * 0.4, base[1] + dir[1] * length * 0.4 - width * fold, base[2] + dir[2] * length * 0.4];
    const left = [mid[0] - sx * width / 2, mid[1], mid[2] - sz * width / 2];
    const right = [mid[0] + sx * width / 2, mid[1], mid[2] + sz * width / 2];
    leaf(base, left, tip, hex);
    leaf(base, tip, right, hex);
}

/**
 * An office plant in a pot, plastic, terracotta or glazed: a ficus, one to three thin trunks with small leaves along
 * their branches, or a floor plant, long leaves arching up and over out of the pot. Watered or not: some are green,
 * some going yellow, and some dying, brown and half bare, with dead leaves on the floor round the pot.
 */
function officePlant(variant) {
    const r = mulberry32(variant * 2654435761 + 23);
    const ficus = ((variant >>> 2) & 1) === 0;
    // 0 and 1 green, 2 going yellow, 3 dying.
    const health = (variant >>> 3) & 3;
    const pick = (list) => list[Math.floor(r() * list.length)];
    const potTop = 0.1;
    // (Open, so the soil shows a little way down inside the rim.)
    const pot = paint(new CylinderGeometry(0.053, 0.04, potTop, 12, 1, true).translate(0, potTop / 2, 0), POTS[variant & 3]);
    const parts = [
        pot,
        insideOut(pot),
        paint(new TorusGeometry(0.053, 0.004, 3, 12).rotateX(Math.PI / 2).translate(0, potTop, 0), POTS[variant & 3]),
        paint(new CylinderGeometry(0.05, 0.05, 0.004, 10).translate(0, potTop - 0.014, 0), health === 3 ? DRY_SOIL : SOIL),
    ];
    const { leaf, geometry } = foliage();
    const keep = [1, 1, 0.75, 0.4][health];
    const leafColor = () => {
        const roll = r();
        if (health < 2) return roll < 0.93 ? pick(LEAF_GREENS) : pick(LEAF_YELLOWS);
        if (health === 2) return roll < 0.5 ? pick(LEAF_GREENS) : roll < 0.82 ? pick(LEAF_YELLOWS) : pick(LEAF_BROWNS);
        return roll < 0.15 ? pick(LEAF_GREENS) : roll < 0.45 ? pick(LEAF_YELLOWS) : pick(LEAF_BROWNS);
    };
    if (ficus) {
        const stems = 1 + Math.floor(r() * 3);
        const height = 0.42 + r() * 0.1;
        const turn = r() * Math.PI * 2;
        const trunks = [];
        for (let s = 0; s < stems; s++) {
            const a = turn + (s / stems) * Math.PI * 2;
            const lean = stems === 1 ? 0.02 : 0.05 + r() * 0.04;
            const apart = stems === 1 ? 0 : 0.008;
            const base = [Math.cos(a) * apart, potTop - 0.016, Math.sin(a) * apart];
            const tip = [base[0] + Math.cos(a) * lean * height, height, base[2] + Math.sin(a) * lean * height];
            parts.push(rod(base, tip, 0.007, 0.004, 5, BARK));
            trunks.push([base, tip]);
            // A few leaves at the top.
            for (let k = 0; k < 5; k++) {
                if (r() > keep) continue;
                const b = r() * Math.PI * 2;
                const up = 0.3 - r() * 0.6;
                const n = Math.hypot(1, up);
                blade(leaf, tip, [Math.cos(b) / n, up / n, Math.sin(b) / n], 0.036 + r() * 0.01, 0.02, leafColor());
            }
        }
        // Branches off the upper part, shorter towards the top, each with its leaves in pairs along it and one at its end.
        const branches = 8 + Math.floor(r() * 2);
        for (let k = 0; k < branches; k++) {
            const [base, tip] = trunks[k % stems];
            const t = 0.35 + 0.6 * (k / branches) + r() * 0.05;
            const start = [base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t, base[2] + (tip[2] - base[2]) * t];
            const b = turn + k * 2.4 + (r() - 0.5) * 0.6;
            const rise = 0.15 + r() * 0.3;
            const n = Math.hypot(1, rise);
            const dir = [Math.cos(b) / n, rise / n, Math.sin(b) / n];
            const length = 0.07 + 0.08 * (1 - (t - 0.35) / 0.65) + r() * 0.02;
            const end = [start[0] + dir[0] * length, start[1] + dir[1] * length, start[2] + dir[2] * length];
            parts.push(rod(start, end, 0.0028, 0.0016, 4, BARK, true));
            for (let j = 1; j <= 5; j++) {
                const p = [start[0] + dir[0] * length * (j / 5), start[1] + dir[1] * length * (j / 5), start[2] + dir[2] * length * (j / 5)];
                for (const side of j === 5 ? [0] : [-1, 1]) {
                    if (r() > keep) continue;
                    // Out to the side, a little forward, and hanging (a ficus's leaves droop).
                    const dx = Math.cos(b) * 0.6 - Math.sin(b) * side * 0.7;
                    const dz = Math.sin(b) * 0.6 + Math.cos(b) * side * 0.7;
                    const dy = -0.25 - r() * 0.45 + (side === 0 ? 0.3 : 0);
                    const m = Math.hypot(dx, dy, dz);
                    blade(leaf, p, [dx / m, dy / m, dz / m], 0.036 + r() * 0.01, 0.019 + r() * 0.004, leafColor());
                }
            }
        }
    } else {
        const count = 10 + Math.floor(r() * 4);
        for (let f = 0; f < count; f++) {
            if (r() > keep) continue;
            const theta = (f / count) * Math.PI * 2 + (r() - 0.5) * 0.4;
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            const reach = 0.07 + r() * 0.07;
            const rise = 0.42 + r() * 0.12;
            // A dying one's leaves hang down over the rim.
            const sag = rise * (0.45 + r() * 0.3 + (health === 3 ? 0.35 : 0));
            const width = 0.022 + r() * 0.008;
            const hex = leafColor();
            // Going yellow, they go brown at their tips first.
            const tipHex = health >= 2 ? pick(LEAF_BROWNS) : hex;
            const edge = (t, side) => {
                const out = 0.006 + reach * t;
                const y = potTop - 0.006 + rise * t - sag * t * t;
                const w = (width / 2) * Math.sin(Math.PI * (0.12 + 0.88 * t));
                return [cos * out - sin * side * w, y, sin * out + cos * side * w];
            };
            const steps = 5;
            for (let k = 0; k < steps; k++) {
                const t0 = k / steps;
                const t1 = (k + 1) / steps;
                const color = k === steps - 1 ? tipHex : hex;
                leaf(edge(t0, -1), edge(t0, 1), edge(t1, 1), color);
                leaf(edge(t0, -1), edge(t1, 1), edge(t1, -1), color);
            }
        }
    }
    // What's dropped, lying flat on the floor round the pot (clear of the shadow under it).
    const fallen = [0, r() < 0.3 ? 1 : 0, 3 + Math.floor(r() * 3), 7 + Math.floor(r() * 5)][health];
    for (let k = 0; k < (ficus ? fallen : Math.ceil(fallen / 3)); k++) {
        const a = r() * Math.PI * 2;
        const d = ficus ? 0.065 + r() * 0.08 : 0.06 + r() * 0.04;
        // (A long one lies round the pot rather than out from it.)
        const b = ficus ? r() * Math.PI * 2 : a + Math.PI / 2 + (r() - 0.5);
        const hex = r() < 0.6 ? pick(LEAF_BROWNS) : pick(LEAF_YELLOWS);
        const [length, width] = ficus ? [0.03, 0.015] : [0.1 + r() * 0.04, 0.022];
        // (Each a little higher than the last, so where two lie over each other, one's on top.)
        blade(leaf, [Math.cos(a) * d, 0.003 + k * 0.0007, Math.sin(a) * d], [Math.cos(b), 0, Math.sin(b)], length, width, hex, 0);
    }
    parts.push(geometry());
    return merge(parts);
}

// The size of a waste bin: its height, and its radius at the top and the bottom (a square one is a little narrower).
const BIN_HEIGHT = 0.12;
const BIN_TOP = 0.066;
const BIN_BOTTOM = 0.052;
const SQUARE_BIN = 0.059;

/** A crumpled ball of paper, about `radius` round, lumpy in its own way (from `seed`), resting on the floor. */
function paperBall(radius, seed, hex) {
    const ball = new SphereGeometry(radius, 6, 4);
    const position = ball.attributes.position;
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        // (From where the point is, so the two copies of each point on the seam move together.)
        const lump = Math.sin(x * 917 + y * 473 + z * 231 + seed * 12.9898) * 43758.5453;
        const scale = 0.75 + 0.45 * (lump - Math.floor(lump));
        position.setXYZ(i, x * scale, y * scale, z * scale);
    }
    ball.computeVertexNormals();
    return grounded(paint(ball, hex));
}

/** A sheet of A4, lying flat, its underside at `y`. */
function sheet(y, hex) {
    return paint(new BoxGeometry(0.078, 0.0015, 0.11).translate(0, y + 0.00075, 0), hex);
}

/** A round plastic waste bin, open at the top, narrower at the bottom. */
function roundBin(color) {
    const side = paint(new CylinderGeometry(BIN_TOP, BIN_BOTTOM, BIN_HEIGHT, 14, 1, true).translate(0, BIN_HEIGHT / 2, 0), color);
    return merge([
        side,
        insideOut(side),
        paint(new CylinderGeometry(BIN_BOTTOM, BIN_BOTTOM, 0.004, 14).translate(0, 0.002, 0), color),
        paint(new TorusGeometry(BIN_TOP, 0.0035, 4, 14).rotateX(Math.PI / 2).translate(0, BIN_HEIGHT, 0), color),
    ]);
}

/** A square one: four thin walls and a bottom, drawn in towards the bottom. */
function squareBin(color) {
    const w = SQUARE_BIN * 2;
    const t = 0.003;
    const parts = [paint(new BoxGeometry(w, 0.004, w).translate(0, 0.002, 0), color)];
    for (const s of [-1, 1]) {
        parts.push(paint(new BoxGeometry(t, BIN_HEIGHT, w).translate(s * (w / 2 - t / 2), BIN_HEIGHT / 2, 0), color));
        parts.push(paint(new BoxGeometry(w - 2 * t, BIN_HEIGHT, t).translate(0, BIN_HEIGHT / 2, s * (w / 2 - t / 2)), color));
    }
    const bin = merge(parts);
    const position = bin.attributes.position;
    for (let i = 0; i < position.count; i++) {
        const k = BIN_BOTTOM / BIN_TOP + (1 - BIN_BOTTOM / BIN_TOP) * (position.getY(i) / BIN_HEIGHT);
        position.setXYZ(i, position.getX(i) * k, position.getY(i), position.getZ(i) * k);
    }
    return bin;
}

/**
 * An office waste bin, round or square, grey, black or the blue recycling kind: empty, with balls of paper in it, one
 * of them missed and on the floor beside it, or full to overflowing. Now and then it's been knocked over, and what was
 * in it is out across the floor.
 */
function wasteBin(variant) {
    const r = mulberry32(variant * 2654435761 + 29);
    const square = ((variant >>> 2) & 1) === 1;
    const contents = (variant >>> 3) & 3;
    const paper = () => PAPERS[Math.floor(r() * PAPERS.length)];
    const body = square ? squareBin(BIN_COLORS[variant & 3]) : roundBin(BIN_COLORS[variant & 3]);
    // How far it is across inside, halved, at height y.
    const inside = (y) => (square ? SQUARE_BIN : BIN_TOP) * (BIN_BOTTOM / BIN_TOP + (1 - BIN_BOTTOM / BIN_TOP) * (y / BIN_HEIGHT)) - 0.004;
    if (((variant >>> 5) & 3) === 0) {
        // On its side, its mouth towards +x: tipped over until its side lies along the floor.
        const slope = ((square ? SQUARE_BIN : BIN_TOP) - (square ? SQUARE_BIN * BIN_BOTTOM / BIN_TOP : BIN_BOTTOM)) / BIN_HEIGHT;
        const lying = grounded(body.rotateZ(-Math.PI / 2 + Math.atan(slope)));
        const mouth = /** @type {import('three').Box3} */ (lying.boundingBox).max.x;
        const parts = [lying];
        const balls = 2 + Math.floor(r() * 3);
        for (let k = 0; k < balls; k++) parts.push(paperBall(0.013 + r() * 0.005, r() * 100, paper()).translate(mouth - 0.025 + r() * 0.08, 0, (r() - 0.5) * 0.1));
        const sheets = 1 + Math.floor(r() * 2);
        for (let k = 0; k < sheets; k++) parts.push(sheet(0.0015 + k * 0.0015, paper()).rotateY(r() * Math.PI).translate(mouth + 0.02 + r() * 0.04, 0, (r() - 0.5) * 0.06));
        return centred(merge(parts));
    }
    const parts = [body];
    if (contents > 0) {
        // The paper at the bottom of the heap, in shadow, and the balls on top of it.
        const level = contents === 3 ? BIN_HEIGHT - 0.012 : BIN_HEIGHT - 0.034;
        const half = inside(level);
        parts.push(paint(square ? new BoxGeometry(half * 2, 0.004, half * 2).translate(0, level - 0.002, 0) : new CylinderGeometry(half, half, 0.004, 14).translate(0, level - 0.002, 0), PAPER_SHADOW));
        const balls = contents === 3 ? 6 : 3 + Math.floor(r() * 2);
        for (let k = 0; k < balls; k++) {
            const a = (k / balls) * Math.PI * 2 + r();
            const d = r() * half * 0.55;
            const heap = contents === 3 ? r() * 0.012 : 0;
            parts.push(paperBall(0.013 + r() * 0.005, r() * 100, paper()).translate(Math.cos(a) * d, level - 0.004 + heap, Math.sin(a) * d));
        }
    }
    if (contents >= 2) {
        const a = r() * Math.PI * 2;
        parts.push(paperBall(0.014, r() * 100, paper()).translate(Math.cos(a) * (BIN_TOP + 0.024), 0, Math.sin(a) * (BIN_TOP + 0.024)));
    }
    return merge(parts);
}

/** A lever-arch file lying on its side, its spine (a label and the finger hole) towards +z and its pages to −z. */
function lyingBinder(color) {
    const file = paint(new BoxGeometry(0.026, 0.118, 0.105), color);
    paintFace(file, 4, color, PROP_ATLAS.spines);
    paintFace(file, 5, BINDER_PAGES, PROP_ATLAS.plain);
    return file.rotateZ(Math.PI / 2).translate(0, 0.013, 0);
}

/** A few lever-arch files in a pile, not quite square on each other, now and then one turned round. */
function binderPile(r, count) {
    const parts = [];
    for (let k = 0; k < count; k++) {
        const turned = r() < 0.2 ? Math.PI : 0;
        parts.push(lyingBinder(OFFICE_BINDERS[Math.floor(r() * OFFICE_BINDERS.length)]).rotateY(turned + (r() - 0.5) * 0.16).translate((r() - 0.5) * 0.008, k * 0.026, (r() - 0.5) * 0.008));
    }
    return merge(parts);
}

// A cardboard archive box: across, high (its lid on), and front to back.
const ARCHIVE = [0.13, 0.095, 0.105];

/**
 * A cardboard archive box, its front (a hand hole and a label) towards +z: brown or white, its lid on, or off and the
 * box full of papers.
 */
function archiveBox(white, tint, lid) {
    const [w, h, d] = ARCHIVE;
    const cardboard = (geometry) => (white ? paint(geometry, ARCHIVE_WHITE) : paint(geometry, tint, PROP_ATLAS.cardboard));
    const box = cardboard(new BoxGeometry(w, h - 0.002, d));
    if (!lid) paintFace(box, 2, PAPERS[1], PROP_ATLAS.plain);
    const parts = [
        box.translate(0, (h - 0.002) / 2, 0),
        paint(new BoxGeometry(0.034, 0.011, 0.002).translate(0, h * 0.7, d / 2 + 0.0005), 0x2a241c),
        paint(new BoxGeometry(0.05, 0.028, 0.002).translate(0, h * 0.4, d / 2 + 0.0005), 0xe9e5d8),
    ];
    if (lid) {
        parts.push(cardboard(new BoxGeometry(w + 0.006, 0.024, d + 0.006)).translate(0, h - 0.012, 0));
    } else {
        // Its sides a little above the papers in it.
        for (const s of [-1, 1]) {
            // (On the box's top, not down its sides: its faces and theirs are in the same planes.)
            parts.push(cardboard(new BoxGeometry(w, 0.006, 0.003)).translate(0, h + 0.001, s * (d / 2 - 0.0015)));
            parts.push(cardboard(new BoxGeometry(0.003, 0.006, d - 0.006)).translate(s * (w / 2 - 0.0015), h + 0.001, 0));
        }
    }
    return merge(parts);
}

/** Loose paper: a few sheets slid out across the floor, and (with `wad`) a heap of it, the last few askew on top. */
function paperPile(r, wad) {
    const parts = [];
    // Each a hair above the one before, so none is in the same plane as another.
    let y = 0.0015;
    const slid = 2 + Math.floor(r() * 2);
    for (let k = 0; k < slid; k++) {
        parts.push(sheet(y, PAPERS[Math.floor(r() * PAPERS.length)]).rotateY(r() * Math.PI).translate((r() - 0.5) * 0.06, 0, (r() - 0.5) * 0.05));
        y += 0.0015;
    }
    if (wad) {
        const thick = 0.008 + r() * 0.012;
        parts.push(paint(new BoxGeometry(0.078, thick, 0.11).translate(0, y + thick / 2, 0), PAPERS[1]).rotateY((r() - 0.5) * 0.3));
        y += thick;
        const loose = 2 + Math.floor(r() * 3);
        for (let k = 0; k < loose; k++) {
            parts.push(sheet(y, PAPERS[Math.floor(r() * PAPERS.length)]).rotateY((r() - 0.5) * 0.5).translate((r() - 0.5) * 0.02, 0, (r() - 0.5) * 0.02));
            y += 0.0015;
        }
    }
    return merge(parts);
}

/**
 * Files left on the floor, their fronts towards +z: lever-arch files in a pile with loose paper beside them; an archive
 * box (or two, one on the other) with files beside it, or with paper; or files on top of a box, sheets slid out round it.
 */
function officeFiles(variant) {
    const r = mulberry32(variant * 2654435761 + 31);
    const arrangement = variant & 3;
    const two = ((variant >>> 2) & 1) === 1;
    const white = ((variant >>> 3) & 1) === 1;
    const tint = CARDBOARD_TINTS[Math.floor(r() * CARDBOARD_TINTS.length)];
    const boxes = () => {
        if (!two) return archiveBox(white, tint, r() < 0.75);
        return merge([archiveBox(white, tint, true), archiveBox(white, tint, r() < 0.6).rotateY((r() - 0.5) * 0.2).translate((r() - 0.5) * 0.01, ARCHIVE[1], 0)]);
    };
    // (Each centred on what it covers; files on a box, on the box.)
    if (arrangement === 0) return centred(merge([binderPile(r, 2 + Math.floor(r() * 3)).translate(-0.06, 0, 0), paperPile(r, true).translate(0.065, 0, 0.01)]));
    if (arrangement === 1) return centred(merge([boxes().translate(-0.06, 0, 0), binderPile(r, 2 + Math.floor(r() * 3)).rotateY((r() - 0.5) * 0.1).translate(0.076, 0, 0.004)]));
    if (arrangement === 2) return centred(merge([paperPile(r, true).translate(0.07, 0, 0.015), boxes().translate(-0.05, 0, 0)]));
    return merge([paperPile(r, false), archiveBox(white, tint, true), binderPile(r, 1 + Math.floor(r() * 3)).rotateY((r() - 0.5) * 0.3).translate(0, ARCHIVE[1], 0)]);
}

// ---------------------------------------------------------------------------------------------- helpers

/**
 * Leaves, as triangles to be seen from both sides (a leaf is seen from below as often as from above): `leaf` adds
 * one, and `geometry` makes the lot into one geometry, coloured by its vertices.
 */
function foliage() {
    const positions = [];
    const normals = [];
    const colors = [];
    const index = [];
    const vertex = (x, y, z, nx, ny, nz, hex) => {
        positions.push(x, y, z);
        normals.push(nx, ny, nz);
        colors.push(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
        return positions.length / 3 - 1;
    };
    // A triangle both ways round: the face turned up, and the one underneath, each wound to face the way it's lit.
    const leaf = (a, b, c, hex) => {
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const length = Math.hypot(...g);
        if (length < 1e-12) return;
        const flip = g[1] < 0 ? -1 : 1;
        const n = g.map((value) => (value / length) * flip);
        const i = vertex(...a, ...n, hex);
        vertex(...b, ...n, hex);
        vertex(...c, ...n, hex);
        index.push(...(flip > 0 ? [i, i + 1, i + 2] : [i, i + 2, i + 1]));
        const j = vertex(...a, -n[0], -n[1], -n[2], hex);
        vertex(...b, -n[0], -n[1], -n[2], hex);
        vertex(...c, -n[0], -n[1], -n[2], hex);
        index.push(...(flip > 0 ? [j, j + 2, j + 1] : [j, j + 1, j + 2]));
    };
    const geometry = () => {
        const leaves = new BufferGeometry();
        leaves.setAttribute('position', new Float32BufferAttribute(positions, 3));
        leaves.setAttribute('normal', new Float32BufferAttribute(normals, 3));
        leaves.setAttribute('color', new Float32BufferAttribute(colors, 3));
        const u = (PROP_ATLAS.plain[0] + PROP_ATLAS.plain[2]) / 2 / PROP_ATLAS_WIDTH;
        const v = 1 - (PROP_ATLAS.plain[1] + PROP_ATLAS.plain[3]) / 2 / PROP_ATLAS_HEIGHT;
        leaves.setAttribute('uv', new Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0).map((_, k) => (k % 2 === 0 ? u : v)), 2));
        leaves.setIndex(index);
        return leaves;
    };
    return { leaf, geometry };
}

/**
 * Colours every vertex and points the texture coordinates at one picture of the atlas (solid white unless
 * given, so the vertex colour is all you see).
 */
export function paint(geometry, hex, picture = PROP_ATLAS.plain) {
    const count = geometry.attributes.position.count;
    geometry.setAttribute('color', new Float32BufferAttribute(count * 3, 3));
    return paintRange(geometry, 0, count, hex, picture);
}

/** Recolours one face of a box (0..5: +x, −x, +y, −y, +z, −z). */
export function paintFace(box, face, hex, picture) {
    return paintRange(box, face * 4, face * 4 + 4, hex, picture);
}

function paintRange(geometry, from, to, hex, [x0, y0, x1, y1]) {
    const colors = geometry.attributes.color;
    const uvs = geometry.attributes.uv;
    // Always map from the primitive's own 0..1 coordinates, so a face can be repainted.
    const base = geometry.userData.baseUv ??= uvs.clone();
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    // Canvas textures are flipped on upload, so pixel row 0 is at v = 1.
    const u0 = x0 / PROP_ATLAS_WIDTH;
    const u1 = x1 / PROP_ATLAS_WIDTH;
    const v0 = 1 - y1 / PROP_ATLAS_HEIGHT;
    const v1 = 1 - y0 / PROP_ATLAS_HEIGHT;
    for (let i = from; i < to; i++) {
        colors.setXYZ(i, r, g, b);
        uvs.setXY(i, u0 + base.getX(i) * (u1 - u0), v0 + base.getY(i) * (v1 - v0));
    }
    return geometry;
}

export function merge(parts) {
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    return merged;
}

/** Puts something that's been turned over back down on the floor, on its lowest point. */
function grounded(geometry) {
    geometry.computeBoundingBox();
    return geometry.translate(0, -geometry.boundingBox.min.y, 0);
}

/** Moves something across the floor so that it's centred on what it covers. */
function centred(geometry) {
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    return geometry.translate(-(min.x + max.x) / 2, 0, -(min.z + max.z) / 2);
}
