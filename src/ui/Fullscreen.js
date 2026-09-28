// How long (ms) a refused request waits for a click or key press. Going full screen long after the click would
// surprise the player.
const WAIT_MS = 6000;
// End of a click, tap or key press. Only listened for while a request waits.
const GESTURES = ['pointerup', 'keyup'];

/**
 * Full screen from a controller button. Browsers only allow it right after a click, tap or key press, and gamepad
 * buttons don't count. So a refused request waits for the next click or key press and retries then.
 * Dispatches `wait` when a request starts (or restarts) waiting and `waitend` when it stops.
 */
export class Fullscreen extends EventTarget {
    /**
     * @param {Document} [doc]
     * @param {Window} [win] Listens here for clicks and key presses.
     */
    constructor(doc = globalThis.document, win = globalThis.window) {
        super();
        this.doc = doc;
        this.win = win;
        /** How long to wait for a gesture (ms). */
        this.waitTime = WAIT_MS;
        /** A refused request is waiting for a gesture. */
        this.waiting = false;
        /** @type {Promise<'entered' | 'exited' | 'waiting' | 'unavailable'> | null} In-flight request. */
        this._busy = null;
        this._timeout = 0;
        this._retryTimer = 0;
        this._onGesture = () => {
            // Deferred so the gesture's own handler runs first. Going full screen and capturing the mouse (click on
            // the view or Start) both use up the same one-gesture permission.
            if (!this._retryTimer) this._retryTimer = setTimeout(() => this._retry(), 0);
        };
        // Went full screen some other way (e.g. starting on a touch screen), so stop waiting.
        doc.addEventListener('fullscreenchange', () => {
            if (this.active) this.cancel();
        });
    }

    /** False where full screen isn't supported at all (iPhone). */
    get available() {
        return this.doc.fullscreenEnabled === true && typeof this.doc.documentElement.requestFullscreen === 'function';
    }

    get active() {
        return Boolean(this.doc.fullscreenElement);
    }

    /**
     * Toggles full screen. Ignored while the browser is still switching.
     * @returns {Promise<'entered' | 'exited' | 'waiting' | 'unavailable'>} 'waiting' if the browser needs a
     * gesture first.
     */
    toggle() {
        this._busy ??= this._toggle().finally(() => (this._busy = null));
        return this._busy;
    }

    /** Stops waiting for a gesture, if we were. */
    cancel() {
        clearTimeout(this._timeout);
        clearTimeout(this._retryTimer);
        this._retryTimer = 0;
        if (!this.waiting) return;
        this.waiting = false;
        for (const type of GESTURES) this.win.removeEventListener(type, this._onGesture, true);
        this.dispatchEvent(new Event('waitend'));
    }

    async _toggle() {
        if (this.active) {
            // Exiting never needs a gesture.
            this.cancel();
            await this.doc.exitFullscreen().catch(() => {});
            return 'exited';
        }
        if (!this.available) return 'unavailable';
        if (await this._enter()) return 'entered';
        this._wait();
        return 'waiting';
    }

    _wait() {
        clearTimeout(this._timeout);
        this._timeout = setTimeout(() => this.cancel(), this.waitTime);
        if (!this.waiting) {
            this.waiting = true;
            // Capture phase so nothing on the page can stop them.
            for (const type of GESTURES) this.win.addEventListener(type, this._onGesture, true);
        }
        this.dispatchEvent(new Event('wait'));
    }

    _retry() {
        this._retryTimer = 0;
        // Escape doesn't count as user activation. Keep waiting for something that does.
        if (!this.waiting || this._busy || this.win.navigator?.userActivation?.isActive === false) return;
        this._busy = this._enter()
            .then((entered) => {
                if (!entered) return 'waiting';
                this.cancel();
                return 'entered';
            })
            .finally(() => (this._busy = null));
    }

    /** @returns {Promise<boolean>} True if it went full screen. */
    async _enter() {
        try {
            await this.doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Desktop app full screen. The window itself goes full screen, which needs no gesture so it never waits. It also
 * stays full screen when Esc pauses the game, unlike browser full screen. Same interface as Fullscreen.
 */
export class WindowFullscreen extends EventTarget {
    /** @param {import('../desktop.js').DesktopBridge} bridge */
    constructor(bridge) {
        super();
        this.bridge = bridge;
        this.waitTime = 0;
        this.waiting = false;
    }

    get available() {
        return true;
    }

    get active() {
        return this.bridge.isFullscreen();
    }

    /** @returns {Promise<'entered' | 'exited'>} */
    async toggle() {
        return (await this.bridge.setFullscreen(!this.active)) ? 'entered' : 'exited';
    }

    cancel() {}
}
