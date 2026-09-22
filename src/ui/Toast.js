const FADE_MS = 500;

/**
 * The small message box at the bottom of the screen. `show` queues messages (hints); `flash` interrupts
 * with immediate feedback (e.g. "Flashlight on") and then carries on with the queue.
 */
export class Toast {
    /** @param {HTMLElement} element */
    constructor(element) {
        this.element = element;
        /** @type {{ message: string, duration: number, queued: boolean, done?: boolean }[]} */
        this.queue = [];
        this.current = null;
        this.timer = 0;
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

    clear() {
        clearTimeout(this.timer);
        this.queue.length = 0;
        this.current = null;
        this.element.classList.remove('visible');
    }

    _next() {
        const item = this.queue.shift();
        if (item) this._display(item);
        else this.current = null;
    }

    _display(item) {
        clearTimeout(this.timer);
        this.current = item;
        this.element.textContent = item.message;
        this.element.classList.add('visible');
        this.timer = setTimeout(() => {
            item.done = true;
            this.element.classList.remove('visible');
            this.timer = setTimeout(() => this._next(), FADE_MS);
        }, item.duration);
    }
}
