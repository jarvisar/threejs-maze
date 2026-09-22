/** In-game overlays: camcorder OSD, chunk coordinates, edit-mode crosshair and the stats readout. */
export class Hud {
    constructor() {
        this.osd = /** @type {HTMLElement} */ (document.getElementById('osd'));
        this.osdLabel = /** @type {HTMLElement} */ (this.osd.querySelector('.osd-label'));
        this.osdTime = /** @type {HTMLElement} */ (document.getElementById('osd-time'));
        this.coordinates = /** @type {HTMLElement} */ (document.getElementById('coordinates'));
        this.crosshair = /** @type {HTMLElement} */ (document.getElementById('crosshair'));
        this.debug = /** @type {HTMLElement} */ (document.getElementById('debug'));

        this._osdEnabled = true;
        this._inGame = false;
        this._lastSecond = -1;
        this._lastCoordinates = '';
    }

    /** Whether the game has started (the OSD is only shown once there's something to "record"). */
    setInGame(inGame) {
        this._inGame = inGame;
        this.osd.hidden = !(this._osdEnabled && inGame);
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

    setStats(text) {
        this.debug.textContent = text;
    }
}
