import { BUTTON } from './Gamepad.js';

/*
 * Konami code. Toggles Level Fun (see party.js). Works with arrow keys plus B and A, a controller's d-pad plus
 * B and A, or on touch by swiping the directions and then tapping twice.
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
// Modifiers can be held while pressing other keys (Shift to sprint), so they don't break the sequence.
const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

// CSS px. A swipe is at least SWIPE_DISTANCE. A tap moves at most TAP_DISTANCE and lasts at most TAP_MS.
const SWIPE_DISTANCE = 40;
const TAP_DISTANCE = 12;
const TAP_MS = 350;

export class KonamiCode {
    constructor() {
        /** Number of inputs matched so far. */
        this.progress = 0;
    }

    /**
     * @param {KonamiInput | null | undefined} input Null is any other input and resets. Undefined is ignored.
     * @returns {boolean} Whether that finished the code.
     */
    push(input) {
        if (input === undefined) return false;
        this.progress = next(this.progress, input);
        if (this.progress < KONAMI.length) return false;
        this.progress = 0;
        return true;
    }
}

/**
 * Progress after one more input. Advances on a match, otherwise falls back to the longest start of the code that
 * the recent inputs still match (so up, up, up still counts as up, up).
 */
function next(progress, input) {
    const matches = (index) => KONAMI[index] === input || (input === 'tap' && (KONAMI[index] === 'b' || KONAMI[index] === 'a'));
    if (matches(progress)) return progress + 1;
    // Inputs so far are KONAMI[0..progress) plus `input`. Find the longest prefix of the code they end with.
    for (let length = progress; length > 0; length--) {
        let fits = matches(length - 1);
        for (let k = 0; fits && k < length - 1; k++) fits = KONAMI[k] === KONAMI[progress - length + 1 + k];
        if (fits) return length;
    }
    return 0;
}

/**
 * @param {string} code
 * @returns {KonamiInput | null | undefined}
 */
export function konamiKey(code) {
    if (MODIFIERS.has(code)) return undefined;
    return /** @type {KonamiInput | undefined} */ (KEYS.get(code)) ?? null;
}

/**
 * Controller input this frame. B and A are the right and bottom face buttons like on Xbox and PlayStation.
 * Nintendo pads go by the printed letters, which are swapped.
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
 * Turns one touch into a swipe direction or a tap. Anything in between is undefined.
 * @param {number} dx CSS px, right is positive.
 * @param {number} dy Down is positive.
 * @param {number} ms Time the finger was down.
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
 * Listens for swipes and taps anywhere on the page, for entering the code on touch screens.
 * @param {(input: KonamiInput) => void} onInput
 * @param {() => boolean} listening Checked on each touch start.
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
