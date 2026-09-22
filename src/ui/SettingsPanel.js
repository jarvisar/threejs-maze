import GUI from 'lil-gui';

// Labels aren't bare numbers because JS orders integer-like keys first, which would put "Unlimited" last.
const FPS_LIMITS = { Unlimited: 0, '30 FPS': 30, '60 FPS': 60, '90 FPS': 90, '120 FPS': 120, '144 FPS': 144 };

/**
 * The settings panel (shown while paused). Controllers write straight into `settings`; `onChange` is
 * called with the path of what changed (e.g. "effects.film.grayscale") so the game can apply it.
 *
 * @param {import('../settings.js').Settings} settings
 * @param {object} callbacks
 * @param {(path: string) => void} callbacks.onChange
 * @param {() => void} callbacks.onReset
 * @param {() => void} callbacks.onNewWorld
 * @param {() => void} callbacks.onCopyWorldLink
 * @param {{ seed: string }} worldInfo Displayed read-only.
 */
export function createSettingsPanel(settings, { onChange, onReset, onNewWorld, onCopyWorldLink }, worldInfo) {
    const gui = new GUI({ title: 'Settings', width: 300 });
    gui.domElement.classList.add('settings-panel');

    const add = (folder, object, section, key, ...args) =>
        folder.add(object, key, ...args).onChange(() => onChange(`${section}.${key}`));

    const graphics = gui.addFolder('Graphics');
    add(graphics, settings.graphics, 'graphics', 'resolutionScale', 25, 100, 5).name('Resolution (%)');
    add(graphics, settings.graphics, 'graphics', 'dynamicLights').name('Dynamic lights');
    add(graphics, settings.graphics, 'graphics', 'fpsLimit', FPS_LIMITS).name('FPS limit');
    add(graphics, settings.graphics, 'graphics', 'camcorderOverlay').name('Camcorder overlay');
    add(graphics, settings.graphics, 'graphics', 'showStats').name('Show stats');

    const gameplay = gui.addFolder('Gameplay');
    add(gameplay, settings.gameplay, 'gameplay', 'movementSpeed', 0.2, 3, 0.1).name('Movement speed');
    add(gameplay, settings.gameplay, 'gameplay', 'mouseSensitivity', 0.1, 3, 0.05).name('Mouse sensitivity');
    add(gameplay, settings.gameplay, 'gameplay', 'invertY').name('Invert mouse Y');
    add(gameplay, settings.gameplay, 'gameplay', 'fieldOfView', 50, 100, 1).name('Field of view');
    add(gameplay, settings.gameplay, 'gameplay', 'headBob').name('Head bob');

    const audio = gui.addFolder('Audio');
    add(audio, settings.audio, 'audio', 'volume', 0, 100, 1).name('Volume');
    add(audio, settings.audio, 'audio', 'muted').name('Mute');

    const effects = gui.addFolder('Shader Effects');
    add(effects, settings.effects, 'effects', 'enabled').name('Enabled');
    const effect = (title, key, controls) => {
        const folder = effects.addFolder(title);
        const values = settings.effects[key];
        add(folder, values, `effects.${key}`, 'enabled').name('Enabled');
        for (const [name, label, ...range] of controls) add(folder, values, `effects.${key}`, name, ...range).name(label);
        folder.close();
    };
    effect('Static', 'static', [['amount', 'Amount', 0, 1, 0.01], ['size', 'Size', 1, 10, 0.1]]);
    effect('RGB Shift', 'rgbShift', [['amount', 'Amount', 0, 0.05, 0.0005], ['angle', 'Angle', 0, 6.28, 0.01]]);
    effect('Scanlines', 'film', [
        ['grayscale', 'Grayscale'],
        ['noise', 'Noise intensity', 0, 1, 0.001],
        ['scanlines', 'Scanline intensity', 0, 1, 0.001],
        ['scanlineCount', 'Scanline count', 0, 1500, 1],
    ]);
    effect('Bad TV', 'badTV', [
        ['distortion', 'Distortion', 0, 1, 0.001],
        ['distortion2', 'Fine distortion', 0, 1, 0.001],
        ['speed', 'Speed', 0, 1, 0.001],
        ['rollSpeed', 'Roll speed', 0, 1, 0.001],
    ]);
    effect('Vignette', 'vignette', [['offset', 'Offset', 0, 2, 0.001], ['darkness', 'Darkness', 0, 1, 0.001]]);
    effect('Bloom', 'bloom', [
        ['threshold', 'Threshold', 0, 1, 0.001],
        ['strength', 'Strength', 0, 2, 0.001],
        ['radius', 'Radius', 0, 1, 0.001],
    ]);
    effects.close();

    const world = gui.addFolder('World');
    world.add(worldInfo, 'seed').name('Seed').disable();
    world.add({ copy: onCopyWorldLink }, 'copy').name('Copy link to this world');
    world.add({ newWorld: onNewWorld }, 'newWorld').name('New world');
    world.close();

    gui.add({ reset: onReset }, 'reset').name('Reset settings');

    gameplay.close();
    audio.close();
    // On small windows the open panel would cover the menu.
    if (innerWidth < 800 || innerHeight < 600) gui.close();

    return gui;
}

/** Refreshes every controller after settings were changed elsewhere (keyboard shortcuts, reset). */
export function refreshSettingsPanel(gui) {
    for (const controller of gui.controllersRecursive()) controller.updateDisplay();
}
