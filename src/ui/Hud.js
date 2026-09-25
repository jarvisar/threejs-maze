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
        this._noteTimer = 0;
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
     * The edit-mode tool strip; pass null to hide it.
     * @param {readonly (readonly string[])[] | null} groups The tools, in groups shown apart (what's built, and
     *     what's put down).
     * @param {string} [current]
     */
    setTools(groups, current) {
        this.tools.hidden = groups === null;
        if (!groups) return;
        this.tools.innerHTML = groups.map((tools) => {
            const items = tools.map((tool) => `<span class="${tool === current ? 'on' : ''}">${tool}</span>`).join('');
            return `<div class="osd-tool-group">${items}</div>`;
        }).join('');
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

    /** The picture going to black (the way out). */
    setFade(on) {
        this.fade.classList.toggle('on', on);
    }

    setStats(text) {
        this.debug.textContent = text;
    }
}
