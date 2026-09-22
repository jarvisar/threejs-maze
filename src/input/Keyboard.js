/** Tracks which keys are held, by physical key code (so WASD works on any keyboard layout). */
export class Keyboard {
    constructor() {
        /** @type {Set<string>} */
        this.held = new Set();
        window.addEventListener('keydown', (event) => this.held.add(event.code));
        window.addEventListener('keyup', (event) => this.held.delete(event.code));
        // Keyups are lost when focus leaves the page, which would leave keys "stuck".
        window.addEventListener('blur', () => this.clear());
    }

    /** Whether any of the given key codes is held. */
    isDown(...codes) {
        for (const code of codes) if (this.held.has(code)) return true;
        return false;
    }

    /** -1, 0 or 1 from a pair of opposing keys. */
    axis(negative, positive) {
        return (this.isDown(...positive) ? 1 : 0) - (this.isDown(...negative) ? 1 : 0);
    }

    clear() {
        this.held.clear();
    }
}
