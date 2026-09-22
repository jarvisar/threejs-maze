/** Tips shown during the first minutes of play; each is skipped if you've already found that feature. */
const HINTS = [
    { at: 4, id: 'flashlight', text: 'Press "F" to toggle the flashlight.' },
    { at: 16, id: 'lights', text: 'Press "2" or "G" to toggle dynamic lights.' },
    { at: 28, id: 'sprint', text: 'Hold "Shift" to sprint.' },
    { at: 42, id: 'zoom', text: 'Scroll to zoom the camera.' },
    { at: 56, id: 'effects', text: 'Press "1" to toggle all shader effects.' },
    { at: 72, id: 'edit', text: 'Press "X" to toggle edit mode.' },
    { at: 90, id: 'photo', text: 'Press "P" to save a still.' },
    { at: 110, id: 'pause', text: 'Press "Esc" to pause and change settings.' },
];

// The timed hints are all about keys; touch screens get this instead.
const TOUCH_HINTS = [
    { at: 1, id: 'move', text: 'Left thumb to walk, drag on the right to look.\nPush the stick all the way to run.' },
];

export class Hints {
    /** @param {import('./Toast.js').Toast} toast */
    constructor(toast) {
        this.toast = toast;
        this.hints = HINTS;
        this.used = new Set();
        this.shown = new Set();
        this.next = 0;
        /** Hints that wait for the right moment rather than a time. */
        this.situations = {
            dark: 'The lights are out here.\nPress "F" for the flashlight.',
            edits: 'Your changes to this world are saved in this browser.',
        };
    }

    touchOnly() {
        this.hints = TOUCH_HINTS;
        this.situations.dark = 'The lights are out here.\nTap "Light" for the flashlight.';
    }

    /** Records that the player used a feature, so its hint isn't needed. */
    markUsed(id) {
        this.used.add(id);
    }

    /** @param {number} playTime Seconds of play so far. */
    update(playTime) {
        while (this.next < this.hints.length && playTime >= this.hints[this.next].at) {
            const hint = this.hints[this.next++];
            if (!this.used.has(hint.id)) this.toast.show(hint.text, hint.text.includes('\n') ? 5000 : 2500);
        }
    }

    /**
     * Shows a situational hint once, unless the feature it points to is already in use.
     * @param {'dark' | 'edits'} id
     * @param {boolean} featureActive e.g. whether the flashlight is on right now
     */
    situation(id, featureActive) {
        if (this.shown.has(id) || featureActive) return;
        this.shown.add(id);
        this.toast.flash(this.situations[id], 3500);
    }
}
