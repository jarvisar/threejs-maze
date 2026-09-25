const FADE_MS = 500;

/**
 * The small message box at the bottom of the screen. `show` queues messages (hints); `flash` interrupts
 * with immediate feedback (e.g. "Flashlight on") and then carries on with the queue.
 * Dispatches `change` with the message now on screen (or null) as its detail, for showing it in VR too.
 */
export class Toast extends EventTarget {
    /** @param {HTMLElement} element */
    constructor(element) {
        super();
        this.element = element;
        /** @type {{ message: string, duration: number, queued: boolean, done?: boolean }[]} */
        this.queue = [];
        this.current = null;
        this.timer = 0;
        this.suspended = false;
    }

    /** Clears the screen and puts queued hints on hold (e.g. while paused); `flash` still works. */
    suspend() {
        if (this.suspended) return;
        this.suspended = true;
        if (this.current) {
            if (this.current.queued && !this.current.done) this.queue.unshift(this.current);
            clearTimeout(this.timer);
            this.current = null;
            this._hide();
        }
    }

    resume() {
        this.suspended = false;
        if (!this.current) this._next();
    }

    /** Queues a message. Ignored if the same message is already showing or waiting. */
    show(message, duration = 2500) {
        if (this.current?.message === message || this.queue.some((item) => item.message === message)) return;
        this.queue.push({ message, duration, queued: true });
        if (!this.current) this._next();
    }

    /** Shows a message right away, replacing whatever is on screen. */
    flash(message, duration = 1500) {
        // Re-show an interrupted hint afterwards (unless it had already finished and was just fading out).
        if (this.current?.queued && !this.current.done) this.queue.unshift(this.current);
        this._display({ message, duration, queued: false });
    }

    /** Takes a message down early, if it's the one showing (e.g. once what it asked for has been done). */
    dismiss(message) {
        if (this.current?.message !== message) return;
        this.current.done = true;
        clearTimeout(this.timer);
        this._hide();
        this.timer = setTimeout(() => this._next(), FADE_MS);
    }

    clear() {
        clearTimeout(this.timer);
        this.queue.length = 0;
        this.current = null;
        this._hide();
    }

    _next() {
        const item = this.suspended ? undefined : this.queue.shift();
        if (item) this._display(item);
        else this.current = null;
    }

    _display(item) {
        clearTimeout(this.timer);
        this.current = item;
        this.element.textContent = item.message;
        this.element.classList.add('visible');
        this.dispatchEvent(new CustomEvent('change', { detail: item.message }));
        this.timer = setTimeout(() => {
            item.done = true;
            this._hide();
            this.timer = setTimeout(() => this._next(), FADE_MS);
        }, item.duration);
    }

    _hide() {
        this.element.classList.remove('visible');
        this.dispatchEvent(new CustomEvent('change', { detail: null }));
    }
}
