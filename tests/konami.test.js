import { describe, expect, it } from 'vitest';
import { BUTTON } from '../src/input/Gamepad.js';
import { KONAMI, KonamiCode, konamiButton, konamiGesture, konamiKey } from '../src/input/konami.js';

const CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];

/** Pushes key presses, returning after which ones the code was complete. */
function type(code, keys) {
    const done = [];
    keys.forEach((key, i) => {
        if (code.push(konamiKey(key))) done.push(i);
    });
    return done;
}

/** A controller with one button pressed this frame. */
function pressing(button, layout = 'xbox') {
    return { layout, pressed: (b) => b === button };
}

describe('the Konami code', () => {
    it('is complete on the last key, and only then', () => {
        expect(type(new KonamiCode(), CODE)).toEqual([CODE.length - 1]);
    });

    it('starts again after it has been put in, so it can go back off', () => {
        expect(type(new KonamiCode(), [...CODE, ...CODE])).toEqual([9, 19]);
    });

    it('does not mind an extra up at the start, or a key it was already expecting', () => {
        expect(type(new KonamiCode(), ['ArrowUp', ...CODE])).toEqual([10]);
        expect(type(new KonamiCode(), ['ArrowUp', 'ArrowUp', 'ArrowUp', ...CODE.slice(2)])).toEqual([10]);
    });

    it('starts over on a wrong key, but not on Shift', () => {
        expect(type(new KonamiCode(), [...CODE.slice(0, 5), 'KeyW', ...CODE.slice(5)])).toEqual([]);
        expect(type(new KonamiCode(), [...CODE.slice(0, 5), 'ShiftLeft', ...CODE.slice(5)])).toEqual([10]);
    });

    it('takes a controller\'s d-pad and B and A where the pad has them', () => {
        const code = new KonamiCode();
        const buttons = [BUTTON.UP, BUTTON.UP, BUTTON.DOWN, BUTTON.DOWN, BUTTON.LEFT, BUTTON.RIGHT, BUTTON.LEFT, BUTTON.RIGHT];
        for (const button of buttons) expect(code.push(konamiButton(pressing(button)))).toBe(false);
        // Xbox and PlayStation: B is on the right, A at the bottom.
        expect(code.push(konamiButton(pressing(BUTTON.B)))).toBe(false);
        expect(code.push(konamiButton(pressing(BUTTON.A)))).toBe(true);
        // Nintendo: the other way round.
        for (const button of buttons) code.push(konamiButton(pressing(button, 'nintendo')));
        expect(code.push(konamiButton(pressing(BUTTON.A, 'nintendo')))).toBe(false);
        expect(code.push(konamiButton(pressing(BUTTON.B, 'nintendo')))).toBe(true);
        // Nothing pressed changes nothing; another button starts over.
        expect(konamiButton({ layout: 'xbox', pressed: () => false })).toBeUndefined();
        expect(konamiButton(pressing(BUTTON.X))).toBeNull();
    });

    it('reads swipes and taps on a touch screen', () => {
        expect(konamiGesture(0, -80, 200)).toBe('up');
        expect(konamiGesture(0, 90, 200)).toBe('down');
        expect(konamiGesture(-70, 10, 200)).toBe('left');
        expect(konamiGesture(70, -10, 200)).toBe('right');
        expect(konamiGesture(3, 2, 120)).toBe('tap');
        // A long press, or a nudge, is nothing.
        expect(konamiGesture(3, 2, 900)).toBeUndefined();
        expect(konamiGesture(20, 10, 200)).toBeUndefined();
        const code = new KonamiCode();
        const inputs = [...KONAMI.slice(0, 8), 'tap', 'tap'];
        expect(inputs.map((input) => code.push(input))).toEqual([...Array(9).fill(false), true]);
    });
});
