import { BUTTON } from './Gamepad.js';

/*
 * The Konami code: up, up, down, down, left, right, left, right, B, A. It turns Level Fun on and off (see
 * party.js). It can be put in with the arrow keys and B and A, with a controller's d-pad and B and A, or on a
 * touch screen by swiping in the directions and then tapping twice.
 */

/** @typedef {'up' | 'down' | 'left' | 'right' | 'b' | 'a' | 'tap'} KonamiInput */

export const KONAMI = /** @type {const} */ (['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a']);

const KEYS = new Map([
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down'],
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
    ['KeyB', 'b'],
    ['KeyA', 'a'],
]);
// Held down while pressing something else (Shift to sprint, say); they don't break the sequence.
const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

// A swipe is at least this far (CSS pixels), a tap no further than this and no longer than TAP_MS.
const SWIPE_DISTANCE = 40;
const TAP_DISTANCE = 12;
const TAP_MS = 350;

/** Follows the inputs as they come, and says when the last one completes the code. */
export class KonamiCode {
    constructor() {
        /** How much of the code has been put in so far. */
        this.progress = 0;
    }

    /**
     * @param {KonamiInput | null | undefined} input Null is anything else (which starts it over); undefined is
     *     nothing that counts either way.
     * @returns {boolean} Whether that finished the code.
     */
    push(input) {
        if (input === undefined) return false;
        this.progress = next(this.progress, input);
        if (this.progress < KONAMI.length) return false;
        this.progress = 0;
        return true;
    }

    reset() {
        this.progress = 0;
    }
}

/**
 * How much of the code is in after one more input: one further along if it's the next one, otherwise as much
 * of the start of the code as the last few inputs still make (so up, up, up still counts as up, up).
 */
function next(progress, input) {
    const matches = (index) => KONAMI[index] === input || (input === 'tap' && (KONAMI[index] === 'b' || KONAMI[index] === 'a'));
    if (matches(progress)) return progress + 1;
    // The inputs so far are KONAMI[0..progress), then `input`: find the longest start of the code they end with.
    for (let length = progress; length > 0; length--) {
        let fits = matches(length - 1);
        for (let k = 0; fits && k < length - 1; k++) fits = KONAMI[k] === KONAMI[progress - length + 1 + k];
        if (fits) return length;
    }
    return 0;
}

/**
 * A key press, by its code, as an input.
 * @param {string} code
 * @returns {KonamiInput | null | undefined}
 */
export function konamiKey(code) {
    if (MODIFIERS.has(code)) return undefined;
    return /** @type {KonamiInput | undefined} */ (KEYS.get(code)) ?? null;
}

/**
 * What was pressed on a controller this frame, as an input. B and A are where Xbox and PlayStation pads have
 * them (the right and bottom face buttons); on a Nintendo pad, where the letters are, which is the other way
 * round.
 * @param {import('./Gamepad.js').GamepadInput} pad
 * @returns {KonamiInput | null | undefined}
 */
export function konamiButton(pad) {
    const nintendo = pad.layout === 'nintendo';
    if (pad.pressed(BUTTON.UP)) return 'up';
    if (pad.pressed(BUTTON.DOWN)) return 'down';
    if (pad.pressed(BUTTON.LEFT)) return 'left';
    if (pad.pressed(BUTTON.RIGHT)) return 'right';
    if (pad.pressed(BUTTON.B)) return nintendo ? 'a' : 'b';
    if (pad.pressed(BUTTON.A)) return nintendo ? 'b' : 'a';
    for (const button of [BUTTON.X, BUTTON.Y, BUTTON.LB, BUTTON.RB, BUTTON.LT, BUTTON.RT, BUTTON.VIEW, BUTTON.MENU]) {
        if (pad.pressed(button)) return null;
    }
    return undefined;
}

/**
 * Turns a finger going down and coming up again into a swipe direction or a tap (or nothing, for anything in
 * between).
 * @param {number} dx How far it moved, in CSS pixels (right is positive).
 * @param {number} dy (Down is positive.)
 * @param {number} ms How long it was down.
 * @returns {KonamiInput | undefined}
 */
export function konamiGesture(dx, dy, ms) {
    const distance = Math.hypot(dx, dy);
    if (distance <= TAP_DISTANCE) return ms <= TAP_MS ? 'tap' : undefined;
    if (distance < SWIPE_DISTANCE) return undefined;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
}

/**
 * Reads swipes and taps anywhere on the page, for the touch-screen version of the code.
 * @param {(input: KonamiInput) => void} onInput
 * @param {() => boolean} listening Whether to take any notice right now.
 */
export function listenForGestures(onInput, listening) {
    let start = null;
    window.addEventListener('touchstart', (event) => {
        const touch = event.changedTouches[0];
        start = event.touches.length === 1 && listening() ? { x: touch.clientX, y: touch.clientY, time: event.timeStamp } : null;
    }, { passive: true });
    window.addEventListener('touchend', (event) => {
        if (!start || event.touches.length > 0) return;
        const touch = event.changedTouches[0];
        const input = konamiGesture(touch.clientX - start.x, touch.clientY - start.y, event.timeStamp - start.time);
        start = null;
        if (input) onInput(input);
    }, { passive: true });
    window.addEventListener('touchcancel', () => {
        start = null;
    }, { passive: true });
}
