import { describe, expect, it } from 'vitest';
import { BUTTON, GamepadInput, applyDeadzone, controllerLayout } from '../src/input/Gamepad.js';

/** A controller as the Gamepad API reports one: `buttons` maps button numbers to how far they're pressed. */
function fakePad({ id = 'Xbox Wireless Controller (STANDARD GAMEPAD)', buttons = {}, axes = [0, 0, 0, 0], timestamp = 1 } = {}) {
    return {
        id,
        connected: true,
        mapping: 'standard',
        timestamp,
        axes,
        buttons: Array.from({ length: 17 }, (_, i) => ({ value: buttons[i] ?? 0, pressed: (buttons[i] ?? 0) > 0.5 })),
    };
}

/** An input reading whatever `pads` holds at the time. */
function input() {
    const state = { pads: [] };
    const gamepad = new GamepadInput(() => state.pads);
    gamepad.connected = 1;
    return { gamepad, state };
}

describe('applyDeadzone', () => {
    it('ignores a stick resting just off centre', () => {
        expect(applyDeadzone(0.1, -0.08, { x: 1, y: 1 })).toEqual({ x: 0, y: 0 });
    });

    it('reaches full speed at the edge and keeps the direction', () => {
        const out = applyDeadzone(Math.SQRT1_2, -Math.SQRT1_2, { x: 0, y: 0 });
        expect(Math.hypot(out.x, out.y)).toBeCloseTo(1);
        expect(out.x).toBeCloseTo(-out.y);
    });

    it('starts from zero just past the dead zone', () => {
        const out = applyDeadzone(0.2, 0, { x: 0, y: 0 });
        expect(out.x).toBeGreaterThan(0);
        expect(out.x).toBeLessThan(0.05);
    });

    it('never goes past 1 on sticks that overshoot the circle', () => {
        const out = applyDeadzone(1, 1, { x: 0, y: 0 });
        expect(Math.hypot(out.x, out.y)).toBeCloseTo(1);
    });
});

describe('controllerLayout', () => {
    it.each([
        ['Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'xbox'],
        ['DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'playstation'],
        ['054c-05c4-Wireless Controller', 'playstation'],
        ['Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)', 'nintendo'],
        ['8BitDo SN30 Pro (Vendor: 2dc8 Product: 6101)', 'xbox'],
    ])('%s is laid out like %s', (id, layout) => {
        expect(controllerLayout(id)).toBe(layout);
    });
});

describe('GamepadInput', () => {
    it('reads nothing until a controller has connected', () => {
        const { gamepad, state } = input();
        gamepad.connected = 0;
        state.pads = [fakePad({ buttons: { [BUTTON.A]: 1 } })];
        expect(gamepad.poll(0)).toBe(false);
        expect(gamepad.held(BUTTON.A)).toBe(false);
    });

    it('reports a press once, then holds it until release', () => {
        const { gamepad, state } = input();
        state.pads = [null, fakePad({ buttons: { [BUTTON.A]: 1 } })];
        expect(gamepad.poll(0)).toBe(true);
        expect(gamepad.pressed(BUTTON.A)).toBe(true);
        expect(gamepad.active).toBe(true);
        gamepad.poll(0.016);
        expect(gamepad.pressed(BUTTON.A)).toBe(false);
        expect(gamepad.held(BUTTON.A)).toBe(true);
        state.pads = [fakePad()];
        gamepad.poll(0.032);
        expect(gamepad.held(BUTTON.A)).toBe(false);
        expect(gamepad.active).toBe(false);
    });

    it('does not flicker a trigger held near the threshold', () => {
        const { gamepad, state } = input();
        const presses = [];
        for (const value of [0.2, 0.55, 0.45, 0.52, 0.4, 0.35, 0.6]) {
            state.pads = [fakePad({ buttons: { [BUTTON.RT]: value } })];
            gamepad.poll(0);
            presses.push(gamepad.pressed(BUTTON.RT));
        }
        expect(presses).toEqual([false, true, false, false, false, false, false]);
        expect(gamepad.value(BUTTON.RT)).toBeCloseTo(0.6);
    });

    it('treats every connected controller as one', () => {
        const { gamepad, state } = input();
        state.pads = [
            fakePad({ buttons: { [BUTTON.X]: 1 }, axes: [0.1, 0, 0, 0] }),
            fakePad({ axes: [-0.9, 0, 0, 0.5] }),
        ];
        gamepad.poll(0);
        expect(gamepad.held(BUTTON.X)).toBe(true);
        expect(gamepad.leftStick.x).toBeLessThan(-0.8);
        expect(gamepad.rightStick.y).toBeGreaterThan(0.3);
    });

    it('names the buttons after the controller used last', () => {
        const { gamepad, state } = input();
        state.pads = [
            fakePad({ timestamp: 5 }),
            fakePad({ id: 'DualSense Wireless Controller (Vendor: 054c Product: 0ce6)', timestamp: 9 }),
        ];
        gamepad.poll(0);
        expect(gamepad.labels.a).toBe('Cross');
    });

    it('repeats a held menu direction after a pause', () => {
        const { gamepad, state } = input();
        state.pads = [fakePad({ buttons: { [BUTTON.DOWN]: 1 } })];
        const fired = [];
        for (let frame = 0; frame <= 50; frame++) {
            const t = frame / 50;
            gamepad.poll(t);
            if (gamepad.direction) fired.push(t);
        }
        expect(fired[0]).toBe(0);
        expect(fired[1]).toBeGreaterThanOrEqual(0.4);
        // Then about every tenth of a second.
        expect(fired.length).toBeGreaterThanOrEqual(6);
        expect(fired[3] - fired[2]).toBeLessThan(0.15);

        // The left stick works for menus too.
        state.pads = [fakePad({ axes: [0.9, 0.1, 0, 0] })];
        gamepad.poll(1);
        expect(gamepad.direction).toBe('right');
    });
});
