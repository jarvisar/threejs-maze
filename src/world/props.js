import { BoxGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PROP_BOTTLES, PROP_CHAIR, PROP_MONITOR, PROP_SIGN } from './decorations.js';

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
    // Solid white, for parts coloured by their vertices alone.
    plain: [304, 304, 336, 336],
};

const FABRIC = 0x2b2b2f;
const PLASTIC = 0x1e1e20;
const CASTER = 0x141414;
const METAL = 0x54575c;
const BEIGE = 0xd5ccb0;
const BEIGE_DARK = 0xc3ba9e;
const BOTTLE = 0xe3e9e4;
const CAP = 0x2f63a8;
const YELLOW = 0xf1c21b;
const YELLOW_DARK = 0xd4a812;
const WHITE = 0xffffff;

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

function cached(key, build) {
    let geometry = templates.get(key);
    if (!geometry) {
        geometry = build();
        templates.set(key, geometry);
    }
    return geometry;
}

/** @param {import('./decorations.js').Prop} prop */
function templateFor(prop) {
    switch (prop.type) {
        case PROP_CHAIR:
            return (prop.variant & 3) === 0 ? cached('chair-tipped', tippedChair) : cached('chair', chair);
        case PROP_MONITOR:
            return cached('monitor', monitor);
        case PROP_SIGN:
            return cached('sign', sign);
        default:
            return bottles(prop.variant);
    }
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
        const geometry = cached('bottle', bottle).clone();
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
