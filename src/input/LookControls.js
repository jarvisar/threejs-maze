const RADIANS_PER_PIXEL = 0.002;
const MAX_PITCH = Math.PI / 2 - 0.001;
// Some browser/mouse combinations report a huge bogus jump when pointer lock engages.
const MAX_EVENT_MOVEMENT = 400;

/**
 * Mouse look with the Pointer Lock API. Keeps yaw/pitch as plain angles (no roll, no gimbal surprises).
 * Dispatches `lock`, `unlock` and `error` events.
 */
export class LookControls extends EventTarget {
    /** @param {HTMLElement} element The element to lock the pointer to. */
    constructor(element) {
        super();
        this.element = element;
        this.yaw = 0;
        this.pitch = 0;
        this.sensitivity = 1;
        this.invertY = false;
        this.isLocked = false;

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
            // Newer browsers return a promise that rejects, e.g. when re-locking too soon after Esc.
            const result = this.element.requestPointerLock();
            result?.catch?.(() => this.dispatchEvent(new Event('error')));
        } catch {
            this.dispatchEvent(new Event('error'));
        }
    }

    unlock() {
        if (document.pointerLockElement === this.element) document.exitPointerLock();
    }

    /** @param {import('three').Camera} camera */
    applyTo(camera) {
        camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }

    _onMouseMove(event) {
        if (!this.isLocked) return;
        const dx = clamp(event.movementX, -MAX_EVENT_MOVEMENT, MAX_EVENT_MOVEMENT);
        const dy = clamp(event.movementY, -MAX_EVENT_MOVEMENT, MAX_EVENT_MOVEMENT);
        const scale = RADIANS_PER_PIXEL * this.sensitivity;
        this.yaw -= dx * scale;
        this.pitch = clamp(this.pitch - dy * scale * (this.invertY ? -1 : 1), -MAX_PITCH, MAX_PITCH);
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value || 0));
}
