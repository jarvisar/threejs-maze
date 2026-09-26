import { desktop } from '../desktop.js';

const INSTALL_OFFERED_KEY = 'backrooms-simulator:install-offered';
// Controller directions and buttons, as the keys the settings page already understands.
const SETTINGS_KEYS = {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    confirm: 'Enter',
    back: 'Escape',
    previous: 'PageUp',
    next: 'PageDown',
};
const CONTROLS_SCROLL = 80;

/**
 * The full-screen overlay: loading screen → title screen → pause menu, each with a settings page and a
 * controls page. Dispatches `start` (start/resume clicked; `detail.controller` if a controller did it), `enter-vr`,
 * `new-world`, and `view` when the page changes. A controller can get around it too (see `navigate`).
 * The pause menu also has an Install link, where the browser can install the game as an app (Chrome, Edge, Samsung Internet),
 * and the first time the title screen comes up with an install available, a small box offers it there too.
 * In the desktop app there's nothing to install, and a Quit link instead (and a New version link when there's one
 * to download).
 */
export class Menu extends EventTarget {
    constructor() {
        super();
        this.root = /** @type {HTMLElement} */ (document.getElementById('menu'));
        this.startButton = /** @type {HTMLButtonElement} */ (document.getElementById('start'));
        this.vrButton = /** @type {HTMLButtonElement} */ (document.getElementById('enter-vr'));
        this.loader = /** @type {HTMLElement} */ (document.getElementById('loader'));
        this.loaderLabel = /** @type {HTMLElement} */ (document.getElementById('loader-label'));
        this.loaderFill = /** @type {HTMLElement} */ (document.getElementById('loader-fill'));
        this.note = /** @type {HTMLElement} */ (document.getElementById('menu-note'));
        this.settingsPanel = /** @type {HTMLElement} */ (document.getElementById('settings'));
        this.controlsPanel = /** @type {HTMLElement} */ (document.getElementById('controls'));
        this.installLink = /** @type {HTMLButtonElement} */ (this.root.querySelector('[data-action="install"]'));
        this.installOffer = /** @type {HTMLElement} */ (document.getElementById('install-offer'));
        this.modes = /** @type {HTMLElement} */ (document.getElementById('modes'));
        this.levels = /** @type {HTMLElement} */ (document.getElementById('levels'));
        this.modeNote = /** @type {HTMLElement} */ (document.getElementById('mode-note'));
        this.ending = /** @type {HTMLElement} */ (document.getElementById('ending'));
        this.endingTitle = /** @type {HTMLElement} */ (document.getElementById('ending-title'));
        this.endingLines = /** @type {HTMLElement} */ (document.getElementById('ending-lines'));
        this.newWorldLink = /** @type {HTMLButtonElement} */ (this.root.querySelector('.menu-links [data-action="new-world"]'));
        this.quitLink = /** @type {HTMLButtonElement} */ (document.getElementById('quit'));
        /** @type {'explore' | 'footage'} */
        this.mode = 'footage';
        /** The browser's saved install prompt; null until it offers one, and after it's been used or the game is installed. */
        this.installPrompt = null;
        /** @type {import('./SettingsMenu.js').SettingsMenu | null} */
        this.settingsMenu = null;
        /** On touch screens the buttons say "Tap" rather than "Click". */
        this.touch = false;
        /**
         * Button names while a controller is in use, else null.
         * @type {import('../input/Gamepad.js').ButtonLabels | null}
         */
        this.controller = null;

        this.startButton.addEventListener('click', () => this.dispatchEvent(new Event('start')));
        this.modes.addEventListener('click', (event) => {
            const mode = /** @type {HTMLElement} */ (event.target).closest?.('[data-mode]')?.getAttribute('data-mode');
            if (mode) this.dispatchEvent(new CustomEvent('mode', { detail: mode }));
        });
        this.levels.addEventListener('click', (event) => {
            const level = /** @type {HTMLElement} */ (event.target).closest?.('[data-level]')?.getAttribute('data-level');
            if (level !== null && level !== undefined) this.dispatchEvent(new CustomEvent('level', { detail: level === 'fun' ? level : Number(level) }));
        });
        this.root.addEventListener('click', (event) => {
            const action = /** @type {HTMLElement} */ (event.target).closest?.('[data-action]')?.getAttribute('data-action');
            if (action === 'settings' || action === 'controls') this.showView(action);
            else if (action === 'back') this.showView('main');
            else if (action === 'install' || action === 'install-now') this._install();
            else if (action === 'install-later') this._hideInstallOffer();
            else if (action === 'quit-app') desktop?.quit();
            else if (action === 'update') desktop?.openUpdate();
            else if (action) this.dispatchEvent(new Event(action));
        });
        /** @type {HTMLButtonElement} */ (this.root.querySelector('[data-action="quit-app"]')).hidden = !desktop;
        // A desktop build that can't update itself links to the download page once there's something newer.
        const updateLink = /** @type {HTMLButtonElement} */ (this.root.querySelector('[data-action="update"]'));
        desktop?.onUpdateAvailable((version) => {
            updateLink.textContent = `New version ${version}`;
            updateLink.hidden = false;
        });
        // Not cancelled, so the browser can still show its own install banner too.
        window.addEventListener('beforeinstallprompt', (event) => {
            this.installPrompt = event;
            this.installLink.hidden = false;
            if (this.state === 'title') this._offerInstall();
        });
        window.addEventListener('appinstalled', () => this._hideInstall());
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

    /** @param {'loading' | 'title' | 'paused' | 'ended' | 'hidden' | 'error'} state */
    setState(state) {
        this.root.dataset.state = state;
        this._updateStartLabel();
        if (state === 'title') this._offerInstall();
        else this._hideInstallOffer();
        if (state === 'hidden' || state === 'loading' || state === 'error') this.showView('main');
        this.ending.hidden = state !== 'ended';
        // The pause menu's way back to the title, in either mode (the ending screen has its own).
        const quit = state === 'paused';
        if (!quit && document.activeElement === this.quitLink) this.startButton.focus({ preventScroll: true });
        this.quitLink.hidden = !quit;
        if (state === 'ended') this.ending.querySelector('button')?.focus({ preventScroll: true });
    }

    /**
     * The levels Explore can be on, as buttons under the modes (shown with Explore picked).
     * @param {{ id: string, name: string }[]} levels A level's number, or 'fun' for Level Fun.
     */
    setLevels(levels) {
        this.levels.replaceChildren(...levels.map(({ id, name }) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'level';
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-checked', 'false');
            button.dataset.level = id;
            button.textContent = name;
            return button;
        }));
    }

