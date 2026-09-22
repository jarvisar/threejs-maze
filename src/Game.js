import {
    Color,
    FogExp2,
    LinearSRGBColorSpace,
    LoadingManager,
    PCFShadowMap,
    PerspectiveCamera,
    Scene,
    Vector3,
    WebGLRenderer,
} from 'three';
import { Ambience } from './audio/Ambience.js';
import {
    CLEAR_COLOR,
    EYE_HEIGHT,
    FOG_COLOR,
    FOG_DENSITY,
    PHYSICS_RATE,
    VIEW_DISTANCE,
} from './config.js';
import { PostProcessing } from './fx/PostProcessing.js';
import { Keyboard } from './input/Keyboard.js';
import { LookControls } from './input/LookControls.js';
import { EditTool } from './player/EditTool.js';
import { Player } from './player/Player.js';
import { flushSettings, loadSettings, resetSettings, saveSettings } from './settings.js';
import { Hints } from './ui/Hints.js';
import { Hud } from './ui/Hud.js';
import { Menu } from './ui/Menu.js';
import { createSettingsPanel, refreshSettingsPanel } from './ui/SettingsPanel.js';
import { Toast } from './ui/Toast.js';
import { ChunkStore, cellCoord, chunkCoord } from './world/ChunkStore.js';
import { Lighting } from './world/lighting.js';
import { createMaterials } from './world/materials.js';
import { mulberry32, parseSeed, randomSeed } from './world/random.js';
import { loadTextures } from './world/textures.js';
import { WorldView } from './world/WorldView.js';

const STEP = 1 / PHYSICS_RATE;
const MAX_FRAME_TIME = 0.25; // don't try to catch up on more than this after a stall
const MENU_FPS = 30; // the title/pause screens are mostly static; no need to burn power on them
const CHUNK_BUILDS_PER_FRAME = 2;

const _cameraRight = new Vector3();

/**
 * @typedef {'loading' | 'title' | 'playing' | 'paused' | 'error'} GameState
 */

export class Game {
    constructor() {
        this.settings = loadSettings();
        this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

        const params = new URLSearchParams(location.search);
        this.seed = parseSeed(params.get('seed')) ?? randomSeed();
        this.debug = import.meta.env.DEV || params.has('debug');

        this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('scene'));
        this.menu = new Menu();
        this.hud = new Hud();
        this.toast = new Toast(/** @type {HTMLElement} */ (document.getElementById('toast')));
        this.hints = new Hints(this.toast);
        this.keyboard = new Keyboard();
        this.audio = new Ambience();
        this.controlsDialog = /** @type {HTMLDialogElement} */ (document.getElementById('controls'));

        /** @type {GameState} */
        this.state = 'loading';
        this.started = false;
        this.editMode = false;
        this.contextLost = false;
        this.playTime = 0;
        this.lastFpsLimit = 60;

