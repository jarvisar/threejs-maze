import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { ScreenGuard } from '../src/footage/screenGuard.js';

const EYE = new Vector3(0, 0.5, 0);
const UP = new Vector3(0, 1, 0);
const FOV = 70;
const ASPECT = 16 / 9;

/** Looking level, turned `yaw` radians to the left of straight down −z, and `pitch` up. */
function facing(yaw, pitch = 0) {
    return new Quaternion().setFromAxisAngle(UP, yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
}

/** Where something `distance` away, `angle` radians to the right of straight ahead (−z), stands. */
function toTheRight(angle, distance = 5) {
    return [Math.sin(angle) * distance, -Math.cos(angle) * distance];
}

/** A guard that has watched the camera turn from `from` to `to` over one frame, and holds there. */
function turned(from, to, snap = 0) {
    const guard = new ScreenGuard();
    guard.update(1 / 60, EYE, facing(from), FOV, ASPECT, snap);
    guard.update(1 / 60, EYE, facing(to), FOV, ASPECT, snap);
    return guard;
}

describe('ScreenGuard', () => {
    it('covers everything until it has seen the camera', () => {
        expect(new ScreenGuard().covers(...toTheRight(Math.PI))).toBe(true);
    });

    it('covers what is in the picture and a little past its edge, and not what is well out of it', () => {
        const guard = turned(0, 0);
        // 16:9 at 70° is about 51° either side of the middle.
        expect(guard.covers(...toTheRight(0))).toBe(true);
        expect(guard.covers(...toTheRight(0.95))).toBe(true);
        expect(guard.covers(...toTheRight(1.02))).toBe(true);
        expect(guard.covers(...toTheRight(1.2))).toBe(false);
        expect(guard.covers(...toTheRight(-1.2))).toBe(false);
        expect(guard.covers(...toTheRight(Math.PI))).toBe(false);
        // Past the far plane.
        expect(guard.covers(...toTheRight(0, 13))).toBe(false);
    });

    it('covers ahead of a turn, and not behind it', () => {
        const spot = toTheRight(1.2);
        const opposite = toTheRight(-1.2);
        // Turning right (clockwise, seen from above) at 3 radians a second.
        const right = turned(0, -3 / 60);
        expect(right.covers(...spot)).toBe(true);
        expect(right.covers(...opposite)).toBe(false);
        const left = turned(0, 3 / 60);
        expect(left.covers(...spot)).toBe(false);
        expect(left.covers(...opposite)).toBe(true);
    });

    it('remembers a turn for a moment after it stops', () => {
        const guard = turned(0, -3 / 60);
        guard.update(1 / 60, EYE, facing(-3 / 60), FOV, ASPECT);
        expect(guard.covers(...toTheRight(1.2 + 3 / 60))).toBe(true);
        for (let k = 0; k < 120; k++) guard.update(1 / 60, EYE, facing(-3 / 60), FOV, ASPECT);
        expect(guard.covers(...toTheRight(1.2 + 3 / 60))).toBe(false);
    });

    it('covers everywhere while the camera is being whipped round', () => {
        const guard = turned(0, 0.12);
        expect(guard.whipping).toBe(true);
        expect(guard.covers(...toTheRight(Math.PI))).toBe(true);
    });

    it('covers a snap turn either way', () => {
        const spot = toTheRight(1.35);
        expect(turned(0, 0).covers(...spot)).toBe(false);
        expect(turned(0, 0, Math.PI / 6).covers(...spot)).toBe(true);
    });

    it('knows what looking down takes in: round your feet, not across the room', () => {
        const guard = new ScreenGuard();
        guard.update(1 / 60, EYE, facing(0, -Math.PI / 2 + 0.01), FOV, ASPECT);
        // Just behind you, which looking level would never show.
        expect(guard.covers(0, 0.5)).toBe(true);
        expect(guard.covers(0, 3)).toBe(false);
        expect(guard.covers(0, -3)).toBe(false);
    });
});
