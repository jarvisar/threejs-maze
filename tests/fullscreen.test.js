import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Fullscreen, WindowFullscreen } from '../src/ui/Fullscreen.js';

/**
 * A page that goes full screen the way browsers do: only while the player has just clicked or pressed a key
 * (`userActivation.isActive`), which pressing a controller button never counts as.
 */
function fakePage({ enabled = true, userActivation = true } = {}) {
    const activation = { isActive: false };
    const win = Object.assign(new EventTarget(), { navigator: userActivation ? { userActivation: activation } : {} });
    const doc = Object.assign(new EventTarget(), { fullscreenEnabled: enabled, fullscreenElement: null });
    const change = (element) => {
        doc.fullscreenElement = element;
        doc.dispatchEvent(new Event('fullscreenchange'));
    };
    doc.documentElement = {
        requestFullscreen: vi.fn(async () => {
            if (!activation.isActive) throw new TypeError('Permissions check failed');
            // Going full screen uses up the permission.
            activation.isActive = false;
            change(doc.documentElement);
        }),
    };
    doc.exitFullscreen = vi.fn(async () => change(null));
    return {
        win,
        doc,
        activation,
        /** A trusted click or key press: `counts` is false for ones browsers don't take as asking (Escape). */
        gesture(type = 'pointerup', counts = true) {
            if (counts) activation.isActive = true;
            win.dispatchEvent(new Event(type));
        },
    };
}

