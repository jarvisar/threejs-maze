import { WALL_HEIGHT } from '../config.js';
import { DECAL_PICTURES, uvOf } from './decalAtlas.js';
import { tileFell } from './decorations.js';
import { GeometryBuilder } from './GeometryBuilder.js';
import { addPeels } from './peels.js';

/*
 * Water damage, as pictures laid over the floor and ceiling: a stain where water has come through the
 * ceiling tiles (sometimes with the sodden tile gone, and lying on the carpet below), and the soaked carpet
 * under it. Leaks are chosen with the chunk (decorations.js).
 *
 * The wallpaper coming away from the walls is in peels.js; its pictures (the bare wall behind it and the
 * back of the paper) are in the same texture as these, drawn in decorationTextures.js and laid out below.
 */

// How far in front of the surface a picture floats (with a polygon offset in the material on top of that).
const FLOOR_OFFSET = 0.004;
const CEILING_OFFSET = 0.004;
// The wet patch is drawn a little inside its picture, so the picture is laid a little larger than the patch.
const PUDDLE_SCALE = 1.2;

// Ceiling tiles: how many to a unit across x and across z (the ceiling texture's repeat), and how much of
// a missing tile's edge the grid it sat in still covers.
const TILES_X = 6;
const TILES_Z = 4;
const TILE_INSET = 0.004;

const CEILING_STAIN_UV = DECAL_PICTURES.ceilingStain.map(uvOf);
const PUDDLE_UV = DECAL_PICTURES.puddle.map(uvOf);
const MISSING_TILE_UV = uvOf(DECAL_PICTURES.missingTile[0]);

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
 * @param {GeometryBuilder} walls The chunk's walls, for the fronts of peeling strips of wallpaper.
 * @returns {{ surfaces: import('three').BufferGeometry | null, ceiling: import('three').BufferGeometry | null }}
 */
export function buildDecalGeometry(store, grid, chunk, x0, z0, ox, oz, walls) {
    const surfaces = surfaceBuilder.reset();
    const ceiling = ceilingBuilder.reset();

    for (const leak of chunk.leaks) {
        const v = leak.variant;
        const turn = (2 * Math.PI) / 256;
        horizontalDecal(ceiling, leak.x - ox, WALL_HEIGHT - CEILING_OFFSET, leak.z - oz, leak.radius, (v & 255) * turn, -1, CEILING_STAIN_UV[(v >>> 8) & 1]);
        horizontalDecal(surfaces, leak.floorX - ox, FLOOR_OFFSET, leak.floorZ - oz, leak.floorRadius * PUDDLE_SCALE, ((v >>> 9) & 255) * turn, 1, PUDDLE_UV[(v >>> 17) & 1]);
        if (tileFell(leak)) {
            // The hole it left, in the grid of tiles, just below the stain.
            const tx = Math.floor(leak.x * TILES_X);
            const tz = Math.floor(leak.z * TILES_Z);
            const y = WALL_HEIGHT - CEILING_OFFSET * 0.5;
            const [ax, bx] = [tx / TILES_X + TILE_INSET - ox, (tx + 1) / TILES_X - TILE_INSET - ox];
            const [az, bz] = [tz / TILES_Z + TILE_INSET - oz, (tz + 1) / TILES_Z - TILE_INSET - oz];
            const { u0, v0, u1, v1 } = MISSING_TILE_UV;
            ceiling.orientedQuad([ax, y, az, 0, -1, 0, u0, v0], [bx, y, az, 0, -1, 0, u1, v0], [bx, y, bz, 0, -1, 0, u1, v1], [ax, y, bz, 0, -1, 0, u0, v1]);
        }
    }
    addPeels(surfaces, walls, store, grid, x0, z0, ox, oz);

    return { surfaces: surfaces.build(), ceiling: ceiling.build() };
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
