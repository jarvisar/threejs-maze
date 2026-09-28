// Button indices in the browser's "standard" layout (https://w3c.github.io/gamepad/#remapping), using Xbox names.
// Other controllers use the same index for the button in the same position.
export const BUTTON = Object.freeze({
    A: 0,
    B: 1,
    X: 2,
    Y: 3,
    LB: 4,
    RB: 5,
    LT: 6,
    RT: 7,
    VIEW: 8,
    MENU: 9,
    LEFT_STICK: 10,
    RIGHT_STICK: 11,
    UP: 12,
    DOWN: 13,
    LEFT: 14,
    RIGHT: 15,
});
const BUTTON_COUNT = 16;

// Worn sticks don't rest at exactly 0, so ignore anything this close to center.
const STICK_DEADZONE = 0.18;
// Hysteresis for buttons (mostly triggers) so one held right at the threshold doesn't flicker. VRHand.js uses
// these too.
export const PRESS = 0.5;
export const RELEASE = 0.3;
// Holding a direction in menus: one step, a pause, then steady repeats.
const REPEAT_DELAY = 0.4;
const REPEAT_INTERVAL = 0.11;
const NAV_THRESHOLD = 0.5;

/** Button names per layout, for hints and the controls page. */
export const BUTTON_LABELS = Object.freeze({
    xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', view: 'View', menu: 'Menu' },
    playstation: { a: 'Cross', b: 'Circle', x: 'Square', y: 'Triangle', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', view: 'Create', menu: 'Options' },
    nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', view: 'Minus', menu: 'Plus' },
});

/** @typedef {typeof BUTTON_LABELS.xbox} ButtonLabels */

/**
 * Guesses the controller family from the browser's id string (it includes the USB vendor id).
 * @param {string} id
 * @returns {keyof BUTTON_LABELS}
 */
export function controllerLayout(id) {
    if (/054c|playstation|dualsense|dualshock|wireless controller/i.test(id)) return 'playstation';
    if (/057e|nintendo|pro controller|joy-con/i.test(id)) return 'nintendo';
    return 'xbox';
}

/**
 * Removes the dead zone and rescales the rest to 0..1, so movement starts from 0 just past the dead zone
 * instead of jumping to 18%.
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number }} out
 */
export function applyDeadzone(x, y, out) {
    const length = Math.hypot(x || 0, y || 0);
    if (length <= STICK_DEADZONE) {
        out.x = 0;
        out.y = 0;
        return out;
    }
    const scale = Math.min((length - STICK_DEADZONE) / (1 - STICK_DEADZONE), 1) / length;
    out.x = x * scale;
    out.y = y * scale;
    return out;
}

/**
 * Controllers via the Gamepad API. There are no button events, so `poll` reads them once a frame. All connected
 * controllers are merged into one. Browsers only expose a controller after one of its buttons is pressed.
 * Dispatches `connect` and `disconnect`.
 */
export class GamepadInput extends EventTarget {
    /** @param {() => ArrayLike<Gamepad | null>} [getGamepads] */
    constructor(getGamepads = () => globalThis.navigator?.getGamepads?.() ?? []) {
        super();
        this.getGamepads = getGamepads;
        /** Connected count from the browser events. Nothing is polled while it's 0. */
        this.connected = 0;
        /** @type {keyof BUTTON_LABELS} */
        this.layout = 'xbox';
        /** After the dead zone. Up is negative y. */
        this.leftStick = { x: 0, y: 0 };
        this.rightStick = { x: 0, y: 0 };
        /** Menu direction from the d-pad or left stick this frame, or null. Repeats while held. */
        this.direction = /** @type {'up' | 'down' | 'left' | 'right' | null} */ (null);
        /** Any button or stick in use this frame. */
        this.active = false;

        this._values = new Float32Array(BUTTON_COUNT);
        this._down = new Uint8Array(BUTTON_COUNT);
        this._wasDown = new Uint8Array(BUTTON_COUNT);
        this._axes = new Float32Array(4);
        this._heldDirection = null;
        this._repeatAt = 0;
        this._newest = -1;

        globalThis.addEventListener?.('gamepadconnected', (event) => {
            this.connected++;
            this.layout = controllerLayout(event.gamepad.id);
            this.dispatchEvent(new CustomEvent('connect', { detail: event.gamepad }));
        });
        globalThis.addEventListener?.('gamepaddisconnected', (event) => {
            this.connected = Math.max(this.connected - 1, 0);
            this.dispatchEvent(new CustomEvent('disconnect', { detail: event.gamepad }));
        });
    }

    get labels() {
        return BUTTON_LABELS[this.layout];
    }

    /**
     * Call once per frame, before checking buttons.
     * @param {number} now Seconds, for repeating menu directions.
     * @returns {boolean} Whether any controller was read.
     */
    poll(now) {
        this._wasDown.set(this._down);
        this._values.fill(0);
        this._axes.fill(0);
        let found = false;
        if (this.connected > 0) {
            for (const pad of Array.from(this.getGamepads())) {
                if (!pad?.connected) continue;
                found = true;
                const buttons = Math.min(pad.buttons.length, BUTTON_COUNT);
                for (let i = 0; i < buttons; i++) {
                    const button = pad.buttons[i];
                    // Some controllers report a pressed button with a value of 0.
                    this._values[i] = Math.max(this._values[i], button.value || (button.pressed ? 1 : 0));
                }
                const axes = Math.min(pad.axes.length, 4);
                for (let i = 0; i < axes; i++) {
                    if (Math.abs(pad.axes[i]) > Math.abs(this._axes[i])) this._axes[i] = pad.axes[i];
                }
                // Button names follow the last controller used.
                if (pad.timestamp > this._newest) {
                    this._newest = pad.timestamp;
                    this.layout = controllerLayout(pad.id);
                }
            }
        }

        let anyDown = false;
        for (let i = 0; i < BUTTON_COUNT; i++) {
            this._down[i] = this._values[i] > (this._wasDown[i] ? RELEASE : PRESS) ? 1 : 0;
            if (this._down[i]) anyDown = true;
        }
        applyDeadzone(this._axes[0], this._axes[1], this.leftStick);
        applyDeadzone(this._axes[2], this._axes[3], this.rightStick);
        const l = this.leftStick;
        const r = this.rightStick;
        this.active = anyDown || l.x !== 0 || l.y !== 0 || r.x !== 0 || r.y !== 0;
        this._updateDirection(now);
        return found;
    }

    /** Went down this frame. */
    pressed(button) {
        return this._down[button] === 1 && this._wasDown[button] === 0;
    }

    held(button) {
        return this._down[button] === 1;
    }

    /** 0..1. Only triggers are analog, other buttons are 0 or 1. */
    value(button) {
        return this._values[button];
    }

    _updateDirection(now) {
        const [x, y] = this._axes;
        let direction = null;
        if (this.held(BUTTON.UP)) direction = 'up';
        else if (this.held(BUTTON.DOWN)) direction = 'down';
        else if (this.held(BUTTON.LEFT)) direction = 'left';
        else if (this.held(BUTTON.RIGHT)) direction = 'right';
        else if (Math.max(Math.abs(x), Math.abs(y)) > NAV_THRESHOLD) {
            direction = Math.abs(y) >= Math.abs(x) ? (y < 0 ? 'up' : 'down') : x < 0 ? 'left' : 'right';
        }

        this.direction = null;
        if (direction !== this._heldDirection) {
            this._heldDirection = direction;
            this.direction = direction;
            this._repeatAt = now + REPEAT_DELAY;
        } else if (direction && now >= this._repeatAt) {
            this.direction = direction;
            this._repeatAt = now + REPEAT_INTERVAL;
        }
    }
}
