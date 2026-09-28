/**
 * Timed tips for the first minutes of play (`at` is seconds). Skipped if the player already used the feature.
 * `pad` gives controller wording from its button names, `vr` gives VR wording. Tips without one aren't shown there.
 */
const HINTS = [
    { at: 4, id: 'flashlight', text: 'Press "F" to toggle the flashlight.', pad: (b) => `Press "${b.x}" to toggle the flashlight.`, vr: 'Press "A" or "X" to turn on the flashlight in that hand.' },
    { at: 16, id: 'lights', text: 'Press "2" or "G" to toggle dynamic lights.' },
    { at: 28, id: 'sprint', text: 'Hold "Shift" to sprint.', pad: () => 'Click the left stick to sprint.', vr: 'Click the left stick to sprint.' },
    { at: 42, id: 'zoom', text: 'Scroll to zoom the camera.', pad: (b) => `Hold "${b.rt}" or "${b.lt}" to zoom the camera.` },
    { at: 56, id: 'effects', text: 'Press "1" to toggle all shader effects.' },
    { at: 72, id: 'edit', text: 'Press "X" to toggle edit mode.', pad: (b) => `Press "${b.y}" to toggle edit mode.`, vr: 'Press "B" or "Y" to toggle edit mode.' },
    { at: 90, id: 'photo', text: 'Press "P" to save a still.', pad: (b) => `Press "${b.view}" to save a still.` },
    { at: 110, id: 'pause', text: 'Press "Esc" to pause and change settings.', pad: (b) => `Press "${b.menu}" to pause and change settings.` },
];

// Found Footage only needs flashlight and sprint.
const FOOTAGE_HINTS = [
    HINTS[0],
    { ...HINTS[2], at: 24 },
];

// Timed hints are all about keys, so touch gets this instead.
const TOUCH_HINTS = [
    { at: 1, id: 'move', text: 'Left thumb to walk, drag on the right to look.\nPush the stick all the way to run.' },
];

const EDITS_SAVED = 'Your changes to this world are saved in this browser.';

export class Hints {
    /** @param {import('./Toast.js').Toast} toast */
    constructor(toast) {
        this.toast = toast;
        this.hints = HINTS;
        this.touch = false;
        this.used = new Set();
        this.shown = new Set();
        this.next = 0;
        /** @type {import('../input/Gamepad.js').ButtonLabels | null} Button names when a controller is in use. */
        this.controller = null;
        this.vr = false;
        /** Hints shown when something happens (see situation()). */
        this.situations = {
            dark: {
                text: 'The lights are out here.\nPress "F" for the flashlight.',
                pad: (b) => `The lights are out here.\nPress "${b.x}" for the flashlight.`,
                vr: 'The lights are out here.\nPress "A" or "X" for the flashlight.',
            },
            edits: { text: EDITS_SAVED, pad: () => EDITS_SAVED, vr: EDITS_SAVED },
        };
    }

    touchOnly() {
        this.touch = true;
        this.hints = TOUCH_HINTS;
        this.situations.dark.text = 'The lights are out here.\nTap "Light" for the flashlight.';
    }

    /**
     * Switches to the mode's hint list, continuing from playTime.
     * @param {'explore' | 'footage'} mode
     * @param {number} playTime
     */
    setMode(mode, playTime) {
        if (this.touch) return;
        this.hints = mode === 'footage' ? FOOTAGE_HINTS : HINTS;
        this.next = this.hints.findIndex((hint) => hint.at > playTime);
        if (this.next < 0) this.next = this.hints.length;
    }

    /** @param {import('../input/Gamepad.js').ButtonLabels | null} labels Button names, or null for keyboard or touch. */
    setController(labels) {
        this.controller = labels;
    }

    /** @param {boolean} vr Use VR controller wording. */
    setVR(vr) {
        this.vr = vr;
    }

    /** Player used this feature, so skip its hint. */
    markUsed(id) {
        this.used.add(id);
    }

    /** @param {number} playTime Seconds of play so far. */
    update(playTime) {
        while (this.next < this.hints.length && playTime >= this.hints[this.next].at) {
            const hint = this.hints[this.next++];
            const text = this._text(hint);
            if (text && !this.used.has(hint.id)) this.toast.show(text, text.includes('\n') ? 5000 : 2500);
        }
    }

    /**
     * Shows a situational hint once, unless the feature is already in use.
     * @param {'dark' | 'edits'} id
     * @param {boolean} featureActive e.g. flashlight is on
     */
    situation(id, featureActive) {
        if (this.shown.has(id) || featureActive) return;
        this.shown.add(id);
        this.toast.flash(this._text(this.situations[id]), 3500);
    }

    /** @param {{ text: string, pad?: (labels: import('../input/Gamepad.js').ButtonLabels) => string, vr?: string }} hint */
    _text(hint) {
        if (this.vr) return hint.vr ?? null;
        if (!this.controller) return hint.text;
        return hint.pad?.(this.controller) ?? null;
    }
}
