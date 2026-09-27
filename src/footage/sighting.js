/*
 * Which of Found Footage's TVs you've caught sight of: each stays on the map from then on, until its note is taken
 * (see FoundFootage.js and Minimap.js).
 */

/**
 * Whether a TV standing at `tv`, beside its note, can be seen from where the viewer is: no further off than `reach`,
 * in the picture (or near enough its edge that some of its light is: `glow`, how far round it that reaches), and with
 * nothing in the way of the set or of its note.
 * @param {import('./Watcher.js').Viewer} viewer
 * @param {{ x: number, z: number }} tv
 * @param {{ x: number, z: number }} note
 * @param {number} reach
 * @param {number} glow
 * @param {(ax: number, az: number, bx: number, bz: number) => boolean} clear Whether nothing stands between two points.
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
