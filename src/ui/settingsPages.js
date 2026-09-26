/**
 * What's on each page of the settings menu.
 * @param {() => string} seed Current world seed, for display.
 * @param {() => string} edits How many changes have been made to this world in edit mode.
 * @param {() => boolean} paused Whether there's a tape or a world in progress (from the pause menu), which a new
 *     world would lose.
 * @returns {import('./SettingsMenu.js').MenuPage[]}
 */
export function settingsPages(seed, edits, paused) {
    const percent = (v) => `${Math.round(v)}%`;
    const times = (v) => `${v.toFixed(v < 1 ? 2 : 1)}x`;
    const fixed = (digits) => (v) => v.toFixed(digits);
    const effect = (key) => `effects.${key}.enabled`;

    return [
        {
            title: 'Picture',
            items: [
                { type: 'range', label: 'Resolution', path: 'graphics.resolutionScale', min: 25, max: 100, step: 5, format: percent },
                { type: 'toggle', label: 'Dynamic lights', path: 'graphics.dynamicLights' },
                {
                    type: 'choice',
                    label: 'FPS limit',
                    path: 'graphics.fpsLimit',
                    options: [[0, 'Off'], [30, '30'], [60, '60'], [90, '90'], [120, '120'], [144, '144']],
                },
                { type: 'toggle', label: 'Camcorder overlay', path: 'graphics.camcorderOverlay' },
                { type: 'toggle', label: 'Map', path: 'graphics.minimap', dependsOn: 'graphics.camcorderOverlay' },
                { type: 'toggle', label: 'Show stats', path: 'graphics.showStats' },
            ],
        },
        {
            title: 'Camera',
            items: [
                { type: 'range', label: 'Movement speed', path: 'gameplay.movementSpeed', min: 0.2, max: 3, step: 0.1, format: times },
                { type: 'range', label: 'Mouse sensitivity', path: 'gameplay.mouseSensitivity', min: 0.1, max: 3, step: 0.05, format: times },
                { type: 'toggle', label: 'Invert mouse Y', path: 'gameplay.invertY' },
                { type: 'range', label: 'Field of view', path: 'gameplay.fieldOfView', min: 50, max: 100, step: 1, format: (v) => `${v}°` },
                { type: 'toggle', label: 'Head bob', path: 'gameplay.headBob' },
                { type: 'heading', label: 'Controller' },
                { type: 'range', label: 'Look speed', path: 'gameplay.stickSensitivity', min: 0.2, max: 3, step: 0.05, format: times },
                { type: 'toggle', label: 'Invert Y', path: 'gameplay.invertStickY' },
                { type: 'heading', label: 'VR' },
                { type: 'choice', label: 'Turning', path: 'vr.snapTurn', options: [[0, 'Smooth'], [30, 'Snap 30°'], [45, 'Snap 45°'], [90, 'Snap 90°']] },
            ],
        },
        {
            title: 'Sound',
            items: [
                { type: 'range', label: 'Volume', path: 'audio.volume', min: 0, max: 100, step: 5, format: percent },
                { type: 'toggle', label: 'Mute', path: 'audio.muted' },
                { type: 'toggle', label: 'Footsteps', path: 'audio.footsteps' },
                { type: 'toggle', label: 'Distant sounds', path: 'audio.ambience' },
            ],
        },
        {
            title: 'Tape',
            items: [
                { type: 'toggle', label: 'Shader effects', path: 'effects.enabled' },
                { type: 'heading', label: 'Static' },
                { type: 'toggle', label: 'Static', path: effect('static'), dependsOn: 'effects.enabled' },
                { type: 'range', label: 'Amount', path: 'effects.static.amount', min: 0, max: 1, step: 0.01, format: fixed(2), dependsOn: effect('static') },
                { type: 'range', label: 'Size', path: 'effects.static.size', min: 1, max: 10, step: 0.5, format: fixed(1), dependsOn: effect('static') },
                { type: 'heading', label: 'Colour bleed' },
                { type: 'toggle', label: 'RGB shift', path: effect('rgbShift'), dependsOn: 'effects.enabled' },
                { type: 'range', label: 'Amount', path: 'effects.rgbShift.amount', min: 0, max: 0.02, step: 0.0005, format: fixed(4), dependsOn: effect('rgbShift') },
                { type: 'range', label: 'Angle', path: 'effects.rgbShift.angle', min: 0, max: 6.28, step: 0.02, format: fixed(2), dependsOn: effect('rgbShift') },
                { type: 'heading', label: 'Scanlines' },
                { type: 'toggle', label: 'Scanlines', path: effect('film'), dependsOn: 'effects.enabled' },
                { type: 'toggle', label: 'Black and white', path: 'effects.film.grayscale', dependsOn: effect('film') },
                { type: 'range', label: 'Grain', path: 'effects.film.noise', min: 0, max: 1, step: 0.01, format: fixed(2), dependsOn: effect('film') },
                { type: 'range', label: 'Line strength', path: 'effects.film.scanlines', min: 0, max: 1, step: 0.01, format: fixed(2), dependsOn: effect('film') },
                { type: 'range', label: 'Line count', path: 'effects.film.scanlineCount', min: 0, max: 1500, step: 25, format: fixed(0), dependsOn: effect('film') },
                { type: 'heading', label: 'Tracking' },
                { type: 'toggle', label: 'Bad tracking', path: effect('badTV'), dependsOn: 'effects.enabled' },
                { type: 'range', label: 'Wobble', path: 'effects.badTV.distortion', min: 0, max: 1, step: 0.01, format: fixed(2), dependsOn: effect('badTV') },
                { type: 'range', label: 'Jitter', path: 'effects.badTV.distortion2', min: 0, max: 1, step: 0.01, format: fixed(2), dependsOn: effect('badTV') },
                { type: 'range', label: 'Speed', path: 'effects.badTV.speed', min: 0, max: 0.1, step: 0.001, format: fixed(3), dependsOn: effect('badTV') },
                { type: 'range', label: 'Vertical roll', path: 'effects.badTV.rollSpeed', min: 0, max: 0.1, step: 0.001, format: fixed(3), dependsOn: effect('badTV') },
                { type: 'heading', label: 'Vignette' },
                { type: 'toggle', label: 'Vignette', path: effect('vignette'), dependsOn: 'effects.enabled' },
                { type: 'range', label: 'Size', path: 'effects.vignette.offset', min: 0, max: 2, step: 0.01, format: fixed(2), dependsOn: effect('vignette') },
                { type: 'range', label: 'Darkness', path: 'effects.vignette.darkness', min: 0, max: 1, step: 0.01, format: fixed(2), dependsOn: effect('vignette') },
                { type: 'heading', label: 'Bloom' },
                { type: 'toggle', label: 'Bloom', path: effect('bloom'), dependsOn: 'effects.enabled' },
                { type: 'range', label: 'Threshold', path: 'effects.bloom.threshold', min: 0, max: 1, step: 0.01, format: fixed(2), dependsOn: effect('bloom') },
                { type: 'range', label: 'Strength', path: 'effects.bloom.strength', min: 0, max: 2, step: 0.02, format: fixed(2), dependsOn: effect('bloom') },
                { type: 'range', label: 'Radius', path: 'effects.bloom.radius', min: 0, max: 1, step: 0.01, format: fixed(2), dependsOn: effect('bloom') },
            ],
        },
        {
            title: 'World',
            items: [
                { type: 'info', label: 'Seed', value: seed },
                { type: 'action', label: 'Copy link to this world', id: 'copy-link' },
                { type: 'text', label: 'Go to seed', id: 'go-to-seed', placeholder: 'number or word' },
                { type: 'action', label: 'New world', id: 'new-world', confirm: paused },
                { type: 'heading', label: 'Atmosphere' },
                { type: 'toggle', label: 'Power cuts', path: 'world.powerCuts' },
                { type: 'heading', label: 'Edit mode' },
                { type: 'info', label: 'Your changes here', value: edits },
                { type: 'action', label: 'Undo all of them', id: 'undo-edits', confirm: () => edits() !== '0' },
                { type: 'heading', label: 'Settings' },
                { type: 'action', label: 'Reset all settings', id: 'reset', confirm: () => true },
            ],
        },
    ];
}
