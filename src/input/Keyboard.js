/** Held keys by physical key code, so WASD works on any keyboard layout. */
export class Keyboard {
    constructor() {
        /** @type {Set<string>} */
        this.held = new Set();
        window.addEventListener('keydown', (event) => this.held.add(event.code));
        window.addEventListener('keyup', (event) => this.held.delete(event.code));
        // Keyups get lost when the page loses focus, which would leave keys stuck.
        window.addEventListener('blur', () => this.clear());
    }

    isDown(...codes) {
        for (const code of codes) if (this.held.has(code)) return true;
        return false;
    }

    /** -1, 0 or 1 from two opposing key sets. */
    axis(negative, positive) {
        return (this.isDown(...positive) ? 1 : 0) - (this.isDown(...negative) ? 1 : 0);
    }

    clear() {
        this.held.clear();
    }
}
