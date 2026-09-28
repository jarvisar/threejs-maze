const RADIANS_PER_PIXEL = 0.002;
const MAX_PITCH = Math.PI / 2 - 0.001;
// Some browser/mouse combinations report a huge bogus jump when pointer lock engages.
const MAX_EVENT_MOVEMENT = 400;

/**
 * Mouse look with Pointer Lock. Yaw/pitch are kept as plain angles (no roll, no gimbal surprises).
 * Dispatches `lock`, `unlock` and `error`.
 */
export class LookControls extends EventTarget {
    /** @param {HTMLElement} element */
    constructor(element) {
        super();
        this.element = element;
        this.yaw = 0;
        this.pitch = 0;
        this.sensitivity = 1;
        this.invertY = false;
        /** Look speed drops as you zoom in, like a real lens. */
        this.zoom = 1;
        this.isLocked = false;
        /** Mouse doesn't turn the view. Set while a panel uses the mouse for its own pointer (see Catalogue.js). */
        this.frozen = false;

        document.addEventListener('mousemove', (event) => this._onMouseMove(event));
        document.addEventListener('pointerlockchange', () => {
            const locked = document.pointerLockElement === this.element;
            if (locked === this.isLocked) return;
            this.isLocked = locked;
            this.dispatchEvent(new Event(locked ? 'lock' : 'unlock'));
        });
        document.addEventListener('pointerlockerror', () => this.dispatchEvent(new Event('error')));
    }

    lock() {
        try {
            // Newer browsers return a promise that can reject, e.g. when re-locking too soon after Esc.
            const result = this.element.requestPointerLock();
            result?.catch?.(() => this.dispatchEvent(new Event('error')));
        } catch {
            this.dispatchEvent(new Event('error'));
        }
    }

    unlock() {
        if (document.pointerLockElement === this.element) document.exitPointerLock();
    }

    /**
     * Turn by angles (e.g. from a stick). Pitch is clamped so the view can't flip over.
     * @param {number} yaw Radians, positive turns left.
     * @param {number} pitch Radians, positive looks up.
     */
    turn(yaw, pitch) {
        this.yaw += yaw;
        this.pitch = clamp(this.pitch + pitch, -MAX_PITCH, MAX_PITCH);
    }

    /** @param {import('three').Camera} camera */
    applyTo(camera) {
        camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }

    _onMouseMove(event) {
        if (!this.isLocked || this.frozen) return;
        const dx = clamp(event.movementX, -MAX_EVENT_MOVEMENT, MAX_EVENT_MOVEMENT);
        const dy = clamp(event.movementY, -MAX_EVENT_MOVEMENT, MAX_EVENT_MOVEMENT);
        const scale = (RADIANS_PER_PIXEL * this.sensitivity) / this.zoom;
        this.turn(-dx * scale, -dy * scale * (this.invertY ? -1 : 1));
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value || 0));
}
