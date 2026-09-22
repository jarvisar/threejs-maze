import { NearestMipmapNearestFilter, RepeatWrapping, TextureLoader } from 'three';
import { CHUNK_SIZE } from '../config.js';
import baseboardUrl from '../assets/textures/baseboard.webp';
import carpetBumpUrl from '../assets/textures/carpet-bump.webp';
import carpetUrl from '../assets/textures/carpet.webp';
import ceilingBumpUrl from '../assets/textures/ceiling-bump.webp';
import ceilingUrl from '../assets/textures/ceiling.jpg';
import wallpaperUrl from '../assets/textures/wallpaper.png';

/**
 * Starts loading every texture. The returned textures can be used immediately; they fill in once loaded,
 * and `manager` reports progress and completion.
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

    // Filtering and tiling match the original release; the pixelated wallpaper/baseboard minification is
    // part of the look. Floor and ceiling repeats are per chunk: 6 carpet tiles per unit, and ceiling tiles
    // of 1/6 × 1/4 unit.
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
        ceiling: load(ceilingUrl, 6 * CHUNK_SIZE, 4 * CHUNK_SIZE),
        ceilingBump: load(ceilingBumpUrl, 6 * CHUNK_SIZE, 4 * CHUNK_SIZE),
    };
}
