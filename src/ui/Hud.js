const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const ZOOM_TICKS = 16;
const ZOOM_SHOWN_MS = 1400;
// The battery loses a bar every 20 minutes of play, down to one bar that blinks.
const BATTERY_BAR_SECONDS = 20 * 60;

/** Camcorder-style date stamp: "SEP.22 2026" and "PM 3:04". */
export function formatDateStamp(date = new Date()) {
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return {
        date: `${MONTHS[date.getMonth()]}.${String(date.getDate()).padStart(2, ' ')} ${date.getFullYear()}`,
        time: `${hours < 12 ? 'AM' : 'PM'} ${hours % 12 || 12}:${minutes}`,
    };
}

/** In-game overlays: camcorder OSD, chunk coordinates, edit-mode crosshair and the stats readout. */
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
        this.debug = /** @type {HTMLElement} */ (document.getElementById('debug'));
        // Found Footage
        this.notes = /** @type {HTMLElement} */ (document.getElementById('osd-notes'));
        this.notesCount = /** @type {HTMLElement} */ (document.getElementById('osd-notes-count'));
        this.stamina = /** @type {HTMLElement} */ (document.getElementById('osd-stamina'));
        this.staminaFill = /** @type {HTMLElement} */ (document.getElementById('osd-stamina-fill'));
        this.noteView = /** @type {HTMLElement} */ (document.getElementById('note-view'));
        this.noteImage = /** @type {HTMLImageElement} */ (document.getElementById('note-image'));
        this.fade = /** @type {HTMLElement} */ (document.getElementById('fade'));
        this.title = /** @type {HTMLElement} */ (document.getElementById('osd-title'));
        this._titleTimer = 0;
        this._noteTimer = 0;
        // What the fade and the title are doing, for VR, which can't see the page (see VR.fade and VR.title).
        this.fading = false;
        /** @type {'black' | 'white'} */
        this.fadeColor = 'black';
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
    }

    /** Whether the game has started (the OSD is only shown once there's something to "record"). */
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

    /** @param {number} seconds Time spent playing (not paused). */
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
     * The edit-mode tool strip; pass null to hide it. The unnamed section's tools (what's built) are always shown;
     * the named ones (each level's things to put down) by name, and the one with the current tool opened out
     * underneath.
     * @param {readonly { name: string | null, tools: readonly string[] }[] | null} sections
     * @param {string} [current]
     */
    setTools(sections, current) {
        this.tools.hidden = sections === null;
        if (!sections) return;
        const items = (tools) => tools.map((tool) => `<span class="${tool === current ? 'on' : ''}">${tool}</span>`).join('');
        const open = sections.find(({ name, tools }) => name !== null && tools.includes(current));
        const built = sections.filter(({ name }) => name === null).map(({ tools }) => `<div class="osd-tool-group">${items(tools)}</div>`);
        const names = sections.filter(({ name }) => name !== null)
            .map((section) => `<span class="osd-tool-section${section === open ? ' open' : ''}">${section.name}</span>`).join('');
        this.tools.innerHTML = `<div class="osd-tool-row">${built.join('')}<div class="osd-tool-group">${names}</div></div>`
            + (open ? `<div class="osd-tool-group osd-tool-open">${items(open.tools)}</div>` : '');
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

    /** Shows or hides the mode's own readouts (the notes counter and the stamina bar). */
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
     * @param {boolean} exhausted Spent: no sprinting until it's back up.
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

    /** Holds a note up to the camera for a moment. @param {string} image A data URL. */
    showNote(image) {
        this.noteImage.src = image;
        this.noteView.classList.add('visible');
        clearTimeout(this._noteTimer);
        this._noteTimer = setTimeout(() => this.noteView.classList.remove('visible'), 2600);
    }

    hideNote() {
        clearTimeout(this._noteTimer);
        this.noteView.classList.remove('visible');
    }

    /**
     * The picture going to black, or white (the way out of a tape), and coming back.
     * @param {boolean} on
     * @param {'black' | 'white'} [color] Which, going out (coming back is from whichever it went to).
     */
    setFade(on, color = 'black') {
        if (on) {
            this.fade.classList.toggle('white', color === 'white');
            this.fadeColor = color;
        }
        this.fade.classList.toggle('on', on);
        this.fading = on;
    }

    /**
     * Words over the middle of the picture for a few seconds, the way a camcorder puts a title on a recording.
     * @param {string} text
     * @param {number} [ms]
     */
    showTitle(text, ms = 3800) {
        this.title.textContent = text;
        this.title.classList.remove('visible');
        // Restart the animation even if a title is up already.
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
