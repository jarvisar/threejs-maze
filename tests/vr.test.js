import { LineBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { RefreshRate } from '../src/xr/VR.js';
import { VRHand, XR_BUTTON } from '../src/xr/VRHand.js';
import { VRFade } from '../src/xr/VRPanel.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A WebXR input source. `buttons` maps xr-standard button numbers to values. */
function fakeSource({ handedness = 'right', buttons = {}, axes = [0, 0, 0, 0], hand = null, gamepad = true } = {}) {
    return {
        handedness,
        targetRayMode: 'tracked-pointer',
        targetRaySpace: {},
        gripSpace: {},
        hand,
        gamepad: gamepad
            ? { mapping: 'xr-standard', axes, buttons: Array.from({ length: 7 }, (_, i) => ({ value: buttons[i] ?? 0, pressed: (buttons[i] ?? 0) > 0.5 })) }
            : null,
    };
}

const frame = { getPose: () => ({ transform: { matrix: IDENTITY } }) };

function hand(source) {
    const h = new VRHand(source.handedness, new LineBasicMaterial());
    h.source = source;
    return h;
}

describe('VRHand', () => {
    it('reports a button once when it goes down, then as held', () => {
        const source = fakeSource();
        const h = hand(source);
        h.update(frame, {});
        expect(h.pressed(XR_BUTTON.A)).toBe(false);

        source.gamepad.buttons[XR_BUTTON.A] = { value: 1, pressed: true };
        h.update(frame, {});
        expect(h.pressed(XR_BUTTON.A)).toBe(true);
        h.update(frame, {});
        expect(h.pressed(XR_BUTTON.A)).toBe(false);
        expect(h.held(XR_BUTTON.A)).toBe(true);
    });

    it('doesn\'t flicker with a trigger held right at the threshold', () => {
        const source = fakeSource({ buttons: { [XR_BUTTON.TRIGGER]: 0.6 } });
        const h = hand(source);
        h.update(frame, {});
        expect(h.pressed(XR_BUTTON.TRIGGER)).toBe(true);
        source.gamepad.buttons[XR_BUTTON.TRIGGER] = { value: 0.45, pressed: false };
        h.update(frame, {});
        expect(h.held(XR_BUTTON.TRIGGER)).toBe(true);
        source.gamepad.buttons[XR_BUTTON.TRIGGER] = { value: 0.6, pressed: true };
        h.update(frame, {});
        expect(h.pressed(XR_BUTTON.TRIGGER)).toBe(false);
    });

    it('reads the thumbstick, or the touchpad on controllers without one', () => {
        const stick = hand(fakeSource({ axes: [0.9, 0, 0, -1] }));
        stick.update(frame, {});
        expect(stick.stick.x).toBe(0);
        expect(stick.stick.y).toBeCloseTo(-1);

        const touchpad = hand(fakeSource({ axes: [1, 0] }));
        touchpad.update(frame, {});
        expect(touchpad.stick.x).toBeCloseTo(1);
    });

    it('ignores the gamepad of a tracked hand (a pinch walks instead) and doesn\'t draw a controller for it', () => {
        const h = hand(fakeSource({ hand: {}, buttons: { [XR_BUTTON.TRIGGER]: 1 } }));
        h.update(frame, {});
        expect(h.hasButtons).toBe(false);
        expect(h.held(XR_BUTTON.TRIGGER)).toBe(false);
        expect(h.tracked).toBe(true);
        expect(h.grip.visible).toBe(false);
    });

    it('is untracked when its pose is lost, and forgets everything when cleared', () => {
        const source = fakeSource({ buttons: { [XR_BUTTON.SQUEEZE]: 1 } });
        const h = hand(source);
        h.update(frame, {});
        expect(h.tracked).toBe(true);
        h.update({ getPose: () => null }, {});
        expect(h.tracked).toBe(false);
        expect(h.ray.visible).toBe(false);
        h.clear();
        h.update(frame, {});
        expect(h.held(XR_BUTTON.SQUEEZE)).toBe(false);
    });

    it('buzzes a controller, but not a tracked hand', () => {
        const pulses = [];
        const source = fakeSource();
        source.gamepad.hapticActuators = [{ pulse: async (intensity, ms) => pulses.push([intensity, ms]) }];
        hand(source).pulse(0.5, 40);
        expect(pulses).toEqual([[0.5, 40]]);

        const tracked = fakeSource({ hand: {} });
        tracked.gamepad.hapticActuators = source.gamepad.hapticActuators;
        hand(tracked).pulse(0.5, 40);
        expect(pulses).toHaveLength(1);
        // Nothing to buzz. Nothing happens.
        expect(() => hand(fakeSource()).pulse(1, 10)).not.toThrow();
    });
});

describe('VRFade', () => {
    const opacity = (fade) => fade.mesh.material.opacity;

    it('goes out as long as the page\'s fade does, and comes back from white more slowly', () => {
        const fade = new VRFade();
        fade.update(1);
        expect(fade.mesh.visible).toBe(false);

        fade.set(true, 'white');
        fade.update(0.7);
        expect(opacity(fade)).toBeGreaterThan(0);
        expect(opacity(fade)).toBeLessThan(1);
        fade.update(0.7);
        expect(opacity(fade)).toBe(1);
        expect(fade.mesh.material.color.getHex()).toBe(0xffffff);

        fade.set(false, 'black');
        fade.update(1.4);
        expect(opacity(fade)).toBeGreaterThan(0);
        // Still white on the way back.
        expect(fade.mesh.material.color.getHex()).toBe(0xffffff);
        fade.update(1.2);
        expect(opacity(fade)).toBe(0);
        expect(fade.mesh.visible).toBe(false);
    });

    it('switches straight over with less motion asked for', () => {
        const fade = new VRFade();
        fade.instant = true;
        fade.set(true, 'black');
        fade.update(0.01);
        expect(opacity(fade)).toBe(1);
        expect(fade.mesh.material.color.getHex()).toBe(0x000000);
    });
});

describe('RefreshRate', () => {
    /** A session like Quest 2's: 90 by default. */
    function fakeSession(frameRate = 90) {
        const asked = [];
        const session = {
            frameRate,
            supportedFrameRates: new Float32Array([60, 72, 80, 90, 120]),
            async updateTargetFrameRate(rate) {
                asked.push(rate);
                session.frameRate = rate;
            },
        };
        return { session, asked };
    }
    /** `seconds` of frames, every one late (a whole frame missed) or none. */
    const run = (watch, session, seconds, late) => {
        const dt = (late ? 2 : 1) / session.frameRate;
        for (let t = 0; t < seconds; t += dt) watch.update(session, dt);
    };

    it('asks for the next rate down once frames keep coming late, a step at a time, but not below 72', async () => {
        const { session, asked } = fakeSession();
        const watch = new RefreshRate();
        run(watch, session, 3.2, false);
        run(watch, session, 3.5, true);
        expect(asked).toEqual([80]);
        await Promise.resolve();
        await Promise.resolve();
        run(watch, session, 10, true);
        await Promise.resolve();
        await Promise.resolve();
        run(watch, session, 10, true);
        expect(asked).toEqual([80, 72]);
    });

    it('leaves the rate alone while frames are on time, or late only now and then', () => {
        const { session, asked } = fakeSession();
        const watch = new RefreshRate();
        run(watch, session, 3.2, false);
        for (let second = 0; second < 20; second++) {
            run(watch, session, 0.95, false);
            run(watch, session, 0.05, true);
        }
        expect(asked).toEqual([]);
    });

    it('ignores the first seconds of a session, and headsets that can\'t change it', () => {
        const { session, asked } = fakeSession();
        const watch = new RefreshRate();
        run(watch, session, 2.5, true);
        expect(asked).toEqual([]);
        const fixed = new RefreshRate();
        const { session: old } = fakeSession();
        delete old.updateTargetFrameRate;
        expect(() => run(fixed, old, 10, true)).not.toThrow();
    });
});
