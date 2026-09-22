/**
 * The full-screen overlay: loading screen → title screen → pause menu, each with a settings page and a
 * controls page. Dispatches `start` (start/resume clicked), `new-world`, and `view` when the page changes.
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
        this.settingsPanel = /** @type {HTMLElement} */ (document.getElementById('settings'));
        this.controlsPanel = /** @type {HTMLElement} */ (document.getElementById('controls'));
        /** @type {import('./SettingsMenu.js').SettingsMenu | null} */
        this.settingsMenu = null;
        /** On touch screens the buttons say "Tap" rather than "Click". */
        this.touch = false;

        this.startButton.addEventListener('click', () => this.dispatchEvent(new Event('start')));
        this.root.addEventListener('click', (event) => {
            const action = /** @type {HTMLElement} */ (event.target).closest?.('[data-action]')?.getAttribute('data-action');
            if (action === 'settings' || action === 'controls') this.showView(action);
            else if (action === 'back') this.showView('main');
            else if (action) this.dispatchEvent(new Event(action));
        });
        window.addEventListener('keydown', (event) => {
            // The settings menu handles its own keys; this is for the controls page.
            if (this.view === 'controls' && (event.key === 'Escape' || event.key === 'Backspace')) {
                this.showView('main');
                event.preventDefault();
            }
        });
    }

    /** @param {import('./SettingsMenu.js').SettingsMenu} settingsMenu */
    attachSettings(settingsMenu) {
        this.settingsMenu = settingsMenu;
        settingsMenu.addEventListener('close', () => this.showView('main'));
    }

    /** @param {'loading' | 'title' | 'paused' | 'hidden' | 'error'} state */
    setState(state) {
        this.root.dataset.state = state;
        this.startButton.textContent = `${this.touch ? 'Tap' : 'Click'} to ${state === 'paused' ? 'Resume' : 'Start'}`;
        if (state === 'hidden' || state === 'loading' || state === 'error') this.showView('main');
    }

    get state() {
        return this.root.dataset.state;
    }

    get view() {
        return this.root.dataset.view;
    }

    /** @param {'main' | 'settings' | 'controls'} view */
    showView(view) {
        if (view === this.view) return;
        this.root.dataset.view = view;
        this.controlsPanel.hidden = view !== 'controls';
        if (view === 'settings') this.settingsMenu?.open();
        else this.settingsMenu?.close();
        if (view === 'main') this.startButton.focus({ preventScroll: true });
        else if (view === 'controls') this.controlsPanel.querySelector('button')?.focus({ preventScroll: true });
        this.dispatchEvent(new Event('view'));
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
