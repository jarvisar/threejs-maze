/** Tips shown during the first minute of play; each is skipped if you've already found that feature. */
const HINTS = [
    { at: 3, id: 'flashlight', text: 'Press "F" to toggle the flashlight.' },
    { at: 15, id: 'effects', text: 'Press "1" to toggle all shader effects.' },
    { at: 22.5, id: 'lights', text: 'Press "2" or "G" to toggle dynamic lights.' },
    { at: 30, id: 'sprint', text: 'Hold "Shift" to sprint.' },
    { at: 45, id: 'edit', text: 'Press "X" to toggle edit mode.' },
    { at: 60, id: 'pause', text: 'Press "Esc" to pause and change settings.' },
];

export class Hints {
    /** @param {import('./Toast.js').Toast} toast */
    constructor(toast) {
        this.toast = toast;
        this.used = new Set();
        this.next = 0;
    }

    /** Records that the player used a feature, so its hint isn't needed. */
    markUsed(id) {
        this.used.add(id);
    }

    /** @param {number} playTime Seconds of play so far. */
    update(playTime) {
        while (this.next < HINTS.length && playTime >= HINTS[this.next].at) {
            const hint = HINTS[this.next++];
            if (!this.used.has(hint.id)) this.toast.show(hint.text);
        }
    }
}
