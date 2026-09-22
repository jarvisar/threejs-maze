/**
 * The full-screen overlay: loading screen → title screen → pause menu.
 * Dispatches `start` (start/resume clicked), `controls` and `new-world`.
 */
export class Menu extends EventTarget {
    constructor() {
        super();
        this.root = /** @type {HTMLElement} */ (document.getElementById('menu'));
        this.startButton = /** @type {HTMLButtonElement} */ (document.getElementById('start'));
        this.loader = /** @type {HTMLElement} */ (document.getElementById('loader'));
        this.loaderLabel = /** @type {HTMLElement} */ (document.getElementById('loader-label'));
        this.loaderFill = /** @type {HTMLElement} */ (document.getElementById('loader-fill'));
        this.note = /** @type {HTMLElement} */ (document.getElementById('menu-note'));

        this.startButton.addEventListener('click', () => this.dispatchEvent(new Event('start')));
        this.root.addEventListener('click', (event) => {
            const action = /** @type {HTMLElement} */ (event.target).closest?.('[data-action]')?.getAttribute('data-action');
            if (action) this.dispatchEvent(new Event(action));
        });
    }

    /** @param {'loading' | 'title' | 'paused' | 'hidden' | 'error'} state */
    setState(state) {
        this.root.dataset.state = state;
        this.startButton.textContent = state === 'paused' ? 'Click to Resume' : 'Click to Start';
    }

    get state() {
        return this.root.dataset.state;
    }

    /**
     * @param {number} fraction 0..1
     * @param {string} label
     */
    setProgress(fraction, label) {
        const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
        this.loaderFill.style.width = `${percent}%`;
        this.loader.setAttribute('aria-valuenow', String(percent));
        this.loaderLabel.textContent = `[ ${label} ]`;
    }

    /** A short line of text under the buttons (hints, warnings). Pass '' to hide it. */
    setNote(text) {
        this.note.textContent = text;
        this.note.hidden = text === '';
    }

    showError(message) {
        this.setState('error');
        this.loaderLabel.textContent = message;
    }
}
