// How far (in CSS pixels) the thumb has to move from where it landed for full speed.
const STICK_RADIUS = 56;
// Pushing the stick nearly all the way out breaks into a run.
const SPRINT_AT = 0.92;
const LOOK_RADIANS_PER_PIXEL = 0.0055;

/**
 * On-screen controls for touch screens: a thumbstick that appears wherever the left thumb lands, dragging
 * anywhere on the right half to look around, and buttons for the flashlight and pausing.
 * Dispatches `pause` and `flashlight`.
 */
export class TouchControls extends EventTarget {
    /**
     * @param {HTMLElement} root The overlay element.
     * @param {import('./LookControls.js').LookControls} look
     */
    constructor(root, look) {
        super();
        this.root = root;
        this.look = look;
        this.stick = /** @type {HTMLElement} */ (root.querySelector('.touch-stick'));
        this.knob = /** @type {HTMLElement} */ (root.querySelector('.touch-knob'));
        /** Movement from the stick: forward and right in -1..1. */
        this.move = { forward: 0, right: 0, sprint: false };

        this._stickId = null;
        this._stickOrigin = { x: 0, y: 0 };
        this._lookId = null;
        this._lookLast = { x: 0, y: 0 };

        root.addEventListener('touchstart', (event) => this._onStart(event), { passive: false });
        root.addEventListener('touchmove', (event) => this._onMove(event), { passive: false });
        root.addEventListener('touchend', (event) => this._onEnd(event));
        root.addEventListener('touchcancel', (event) => this._onEnd(event));
        root.addEventListener('click', (event) => {
            const action = /** @type {HTMLElement} */ (event.target).closest('[data-touch]')?.getAttribute('data-touch');
            if (action) this.dispatchEvent(new Event(action));
        });
    }

    setActive(active) {
        this.root.hidden = !active;
        if (!active) this.reset();
    }

    reset() {
        this._stickId = null;
        this._lookId = null;
        this.move.forward = 0;
        this.move.right = 0;
        this.move.sprint = false;
        this.stick.hidden = true;
    }

    _onStart(event) {
        if (/** @type {HTMLElement} */ (event.target).closest('[data-touch]')) return; // a button
        event.preventDefault();
        for (const touch of event.changedTouches) {
            if (touch.clientX < innerWidth / 2 && this._stickId === null) {
                this._stickId = touch.identifier;
                this._stickOrigin = { x: touch.clientX, y: touch.clientY };
                this.stick.style.transform = `translate(${touch.clientX}px, ${touch.clientY}px)`;
                this.knob.style.transform = '';
                this.stick.hidden = false;
            } else if (this._lookId === null) {
                this._lookId = touch.identifier;
                this._lookLast = { x: touch.clientX, y: touch.clientY };
            }
        }
    }

    _onMove(event) {
        event.preventDefault();
        for (const touch of event.changedTouches) {
            if (touch.identifier === this._stickId) {
                let dx = touch.clientX - this._stickOrigin.x;
                let dy = touch.clientY - this._stickOrigin.y;
                const length = Math.hypot(dx, dy);
                if (length > STICK_RADIUS) {
                    dx *= STICK_RADIUS / length;
                    dy *= STICK_RADIUS / length;
                }
                this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
                this.move.right = dx / STICK_RADIUS;
                this.move.forward = -dy / STICK_RADIUS;
                this.move.sprint = length / STICK_RADIUS >= SPRINT_AT && -dy > Math.abs(dx);
            } else if (touch.identifier === this._lookId) {
                const look = this.look;
                const scale = (LOOK_RADIANS_PER_PIXEL * look.sensitivity) / look.zoom;
                look.yaw -= (touch.clientX - this._lookLast.x) * scale;
                const pitch = look.pitch - (touch.clientY - this._lookLast.y) * scale * (look.invertY ? -1 : 1);
                look.pitch = Math.min(Math.max(pitch, -Math.PI / 2 + 0.001), Math.PI / 2 - 0.001);
                this._lookLast = { x: touch.clientX, y: touch.clientY };
            }
        }
    }

    _onEnd(event) {
        for (const touch of event.changedTouches) {
            if (touch.identifier === this._stickId) {
                this._stickId = null;
                this.move.forward = 0;
                this.move.right = 0;
                this.move.sprint = false;
                this.stick.hidden = true;
            } else if (touch.identifier === this._lookId) {
                this._lookId = null;
            }
        }
    }
}
