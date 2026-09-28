const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const ZOOM_TICKS = 16;
const ZOOM_SHOWN_MS = 1400;
// Tool strip shows this many around the current tool. The rest are in the catalogue.
const TOOLS_SHOWN = 7;
// How long an edit note (UNDONE, COPIED) stays under the crosshair.
const EDIT_NOTE_MS = 1100;
// Battery drops a bar every 20 min of play, down to one blinking bar.
const BATTERY_BAR_SECONDS = 20 * 60;

/** Camcorder date stamp: "SEP.22 2026" and "PM 3:04". */
export function formatDateStamp(date = new Date()) {
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return {
        date: `${MONTHS[date.getMonth()]}.${String(date.getDate()).padStart(2, ' ')} ${date.getFullYear()}`,
        time: `${hours < 12 ? 'AM' : 'PM'} ${hours % 12 || 12}:${minutes}`,
    };
}

/** In-game overlays: camcorder OSD, chunk coordinates, edit mode crosshair and help, stats readout. */
export class Hud {
    constructor() {
        this.osd = /** @type {HTMLElement} */ (document.getElementById('osd'));
        this.osdLabel = /** @type {HTMLElement} */ (this.osd.querySelector('.osd-label'));
        this.osdTime = /** @type {HTMLElement} */ (document.getElementById('osd-time'));
        this.osdDate = /** @type {HTMLElement} */ (document.getElementById('osd-date'));
        this.battery = /** @type {HTMLElement} */ (document.getElementById('osd-battery'));
        this.zoom = /** @type {HTMLElement} */ (document.getElementById('osd-zoom'));
        this.zoomBar = /** @type {HTMLElement} */ (document.getElementById('osd-zoom-bar'));
        this.tools = /** @type {HTMLElement} */ (document.getElementById('osd-tools'));
        this.coordinates = /** @type {HTMLElement} */ (document.getElementById('coordinates'));
        this.crosshair = /** @type {HTMLElement} */ (document.getElementById('crosshair'));
        this.editLabel = /** @type {HTMLElement} */ (document.getElementById('edit-label'));
        this.editHelp = /** @type {HTMLElement} */ (document.getElementById('edit-help'));
        this.debug = /** @type {HTMLElement} */ (document.getElementById('debug'));
        // Found Footage
        this.notes = /** @type {HTMLElement} */ (document.getElementById('osd-notes'));
        this.notesCount = /** @type {HTMLElement} */ (document.getElementById('osd-notes-count'));
        this.stamina = /** @type {HTMLElement} */ (document.getElementById('osd-stamina'));
        this.staminaFill = /** @type {HTMLElement} */ (document.getElementById('osd-stamina-fill'));
        this.noteView = /** @type {HTMLElement} */ (document.getElementById('note-view'));
        this.noteImage = /** @type {HTMLCanvasElement} */ (document.getElementById('note-image'));
        this.fade = /** @type {HTMLElement} */ (document.getElementById('fade'));
        this.title = /** @type {HTMLElement} */ (document.getElementById('osd-title'));
        this._titleTimer = 0;
        this._noteTimer = 0;
        // Fade and title state for VR, which can't see the page (see VR.fade and VR.title).
        this.fading = false;
        /** @type {'black' | 'white'} */
        this.fadeColor = 'black';
        this._hold = false;
        /** @type {string | null} */
        this.titleText = null;
        this._staminaShown = -1;

        this.zoomBar.innerHTML = '<i></i>'.repeat(ZOOM_TICKS);
        this._zoomTicks = [...this.zoomBar.children];

        this._osdEnabled = true;
        this._inGame = false;
        this._lastSecond = -1;
        this._lastCoordinates = '';
        this._lastDate = '';
        this._batteryBars = -1;
        this._zoomTimer = 0;
        this._zoomLevel = -1;
        this._editLabel = '';
        this._editNote = '';
        this._editNoteTimer = 0;
    }

    /** The OSD only shows once the game has started. */
    setInGame(inGame) {
        this._inGame = inGame;
        this.osd.hidden = !(this._osdEnabled && inGame);
        if (inGame) this._updateDate();
    }

    setOsdEnabled(enabled) {
        this._osdEnabled = enabled;
        this.setInGame(this._inGame);
    }

    /** @param {'rec' | 'pause' | 'edit'} mode */
    setOsdMode(mode) {
        this.osd.dataset.mode = mode;
        this.osdLabel.textContent = mode === 'pause' ? 'PAUSE' : mode === 'edit' ? 'EDIT' : 'REC';
    }