    /**
     * Marks which mode the title screen starts, with a line about it, and in Explore which level.
     * @param {'explore' | 'footage'} mode
     * @param {string} note
     * @param {number | 'fun' | null} [level] Explore's level ('fun' for Level Fun), or null for none of them.
     */
    setMode(mode, note, level = null) {
        for (const button of this.modes.querySelectorAll('[data-mode]')) {
            button.setAttribute('aria-checked', String(button.getAttribute('data-mode') === mode));
        }
        for (const button of this.levels.querySelectorAll('[data-level]')) {
            button.setAttribute('aria-checked', String(button.getAttribute('data-level') === String(level)));
        }
        const showLevels = mode === 'explore' && this.levels.children.length > 1;
        if (!showLevels && this.levels.contains(document.activeElement)) /** @type {HTMLElement} */ (this.modes.querySelector('[data-mode="explore"]'))?.focus({ preventScroll: true });
        this.levels.hidden = !showLevels;
        this.modeNote.textContent = note;
        this.mode = mode;
        // On a tape, New World is a new tape.
        this.newWorldLink.textContent = mode === 'footage' ? 'New tape' : 'New World';
    }

    /**
     * Found Footage: how the tape ended (shown in the 'ended' state).
     * @param {{ escaped: boolean, title: string, lines: string[] }} summary
     */
    showEnding({ escaped, title, lines }) {
        this.root.dataset.ending = escaped ? 'escaped' : 'caught';
        this.endingTitle.textContent = title;
        this.endingLines.textContent = lines.join('\n');
    }

    /**
     * Switches the menu's wording (and the controls page's button names) to a controller, or back with null.
     * @param {import('../input/Gamepad.js').ButtonLabels | null} labels
     */
    setController(labels) {
        this.controller = labels;
        this._updateStartLabel();
        this.settingsMenu?.setController(labels);
        if (labels) this.showButtonNames(labels);
    }

