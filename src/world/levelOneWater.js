import { backroomsNoise } from './panelLights.js';
import { smoothstep } from './generator.js';

/*
 * Where the water is in Level 1's floor, worked out the same way its shader does (levelOneWetness in
 * levelOneShading.js), so the footsteps splash where there's a puddle on screen and the drips come from where it's
 * wet.
 */

/**
 * How wet the floor is at (x, z): 0 dry concrete, about 0.5 damp, 1 standing water.
 * @param {number} x
 * @param {number} z
 */
export function levelOneWetness(x, z) {
    const n = backroomsNoise(x * 0.23 + 11.3, z * 0.23 + 5.7) * 0.6
        + backroomsNoise(x * 0.71 + 3.1, z * 0.71 + 19.9) * 0.3
        + backroomsNoise(x * 2.3 + 7.7, z * 2.3 + 1.3) * 0.1;
    return smoothstep(0.5, 0.64, n);
}
