import { CHUNK_SIZE, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { GeometryBuilder, verticalQuad } from './GeometryBuilder.js';
import { EDGE_WALL } from './grid.js';
import { hashFloat, hashInts } from './random.js';

/*
 * Water damage, as pictures laid over the walls, floor and ceiling: a stain where water has come through
 * the ceiling tiles, the soaked carpet under it, and wallpaper that has come away from the wall.
 *
 * Leaks are chosen with the chunk (decorations.js). Peeling wallpaper is worked out here, when the chunk is
 * meshed, from the walls as they are now (a wall knocked down in edit mode takes its peel with it) and from
 * the state of the ceiling lights: the paper mostly comes away where the lights have failed, so the two
 * kinds of decay go together.
 *
 * The pictures themselves are drawn in decorationTextures.js, into one texture laid out as below.
 */

const N = CHUNK_SIZE;
const HALF_THICKNESS = WALL_THICKNESS / 2;

// How far in front of the surface a picture floats (with a polygon offset in the material on top of that).
const FLOOR_OFFSET = 0.004;
const CEILING_OFFSET = 0.004;
const WALL_OFFSET = 0.002;

// Peels per wall face (each side of each cell's wall counts), and how much more likely one is where the
// nearest light has died or is failing.
const PEEL_CHANCE = 0.003;
const PEEL_CHANCE_FAILING = 0.06;

export const DECAL_ATLAS_SIZE = 1024;
/** Every picture is drawn in a square cell this big, with a gutter between cells. */
export const DECAL_CELL = 320;
const STRIDE = 352;

/**
 * @typedef {object} Picture
 * @property {number} x Pixel position of the picture's cell in the atlas.
 * @property {number} y
 * @property {number} aspect How wide the picture is drawn, relative to the cell's height (a narrow peel
 *     only uses the middle of its cell, so it isn't stretched when laid over the wall).
 */

/** @type {Record<'peel' | 'ceilingStain' | 'puddle', Picture[]>} */
export const DECAL_PICTURES = {
    peel: [
        { x: 0, y: 0, aspect: 1 },
        { x: STRIDE, y: 0, aspect: 0.55 },
        { x: 2 * STRIDE, y: 0, aspect: 0.8 },
    ],
    ceilingStain: [
        { x: 0, y: STRIDE, aspect: 1 },
        { x: STRIDE, y: STRIDE, aspect: 1 },
    ],
    puddle: [
        { x: 2 * STRIDE, y: STRIDE, aspect: 1 },
        { x: 0, y: 2 * STRIDE, aspect: 1 },
    ],
};

/** Texture coordinates of a picture's drawn part. (Canvas textures are flipped on upload: row 0 is v = 1.) */
function uvOf({ x, y, aspect }) {
    const inset = (DECAL_CELL * (1 - aspect)) / 2;
    return {
        u0: (x + inset) / DECAL_ATLAS_SIZE,
        u1: (x + DECAL_CELL - inset) / DECAL_ATLAS_SIZE,
        v0: 1 - (y + DECAL_CELL) / DECAL_ATLAS_SIZE,
        v1: 1 - y / DECAL_ATLAS_SIZE,
    };
}

const PEEL_UV = DECAL_PICTURES.peel.map(uvOf);
const CEILING_STAIN_UV = DECAL_PICTURES.ceilingStain.map(uvOf);
const PUDDLE_UV = DECAL_PICTURES.puddle.map(uvOf);

const surfaceBuilder = new GeometryBuilder();
const ceilingBuilder = new GeometryBuilder();

/**
 * The decals of one chunk, relative to its centre (ox, oz): those on the walls and floor, and those on
 * the ceiling (drawn with a material that follows the ceiling's own shade).
 *
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {{ ex: (x: number, z: number) => number, ez: (x: number, z: number) => number }} grid The walls
 *     around the chunk (see RegionGrid in chunkGeometry.js).
 * @param {import('./generator.js').ChunkData} chunk
 * @param {number} x0 World coordinates of the chunk's first cell.
 * @param {number} z0
 * @param {number} ox
 * @param {number} oz
 * @returns {{ surfaces: import('three').BufferGeometry | null, ceiling: import('three').BufferGeometry | null }}
 */
export function buildDecalGeometry(store, grid, chunk, x0, z0, ox, oz) {
    const surfaces = surfaceBuilder.reset();
    const ceiling = ceilingBuilder.reset();

    for (const leak of chunk.leaks) {
        const v = leak.variant;
        const turn = (2 * Math.PI) / 256;
        horizontalDecal(ceiling, leak.x - ox, WALL_HEIGHT - CEILING_OFFSET, leak.z - oz, leak.radius, (v & 255) * turn, -1, CEILING_STAIN_UV[(v >>> 8) & 1]);
        horizontalDecal(surfaces, leak.floorX - ox, FLOOR_OFFSET, leak.floorZ - oz, leak.floorRadius, ((v >>> 9) & 255) * turn, 1, PUDDLE_UV[(v >>> 17) & 1]);
    }
    addPeels(surfaces, store, grid, x0, z0, ox, oz);

    return { surfaces: surfaces.build(), ceiling: ceiling.build() };
}

/**
 * Wallpaper coming away at the top of walls. Each face of each wall rolls for one, from the seed and its
 * own coordinates, weighted by the state of the light over the room it faces.
 */
function addPeels(builder, store, grid, x0, z0, ox, oz) {
    const seed = store.seed;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            for (let axis = 0; axis < 2; axis++) {
                if ((axis === 0 ? grid.ex(x, z) : grid.ez(x, z)) !== EDGE_WALL) continue;
                for (let side = 1; side >= -1; side -= 2) {
                    const slot = axis * 2 + (side > 0 ? 1 : 0);
                    // The cell this face is seen from.
                    const roomX = axis === 0 && side > 0 ? x + 1 : x;
                    const roomZ = axis === 1 && side > 0 ? z + 1 : z;
                    const chance = PEEL_CHANCE + PEEL_CHANCE_FAILING * failingLightAt(store, roomX, roomZ);
                    if (hashFloat(seed, 0x9ee1, x, z, slot) >= chance) continue;

                    const h = hashInts(seed, 0x9ee2, x, z, slot);
                    const variant = h % 3;
                    const height = 0.34 + (0.2 * ((h >>> 8) & 255)) / 255;
                    const width = height * DECAL_PICTURES.peel[variant].aspect;
                    // Anywhere along the wall, clear of the corners.
                    const along = (((h >>> 16) & 255) / 255 - 0.5) * (0.9 - width);
                    const mirror = ((h >>> 24) & 1) === 1;
                    const plane = (axis === 0 ? x : z) + 0.5 + side * (HALF_THICKNESS + WALL_OFFSET) - (axis === 0 ? ox : oz);
                    const centre = (axis === 0 ? z : x) + along - (axis === 0 ? oz : ox);
                    wallDecal(builder, axis, side, plane, centre, width, WALL_HEIGHT - height, WALL_HEIGHT, PEEL_UV[variant], mirror);
                }
            }
        }
    }
}