    /**
     * Shows the Enter VR button (and the VR controls) when a headset can be used.
     * @param {boolean} available
     */
    setVR(available) {
        if (!available && document.activeElement === this.vrButton) this.startButton.focus({ preventScroll: true });
        this.vrButton.hidden = !available;
        if (available) document.documentElement.dataset.vr = '';
        else delete document.documentElement.dataset.vr;
    }

    /**
     * Names the buttons on the controls page after the controller's own (Cross rather than A, and so on).
     * @param {import('../input/Gamepad.js').ButtonLabels} labels
     */
    showButtonNames(labels) {
        for (const key of this.controlsPanel.querySelectorAll('[data-pad]')) key.textContent = labels[key.getAttribute('data-pad')];
    }

    /**
     * Moves around the menu with a controller.
     * @param {'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'previous' | 'next'} action
     */
    navigate(action) {
        if (this.state !== 'title' && this.state !== 'paused' && this.state !== 'ended') return;
        if (this.view === 'settings') {
            this.settingsMenu?.press(SETTINGS_KEYS[action]);
        } else if (this.view === 'controls') {
            if (action === 'up' || action === 'down') {
                this.controlsPanel.querySelector('.panel-scroll')?.scrollBy({ top: action === 'up' ? -CONTROLS_SCROLL : CONTROLS_SCROLL });
            } else if (action === 'confirm' || action === 'back') {
                this.showView('main');
            }
        } else if (action === 'back') {
            this._hideInstallOffer();
        } else {
            // The buttons in the order they're laid out: the mode, Start, the links under it, then the
            // install offer (or, once a tape has ended, its buttons).
            const buttons = [...this.root.querySelectorAll('.menu-center button')]
                .filter((button) => button.getClientRects().length > 0 && !button.closest('.install-offer:not(.visible)'));
            const focused = /** @type {HTMLButtonElement} */ (document.activeElement);
            const index = buttons.indexOf(focused);
            const first = this.state === 'ended' ? buttons[0] : this.startButton;
            if (action === 'confirm') {
                const target = index < 0 ? first : focused;
                if (target === this.startButton) this.dispatchEvent(new CustomEvent('start', { detail: { controller: true } }));
                else if (target?.dataset.action === 'retry' || target?.dataset.action === 'new-run') {
                    // Starting again from a controller: the mouse isn't needed (and can't be captured from here).
                    this.dispatchEvent(new CustomEvent(target.dataset.action, { detail: { controller: true } }));
                } else target?.click();
            } else if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
                const step = action === 'up' || action === 'left' ? -1 : 1;
                const next = index < 0 ? first : buttons[Math.min(Math.max(index + step, 0), buttons.length - 1)];
                next?.focus({ preventScroll: true });
            }
        }
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

    _updateStartLabel() {
        const action = this.state === 'paused' ? 'Resume' : 'Start';
        if (this.controller) this.startButton.textContent = `Press ${this.controller.a} to ${action}`;
        else this.startButton.textContent = `${this.touch ? 'Tap' : 'Click'} to ${action}`;
    }

    _install() {
        const prompt = this.installPrompt;
        // A prompt can only be shown once; the browser offers a new one on a later visit if this one is dismissed.
        this._hideInstall();
        prompt?.prompt().catch(() => {});
    }

    _hideInstall() {
        this.installPrompt = null;
        if (document.activeElement === this.installLink) this.startButton.focus({ preventScroll: true });
        this.installLink.hidden = true;
        this._hideInstallOffer();
    }

    /** Shows the install box, unless there's nothing to install or it's been offered before (on any visit). */
    _offerInstall() {
        if (!this.installPrompt || this.installOffer.classList.contains('visible')) return;
        try {
            if (localStorage.getItem(INSTALL_OFFERED_KEY)) return;
            localStorage.setItem(INSTALL_OFFERED_KEY, '1');
        } catch {
            // Without storage it would come back on every visit, so leave it to the pause menu's link.
            return;
        }
        this.installOffer.classList.add('visible');
    }

    /** Once it's gone it stays gone; the pause menu's Install link is still there. */
    _hideInstallOffer() {
        if (!this.installOffer.classList.contains('visible')) return;
        if (this.installOffer.contains(document.activeElement)) this.startButton.focus({ preventScroll: true });
        this.installOffer.classList.remove('visible');
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
