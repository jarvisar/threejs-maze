/*
 * Tracks which Found Footage TVs you've seen. A seen TV stays on the map until its note is taken (see FoundFootage.js
 * and Minimap.js).
 */

/**
 * True if the TV (next to its note) is visible to the viewer. It has to be within `reach` and on screen, or within
 * `glow` of the screen edge since its light shows past the frame. Either the set or the note needs a clear line.
 * @param {import('./Watcher.js').Viewer} viewer
 * @param {{ x: number, z: number }} tv
 * @param {{ x: number, z: number }} note
 * @param {number} reach
 * @param {number} glow
 * @param {(ax: number, az: number, bx: number, bz: number) => boolean} clear True if nothing is between two points.
 */
export function inSight(viewer, tv, note, reach, glow, clear) {
    const dx = tv.x - viewer.x;
    const dz = tv.z - viewer.z;
    const distance = Math.hypot(dx, dz);
    if (distance > reach) return false;
    if (distance > glow) {
        const angle = Math.acos(Math.max(-1, Math.min(1, (dx * viewer.fx + dz * viewer.fz) / distance)));
        if (angle > viewer.halfFov + Math.atan(glow / distance)) return false;
    }
    return clear(viewer.x, viewer.z, tv.x, tv.z) || clear(viewer.x, viewer.z, note.x, note.z);
}
