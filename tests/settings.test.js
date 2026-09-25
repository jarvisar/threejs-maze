import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, flushSettings, loadSettings, resetSettings, saveSettings } from '../src/settings.js';

/** A stand-in for localStorage holding `saved` (as the game stored it) under the settings key. */
function storage(saved) {
    const items = new Map(saved === undefined ? [] : [['backrooms-simulator:settings:v1', JSON.stringify(saved)]]);
    return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
}

describe('settings', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('turns the dynamic lights on for new players', () => {
        vi.stubGlobal('localStorage', storage(undefined));
        expect(loadSettings().graphics.dynamicLights).toBe(true);
    });

    it('gives settings saved before the lights were on by default the new default, and keeps the rest', () => {
        vi.stubGlobal('localStorage', storage({ graphics: { resolutionScale: 30, dynamicLights: false }, audio: { volume: 20 } }));
        const settings = loadSettings();
        expect(settings.graphics.dynamicLights).toBe(true);
        expect(settings.graphics.resolutionScale).toBe(30);
        expect(settings.audio.volume).toBe(20);
        expect(settings.version).toBe(DEFAULT_SETTINGS.version);
    });

    it('keeps the lights off once they have been turned off since', () => {
        const local = storage({ graphics: { dynamicLights: false } });
        vi.stubGlobal('localStorage', local);
        const settings = loadSettings();
        settings.graphics.dynamicLights = false;
        saveSettings(settings);
        flushSettings();
        expect(loadSettings().graphics.dynamicLights).toBe(false);
    });

    it('starts new players on Found Footage', () => {
        vi.stubGlobal('localStorage', storage(undefined));
        expect(loadSettings().world.mode).toBe('footage');
        const settings = loadSettings();
        settings.world.mode = 'explore';
        resetSettings(settings);
        expect(settings.world.mode).toBe('footage');
    });

    it('moves settings saved while Explore was the default over to Found Footage, and keeps the rest', () => {
        vi.stubGlobal('localStorage', storage({ version: 2, graphics: { dynamicLights: false }, world: { mode: 'explore', powerCuts: false } }));
        const settings = loadSettings();
        expect(settings.world.mode).toBe('footage');
        expect(settings.world.powerCuts).toBe(false);
        // Saved after the lights changed, so they stay as they were.
        expect(settings.graphics.dynamicLights).toBe(false);
        expect(settings.version).toBe(DEFAULT_SETTINGS.version);
    });

    it('gives the oldest saved settings both new defaults', () => {
        vi.stubGlobal('localStorage', storage({ graphics: { dynamicLights: false }, world: { mode: 'explore' } }));
        const settings = loadSettings();
        expect(settings.world.mode).toBe('footage');
        expect(settings.graphics.dynamicLights).toBe(true);
    });

    it('keeps Explore once it has been picked since', () => {
        vi.stubGlobal('localStorage', storage({ version: 2, world: { mode: 'explore' } }));
        const settings = loadSettings();
        settings.world.mode = 'explore';
        saveSettings(settings);
        flushSettings();
        expect(loadSettings().world.mode).toBe('explore');
    });
});
