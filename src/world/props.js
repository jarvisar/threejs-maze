import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Float32BufferAttribute, SphereGeometry, TorusGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    PROP_BALL,
    PROP_BARREL,
    PROP_BOTTLES,
    PROP_BOXES,
    PROP_CHAIR,
    PROP_CONE,
    PROP_CRATES,
    PROP_HAT,
    PROP_LIFEBUOY,
    PROP_MONITOR,
    PROP_NAMES,
    PROP_PALLET,
    PROP_RACK,
    PROP_RING,
    PROP_SIGN,
    PROP_TILE,
    isPartyProp,
} from './decorations.js';
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
const SHADOW_RADIUS = [0.14, 0.11, 0.06, 0.13, 0.14, 0.2, 0.17, 0.25, 0.14, 0.08, 0.36, 0.13, 0.14, 0.06, 0.2, 0.1, 0.045, 0.03];

/** @param {import('./decorations.js').Prop} prop */
export function propShadowRadius(prop) {
    if (prop.type === PROP_CRATES && ((prop.variant & 3) === 1 || (prop.variant & 3) === 3)) return 0.27;
    if (prop.type === PROP_BARREL && (prop.variant & 1) === 1) return 0.22;
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

/** The same chair knocked over, resting on its base and the top of its back. */
function tippedChair() {
    const geometry = chair().clone().rotateZ(Math.PI / 2).rotateX(-0.4);
    geometry.computeBoundingBox();
    return geometry.translate(0, -geometry.boundingBox.min.y, 0);
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
        if (lying) geometry.rotateX(Math.PI / 2).translate(0, 0.0135, 0);
        geometry.rotateY(angle);
        geometry.translate(Math.cos(k * 2.1 + angle) * spread, 0, Math.sin(k * 2.1 + angle) * spread);
        parts.push(geometry);
    }
    return merge(parts);
}

/** A folding "wet floor" sign: two boards leaning on each other, printed on the outside. */
function sign() {
    const board = paint(new BoxGeometry(0.15, 0.25, 0.006), YELLOW);
    paintFace(board, 4, WHITE, PROP_ATLAS.sign);
    const front = board.translate(0, 0.125, 0).rotateX(-SIGN_LEAN).translate(0, 0, 0.25 * Math.sin(SIGN_LEAN));
    const back = front.clone().rotateY(Math.PI);
    const hinge = paint(new BoxGeometry(0.15, 0.014, 0.024).translate(0, 0.25 * Math.cos(SIGN_LEAN), 0), YELLOW_DARK);
    return merge([front, back, hinge]);
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
    if (label) parts.push(paint(new CylinderGeometry(R + 0.0015, R + 0.0015, 0.1, 18, 1, true, -0.5, 1), WHITE, PROP_ATLAS.drumLabel).translate(0, H * 0.5, 0));
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
    if (((variant >>> 1) & 3) === 0) return geometry.rotateZ(Math.PI / 2).translate(0.155, 0.1, 0);
    return geometry;
}

/** A traffic cone, standing on its square base: orange, with two white bands. */
function cone() {
    const H = 0.25;
    const radiusAt = (y) => 0.05 - (y / H) * 0.041;
    const band = (y, height) => paint(new CylinderGeometry(radiusAt(y + height) + 0.0012, radiusAt(y) + 0.0012, height, 16, 1, true).translate(0, 0.012 + y + height / 2, 0), CONE_BAND);
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
    const first = tipped ? upright().rotateZ(Math.PI / 2 - 0.2).translate(0.13, 0.05, 0) : upright();
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

/** The loads on a rack's three shelves (the floor and two up), from its variant: three bits each. */
function rackLoads(variant) {
    return (variant >>> 2) & 0x1ff;
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
            return floor
                ? merge([drum(DRUM_COLORS[0], true).translate(-0.12, 0, 0), drum(DRUM_COLORS[2], false).rotateY(1).translate(0.12, 0, 0)])
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
        const load = (loads >>> (shelf * 3)) & 7;
        if (load === 5 || load === 7) continue;
        const floor = shelf === 0;
        const geometry = cached(`rack-load ${load} ${floor}`, () => /** @type {import('three').BufferGeometry} */ (rackLoad(load, floor)));
        pieces.push({ geometry, y: SHELF_TOPS[shelf] });
    }
    return pieces;
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

// ---------------------------------------------------------------------------------------------- helpers

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
