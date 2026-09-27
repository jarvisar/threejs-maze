import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, applyDeviceDefaults, flushSettings, loadSettings, resetSettings, saveSettings } from '../src/settings.js';

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

    it('turns ambient occlusion on for new players where the graphics card can take it, and nowhere else', () => {
        vi.stubGlobal('localStorage', storage(undefined));
        const strong = loadSettings();
        applyDeviceDefaults(strong, { ambientOcclusion: true });
        expect(strong.graphics.ambientOcclusion).toBe(true);
        const weak = loadSettings();
        applyDeviceDefaults(weak, { ambientOcclusion: false });
        expect(weak.graphics.ambientOcclusion).toBe(false);
    });

    it('gives settings saved before then the device default once, but keeps it on where it was turned on', () => {
        vi.stubGlobal('localStorage', storage({ version: 3, graphics: { resolutionScale: 70, ambientOcclusion: false } }));
        const settings = loadSettings();
        applyDeviceDefaults(settings, { ambientOcclusion: true });
        expect(settings.graphics.ambientOcclusion).toBe(true);
        expect(settings.graphics.resolutionScale).toBe(70);
        expect(settings.version).toBe(DEFAULT_SETTINGS.version);
        vi.stubGlobal('localStorage', storage({ version: 3, graphics: { ambientOcclusion: true } }));
        const chosen = loadSettings();
        applyDeviceDefaults(chosen, { ambientOcclusion: false });
        expect(chosen.graphics.ambientOcclusion).toBe(true);
    });

    it('keeps ambient occlusion as it was saved since, whatever the graphics card', () => {
        vi.stubGlobal('localStorage', storage(undefined));
        const settings = loadSettings();
        applyDeviceDefaults(settings, { ambientOcclusion: true });
        settings.graphics.ambientOcclusion = false;
        saveSettings(settings);
        flushSettings();
        const off = loadSettings();
        applyDeviceDefaults(off, { ambientOcclusion: true });
        expect(off.graphics.ambientOcclusion).toBe(false);
        off.graphics.ambientOcclusion = true;
        saveSettings(off);
        flushSettings();
        const on = loadSettings();
        applyDeviceDefaults(on, { ambientOcclusion: false });
        expect(on.graphics.ambientOcclusion).toBe(true);
        resetSettings(on);
        expect(on.graphics.ambientOcclusion).toBe(false);
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
