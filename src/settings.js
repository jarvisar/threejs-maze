const STORAGE_KEY = 'backrooms-simulator:settings:v1';
// Bump when a default changes and older saved settings should pick up the new one (see loadSettings).
const SETTINGS_VERSION = 5;

/** All user settings with defaults. Saved to localStorage on every change. */
export const DEFAULT_SETTINGS = Object.freeze({
    version: SETTINGS_VERSION,
    graphics: {
        resolutionScale: 50, // % of device pixel ratio. The soft low-res look is part of the style.
        // See fx/AmbientOcclusion.js. Costs a few passes, so Game.js turns it off if fps can't keep up.
        ambientOcclusion: true,
        dynamicLights: true, // turned off during play if fps can't keep up (see Game.js)
        fpsLimit: 60, // 0 = no limit (display refresh rate). Default with a dedicated GPU (see applyDeviceDefaults).
        camcorderOverlay: true,
        minimap: true,
        showStats: false,
    },
    gameplay: {
        movementSpeed: 1,
        mouseSensitivity: 1,
        invertY: false,
        stickSensitivity: 1, // controller right stick look
        invertStickY: false,
        fieldOfView: 70,
        headBob: true,
    },
    vr: {
        snapTurn: 30, // degrees per right stick flick. 0 = smooth turning.
    },
    world: {
        mode: 'footage', // what the title screen starts: 'footage' (Found Footage) or 'explore' (endless level)
        level: 0, // Explore level (see world/levels.js)
        fun: false, // Explore on Level Fun instead, once unlocked (see unlocks.js)
        powerCuts: true, // lights go out for a few seconds now and then
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
 * @returns {Settings} Saved settings merged over the defaults. Unknown or wrongly typed values are ignored.
 *     Device-dependent defaults come later from applyDeviceDefaults.
 */
export function loadSettings() {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const saved = readSaved();
    if (saved) {
        mergeKnown(settings, saved);
        // Dynamic lights defaulted to off before version 2, so old saves have them off whether or not the player
        // chose that. Apply the new default once.
        if (!(saved.version >= 2)) settings.graphics.dynamicLights = true;
        // Same for mode. Explore was the default before version 3.
        if (!(saved.version >= 3)) settings.world.mode = 'footage';
        // Same for AO. Before version 5 it was off by default (on only with a dedicated GPU).
        if (!(saved.version >= 5)) settings.graphics.ambientOcclusion = true;
        settings.version = SETTINGS_VERSION;
    }
    return settings;
}

/**
 * Applies device-dependent defaults, which are only known once the game is running, unless a newer save has them.
 * For now that's just the FPS limit: none with a dedicated GPU (see gpu.js), 60 otherwise. Before version 5 the
 * default was no limit, so an old save that set a limit keeps it.
 * @param {Settings} settings As loaded (see loadSettings).
 * @param {{ fpsLimit: number }} device This device's defaults.
 */
export function applyDeviceDefaults(settings, device) {
    const saved = readSaved();
    if (!(saved?.version >= 5) && !(saved?.graphics?.fpsLimit > 0)) settings.graphics.fpsLimit = device.fpsLimit;
}

/** @returns {Record<string, any> | null} Raw saved settings. */
function readSaved() {
    try {
        const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null');
        return saved && typeof saved === 'object' ? saved : null;
    } catch {
        // Storage can be unavailable (privacy modes, sandboxed iframes) or hold junk. Defaults are fine.
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

/** Writes pending settings now (e.g. when the page is closing). */
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

/** Resets in place so existing references stay valid. */
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
