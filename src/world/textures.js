import { NearestMipmapNearestFilter, RepeatWrapping, TextureLoader } from 'three';
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
    // part of the look.
    return {
        wallpaper: load(wallpaperUrl, 1, 1, (t) => {
            t.minFilter = NearestMipmapNearestFilter;
            t.offset.set(...wallpaperOffset);
        }),
        baseboard: load(baseboardUrl, 20, 20, (t) => {
            t.minFilter = NearestMipmapNearestFilter;
            t.anisotropy = Math.min(16, maxAnisotropy);
        }),
        carpet: load(carpetUrl, 60, 60),
        carpetBump: load(carpetBumpUrl, 60, 60),
        ceiling: load(ceilingUrl, 60, 40),
        ceilingBump: load(ceilingBumpUrl, 60, 40),
    };
}