    /** @param {number} seconds Play time, not counting pauses. */
    setPlayTime(seconds) {
        const whole = Math.floor(seconds);
        if (whole === this._lastSecond) return;
        this._lastSecond = whole;
        const h = Math.floor(whole / 3600);
        const m = Math.floor(whole / 60) % 60;
        const s = whole % 60;
        this.osdTime.textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

        const bars = Math.max(4 - Math.floor(seconds / BATTERY_BAR_SECONDS), 1);
        if (bars !== this._batteryBars) {
            this._batteryBars = bars;
            this.battery.dataset.bars = String(bars);
        }
        this._updateDate();
    }

    _updateDate() {
        const { date, time } = formatDateStamp();
        const text = `${time}\n${date}`;
        if (text === this._lastDate) return;
        this._lastDate = text;
        this.osdDate.textContent = text;
    }

    /**
     * Shows the W–T zoom bar for a moment.
     * @param {number} fraction 0 (wide) .. 1 (fully zoomed in)
     */
    showZoom(fraction) {
        const level = Math.round(fraction * ZOOM_TICKS);
        if (level !== this._zoomLevel) {
            this._zoomLevel = level;
            this._zoomTicks.forEach((tick, i) => tick.classList.toggle('on', i < level));
        }
        this.zoom.classList.add('visible');
        clearTimeout(this._zoomTimer);
        this._zoomTimer = setTimeout(() => this.zoom.classList.remove('visible'), ZOOM_SHOWN_MS);
    }

    hideZoom() {
        clearTimeout(this._zoomTimer);
        this.zoom.classList.remove('visible');
    }

    /**
     * Edit mode tool strip, null hides it. The unnamed section (built pieces) always shows. Named sections (each
     * level's props) collapse under "Levels" until the current tool is in one. Then that level's name shows with up
     * to TOOLS_SHOWN of its tools around the current one, and a marker at either end if there are more.
     * @param {readonly { name: string | null, tools: readonly string[] }[] | null} sections
     * @param {string} [current]
     */
    setTools(sections, current) {
        this.tools.hidden = sections === null;
        if (!sections) return;
        const items = (tools) => tools.map((tool) => `<span class="${tool === current ? 'on' : ''}">${tool}</span>`).join('');
        const open = sections.find(({ name, tools }) => name !== null && tools.includes(current));
        const built = sections.filter(({ name }) => name === null).map(({ tools }) => `<div class="osd-tool-group">${items(tools)}</div>`);
        const levels = sections.some(({ name }) => name !== null)
            ? `<div class="osd-tool-group"><span class="osd-tool-section${open ? ' open' : ''}">${open ? open.name : 'Levels'}</span></div>`
            : '';
        let row = '';
        if (open) {
            const at = open.tools.indexOf(/** @type {string} */ (current));
            const first = Math.min(Math.max(at - Math.floor(TOOLS_SHOWN / 2), 0), Math.max(open.tools.length - TOOLS_SHOWN, 0));
            const shown = open.tools.slice(first, first + TOOLS_SHOWN);
            const more = (side, hidden) => `<i class="osd-tool-more ${side}"${hidden ? ' hidden' : ''} aria-hidden="true"></i>`;
            row = `<div class="osd-tool-group osd-tool-open">${more('before', first === 0)}${items(shown)}${more('after', first + TOOLS_SHOWN >= open.tools.length)}</div>`;
        }
        this.tools.innerHTML = `<div class="osd-tool-row">${built.join('')}${levels}</div>${row}`;
    }

    /**
     * Label under the edit crosshair: what build and remove will do to the target (with button names), or why
     * nothing can be done. Null hides it.
     * @param {{ build: string | null, remove: string | null, note: string | null } | null} actions
     * @param {{ build: string, remove: string }} [buttons]
     */
    setEditLabel(actions, buttons = { build: 'RMB', remove: 'LMB' }) {
        const note = this._editNote || actions?.note || '';
        const key = actions ? `${actions.build}|${actions.remove}|${note}|${buttons.build}|${buttons.remove}` : '';
        if (key === this._editLabel) return;
        this._editLabel = key;
        this.editLabel.hidden = actions === null;
        if (!actions) return;
        const line = (button, text) => (text ? `<p class="edit-action"><kbd>${button}</kbd>${text}</p>` : '');
        this.editLabel.innerHTML = line(buttons.build, actions.build) + line(buttons.remove, actions.remove) + (note ? `<p class="edit-note">${note}</p>` : '');
    }

