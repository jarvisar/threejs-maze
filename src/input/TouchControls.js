// Thumb distance from the touch point for full speed (CSS px).
const STICK_RADIUS = 56;
// Pushing the stick almost all the way out sprints.
const SPRINT_AT = 0.92;
const LOOK_RADIANS_PER_PIXEL = 0.0055;

/**
 * Touch screen controls. A thumbstick appears wherever the left thumb lands, dragging on the right half looks
 * around, and there are buttons for jump (hold, also swims up), flashlight and pause.
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
        this.jumpButton = /** @type {HTMLElement} */ (root.querySelector('[data-hold="jump"]'));
        /** forward and right are -1..1 from the stick. jump is the held jump button. */
        this.move = { forward: 0, right: 0, sprint: false, jump: false };

        this._jumpId = null;
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
        this._jumpId = null;
        this._stickId = null;
        this._lookId = null;
        this.move.forward = 0;
        this.move.right = 0;
        this.move.sprint = false;
        this.move.jump = false;
        this.jumpButton.classList.remove('held');
        this.stick.hidden = true;
    }

    _onStart(event) {
        if (/** @type {HTMLElement} */ (event.target).closest('[data-touch]')) return; // a button
        event.preventDefault();
        for (const touch of event.changedTouches) {
            if (/** @type {HTMLElement} */ (touch.target).closest?.('[data-hold="jump"]')) {
                // Held, not tapped. It's read every step and keeps swimming up while down.
                this._jumpId = touch.identifier;
                this.move.jump = true;
                this.jumpButton.classList.add('held');
            } else if (touch.clientX < innerWidth / 2 && this._stickId === null) {
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
                look.turn(-(touch.clientX - this._lookLast.x) * scale, -(touch.clientY - this._lookLast.y) * scale * (look.invertY ? -1 : 1));
                this._lookLast = { x: touch.clientX, y: touch.clientY };
            }
        }
    }

    _onEnd(event) {
        for (const touch of event.changedTouches) {
            if (touch.identifier === this._jumpId) {
                this._jumpId = null;
                this.move.jump = false;
                this.jumpButton.classList.remove('held');
            } else if (touch.identifier === this._stickId) {
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
