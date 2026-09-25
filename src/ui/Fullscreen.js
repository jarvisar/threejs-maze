// How long a refused request waits for a click or a key press. Going full screen on a click long after asking
// for it would come as a surprise.
const WAIT_MS = 6000;
// The end of a click, a tap or a key press. Listened for while a request waits.
const GESTURES = ['pointerup', 'keyup'];

/**
 * Full screen at the press of a controller button. Browsers only go full screen straight after a click, a tap
 * or a key press, and a controller button doesn't count, so when the browser says no, the request waits for
 * the next click or key press and goes through then.
 * Dispatches `wait` when a request starts waiting (again), and `waitend` when it stops, whether it went
 * through or not.
 */
export class Fullscreen extends EventTarget {
    /**
     * @param {Document} [doc]
     * @param {Window} [win] Where clicks and key presses are listened for.
     */
    constructor(doc = globalThis.document, win = globalThis.window) {
        super();
        this.doc = doc;
        this.win = win;
        /** How long a refused request waits for a click or a key press, in ms. */
        this.waitTime = WAIT_MS;
        /** Whether a refused request is waiting for a click or a key press. */
        this.waiting = false;
        /** @type {Promise<'entered' | 'exited' | 'waiting' | 'unavailable'> | null} The request under way. */
        this._busy = null;
        this._timeout = 0;
        this._retryTimer = 0;
        this._onGesture = () => {
            // Not straight away: whatever the click or key press does itself goes first. Going full screen
            // uses up the browser's permission, and capturing the mouse (a click on the view, or on Start)
            // needs it too.
            if (!this._retryTimer) this._retryTimer = setTimeout(() => this._retry(), 0);
        };
        // However it went full screen (e.g. starting on a touch screen), there's nothing left to wait for.
        doc.addEventListener('fullscreenchange', () => {
            if (this.active) this.cancel();
        });
    }

    /** Whether the page can go full screen at all (on an iPhone, for one, it can't). */
    get available() {
        return this.doc.fullscreenEnabled === true && typeof this.doc.documentElement.requestFullscreen === 'function';
    }

    get active() {
        return Boolean(this.doc.fullscreenElement);
    }

    /**
     * Goes full screen, or back out of it. Pressing again while the browser is still switching does nothing.
     * @returns {Promise<'entered' | 'exited' | 'waiting' | 'unavailable'>} 'waiting' if the browser wants a
     * click or a key press first.
     */
    toggle() {
        this._busy ??= this._toggle().finally(() => (this._busy = null));
        return this._busy;
    }

    /** Stops waiting for a click or a key press, if a request was. */
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
            // Leaving never needs a click.
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
            // Capturing, so nothing on the page can stop them getting here.
            for (const type of GESTURES) this.win.addEventListener(type, this._onGesture, true);
        }
        this.dispatchEvent(new Event('wait'));
    }

    _retry() {
        this._retryTimer = 0;
        // Escape, for one, doesn't count as asking for anything; keep waiting for something that does.
        if (!this.waiting || this._busy || this.win.navigator?.userActivation?.isActive === false) return;
        this._busy = this._enter()
            .then((entered) => {
                if (!entered) return 'waiting';
                this.cancel();
                return 'entered';
            })
            .finally(() => (this._busy = null));
    }

    /** @returns {Promise<boolean>} Whether the browser went full screen. */
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
 * Full screen in the desktop app: the window itself goes full screen. It needs no click, so it never waits, and it
 * stays full screen when Esc pauses the game (a browser's full screen ends with Esc). Same interface as Fullscreen.
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