        this._accumulator = 0;
        this._lastFrameTime = -1;
        this._nextFrameTime = 0;
        this._stats = { frames: 0, time: 0, fps: 0, frameMs: 0, nextUpdate: 0 };
        this._moveInput = { forward: 0, right: 0, up: 0, sprint: false };
        this._isWall = (x, z) => this.store.isWall(x, z);
    }

    async init() {
        try {
            this.menu.setProgress(0, 'Loading');
            this._createRenderer();
            await this._loadAssets();
            this._createWorld();
            await this._warmUp();
            this._createSettingsPanel();
            this._bindEvents();
            this._applyAllSettings();
        } catch (error) {
            console.error(error);
            this.state = 'error';
            this.menu.showError(error instanceof WebGLUnavailableError
                ? 'Backrooms Simulator needs WebGL 2, which this browser or device doesn\'t support (or has turned off).'
                : 'Something went wrong while loading.\nCheck your connection and reload the page.');
            return;
        }

        this.state = 'title';
        this.menu.setState('title');
        this.hud.coordinates.hidden = false;
        if (!matchMedia('(any-pointer: fine)').matches) this.menu.setNote('This game needs a keyboard and mouse.');
        this.renderer.setAnimationLoop((time) => this._frame(time));

        if (this.debug) window.__backrooms = this;
    }

    // ------------------------------------------------------------------ setup

    _createRenderer() {
        try {
            this.renderer = new WebGLRenderer({
                canvas: this.canvas,
                antialias: false, // everything goes through post-processing render targets anyway
                stencil: false,
                powerPreference: 'high-performance',
            });
        } catch (error) {
            throw new WebGLUnavailableError(error);
        }
        const renderer = this.renderer;
        renderer.outputColorSpace = LinearSRGBColorSpace; // see colorManagement.js
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = PCFShadowMap;
        // Several render passes make up a frame; count them all for the stats readout.
        renderer.info.autoReset = false;

        this.scene = new Scene();
        // A scene background (rather than the renderer's clear colour) survives a WebGL context restore.
        this.scene.background = new Color(CLEAR_COLOR);
        this.scene.fog = new FogExp2(FOG_COLOR, FOG_DENSITY);
        this.camera = new PerspectiveCamera(this.settings.gameplay.fieldOfView, innerWidth / innerHeight, 0.05, VIEW_DISTANCE);
        this.camera.position.set(0, EYE_HEIGHT, 0);
    }

    _loadAssets() {
        return new Promise((resolve, reject) => {
            const manager = new LoadingManager();
            let failed = false;
            manager.onProgress = (_url, loaded, total) => {
                this.menu.setProgress((loaded / total) * 0.6, `Loading textures ${loaded}/${total}`);
            };
            manager.onError = (url) => {
                failed = true;
                console.error(`Could not load ${url}`);
            };
            manager.onLoad = () => (failed ? reject(new Error('Some textures failed to load')) : resolve());

            const random = mulberry32(this.seed);
            this.textures = loadTextures(manager, {
                maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
                wallpaperOffset: [random(), random()],
            });
        });
    }

    _createWorld() {
        this.menu.setProgress(0.62, 'Generating level');
        this.store = new ChunkStore(this.seed);
        this.materials = createMaterials(this.textures);
        this.lighting = new Lighting(this.scene, this.materials.ceiling);
        this.world = new WorldView(this.scene, this.store, this.materials);
        this.player = new Player();
        this.look = new LookControls(this.canvas);
        this.editTool = new EditTool(this.scene, this.materials.highlight);
        this.post = new PostProcessing(this.renderer, this.scene, this.camera);

        this.world.update(0, 0, Infinity);
        this._resize();
    }

    /**
     * Does all first-use GPU work up front, behind the loading screen. three.js otherwise compiles each
     * shader and uploads each texture the first time something using it comes into view, which is what
     * caused the old version to freeze when looking at things for the first time.
     */
    async _warmUp() {
        const { renderer, scene, camera } = this;

        this.menu.setProgress(0.66, 'Uploading textures');
        for (const texture of Object.values(this.textures)) renderer.initTexture(texture);
        await nextFrame();

        this.menu.setProgress(0.72, 'Compiling shaders');
        this.editTool.outline.visible = true;
        await renderer.compileAsync(scene, camera);

        // Draw a few frames with everything switched on (flashlight shadows, bloom, the VHS pass) so the
        // shaders compile() doesn't cover are ready too, and the GPU has seen every resource once.
        this.menu.setProgress(0.9, 'Warming up');
        this.lighting.setFlashlight(true);
        this.post.setEnabled(true, true);
        for (let i = 0; i < 4; i++) {
            this.look.yaw = (i * Math.PI) / 2;
            this.look.applyTo(camera);
            this.lighting.updateFlashlight(camera);
            this.post.render(0);
            await nextFrame();
        }
        this.look.yaw = 0;
        this.editTool.hide();
        this.lighting.setFlashlight(false);
        this.menu.setProgress(1, 'Ready');
    }

    _createSettingsPanel() {
        this.worldInfo = { seed: String(this.seed) };
        this.gui = createSettingsPanel(this.settings, {
            onChange: (path) => {
                this._applySetting(path);
                saveSettings(this.settings);
            },
            onReset: () => {
                resetSettings(this.settings);
                this._applyAllSettings();
                refreshSettingsPanel(this.gui);
                saveSettings(this.settings);
                this.toast.flash('Settings reset.');
            },
            onNewWorld: () => this.newWorld(),
            onCopyWorldLink: () => this._copyWorldLink(),
        }, this.worldInfo);
    }

    _bindEvents() {
        window.addEventListener('resize', () => this._resize());
        window.addEventListener('keydown', (event) => this._onKeyDown(event));
        window.addEventListener('blur', () => this.look.unlock());
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) return;
            this.look.unlock();
            flushSettings(); // a change made just before closing the tab would otherwise be lost
        });
        window.addEventListener('pagehide', () => flushSettings());

        this.menu.addEventListener('start', () => this._requestPlay());
        this.menu.addEventListener('controls', () => this.controlsDialog.showModal());
        this.menu.addEventListener('new-world', () => this.newWorld());

        this.look.addEventListener('lock', () => this._play());
        this.look.addEventListener('unlock', () => this._pause());
        this.look.addEventListener('error', () => {
            this.menu.setNote('Couldn\'t capture the mouse. Click the button again.');
        });

        this.canvas.addEventListener('mousedown', (event) => this._onMouseDown(event));
        this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

        this.canvas.addEventListener('webglcontextlost', (event) => {
            event.preventDefault(); // lets the browser restore the context
            this.contextLost = true;
            this.look.unlock(); // pauses (asynchronously, via the unlock event)
            this.gui.hide();
            this.menu.showError('The graphics driver stopped responding.\nWaiting for it to come back...');
        });
        this.canvas.addEventListener('webglcontextrestored', () => {
            this.contextLost = false;
            this.menu.setState(this.started ? 'paused' : 'title');
            this.gui.show();
        });
    }

    // ------------------------------------------------------------------ state

    _requestPlay() {
        if (this.contextLost) return;
        this.menu.setNote('');
        this.audio.start();
        this.look.lock();
    }

    _play() {
        if (this.contextLost || (this.state !== 'title' && this.state !== 'paused')) return;
        if (this.controlsDialog.open) this.controlsDialog.close();
        this.state = 'playing';
        this.started = true;
        this.menu.setState('hidden');
        this.gui.hide();
        this.hud.setInGame(true);
        this.hud.setOsdMode(this.editMode ? 'edit' : 'rec');
        this.hud.setCrosshair(this.editMode);
        this.audio.setPaused(false);
        this._accumulator = 0;
    }

    _pause() {
        if (this.state !== 'playing') return;
        this.state = 'paused';
        this.keyboard.clear();
        this.hud.setOsdMode('pause');
        this.hud.setCrosshair(false);
        this.editTool.hide();
        this.audio.setPaused(true);
        if (this.contextLost) return; // keep the error message up
        this.menu.setState('paused');
        this.gui.show();
    }

    /** Starts over in a freshly generated world. */
    newWorld() {
        this.seed = randomSeed();
        this.worldInfo.seed = String(this.seed);
        refreshSettingsPanel(this.gui);

        this.store = new ChunkStore(this.seed);
        this.world.setStore(this.store);
        this.world.update(0, 0, Infinity);
        const random = mulberry32(this.seed);
        this.textures.wallpaper.offset.set(random(), random());
        this.player.reset();
        this.look.yaw = 0;
        this.look.pitch = 0;

        const url = new URL(location.href);
        url.searchParams.set('seed', String(this.seed));
        history.replaceState(null, '', url);
        this.toast.flash('Entered a new world.');
    }

    async _copyWorldLink() {
        const url = new URL(location.pathname, location.origin);
        url.searchParams.set('seed', String(this.seed));
        try {
            await navigator.clipboard.writeText(url.href);
            this.toast.flash('Link copied. Anyone who opens it gets this same world.', 3000);
        } catch {
            this.toast.flash(`Seed: ${this.seed}`, 4000);
        }
    }

    // ------------------------------------------------------------------ input

    _onKeyDown(event) {
        if (event.repeat || this.state === 'loading' || this.state === 'error') return;
        const target = /** @type {HTMLElement} */ (event.target);
        if (target.closest?.('input, textarea, select, [contenteditable]')) return;
        const playing = this.state === 'playing';
        const graphics = this.settings.graphics;

        switch (event.code) {
            case 'KeyF':
                if (!playing) return;
                this.lighting.setFlashlight(!this.lighting.flashlightOn);
                this.hints.markUsed('flashlight');
                break;
            case 'Digit1':
                this.settings.effects.enabled = !this.settings.effects.enabled;
                this._settingChanged('effects.enabled');
                this.hints.markUsed('effects');
                this.toast.flash(`Shader effects ${this.settings.effects.enabled ? 'on' : 'off'}`);
                break;
            case 'Digit2':
            case 'KeyG':
                graphics.dynamicLights = !graphics.dynamicLights;
                this._settingChanged('graphics.dynamicLights');
                this.hints.markUsed('lights');
                this.toast.flash(`Dynamic lights ${graphics.dynamicLights ? 'on' : 'off'}`);
                break;
            case 'Digit3':
                if (graphics.fpsLimit === 0) {
                    graphics.fpsLimit = this.lastFpsLimit;
                } else {
                    this.lastFpsLimit = graphics.fpsLimit;
                    graphics.fpsLimit = 0;
                }
                this._settingChanged('graphics.fpsLimit');
                this.toast.flash(graphics.fpsLimit ? `FPS limit: ${graphics.fpsLimit}` : 'FPS limit: off');
                break;
            case 'Digit4':
                graphics.resolutionScale = graphics.resolutionScale === 100 ? 50 : 100;
                this._settingChanged('graphics.resolutionScale');
                this.toast.flash(`Resolution: ${graphics.resolutionScale}%`);
                break;
            case 'KeyX':
                if (playing) this._toggleEditMode();
                break;
            case 'KeyM':
                this.settings.audio.muted = !this.settings.audio.muted;
                this._settingChanged('audio.muted');
                this.toast.flash(this.settings.audio.muted ? 'Sound muted' : 'Sound on');
                break;
            case 'F3':
            case 'Backquote':
                event.preventDefault();
                graphics.showStats = !graphics.showStats;
                this._settingChanged('graphics.showStats');
                break;
            case 'Space':
                if (playing) event.preventDefault(); // don't scroll or re-press a focused button
                break;
            default:
                if (playing && (event.code === 'ShiftLeft' || event.code === 'ShiftRight')) this.hints.markUsed('sprint');
        }
    }

    _onMouseDown(event) {
        if (this.state !== 'playing' || !this.editMode) return;
        const store = this.store;
        const changed = event.button === 0 ? this.editTool.remove(store)
            : event.button === 2 ? this.editTool.place(store, this.player.position)
                : null;
        if (changed) this.world.refreshCell(changed.x, changed.z);
    }

    _toggleEditMode() {
        this.editMode = !this.editMode;
        this.player.flying = this.editMode;
        this.hints.markUsed('edit');
        this.hud.setCrosshair(this.editMode);
        this.hud.setOsdMode(this.editMode ? 'edit' : 'rec');
        if (this.editMode) {
            this.toast.flash('Edit mode enabled.\nLeft click removes walls, right click places them.\nSpace / Q and E fly up and down.', 4500);
        } else {
            this.editTool.hide();
            this.toast.flash('Edit mode disabled.');
        }
    }

    // ------------------------------------------------------------------ settings

    /** Applies a setting changed by a keyboard shortcut and keeps the panel and storage in sync. */
    _settingChanged(path) {
        this._applySetting(path);
        refreshSettingsPanel(this.gui);
        saveSettings(this.settings);
    }

    _applySetting(path) {
        const { graphics, gameplay, audio } = this.settings;
        switch (path) {
            case 'graphics.resolutionScale':
                this._resize();
                break;
            case 'graphics.dynamicLights':
                this.lighting.setCeilingLights(graphics.dynamicLights);
                break;
            case 'graphics.fpsLimit':
                this._nextFrameTime = 0;
                break;
            case 'graphics.camcorderOverlay':
                this.hud.setOsdEnabled(graphics.camcorderOverlay);
                break;
            case 'graphics.showStats':
                this.hud.setStatsVisible(graphics.showStats);
                break;
            case 'gameplay.mouseSensitivity':
            case 'gameplay.invertY':
                this.look.sensitivity = gameplay.mouseSensitivity;
                this.look.invertY = gameplay.invertY;
                break;
            case 'gameplay.fieldOfView':
                this.camera.fov = gameplay.fieldOfView;
                this.camera.updateProjectionMatrix();
                break;
            case 'audio.volume':
            case 'audio.muted':
                this.audio.setVolume(audio.volume / 100);
                this.audio.setMuted(audio.muted);
                break;
            default:
                if (path.startsWith('effects.')) this._applyEffects();
        }
    }

    _applyAllSettings() {
        for (const path of [
            'graphics.resolutionScale',
            'graphics.dynamicLights',
            'graphics.fpsLimit',
            'graphics.camcorderOverlay',
            'graphics.showStats',
            'gameplay.mouseSensitivity',
            'gameplay.fieldOfView',
            'audio.volume',
            'effects.enabled',
        ]) {
            this._applySetting(path);
        }
    }

    _applyEffects() {
        const effects = this.settings.effects;
        const u = this.post.vhs;
        u.staticEnabled.value = effects.static.enabled;
        u.staticAmount.value = effects.static.amount;
        u.staticSize.value = effects.static.size;
        u.rgbShiftEnabled.value = effects.rgbShift.enabled;
        u.rgbShiftAmount.value = effects.rgbShift.amount;
        u.rgbShiftAngle.value = effects.rgbShift.angle;
        u.filmEnabled.value = effects.film.enabled;
        u.filmGrayscale.value = effects.film.grayscale;
        u.filmNoiseIntensity.value = effects.film.noise;
        u.filmScanlineIntensity.value = effects.film.scanlines;
        u.filmScanlineCount.value = effects.film.scanlineCount;
        u.badTVEnabled.value = effects.badTV.enabled;
        u.badTVDistortion.value = effects.badTV.distortion;
        u.badTVDistortion2.value = effects.badTV.distortion2;
        u.badTVSpeed.value = effects.badTV.speed;
        u.badTVRollSpeed.value = effects.badTV.rollSpeed;
        u.vignetteEnabled.value = effects.vignette.enabled;
        u.vignetteOffset.value = effects.vignette.offset;
        u.vignetteDarkness.value = effects.vignette.darkness;

        const bloom = this.post.bloomPass;
        bloom.threshold = effects.bloom.threshold;
        bloom.strength = effects.bloom.strength;
        bloom.radius = effects.bloom.radius;

        const anyVhsStage = ['static', 'rgbShift', 'film', 'badTV', 'vignette'].some((key) => effects[key].enabled);
        this.post.setEnabled(effects.enabled && anyVhsStage, effects.enabled && effects.bloom.enabled);
    }

    _resize() {
        const width = innerWidth;
        const height = innerHeight;
        const pixelRatio = (Math.min(devicePixelRatio, 2) * this.settings.graphics.resolutionScale) / 100;
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.post.setSize(width, height, pixelRatio);
    }

    // ------------------------------------------------------------------ frame

    _frame(timeMs) {
        const now = timeMs / 1000;

        // Optional frame-rate limit (and a lower rate on the menus, which barely change).
        const limit = this.state === 'playing' ? this.settings.graphics.fpsLimit : MENU_FPS;
        if (limit > 0) {
            if (now < this._nextFrameTime - 0.002) return;
            this._nextFrameTime = Math.max(this._nextFrameTime + 1 / limit, now);
        }

        const dt = this._lastFrameTime < 0 ? 0 : Math.min(now - this._lastFrameTime, MAX_FRAME_TIME);
        this._lastFrameTime = now;

        const { camera, player, look } = this;
        let alpha = 1;

        if (this.state === 'playing') {
            this._accumulator += dt;
            const input = this._readMoveInput();
            while (this._accumulator >= STEP) {
                player.step(input, look.yaw, this.settings.gameplay.movementSpeed, this._isWall);
                this._accumulator -= STEP;
            }
            alpha = this._accumulator / STEP;
            this.playTime += dt;
            this.hints.update(this.playTime);
            this.hud.setPlayTime(this.playTime);
        } else if (this.state === 'title' && !this.reducedMotion) {
            // Slowly look around on the title screen, like an idle camcorder.
            look.yaw = Math.sin(now * 0.05) * 0.55;
            look.pitch = Math.sin(now * 0.037) * 0.04;
        }

        camera.position.lerpVectors(player.previousPosition, player.position, alpha);
        look.applyTo(camera);
        if (this.state === 'playing' && this.settings.gameplay.headBob) {
            const bob = player.headBob();
            _cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
            camera.position.addScaledVector(_cameraRight, bob.right);
            camera.position.y += bob.up;
        }

        this.world.update(player.position.x, player.position.z, CHUNK_BUILDS_PER_FRAME);
        this.lighting.updateFlashlight(camera);
        if (this.state === 'playing' && this.editMode) this.editTool.update(camera, this.store);
        this.hud.setCoordinates(chunkCoord(cellCoord(player.position.x)), chunkCoord(cellCoord(player.position.z)));

        this.renderer.info.reset();
        this.post.render(dt);

        if (this.settings.graphics.showStats) this._updateStats(now, dt);
    }

    _readMoveInput() {
        const kb = this.keyboard;
        const input = this._moveInput;
        input.forward = kb.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
        input.right = kb.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
        input.up = kb.axis(['KeyE'], ['Space', 'KeyQ']);
        input.sprint = kb.isDown('ShiftLeft', 'ShiftRight');
        return input;
    }

    _updateStats(now, dt) {
        const stats = this._stats;
        stats.frames++;
        stats.time += dt;
        if (now < stats.nextUpdate) return;
        if (stats.time > 0) {
            stats.fps = Math.round(stats.frames / stats.time);
            stats.frameMs = (stats.time / stats.frames) * 1000;
        }
        stats.frames = 0;
        stats.time = 0;
        stats.nextUpdate = now + 0.5;

        const info = this.renderer.info;
        const p = this.player.position;
        this.hud.setStats([
            `FPS    ${stats.fps} (${stats.frameMs.toFixed(1)} ms)`,
            `CALLS  ${info.render.calls}`,
            `TRIS   ${(info.render.triangles / 1000).toFixed(1)}k`,
            `CHUNKS ${this.world.loadedCount}`,
            `POS    ${p.x.toFixed(1)} ${p.y.toFixed(2)} ${p.z.toFixed(1)}`,
            `SEED   ${this.seed}`,
        ].join('\n'));
    }
}

class WebGLUnavailableError extends Error {
    constructor(cause) {
        super('WebGL 2 is not available', { cause });
    }
}

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
