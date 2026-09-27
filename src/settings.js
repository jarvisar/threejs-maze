const STORAGE_KEY = 'backrooms-simulator:settings:v1';
// Goes up when a default changes in a way that settings saved before it should pick up (see loadSettings).
const SETTINGS_VERSION = 5;

/** Every user-adjustable setting and its default. Saved to localStorage whenever something changes. */
export const DEFAULT_SETTINGS = Object.freeze({
    version: SETTINGS_VERSION,
    graphics: {
        resolutionScale: 50, // % of the device's pixel ratio; the soft low-res look is part of the style
        // Shade in corners and under things (see fx/AmbientOcclusion.js). It costs a few passes, so it goes off by
        // itself if the frame rate can't keep up with it (see Game.js).
        ambientOcclusion: true,
        dynamicLights: true, // switched off during play if the frame rate can't keep up with them (see Game.js)
        fpsLimit: 60, // 0 = no limit (follow the display's refresh rate), the default with a dedicated graphics card (see applyDeviceDefaults)
        camcorderOverlay: true,
        minimap: true,
        showStats: false,
    },
    gameplay: {
        movementSpeed: 1,
        mouseSensitivity: 1,
        invertY: false,
        stickSensitivity: 1, // looking around with a controller's right stick
        invertStickY: false,
        fieldOfView: 70,
        headBob: true,
    },
    vr: {
        snapTurn: 30, // degrees per flick of the right stick; 0 turns smoothly instead
    },
    world: {
        mode: 'footage', // what the title screen starts: 'footage' (Found Footage) or 'explore' (the endless level)
        level: 0, // which level Explore is on (see world/levels.js)
        fun: false, // Explore's on Level Fun instead, once it's been found (see unlocks.js)
        powerCuts: true, // now and then the lights go out for a few seconds
    },
    audio: {
        volume: 50,
        muted: false,
        footsteps: true,
        ambience: true, // distant noises and buzzing lights
    },
    effects: {
        enabled: true,
        static: { enabled: true, amount: 0.04, size: 4 },
        rgbShift: { enabled: true, amount: 0.001, angle: 0 },
        film: { enabled: true, grayscale: false, noise: 0.1, scanlines: 0.8, scanlineCount: 375 },
        badTV: { enabled: true, distortion: 0.15, distortion2: 0.3, speed: 0.005, rollSpeed: 0 },
        vignette: { enabled: true, offset: 0.81, darkness: 1 },
        bloom: { enabled: false, threshold: 0.9, strength: 0.4, radius: 0.5 },
    },
});

/** @typedef {typeof DEFAULT_SETTINGS} Settings */

/**
 * @returns {Settings} Saved settings merged over the defaults (unknown or mistyped values are ignored). Those whose
 *     default depends on the device get it from applyDeviceDefaults.
 */
export function loadSettings() {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const saved = readSaved();
    if (saved) {
        mergeKnown(settings, saved);
        // Dynamic lights were off by default before version 2, so older saved settings have them off whether
        // or not anyone chose that. Give them the new default once.
        if (!(saved.version >= 2)) settings.graphics.dynamicLights = true;
        // The same for the mode: Explore was picked by default before version 3.
        if (!(saved.version >= 3)) settings.world.mode = 'footage';
        // And for ambient occlusion, off by default (or on only with a dedicated graphics card) before version 5.
        if (!(saved.version >= 5)) settings.graphics.ambientOcclusion = true;
        settings.version = SETTINGS_VERSION;
    }
    return settings;
}

/**
 * Gives the settings whose default depends on the device (which the game can only tell once it's running) that default,
 * where they haven't been saved since it came in: the FPS limit, none with a dedicated graphics card (see gpu.js), 60
 * without. Before version 5 there was none by default, so a limit someone picked stays.
 * @param {Settings} settings As loaded (see loadSettings).
 * @param {{ fpsLimit: number }} device This device's defaults.
 */
export function applyDeviceDefaults(settings, device) {
    const saved = readSaved();
    if (!(saved?.version >= 5) && !(saved?.graphics?.fpsLimit > 0)) settings.graphics.fpsLimit = device.fpsLimit;
}

/** @returns {Record<string, any> | null} The saved settings, as they were saved. */
function readSaved() {
    try {
        const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null');
        return saved && typeof saved === 'object' ? saved : null;
    } catch {
        // Storage can be unavailable (privacy modes, sandboxed iframes) or hold junk; defaults are fine.
        return null;
    }
}

let saveTimer = 0;
let pending = null;

/** Saves settings shortly after the last change (sliders fire many changes per second). */
export function saveSettings(settings) {
    pending = settings;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSettings, 250);
}

/** Writes any not-yet-saved settings immediately (e.g. when the page is being closed). */
export function flushSettings() {
    clearTimeout(saveTimer);
    if (!pending) return;
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(pending));
    } catch {
        // Not being able to persist settings shouldn't break the game.
    }
    pending = null;
}

/** Resets `settings` to the defaults in place (so existing references stay valid). */
export function resetSettings(settings) {
    mergeKnown(settings, structuredClone(DEFAULT_SETTINGS));
}

function mergeKnown(target, source) {
    for (const key of Object.keys(target)) {
        if (!(key in source)) continue;
        const current = target[key];
        const incoming = source[key];
        if (current && typeof current === 'object') {
            if (incoming && typeof incoming === 'object') mergeKnown(current, incoming);
        } else if (typeof incoming === typeof current && (typeof incoming !== 'number' || Number.isFinite(incoming))) {
            target[key] = incoming;
        }
    }
}
