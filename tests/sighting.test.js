import { describe, expect, it } from 'vitest';
import { inSight } from '../src/footage/sighting.js';

// Standing at the origin, looking along −z, seeing 45° either side.
const viewer = { x: 0, z: 0, fx: 0, fz: -1, halfFov: Math.PI / 4 };
const open = () => true;
const REACH = 11;
const GLOW = 0.4;

describe('catching sight of a TV', () => {
    it('sees one in front, as far off as it reaches, and not past that', () => {
        expect(inSight(viewer, { x: 1, z: -6 }, { x: 1.1, z: -6.2 }, REACH, GLOW, open)).toBe(true);
        expect(inSight(viewer, { x: 0, z: -10.9 }, { x: 0, z: -11.1 }, REACH, GLOW, open)).toBe(true);
        expect(inSight(viewer, { x: 0, z: -11.5 }, { x: 0, z: -11.7 }, REACH, GLOW, open)).toBe(false);
    });

    it('only while it (or the light round it) is in the picture', () => {
        // Behind, and off to the side.
        expect(inSight(viewer, { x: 0, z: 4 }, { x: 0, z: 4.2 }, REACH, GLOW, open)).toBe(false);
        expect(inSight(viewer, { x: 4, z: -1 }, { x: 4.2, z: -1 }, REACH, GLOW, open)).toBe(false);
        // Just past the edge of the picture, its light isn't.
        const angle = Math.PI / 4 + Math.atan(GLOW / 3) * 0.5;
        expect(inSight(viewer, { x: 3 * Math.sin(angle), z: -3 * Math.cos(angle) }, { x: 0, z: -9 }, REACH, GLOW, open)).toBe(true);
        // Right beside you, whichever way you face.
        expect(inSight(viewer, { x: 0.2, z: 0.2 }, { x: 0.3, z: 0.3 }, REACH, GLOW, open)).toBe(true);
    });

    it('not through a wall, unless its note can be seen', () => {
        const tv = { x: 0, z: -5 };
        const note = { x: 0.3, z: -5.4 };
        expect(inSight(viewer, tv, note, REACH, GLOW, () => false)).toBe(false);
        const noteOnly = (ax, az, bx, bz) => bx === note.x && bz === note.z;
        expect(inSight(viewer, tv, note, REACH, GLOW, noteOnly)).toBe(true);
    });
});
