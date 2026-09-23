import { LineBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { VRHand, XR_BUTTON } from '../src/xr/VRHand.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A WebXR input source as a browser reports one: `buttons` maps xr-standard button numbers to values. */
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
});
