/*
 * How the decals texture is laid out: every picture drawn in decorationTextures.js, and where it is. Used by
 * the decals (decals.js) and the peeling wallpaper (peels.js).
 */

export const DECAL_ATLAS_SIZE = 1024;
/** Every picture is drawn in a square cell this big, with a gutter between cells. */
export const DECAL_CELL = 320;
const STRIDE = 352;
/** A bare-wall picture covers the tear and the shadow of the strip below it: this much taller than the tear. */
export const BARE_WALL_DEPTH = 1.7;

/**
 * @typedef {object} Picture
 * @property {number} x Pixel position of the picture's cell in the atlas.
 * @property {number} y
 * @property {number} aspect How wide the picture is drawn, relative to the cell's height (a narrow one
 *     only uses the middle of its cell, so it isn't stretched when laid over the wall).
 */

/**
 * @type {{ bareWall: Picture[], ceilingStain: Picture[], paperBack: Picture[], puddle: Picture[], missingTile: Picture[] }}
 */
export const DECAL_PICTURES = {
    // What's left on the wall where a strip of wallpaper has come away, and the shadow of the strip hanging
    // below it: for a narrow tear, a middling one and a wide one.
    bareWall: [
        { x: 0, y: 0, aspect: 0.32 },
        { x: STRIDE, y: 0, aspect: 0.56 },
        { x: 2 * STRIDE, y: 0, aspect: 0.86 },
    ],
    ceilingStain: [
        { x: 0, y: STRIDE, aspect: 1 },
        { x: STRIDE, y: STRIDE, aspect: 1 },
    ],
    paperBack: [{ x: 2 * STRIDE, y: STRIDE, aspect: 1 }],
    puddle: [
        { x: 0, y: 2 * STRIDE, aspect: 1 },
        { x: STRIDE, y: 2 * STRIDE, aspect: 1 },
    ],
    missingTile: [{ x: 2 * STRIDE, y: 2 * STRIDE, aspect: 1 }],
};

/** Texture coordinates of a picture's drawn part. (Canvas textures are flipped on upload: row 0 is v = 1.) */
export function uvOf({ x, y, aspect }) {
    const inset = (DECAL_CELL * (1 - aspect)) / 2;
    return {
        u0: (x + inset) / DECAL_ATLAS_SIZE,
        u1: (x + DECAL_CELL - inset) / DECAL_ATLAS_SIZE,
        v0: 1 - (y + DECAL_CELL) / DECAL_ATLAS_SIZE,
        v1: 1 - y / DECAL_ATLAS_SIZE,
    };
}