    /** Briefly shows a note under the edit crosshair (UNDONE, COPIED). */
    flashEditNote(text) {
        this._editNote = text;
        this._editLabel = '';
        clearTimeout(this._editNoteTimer);
        this._editNoteTimer = setTimeout(() => {
            this._editNote = '';
            this._editLabel = '';
        }, EDIT_NOTE_MS);
    }

    /**
     * Edit mode key list under the timer (see Game). When collapsed it's just the key that expands it. Null hides it.
     * @param {[string, string][] | null} keys
     */
    setEditHelp(keys) {
        this.editHelp.hidden = keys === null;
        if (!keys) return;
        this.editHelp.innerHTML = keys.map(([key, text]) => `<p><kbd>${key}</kbd>${text}</p>`).join('');
    }

    setCoordinates(cx, cz) {
        const text = `(${cx},${cz})`;
        if (text === this._lastCoordinates) return;
        this._lastCoordinates = text;
        this.coordinates.textContent = text;
    }

    setCrosshair(visible) {
        this.crosshair.hidden = !visible;
    }

    setStatsVisible(visible) {
        this.debug.hidden = !visible;
    }

    // ------------------------------------------------------------------ Found Footage

    /** Found Footage readouts (notes counter, stamina bar). */
    setFootage(active) {
        this.notes.hidden = !active;
        this.stamina.hidden = !active;
        if (!active) this.hideNote();
    }

    setNotes(found, total) {
        this.notesCount.textContent = `${found}/${total}`;
    }

    /**
     * @param {number} level 0..1
     * @param {boolean} exhausted Can't sprint until it refills.
     */
    setStamina(level, exhausted) {
        const shown = Math.round(level * 40);
        if (shown !== this._staminaShown) {
            this._staminaShown = shown;
            this.staminaFill.style.transform = `scaleX(${shown / 40})`;
            this.stamina.setAttribute('aria-valuenow', String(Math.round(level * 100)));
        }
        this.stamina.classList.toggle('spent', exhausted);
        this.stamina.classList.toggle('full', level >= 0.999);
    }

    /**
     * Shows a note briefly.
     * @param {import('../footage/noteTextures.js').NotePicture} note
     */
    showNote({ image, x, y, width, height }) {
        const canvas = this.noteImage;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
        g.clearRect(0, 0, width, height);
        g.drawImage(image, x, y, width, height, 0, 0, width, height);
        this.noteView.classList.add('visible');
        clearTimeout(this._noteTimer);
        this._noteTimer = setTimeout(() => this.noteView.classList.remove('visible'), 2600);
    }

    hideNote() {
        clearTimeout(this._noteTimer);
        this.noteView.classList.remove('visible');
    }

    /**
     * Fades the picture out to black, or white (tape exit), and back in.
     * @param {boolean} on
     * @param {'black' | 'white'} [color] Only used when fading out.
     */
    setFade(on, color = 'black') {
        if (on) {
            this.fade.classList.toggle('white', color === 'white');
            this.fadeColor = color;
        }
        this.fade.classList.toggle('on', on || this._hold);
        this.fading = on;
    }

    /**
     * Keeps the picture faded out while a new world loads (see Game.settle), whatever setFade does meanwhile.
     * Uses `color` if given, else the color it's already faded to (a tape exit stays white until the next level
     * is ready), else black.
     * @param {boolean} on
     * @param {'black' | 'white' | null} [color]
     */
    setHold(on, color = null) {
        if (on && color) this.fade.classList.toggle('white', color === 'white');
        if (on === this._hold) return;
        if (on && !color && !this.fading) this.fade.classList.remove('white');
        this._hold = on;
        this.fade.classList.toggle('on', on || this.fading);
    }

    /**
     * Camcorder-style title over the middle of the picture for a few seconds.
     * @param {string} text
     * @param {number} [ms]
     */
    showTitle(text, ms = 3800) {
        this.title.textContent = text;
        this.title.classList.remove('visible');
        // Force a reflow so the animation restarts if a title is already up.
        void this.title.offsetWidth;
        this.title.classList.add('visible');
        this.titleText = text;
        clearTimeout(this._titleTimer);
        this._titleTimer = setTimeout(() => this.hideTitle(), ms);
    }

    hideTitle() {
        clearTimeout(this._titleTimer);
        this.title.classList.remove('visible');
        this.titleText = null;
    }

    setStats(text) {
        this.debug.textContent = text;
    }
}