/**
 * How badly the light over a cell has failed, 0 (fine) to 1 (dead or in the dark): the worst of the
 * panels nearest the cell (one if the cell is under a panel, otherwise the two or four around it).
 */
export function failingLightAt(store, x, z) {
    let worst = 0;
    for (const px of (x & 1) ? [x] : [x - 1, x + 1]) {
        for (const pz of (z & 1) ? [z] : [z - 1, z + 1]) {
            const data = store.panelData(px, pz);
            const k = store.panelOffset(px, pz);
            const brightness = data[k];
            const area = data[k + 1] / 255;
            const flicker = data[k + 2];
            const failing = brightness === 0 ? 1 : flicker !== 0 ? 0.85 : brightness < 255 ? 0.45 : 0;
            worst = Math.max(worst, failing, 1 - area);
        }
    }
    return worst;
}

/**
 * A square picture of half-size r on a horizontal surface, turned by `angle`, facing up (normalY = 1)
 * or down (−1).
 */
function horizontalDecal(builder, cx, y, cz, r, angle, normalY, uv) {
    const c = Math.cos(angle) * r;
    const s = Math.sin(angle) * r;
    const px = (u, v) => cx + u * c - v * s;
    const pz = (u, v) => cz + u * s + v * c;
    // Counter-clockwise as seen from the side the picture faces.
    if (normalY > 0) {
        builder.quad(px(-1, 1), y, pz(-1, 1), px(1, 1), y, pz(1, 1), px(1, -1), y, pz(1, -1), px(-1, -1), y, pz(-1, -1), 0, 1, 0, uv.u0, uv.v0, uv.u1, uv.v1);
    } else {
        builder.quad(px(-1, -1), y, pz(-1, -1), px(1, -1), y, pz(1, -1), px(1, 1), y, pz(1, 1), px(-1, 1), y, pz(-1, 1), 0, -1, 0, uv.u0, uv.v0, uv.u1, uv.v1);
    }
}

/**
 * A picture on a wall face (see wallQuad in chunkGeometry.js for the orientation), `width` wide around
 * `centre` along the wall.
 */
function wallDecal(builder, axis, side, plane, centre, width, y0, y1, uv, mirror) {
    const right = axis === 0 ? -side : side;
    const s0 = centre - width / 2;
    const s1 = centre + width / 2;
    const left = right > 0 ? s0 : s1;
    const rightEnd = right > 0 ? s1 : s0;
    const nx = axis === 0 ? side : 0;
    const nz = axis === 0 ? 0 : side;
    const u0 = mirror ? uv.u1 : uv.u0;
    const u1 = mirror ? uv.u0 : uv.u1;
    verticalQuad(builder, axis, plane, left, rightEnd, y0, y1, nx, nz, u0, uv.v0, u1, uv.v1);
}
