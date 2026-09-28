import { NearestMipmapNearestFilter, RepeatWrapping, TextureLoader } from 'three';
import { CEILING_TILES_X, CEILING_TILES_Z, CHUNK_SIZE } from '../config.js';
import baseboardUrl from '../assets/textures/baseboard.webp';
import carpetBumpUrl from '../assets/textures/carpet-bump.webp';
import carpetUrl from '../assets/textures/carpet.webp';
import ceilingBumpUrl from '../assets/textures/ceiling-bump.webp';
import ceilingUrl from '../assets/textures/ceiling.jpg';
import wallpaperUrl from '../assets/textures/wallpaper.png';

/**
 * Starts loading every texture. The returned textures can be used immediately, and they fill in once loaded,
 * with `manager` reporting progress and completion.
 *
 * @param {import('three').LoadingManager} manager
 * @param {{ maxAnisotropy: number, wallpaperOffset: [number, number] }} options
 */
export function loadTextures(manager, { maxAnisotropy, wallpaperOffset }) {
    const loader = new TextureLoader(manager);
    const load = (url, repeatX, repeatY, configure) => {
        const texture = loader.load(url);
        texture.wrapS = RepeatWrapping;
        texture.wrapT = RepeatWrapping;
        texture.repeat.set(repeatX, repeatY);
        configure?.(texture);
        return texture;
    };

    // Filtering and tiling match the original release, and the pixelated wallpaper/baseboard minification is
    // part of the look. Floor and ceiling repeats are per chunk: 6 carpet tiles per unit, and ceiling tiles
    // of 1/6 × 1/4 unit, moved half a tile so that they're centred on the cells (and a light panel, in the
    // middle of one, takes the place of a tile).
    const centred = (t) => t.offset.set(0.5, 0.5);
    return {
        wallpaper: load(wallpaperUrl, 1, 1, (t) => {
            t.minFilter = NearestMipmapNearestFilter;
            t.offset.set(...wallpaperOffset);
        }),
        baseboard: load(baseboardUrl, 20, 20, (t) => {
            t.minFilter = NearestMipmapNearestFilter;
            t.anisotropy = Math.min(16, maxAnisotropy);
        }),
        carpet: load(carpetUrl, 6 * CHUNK_SIZE, 6 * CHUNK_SIZE),
        carpetBump: load(carpetBumpUrl, 6 * CHUNK_SIZE, 6 * CHUNK_SIZE),
        ceiling: load(ceilingUrl, CEILING_TILES_X * CHUNK_SIZE, CEILING_TILES_Z * CHUNK_SIZE, centred),
        ceilingBump: load(ceilingBumpUrl, CEILING_TILES_X * CHUNK_SIZE, CEILING_TILES_Z * CHUNK_SIZE, centred),
    };
}