function events(fullscreen) {
    const seen = [];
    for (const type of ['wait', 'waitend']) fullscreen.addEventListener(type, () => seen.push(type));
    return seen;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('Fullscreen', () => {
    it('goes full screen straight away when the browser allows it, and back out', async () => {
        const page = fakePage();
        const fullscreen = new Fullscreen(page.doc, page.win);
        const seen = events(fullscreen);
        page.activation.isActive = true; // e.g. clicked a moment ago
        expect(await fullscreen.toggle()).toBe('entered');
        expect(fullscreen.active).toBe(true);
        // Leaving doesn't need a click.
        expect(await fullscreen.toggle()).toBe('exited');
        expect(page.doc.exitFullscreen).toHaveBeenCalledOnce();
        expect(fullscreen.active).toBe(false);
        expect(seen).toEqual([]);
    });

    it('says when there is no full screen at all, without asking', async () => {
        // Turned off (e.g. in a frame that isn't allowed it)...
        const off = fakePage({ enabled: false });
        let fullscreen = new Fullscreen(off.doc, off.win);
        expect(fullscreen.available).toBe(false);
        expect(await fullscreen.toggle()).toBe('unavailable');
        expect(off.doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
        expect(fullscreen.waiting).toBe(false);

        // ...or not there at all (e.g. on an iPhone).
        const missing = fakePage();
        delete missing.doc.fullscreenEnabled;
        delete missing.doc.documentElement.requestFullscreen;
        fullscreen = new Fullscreen(missing.doc, missing.win);
        expect(fullscreen.available).toBe(false);
        expect(await fullscreen.toggle()).toBe('unavailable');
        expect(fullscreen.waiting).toBe(false);
    });

    it('waits for the next click when refused, and goes full screen then', async () => {
        const page = fakePage();
        const fullscreen = new Fullscreen(page.doc, page.win);
        const seen = events(fullscreen);
        expect(await fullscreen.toggle()).toBe('waiting');
        expect(page.doc.documentElement.requestFullscreen).toHaveBeenCalledOnce();
        expect(fullscreen.waiting).toBe(true);
        expect(seen).toEqual(['wait']);

        page.gesture('pointerup');
        await vi.advanceTimersByTimeAsync(0);
        expect(fullscreen.active).toBe(true);
        expect(fullscreen.waiting).toBe(false);
        expect(seen).toEqual(['wait', 'waitend']);

        // It's done: later clicks leave full screen alone.
        await fullscreen.toggle();
        page.gesture('pointerup');
        await vi.advanceTimersByTimeAsync(0);
        expect(fullscreen.active).toBe(false);
        expect(page.doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(2);
    });

    it('lets whatever the click does itself go first', async () => {
        const page = fakePage();
        const fullscreen = new Fullscreen(page.doc, page.win);
        await fullscreen.toggle();
        // e.g. capturing the mouse, which needs the permission that going full screen uses up.
        let capturedWith = null;
        page.win.addEventListener('pointerup', () => {
            capturedWith = page.activation.isActive;
        });
        page.gesture('pointerup');
        expect(capturedWith).toBe(true);
        expect(fullscreen.active).toBe(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(fullscreen.active).toBe(true);
    });

    it('takes a key press, but not one that browsers ignore', async () => {
        const page = fakePage();
        const fullscreen = new Fullscreen(page.doc, page.win);
        await fullscreen.toggle();
        page.gesture('keyup', false); // Escape
        await vi.advanceTimersByTimeAsync(0);
        expect(fullscreen.waiting).toBe(true);
        expect(page.doc.documentElement.requestFullscreen).toHaveBeenCalledOnce();

        page.gesture('keyup');
        await vi.advanceTimersByTimeAsync(0);
        expect(fullscreen.active).toBe(true);
    });

    it('keeps trying in browsers that can\'t say whether a click counts', async () => {
        const page = fakePage({ userActivation: false });
        const fullscreen = new Fullscreen(page.doc, page.win);
        await fullscreen.toggle();
        page.win.dispatchEvent(new Event('keyup')); // refused
        await vi.advanceTimersByTimeAsync(0);
        expect(page.doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(2);
        expect(fullscreen.waiting).toBe(true);
        page.gesture('pointerup');
        await vi.advanceTimersByTimeAsync(0);
        expect(fullscreen.active).toBe(true);
    });

    it('asks once for a tap and a key press that come together', async () => {
        const page = fakePage();
        const fullscreen = new Fullscreen(page.doc, page.win);
        await fullscreen.toggle();
        page.gesture('pointerup');
        page.gesture('keyup');
        await vi.advanceTimersByTimeAsync(0);
        expect(page.doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(2);
        expect(fullscreen.active).toBe(true);
    });

    it('stops waiting after a while', async () => {
        const page = fakePage();
        const fullscreen = new Fullscreen(page.doc, page.win);
        const seen = events(fullscreen);
        await fullscreen.toggle();
        await vi.advanceTimersByTimeAsync(fullscreen.waitTime);
        expect(fullscreen.waiting).toBe(false);
        expect(seen).toEqual(['wait', 'waitend']);
        page.gesture('pointerup');
        await vi.advanceTimersByTimeAsync(0);
        expect(fullscreen.active).toBe(false);
    });

    it('waits afresh when pressed again while waiting', async () => {
        const page = fakePage();
        const fullscreen = new Fullscreen(page.doc, page.win);
        const seen = events(fullscreen);
        await fullscreen.toggle();
        await vi.advanceTimersByTimeAsync(fullscreen.waitTime - 1000);
        expect(await fullscreen.toggle()).toBe('waiting');
        await vi.advanceTimersByTimeAsync(2000);
        expect(fullscreen.waiting).toBe(true);
        expect(seen).toEqual(['wait', 'wait']);
    });

    it('stops waiting when cancelled, or when full screen comes some other way', async () => {
        const page = fakePage();
        const fullscreen = new Fullscreen(page.doc, page.win);
        const seen = events(fullscreen);
        await fullscreen.toggle();
        // A click that's about to finish it, then something that shouldn't be finished (entering VR).
        page.gesture('pointerup');
        fullscreen.cancel();
        await vi.advanceTimersByTimeAsync(0);
        expect(fullscreen.active).toBe(false);
        expect(seen).toEqual(['wait', 'waitend']);

        page.activation.isActive = false;
        await fullscreen.toggle();
        // e.g. tapping Start on a touch screen.
        page.activation.isActive = true;
        await page.doc.documentElement.requestFullscreen();
        expect(fullscreen.waiting).toBe(false);
        expect(seen).toEqual(['wait', 'waitend', 'wait', 'waitend']);
    });

    it('ignores presses while the browser is still switching', async () => {
        const page = fakePage();
        const fullscreen = new Fullscreen(page.doc, page.win);
        page.activation.isActive = true;
        const first = fullscreen.toggle();
        const second = fullscreen.toggle();
        expect(await first).toBe('entered');
        expect(await second).toBe('entered');
        expect(page.doc.documentElement.requestFullscreen).toHaveBeenCalledOnce();
        expect(fullscreen.active).toBe(true);
    });
});

describe('WindowFullscreen', () => {
    /** The desktop app's bridge: the window goes full screen when asked, no click needed. */
    function fakeBridge() {
        let fullscreen = false;
        return {
            isFullscreen: () => fullscreen,
            setFullscreen: vi.fn(async (on) => (fullscreen = on)),
        };
    }

    it('puts the window in and out of full screen without waiting for a click', async () => {
        const bridge = fakeBridge();
        const fullscreen = new WindowFullscreen(bridge);
        const seen = events(fullscreen);
        expect(fullscreen.available).toBe(true);
        expect(await fullscreen.toggle()).toBe('entered');
        expect(fullscreen.active).toBe(true);
        expect(await fullscreen.toggle()).toBe('exited');
        expect(fullscreen.active).toBe(false);
        expect(bridge.setFullscreen.mock.calls).toEqual([[true], [false]]);
        expect(seen).toEqual([]);
        expect(fullscreen.waiting).toBe(false);
    });

    it('goes by the window, however it went full screen', async () => {
        const bridge = fakeBridge();
        const fullscreen = new WindowFullscreen(bridge);
        await bridge.setFullscreen(true); // F11, say
        expect(await fullscreen.toggle()).toBe('exited');
    });
});
