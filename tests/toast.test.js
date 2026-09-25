import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '../src/ui/Toast.js';

const ASKING = 'Click or press a key to go full screen.';

function toast() {
    const classes = new Set();
    const element = { textContent: '', classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
    return { toast: new Toast(/** @type {any} */ (element)), element, visible: () => classes.has('visible') };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('Toast.dismiss', () => {
    it('takes down the message it names, and nothing else', () => {
        const { toast: t, element, visible } = toast();
        t.flash(ASKING, 6000);
        t.dismiss('Still saved.');
        expect(visible()).toBe(true);
        t.dismiss(ASKING);
        expect(visible()).toBe(false);
        expect(element.textContent).toBe(ASKING); // fading out
    });

    it('carries on with the hint it interrupted', () => {
        const { toast: t, element, visible } = toast();
        t.show('Hold "Shift" to sprint.');
        t.flash(ASKING, 6000);
        t.dismiss(ASKING);
        vi.advanceTimersByTime(500);
        expect(visible()).toBe(true);
        expect(element.textContent).toBe('Hold "Shift" to sprint.');
    });
});
