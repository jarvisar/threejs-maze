import { Box3, BoxGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PROP_BOTTLES, PROP_CHAIR, PROP_MONITOR, PROP_NAMES, PROP_SIGN, PROP_TILE } from './decorations.js';

/*
 * The objects left lying around (see decorations.js for where they go): built from boxes and cylinders,
 * coloured by their vertices, with a small drawn texture for the parts that need a picture (the print on
 * the wet-floor sign, a monitor's screen, a bottle's label). Every prop in a chunk is merged into one mesh.
 *
 * Sizes are in world units: 1 unit is 2.7 m (a chair seat is about 0.17 up).
 */

/** The props texture (drawn in decorationTextures.js): where each picture is, in pixels. */
export const PROP_ATLAS_SIZE = 512;
export const PROP_ATLAS = {
    sign: [0, 0, 256, 256],
    monitor: [256, 0, 512, 256],
    label: [0, 256, 256, 320],
    // A ceiling tile, face up: the part that broke off is the bottom 40%.
    tile: [352, 256, 512, 496],
    // Solid white, for parts coloured by their vertices alone.
    plain: [304, 304, 336, 336],
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

const _matrix = new Matrix4();

/**
 * One mesh with every prop of a chunk, positioned relative to the chunk's centre (ox, oz).
 * @param {import('./decorations.js').Prop[]} props
 * @param {number} ox
 * @param {number} oz
 * @returns {import('three').BufferGeometry | null}
 */
export function buildPropGeometry(props, ox, oz) {
    if (props.length === 0) return null;
    const parts = [];
    for (const prop of props) {
        const geometry = templateFor(prop).clone();
        _matrix.makeRotationY(prop.yaw).setPosition(prop.x - ox, 0, prop.z - oz);
        geometry.applyMatrix4(_matrix);
        parts.push(geometry);
    }
    if (parts.length === 1) {
        parts[0].computeBoundingSphere();
        return parts[0];
    }
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    merged.computeBoundingSphere();
    return merged;
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
const SHADOW_RADIUS = [0.14, 0.11, 0.06, 0.13, 0.14];

/** @param {import('./decorations.js').Prop} prop */
export function propShadowRadius(prop) {
    return prop.type === PROP_CHAIR && (prop.variant & 3) === 0 ? 0.2 : SHADOW_RADIUS[prop.type];
}

/**
 * A prop's shape in its own frame: standing on the floor at the origin, its front towards +z. Props that look
 * the same share it (all but bottles), so it mustn't be changed.
 * @param {import('./decorations.js').Prop} prop
 */
export function templateFor(prop) {
    switch (prop.type) {
        case PROP_CHAIR:
            return (prop.variant & 3) === 0 ? cached('chair-tipped', tippedChair) : cached('chair', chair);
        case PROP_MONITOR:
            return cached('monitor', monitor);
        case PROP_SIGN:
            return cached('sign', sign);
        case PROP_TILE:
            return cached('tile', fallenTile);
        default:
            return softenTops(bottles(prop.variant));
    }
}

/** A name for a prop's shape: props with the same one look the same, until they're turned and moved. */
export function propShapeKey(prop) {
    switch (prop.type) {
        case PROP_CHAIR:
            return (prop.variant & 3) === 0 ? 'chair-tipped' : 'chair';
        case PROP_BOTTLES:
            return `bottles ${prop.variant}`;
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

// ---------------------------------------------------------------------------------------------- helpers

/**
 * Colours every vertex and points the texture coordinates at one picture of the atlas (solid white unless
 * given, so the vertex colour is all you see).
 */
function paint(geometry, hex, picture = PROP_ATLAS.plain) {
    const count = geometry.attributes.position.count;
    geometry.setAttribute('color', new Float32BufferAttribute(count * 3, 3));
    return paintRange(geometry, 0, count, hex, picture);
}

/** Recolours one face of a box (0..5: +x, −x, +y, −y, +z, −z). */
function paintFace(box, face, hex, picture) {
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
    const u0 = x0 / PROP_ATLAS_SIZE;
    const u1 = x1 / PROP_ATLAS_SIZE;
    const v0 = 1 - y1 / PROP_ATLAS_SIZE;
    const v1 = 1 - y0 / PROP_ATLAS_SIZE;
    for (let i = from; i < to; i++) {
        colors.setXYZ(i, r, g, b);
        uvs.setXY(i, u0 + base.getX(i) * (u1 - u0), v0 + base.getY(i) * (v1 - v0));
    }
    return geometry;
}

function merge(parts) {
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    return merged;
}
