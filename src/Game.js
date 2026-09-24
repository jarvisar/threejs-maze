import {
    Color,
    FogExp2,
    LinearSRGBColorSpace,
    LoadingManager,
    MathUtils,
    PCFShadowMap,
    PerspectiveCamera,
    Scene,
    Vector3,
    WebGLRenderer,
} from 'three';
import { Ambience } from './audio/Ambience.js';
import { Dread } from './audio/Dread.js';
import {
    CLEAR_COLOR,
    EDIT_REACH,
    EYE_HEIGHT,
    FOG_COLOR,
    FOG_DENSITY,
    MAX_ZOOM,
    PHYSICS_RATE,
    PLAYER_RADIUS,
    VIEW_DISTANCE,
    WALL_HEIGHT,
} from './config.js';
import { FoundFootage } from './footage/FoundFootage.js';
import { PostProcessing } from './fx/PostProcessing.js';
import { BUTTON, GamepadInput } from './input/Gamepad.js';
import { Keyboard } from './input/Keyboard.js';
import { LookControls } from './input/LookControls.js';
import { TouchControls } from './input/TouchControls.js';
import { findFreeSpot } from './player/collision.js';
import { EDIT_TOOLS, EditTool } from './player/EditTool.js';
import { Player } from './player/Player.js';
import { flushSettings, loadSettings, resetSettings, saveSettings } from './settings.js';
import { Hints } from './ui/Hints.js';
import { Hud } from './ui/Hud.js';
import { Menu } from './ui/Menu.js';
import { Minimap } from './ui/Minimap.js';
import { SettingsMenu } from './ui/SettingsMenu.js';
import { settingsPages } from './ui/settingsPages.js';
import { saveStill } from './ui/stills.js';
import { Toast } from './ui/Toast.js';
import { Blackouts } from './world/blackouts.js';
import { ChunkStore, cellCoord, chunkCoord } from './world/ChunkStore.js';
import { EditLog } from './world/edits.js';
import { Lighting } from './world/lighting.js';
import { createMaterials } from './world/materials.js';
import { PanelLightMap, panelFlicker } from './world/panelLights.js';
import { parseSeed, randomSeed, wallpaperOffset } from './world/random.js';
import { loadTextures } from './world/textures.js';
import { WorldView } from './world/WorldView.js';
import { ZONE_NAMES } from './world/zones.js';
import { VR } from './xr/VR.js';
import { XR_BUTTON } from './xr/VRHand.js';

const STEP = 1 / PHYSICS_RATE;
const MAX_FRAME_TIME = 0.25; // don't try to catch up on more than this after a stall
const MENU_FPS = 30; // the title/pause screens are mostly static; no need to burn power on them
const CHUNK_BUILDS_PER_FRAME = 1;
// Below this area light, the player is "in the dark" (for the flashlight hint).
const DARK_AREA = 0.45;
// Failing tubes within this distance are loud enough to hear buzzing.
const BUZZ_RANGE = 5;
// Controller: how fast the right stick turns the view when pushed all the way (radians per second; up and
// down a bit slower), and how fast the triggers zoom.
const STICK_TURN_SPEED = 2.6;
const STICK_PITCH_SCALE = 0.75;
const TRIGGER_ZOOM_SPEED = 1.6;
// Clicking the left stick runs until the stick is let go to about here.
const STICK_SPRINT_RELEASE = 0.3;
// VR: walking is slower than on a screen (fast movement you don't make yourself is what makes people feel
// sick in a headset). Snap turning turns once per flick of the stick past SNAP_PRESS, then waits for it
// to come back past SNAP_RELEASE.
const VR_SPEED = 0.6;
const SNAP_PRESS = 0.7;
const SNAP_RELEASE = 0.35;

const _cameraRight = new Vector3();
const _vrPosition = new Vector3();
const _tracked = { x: 0, z: 0 };

/**
 * @typedef {'loading' | 'title' | 'playing' | 'paused' | 'ended' | 'error'} GameState
 * @typedef {'explore' | 'footage'} GameMode
 */

export class Game {
    constructor() {
        this.settings = loadSettings();
        this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Phones and tablets: on-screen controls instead of keyboard, mouse and pointer lock.
        this.touch = !matchMedia('(any-pointer: fine)').matches && navigator.maxTouchPoints > 0;
        // The stylesheet shows touch or keyboard controls and hints to match.
        document.documentElement.dataset.input = this.touch ? 'touch' : 'mouse';

        const params = new URLSearchParams(location.search);
        this.seed = parseSeed(params.get('seed')) ?? randomSeed();
        this.debug = import.meta.env.DEV || params.has('debug');
        /** @type {GameMode} What Start starts: the endless level, or a Found Footage tape. */
        this.mode = params.get('mode') === 'footage' ? 'footage' : params.get('mode') === 'explore' ? 'explore' : this.settings.world.mode;

        this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('scene'));
        this.menu = new Menu();
        this.menu.touch = this.touch;
        this.hud = new Hud();
        this.minimap = new Minimap(/** @type {HTMLCanvasElement} */ (document.getElementById('minimap')));
        this.toast = new Toast(/** @type {HTMLElement} */ (document.getElementById('toast')));
        this.hints = new Hints(this.toast);
        this.keyboard = new Keyboard();
        this.gamepad = new GamepadInput();
        this.audio = new Ambience();
        this.dread = new Dread(this.audio);
        this.blackouts = new Blackouts();
        this._onBlackoutEvent = (event, strength) => {
            if (event === 'cut') this.audio.powerCut();
            else if (event === 'flash') this.audio.powerFlash(strength);
            else this.audio.powerRestored();
        };

        /** @type {GameState} */
        this.state = 'loading';
        this.started = false;
        this.editMode = false;
        this.contextLost = false;
        this.playTime = 0;
        this.lastFpsLimit = 60;
        this.zoom = 1;
        this.zoomTarget = 1;

        this._accumulator = 0;
        this._lastFrameTime = -1;
        this._nextFrameTime = 0;
        this._size = ''; // canvas size and pixel ratio at the last resize
        this._stats ={ frames: 0, time: 0, fps: 0, frameMs: 0, nextUpdate: 0 };
        this._moveInput = { forward: 0, right: 0, up: 0, sprint: false };
        this._boxesNear = (minX, minZ, maxX, maxZ, doorsSolid) => this.store.boxesNear(minX, minZ, maxX, maxZ, doorsSolid);
        this._stepsHeard = 0;
        this._stillRequested = false;
        this._toolScroll = 0;
        /** @type {import('./input/Gamepad.js').ButtonLabels | null} Button names while a controller is in use. */
        this._controller = null;
        this._stickSprint = false;
        /** Movement from VR controllers (or pinching), read along with the other inputs. */
        this._vrMove = { forward: 0, right: 0, up: 0, sprint: false };
        this._snapped = false;
        this._vrHelpShown = false;
        /** @type {Map<number, boolean>} Whether each nearby flickering panel was lit last frame. */
        this._flickerLit = new Map();
    }

    async init() {
        try {
            this.menu.setProgress(0, 'Loading');
            this._createRenderer();
            await this._loadAssets();
            this._createWorld();
            await this._warmUp();
            this._createSettingsMenu();
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
        this.menu.setMode(this.mode, this._modeNote());
        this.hud.coordinates.hidden = false;
        if (this.touch) this.hints.touchOnly();
        else if (!matchMedia('(any-pointer: fine)').matches && this.gamepad.connected === 0) {
            this.menu.setNote('This game needs a keyboard and mouse, a controller, or a touch screen.');
        }
        this.renderer.setAnimationLoop((time, xrFrame) => this._frame(time, xrFrame));

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
        // The near plane is close enough that walls don't clip even when pressed up against them.
        this.camera = new PerspectiveCamera(this.settings.gameplay.fieldOfView, innerWidth / innerHeight, 0.03, VIEW_DISTANCE);
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

            this.textures = loadTextures(manager, {
                maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
                wallpaperOffset: wallpaperOffset(this.seed),
            });
        });
    }

    _createWorld() {
        this.menu.setProgress(0.62, 'Generating level');
        this.store = new ChunkStore(this.seed, new EditLog(this.seed));
        this.panelLights = new PanelLightMap();
        this.materials = createMaterials(this.textures, this.panelLights.texture, this.renderer.capabilities.getMaxAnisotropy());
        this.lighting = new Lighting(this.scene, this.materials.ceiling, this.materials.ceilingDecal);
        this.world = new WorldView(this.scene, this.store, this.materials, this.panelLights);
        this.player = new Player();
        this.look = new LookControls(this.canvas);
        this.touchControls = new TouchControls(/** @type {HTMLElement} */ (document.getElementById('touch')), this.look);
        this.editTool = new EditTool(this.scene, { build: this.materials.highlight, select: this.materials.selection });
        this.post = new PostProcessing(this.renderer, this.scene, this.camera);
        this.vr = new VR(this.renderer, this.scene, this.camera, this.materials.highlight);

        this.world.update(0, 0, Infinity);
        this.lighting.update(0, this.store.areaLight(0, 0), true);
        this._resize();

        // The Found Footage mode: it has its own world, built when the mode is picked.
        this.footage = new FoundFootage(this);
        if (this.mode === 'footage') this.footage.prepare(this.seed);
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
        renderer.initTexture(this.panelLights.texture);
        renderer.initTexture(this.materials.decal.map);
        renderer.initTexture(this.materials.prop.map);
        for (const texture of this.footage.textures) renderer.initTexture(texture);
        await nextFrame();

        this.menu.setProgress(0.72, 'Compiling shaders');
        this.editTool.showAll();
        this.vr.showAll();
        this.world.showWarmUp(Object.values(this.footage.materials));
        await renderer.compileAsync(scene, camera);
        this.vr.hideAll();
        this.world.hideWarmUp();

        // Draw a few frames with everything switched on (flashlight shadows, bloom, the VHS pass) so the
        // shaders compile() doesn't cover are ready too, and the GPU has seen every resource once.
        this.menu.setProgress(0.9, 'Warming up');
        this.lighting.setFlashlight(true);
        this.post.setEnabled(true, true);
        for (let i = 0; i < 4; i++) {
            this.look.yaw = (i * Math.PI) / 2;
            this.look.applyTo(camera);
            this.lighting.updateFlashlight(camera, this.world.version);
            this.post.render(0);
            await nextFrame();
        }
        this.look.yaw = 0;
        this.editTool.hide();
        this.lighting.setFlashlight(false);
        this.menu.setProgress(1, 'Ready');
    }

    _createSettingsMenu() {
        const root = /** @type {HTMLElement} */ (document.getElementById('settings'));
        this.settingsMenu = new SettingsMenu(root, this.settings, settingsPages(() => String(this.seed), () => String(this.store.edits?.size ?? 0)), {
            onChange: (path) => {
                this._applySetting(path);
                saveSettings(this.settings);
            },
            onAction: (id, value) => {
                if (id === 'copy-link') this._copyWorldLink();
                else if (id === 'new-world') this.newWorld();
                else if (id === 'go-to-seed') this._goToSeed(value);
                else if (id === 'reset') this._resetSettings();
                else if (id === 'undo-edits') this._undoEdits();
            },
        });
        this.menu.attachSettings(this.settingsMenu);
    }

    _bindEvents() {
        window.addEventListener('resize', () => this._resize());
        window.addEventListener('keydown', (event) => this._onKeyDown(event));
        window.addEventListener('wheel', (event) => this._onWheel(event), { passive: true });
        // In VR the headset says when it's in use (see VR.visible); the page losing focus doesn't matter.
        window.addEventListener('blur', () => {
            if (!this.vr.presenting) this._releaseControls();
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) return;
            if (!this.vr.presenting) this._releaseControls();
            // Changes made just before closing the tab would otherwise be lost.
            flushSettings();
            this.store.edits?.save();
        });
        window.addEventListener('pagehide', () => {
            flushSettings();
            this.store.edits?.save();
        });

        this.menu.addEventListener('start', (event) => this._requestPlay(/** @type {CustomEvent} */ (event).detail?.controller === true));
        this.menu.addEventListener('new-world', () => this.newWorld());
        this.menu.addEventListener('enter-vr', () => this._enterVR());
        this.menu.addEventListener('mode', (event) => this.setMode(/** @type {CustomEvent} */ (event).detail));
        this.menu.addEventListener('retry', (event) => this.startFootage(this.seed, /** @type {CustomEvent} */ (event).detail?.controller === true));
        this.menu.addEventListener('new-run', (event) => this.startFootage(randomSeed(), /** @type {CustomEvent} */ (event).detail?.controller === true));
        this.menu.addEventListener('to-title', () => this.toTitle());

        // A headset can be found (or plugged in) at any time.
        this.menu.setVR(this.vr.available);
        this.vr.addEventListener('support', () => this.menu.setVR(this.vr.available));
        this.vr.addEventListener('start', () => this._onVRStart());
        this.vr.addEventListener('end', () => this._onVREnd());
        this.vr.addEventListener('inputs', () => this._vrHelp());
        // The page's overlays can't be seen in a headset; messages are shown in front of you instead.
        this.toast.addEventListener('change', (event) => this.vr.panel.show(/** @type {CustomEvent} */ (event).detail));

        this.gamepad.addEventListener('connect', () => {
            document.documentElement.dataset.controller = this._controller ? 'active' : 'connected';
            this.menu.showButtonNames(this.gamepad.labels);
            if (this.state === 'title' || this.state === 'paused') this.menu.setNote('');
            this.toast.flash('Controller connected.');
        });
        this.gamepad.addEventListener('disconnect', () => {
            if (this.gamepad.connected > 0) return;
            delete document.documentElement.dataset.controller;
            if (this._controller && this.state === 'playing') this._releaseControls();
            this._setController(false);
            this.toast.flash('Controller disconnected.');
        });
        // One may have connected while loading.
        if (this.gamepad.connected > 0) {
            document.documentElement.dataset.controller = 'connected';
            this.menu.showButtonNames(this.gamepad.labels);
        }
        // A click or a key press means the mouse and keyboard (or touch) are back in charge. It's also the
        // first chance to start the sound after starting with a controller, which browsers don't count.
        window.addEventListener('pointerdown', () => {
            this._setController(false);
            if (this.audio.blocked) this.audio.start();
        });

        this.touchControls.addEventListener('pause', () => this._pause());
        this.touchControls.addEventListener('flashlight', () => this._toggleFlashlight());
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
            this._releaseControls(); // pauses
            this.menu.showError('The graphics driver stopped responding.\nWaiting for it to come back...');
        });
        this.canvas.addEventListener('webglcontextrestored', () => {
            this.contextLost = false;
            this.lighting.invalidateShadow(); // the old one went with the context
            this.menu.setState(this.started ? 'paused' : 'title');
        });
    }

    // ------------------------------------------------------------------ state

    /** @param {boolean} [controller] Started with a controller button rather than a click or tap. */
    _requestPlay(controller = false) {
        if (this.contextLost) return;
        this.menu.setNote('');
        this.audio.start();
        if (this.touch) {
            // No pointer lock on touch screens; go full screen if the browser allows it.
            document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
            this._play();
        } else if (controller) {
            // A controller doesn't need the mouse captured (and browsers only allow that from a click anyway).
            // Clicking the view captures it later.
            this._play();
        } else {
            this.look.lock();
        }
    }

    /** The Enter VR button: puts the game in the headset, which starts playing once it's on. */
    async _enterVR() {
        if (this.contextLost || this.vr.presenting || (this.state !== 'title' && this.state !== 'paused' && this.state !== 'ended')) return;
        this.menu.setNote('');
        this.audio.start();
        try {
            await this.vr.enter();
        } catch (error) {
            console.warn('Could not start VR:', error);
            this.menu.setNote('Couldn\'t start VR. Check that the headset is on and connected, then try again.');
        }
    }

    _onVRStart() {
        this.look.unlock();
        this._lastFrameTime = -1; // the headset has its own clock
        // No camcorder zoom in a headset.
        this.zoom = this.zoomTarget = 1;
        this._updateFov();
        this.hud.hideZoom();
        this.audio.setZoomMotor(0);
        this.hints.setVR(true);
        this._snapped = false;
        this._vrHelpShown = false;
        this._play();
        this._vrHelp();
    }

    _onVREnd() {
        this.hints.setVR(false);
        // Carry on facing the same way on the screen.
        this.look.yaw = this.vr.headYaw(this.look.yaw);
        this.look.pitch = 0;
        this._vrMove.forward = this._vrMove.right = this._vrMove.up = 0;
        this._vrMove.sprint = false;
        this._lastFrameTime = -1;
        this._size = ''; // three.js has put the canvas back to its old size; catch up with any change since
        this._resize();
        this._updateFov();
        this._pause();
    }

    /** Once, when VR starts: how to get around with whatever the player has in their hands. */
    _vrHelp() {
        if (this._vrHelpShown || this.state !== 'playing' || !this.vr.presenting) return;
        const kind = this.vr.inputKind;
        if (!kind) return; // nothing connected yet; this runs again when something is
        this._vrHelpShown = true;
        if (kind === 'controllers') this.toast.flash('Left stick to walk, right stick to turn.', 4000);
        else if (kind === 'hands') this.toast.flash('Pinch and hold to walk where you\'re looking.', 5000);
        else this.toast.flash('Press and hold to walk where you\'re looking.', 5000);
    }

    /** Lets go of the mouse and pauses, e.g. when the tab loses focus. */
    _releaseControls() {
        this.look.unlock();
        // Releasing the mouse pauses too, but asynchronously, and only if it was actually captured.
        this._pause();
    }

    _play() {
        if (this.contextLost || (this.state !== 'title' && this.state !== 'paused' && this.state !== 'ended')) return;
        // A tape starts (or starts again) from the title screen or the ending screen, never from a pause.
        if (this.state !== 'paused' && this.mode === 'footage' && !this.footage.active) {
            this.hud.setFade(false);
            this.footage.begin();
            this.settingsMenu.refresh();
        }
        this.state = 'playing';
        this.started = true;
        this.menu.setState('hidden');
        this.hud.setInGame(true);
        this.hud.setOsdMode(this.editMode ? 'edit' : 'rec');
        this.hud.setCrosshair(this.editMode);
        this.hud.setTools(this.editMode ? EDIT_TOOLS : null, this.editTool.tool);
        this.touchControls.setActive(this.touch && !this.vr.presenting);
        this.toast.resume();
        this.audio.setPaused(false);
        this._accumulator = 0;
        this._glitch(0.7, 0.5);
    }

    _pause() {
        if (this.state !== 'playing') return;
        // The last seconds of a tape play out; the ending screen follows.
        if (this.footage.active && this.footage.ended) return;
        this.state = 'paused';
        this.keyboard.clear();
        this._stickSprint = false;
        this.touchControls.setActive(false);
        this.toast.suspend();
        this.hud.setOsdMode('pause');
        this.hud.setCrosshair(false);
        this.hud.setTools(null);
        this.hud.hideZoom();
        this.editTool.hide();
        this.audio.setPaused(true);
        // There's no pause menu inside the headset, so pausing takes it off (and the menu is on the screen).
        this.vr.exit();
        if (this.contextLost) return; // keep the error message up
        this.menu.setState('paused');
    }

    /**
     * Starts over in another world (or, on a tape, another tape).
     * @param {number} [seed] A random one if left out.
     */
    newWorld(seed = randomSeed()) {
        if (this.mode === 'footage' && this.state === 'paused') {
            // From the pause menu: straight into another tape.
            this.startFootage(seed, this.menu.controller !== null);
            return;
        }
        if (this.mode === 'footage') {
            // A new tape is ready on the title screen; it starts with Start.
            this.footage.stop();
            this.seed = seed;
            this.footage.prepare(seed);
            this._rememberSeed();
            this._flickerLit.clear();
            this.settingsMenu.refresh();
            if (this.state !== 'title') this._showTitle();
            this.toast.flash('New tape.');
            this._glitch(1, 1.1);
            return;
        }
        this.seed = seed;
        this._makeExploreWorld();
        this._flickerLit.clear();
        this.settingsMenu.refresh();
        this._rememberSeed();
        this.toast.flash('Entered a new world.');
        this._glitch(1, 1.1);
    }

    /** The endless level for the current seed, with the player back at its start. */
    _makeExploreWorld() {
        this.store = new ChunkStore(this.seed, new EditLog(this.seed));
        this.world.setStore(this.store);
        this.world.update(0, 0, Infinity);
        this.lighting.update(0, this.store.areaLight(0, 0), true);
        this.textures.wallpaper.offset.set(...wallpaperOffset(this.seed));
        this.player.reset();
        this.look.yaw = 0;
        this.look.pitch = 0;
    }

    /** Keeps the address in step, so the link can be shared. */
    _rememberSeed() {
        const url = new URL(location.href);
        url.searchParams.set('seed', String(this.seed));
        if (this.mode === 'footage') url.searchParams.set('mode', 'footage');
        else url.searchParams.delete('mode');
        history.replaceState(null, '', url);
    }

    // ------------------------------------------------------------------ Found Footage

    /**
     * Picks what the title screen starts. The world behind the title changes with it.
     * @param {GameMode} mode
     */
    setMode(mode) {
        if (mode !== 'explore' && mode !== 'footage') return;
        const changed = mode !== this.mode;
        this.mode = mode;
        this.settings.world.mode = mode;
        saveSettings(this.settings);
        this.menu.setMode(mode, this._modeNote());
        this._rememberSeed();
        if (!changed || this.state !== 'title') return;
        if (mode === 'footage') {
            this.footage.prepare(this.seed);
        } else {
            this.footage.stop();
            this._makeExploreWorld();
        }
        this._flickerLit.clear();
        this._glitch(0.6, 0.6);
    }

    _modeNote() {
        return this.mode === 'footage' ? this.footage.describe() : 'The endless level.';
    }

    /**
     * Starts a tape from the ending screen (or the pause menu's New World).
     * @param {number} seed
     * @param {boolean} [controller] Started with a controller (or touch): no mouse to capture.
     */
    startFootage(seed, controller = false) {
        if (this.contextLost) return;
        this.footage.stop();
        this.seed = seed;
        this.mode = 'footage';
        this.footage.prepare(seed);
        this._flickerLit.clear();
        this._rememberSeed();
        this.state = 'ended'; // whatever it was: the next _play starts the tape
        this._requestPlay(controller || this.touch);
    }

    /**
     * The tape has ended: the screen it ends on.
     * @param {'caught' | 'escaped'} result
     */
    endFootage(result) {
        if (this.state !== 'playing') return;
        this.state = 'ended';
        this.keyboard.clear();
        this._stickSprint = false;
        this.touchControls.setActive(false);
        this.toast.clear();
        this.hud.setOsdMode('pause');
        this.hud.setCrosshair(false);
        this.hud.hideZoom();
        this.hud.hideNote();
        this.audio.setZoomMotor(0);
        this.audio.setPaused(true);
        this.look.unlock();
        this.vr.exit();
        this.menu.showEnding(this.footage.summary());
        this.menu.setMode(this.mode, this._modeNote());
        this.menu.setState('ended');
        void result;
    }

    /** Back to the title screen, leaving the tape (the mode stays picked, with a fresh preview of it). */
    toTitle() {
        if (this.state !== 'ended' && this.state !== 'paused') return;
        this.footage.stop();
        if (this.mode === 'footage') this.footage.prepare(this.seed);
        else this._makeExploreWorld();
        this._flickerLit.clear();
        this._showTitle();
    }

    _showTitle() {
        this.state = 'title';
        this.started = false;
        this.editMode = false;
        this.player.flying = false;
        this.editTool.hide();
        this.hud.setInGame(false);
        this.hud.setFade(false);
        this.hud.setCrosshair(false);
        this.hud.setTools(null);
        this.menu.setMode(this.mode, this._modeNote());
        this.menu.setState('title');
    }

    _goToSeed(text) {
        const seed = parseSeed(text);
        if (seed !== null) this.newWorld(seed);
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

    /** Throws away everything built or knocked down in this world and restores it as generated. */
    _undoEdits() {
        const edits = this.store.edits;
        if (!edits || edits.size === 0) {
            this.toast.flash('Nothing to undo in this world.');
            return;
        }
        edits.clear();
        this.store = new ChunkStore(this.seed, edits);
        this.world.setStore(this.store);
        const p = this.player.position;
        this.world.update(p.x, p.z, Infinity);
        const spot = findFreeSpot(p.x, p.z, PLAYER_RADIUS, this._boxesNear);
        if (p.y < EYE_HEIGHT + WALL_HEIGHT) this.player.reset(spot.x, spot.z);
        this.settingsMenu.refresh();
        this.toast.flash('This world is back the way it was.');
    }

    _resetSettings() {
        resetSettings(this.settings);
        this._applyAllSettings();
        this.settingsMenu.refresh();
        saveSettings(this.settings);
        this.toast.flash('Settings reset.');
    }

    _glitch(strength, seconds) {
        if (!this.reducedMotion) this.post.glitch(strength, seconds);
    }

    // ------------------------------------------------------------------ input

    _onKeyDown(event) {
        if (event.repeat || this.state === 'loading' || this.state === 'error') return;
        const target = /** @type {HTMLElement} */ (event.target);
        this._setController(false);
        if (this.audio.blocked) this.audio.start();
        if (target.closest?.('input, textarea, select, [contenteditable]')) return;
        const playing = this.state === 'playing';
        const graphics = this.settings.graphics;

        switch (event.code) {
            case 'Escape':
                // Only reaches the page when the mouse isn't captured, e.g. playing on with a controller.
                if (playing && !this.look.isLocked) this._pause();
                break;
            case 'KeyF':
                if (!playing) return;
                this._toggleFlashlight();
                break;
            case 'KeyP':
                if (!playing || this.vr.presenting) return; // the canvas doesn't have the headset's picture
                this._stillRequested = true;
                this.hints.markUsed('photo');
                break;
            case 'KeyR':
                if (playing && this.editMode) this._cycleTool(1);
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

    /** The scroll wheel zooms the camera, or picks what to build in edit mode. */
    _onWheel(event) {
        if (this.state !== 'playing') return;
        const delta = event.deltaY * (event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1);
        if (this.editMode) {
            // Trackpads send lots of tiny deltas; wait for about a notch's worth.
            this._toolScroll += delta;
            if (Math.abs(this._toolScroll) >= 60) {
                this._cycleTool(Math.sign(this._toolScroll));
                this._toolScroll = 0;
            }
            return;
        }
        if (this.vr.presenting) return;
        this.zoomTarget = MathUtils.clamp(this.zoomTarget * Math.exp(-delta * 0.0018), 1, MAX_ZOOM);
        this.hints.markUsed('zoom');
    }

    _onMouseDown(event) {
        if (this.state !== 'playing' || this.vr.presenting) return;
        if (!this.touch && !this.look.isLocked) {
            // Playing with a controller leaves the mouse free; clicking the view takes it back.
            this.look.lock();
            return;
        }
        if (!this.editMode) return;
        if (event.button === 0) this._edit('remove');
        else if (event.button === 2) this._edit('build');
    }

    /** @param {'remove' | 'build'} action On whatever edit mode is aiming at. */
    _edit(action) {
        const changed = action === 'remove' ? this.editTool.remove(this.store) : this.editTool.place(this.store, this.player.position);
        if (!changed) return;
        this.world.refreshCell(changed.x, changed.z);
        this.hints.situation('edits', false);
    }

    _toggleFlashlight() {
        this.lighting.setFlashlight(!this.lighting.flashlightOn);
        this.hints.markUsed('flashlight');
    }

    /**
     * Switches hints and menus to name controller buttons (or back to keys), whichever was used last.
     * @param {boolean} active
     */
    _setController(active) {
        const labels = active ? this.gamepad.labels : null;
        if (labels === this._controller) return;
        this._controller = labels;
        this.hints.setController(labels);
        this.menu.setController(labels);
        if (this.gamepad.connected > 0) document.documentElement.dataset.controller = active ? 'active' : 'connected';
    }

    /** Controllers have no events for their buttons, so they're read every frame. */
    _pollController(now, dt) {
        const pad = this.gamepad;
        if (!pad.poll(now)) return;
        if (pad.active) this._setController(true);
        if (this.state === 'playing') this._controllerPlay(pad, dt);
        else if (this.state === 'title' || this.state === 'paused' || this.state === 'ended') this._controllerMenu(pad);
    }

    /** @param {GamepadInput} pad */
    _controllerPlay(pad, dt) {
        if (pad.pressed(BUTTON.MENU)) {
            this._releaseControls();
            return;
        }

        const vr = this.vr.presenting;
        const stick = pad.rightStick;
        if (stick.x !== 0 || stick.y !== 0) {
            const { stickSensitivity, invertStickY } = this.settings.gameplay;
            // Scaled by how far the stick is pushed (so the speed goes with its square): a nudge aims finely,
            // pushing all the way turns quickly. Slower when zoomed in, like the mouse.
            const speed = (STICK_TURN_SPEED * stickSensitivity * Math.hypot(stick.x, stick.y) * dt) / this.zoom;
            this.look.turn(-stick.x * speed, -stick.y * speed * STICK_PITCH_SCALE * (invertStickY ? -1 : 1));
        }

        const move = pad.leftStick;
        if (pad.pressed(BUTTON.LEFT_STICK)) {
            this._stickSprint = true;
            this.hints.markUsed('sprint');
        } else if (Math.hypot(move.x, move.y) < STICK_SPRINT_RELEASE) {
            this._stickSprint = false;
        }

        if (pad.pressed(BUTTON.X)) this._toggleFlashlight();
        if (pad.pressed(BUTTON.Y)) this._toggleEditMode();
        if (pad.pressed(BUTTON.VIEW) && !vr) {
            this._stillRequested = true;
            this.hints.markUsed('photo');
        }

        if (this.editMode) {
            if (pad.pressed(BUTTON.LB)) this._cycleTool(-1);
            if (pad.pressed(BUTTON.RB)) this._cycleTool(1);
            if (pad.pressed(BUTTON.LT)) this._edit('remove');
            if (pad.pressed(BUTTON.RT)) this._edit('build');
        } else if (!vr) {
            // The triggers are pressure sensitive: squeeze harder to zoom faster.
            const zoom = pad.value(BUTTON.RT) - pad.value(BUTTON.LT);
            if (Math.abs(zoom) > 0.05) {
                this.zoomTarget = MathUtils.clamp(this.zoomTarget * Math.exp(zoom * TRIGGER_ZOOM_SPEED * dt), 1, MAX_ZOOM);
                this.hints.markUsed('zoom');
            }
        }
    }

    /** @param {GamepadInput} pad */
    _controllerMenu(pad) {
        if (pad.pressed(BUTTON.MENU) && this.state !== 'ended') {
            this._requestPlay(true);
            return;
        }
        const menu = this.menu;
        if (pad.direction) menu.navigate(pad.direction);
        if (pad.pressed(BUTTON.A)) menu.navigate('confirm');
        if (pad.pressed(BUTTON.B)) menu.navigate('back');
        if (pad.pressed(BUTTON.LB)) menu.navigate('previous');
        if (pad.pressed(BUTTON.RB)) menu.navigate('next');
    }

    _toggleEditMode() {
        if (this.footage.active) {
            this.toast.flash('Edit mode is off in Found Footage.');
            return;
        }
        this.editMode = !this.editMode;
        this.player.flying = this.editMode;
        this.hints.markUsed('edit');
        this.hud.setCrosshair(this.editMode);
        this.hud.setOsdMode(this.editMode ? 'edit' : 'rec');
        this.hud.setTools(this.editMode ? EDIT_TOOLS : null, this.editTool.tool);
        if (this.editMode) {
            // Aiming works best without zoom (and the wheel picks tools now).
            this.zoom = this.zoomTarget = 1;
            this._updateFov();
            this.hud.hideZoom();
            this.audio.setZoomMotor(0);
            const b = this._controller;
            if (this.vr.presenting && this.vr.inputKind === 'controllers') {
                this.toast.flash('Edit mode enabled.\nTrigger builds, grip removes.\nClick the right stick to pick what to build;\npush it up or down to fly.', 6000);
            } else {
                this.toast.flash(b
                    ? `Edit mode enabled.\n${b.lt} removes, ${b.rt} builds.\n${b.lb} and ${b.rb} pick what to build; ${b.a} and ${b.b} fly.`
                    : 'Edit mode enabled.\nLeft click removes, right click builds.\nScroll or R picks what to build; Space / Q and E fly.', 5000);
            }
        } else {
            this.editTool.hide();
            this.toast.flash('Edit mode disabled.');
        }
    }

    _cycleTool(direction) {
        const tool = this.editTool.cycleTool(direction);
        this.hud.setTools(EDIT_TOOLS, tool);
        // The list of tools is on the screen, not in the headset.
        if (this.vr.presenting) this.toast.flash(tool[0].toUpperCase() + tool.slice(1));
    }

    // ------------------------------------------------------------------ settings

    /** Applies a setting changed by a keyboard shortcut and keeps the menu and storage in sync. */
    _settingChanged(path) {
        this._applySetting(path);
        this.settingsMenu.refresh();
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
            case 'graphics.minimap':
                this.minimap.setEnabled(graphics.minimap);
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
                this._updateFov();
                break;
            case 'audio.volume':
            case 'audio.muted':
                this.audio.setVolume(audio.volume / 100);
                this.audio.setMuted(audio.muted);
                break;
            case 'audio.footsteps':
                this.audio.footstepsEnabled = audio.footsteps;
                break;
            case 'audio.ambience':
                this.audio.ambienceEnabled = audio.ambience;
                break;
            case 'world.powerCuts':
                this.blackouts.enabled = this.settings.world.powerCuts;
                if (!this.blackouts.enabled && this.blackouts.level > 0) {
                    this.blackouts.cancel();
                    this.audio.powerRestored();
                }
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
            'graphics.minimap',
            'graphics.showStats',
            'gameplay.mouseSensitivity',
            'gameplay.fieldOfView',
            'audio.volume',
            'audio.footsteps',
            'audio.ambience',
            'world.powerCuts',
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

        // On a tape the static is the picture going: it's always on, whatever the settings say.
        const footage = this.footage?.active === true;
        if (footage) u.staticEnabled.value = true;
        const anyVhsStage = ['static', 'rgbShift', 'film', 'badTV', 'vignette'].some((key) => effects[key].enabled);
        this.post.setEnabled((effects.enabled && anyVhsStage) || footage, effects.enabled && effects.bloom.enabled);
    }

    /** Field of view from the setting, narrowed by the camcorder zoom. */
    _updateFov() {
        const base = MathUtils.degToRad(this.settings.gameplay.fieldOfView);
        this.camera.fov = MathUtils.radToDeg(2 * Math.atan(Math.tan(base / 2) / this.zoom));
        this.camera.updateProjectionMatrix();
        this.look.zoom = this.zoom;
    }

    _resize() {
        // The headset decides the size while it's on (three.js refuses to change it).
        if (this.vr?.presenting) return;
        const width = innerWidth;
        const height = innerHeight;
        const pixelRatio = (Math.min(devicePixelRatio, 2) * this.settings.graphics.resolutionScale) / 100;
        // Phones send resize events that change nothing (e.g. as browser bars show and hide). Resizing
        // reallocates every render target, which is a hitch, so only do it for a real change.
        const size = `${width}x${height}@${pixelRatio}`;
        if (size === this._size) return;
        this._size = size;
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.post.setSize(width, height, pixelRatio);
    }

    // ------------------------------------------------------------------ frame

    /**
     * @param {number} timeMs
     * @param {XRFrame} [xrFrame] While in VR.
     */
    _frame(timeMs, xrFrame) {
        const now = timeMs / 1000;
        const vr = this.vr.presenting;

        // Optional frame-rate limit (and a lower rate on the menus, which barely change). Never in VR: the
        // headset sets the pace, and it would show a skipped frame as garbage.
        const limit = vr ? 0 : this.state === 'playing' ? this.settings.graphics.fpsLimit : MENU_FPS;
        if (limit > 0) {
            if (now < this._nextFrameTime - 0.002) return;
            this._nextFrameTime = Math.max(this._nextFrameTime + 1 / limit, now);
        }

        const dt = this._lastFrameTime < 0 ? 0 : MathUtils.clamp(now - this._lastFrameTime, 0, MAX_FRAME_TIME);
        this._lastFrameTime = now;

        this._pollController(now, dt);
        if (vr) this.vr.beginFrame(xrFrame);

        const { camera, player, look } = this;
        const playing = this.state === 'playing';
        const footage = this.footage.active;
        let alpha = 1;

        if (playing) {
            if (vr) this._vrPlay(dt);
            this._accumulator += dt;
            const input = this._readMoveInput();
            // In VR, forward is wherever the headset faces.
            const yaw = vr ? this.vr.headYaw(look.yaw) : look.yaw;
            const speed = this.settings.gameplay.movementSpeed * (vr ? VR_SPEED : 1);
            while (this._accumulator >= STEP) {
                player.step(input, yaw, speed, this._boxesNear);
                this._accumulator -= STEP;
            }
            alpha = this._accumulator / STEP;
            this.playTime += dt;
            this.hints.update(this.playTime);
            this.hud.setPlayTime(this.playTime);
            this._updateZoom(dt);
            if (player.steps !== this._stepsHeard) {
                this._stepsHeard = player.steps;
                this.audio.footstep(player.stepWeight);
            }
        } else if (this.state === 'title' && !this.reducedMotion && !vr) {
            // Slowly look around on the title screen, like an idle camcorder.
            look.yaw = Math.sin(now * 0.05) * 0.55;
            look.pitch = Math.sin(now * 0.037) * 0.04;
        }

        // Where everything is seen from: the camera, or in VR the headset (which moves the camera itself).
        let view = camera;
        if (vr) {
            _vrPosition.lerpVectors(player.previousPosition, player.position, alpha);
            this.vr.place(_vrPosition, look.yaw);
            view = this.vr.head;
        } else {
            camera.position.lerpVectors(player.previousPosition, player.position, alpha);
            look.applyTo(camera);
            if (playing && this.settings.gameplay.headBob) {
                const bob = player.headBob();
                _cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
                camera.position.addScaledVector(_cameraRight, bob.right);
                camera.position.y += bob.up;
            }
        }

        this.world.update(player.position.x, player.position.z, CHUNK_BUILDS_PER_FRAME);
        this.lighting.update(dt, this.store.areaLight(view.position.x, view.position.z));
        // In VR the flashlight is held in a hand (or, with nothing to hold it, worn like on the screen).
        const lightHand = vr && this.vr.lightHand.tracked ? this.vr.lightHand : null;
        this.lighting.updateFlashlight(lightHand ? lightHand.aim : view, this.world.version, lightHand !== null);
        this.audio.setAreaLight(this.lighting.areaLight);
        if (playing) {
            // A power cut, or on a tape the lights failing as the notes go (and as it comes close).
            const cut = this.blackouts.update(dt, this._onBlackoutEvent);
            if (footage) this.footage.update(dt, view);
            this.lighting.setBlackout(Math.max(cut, footage ? this.footage.gloom : 0));
            this.audio.update(dt);
            const facing = vr ? this.vr.headYaw(look.yaw) : look.yaw;
            this._updateFlickerSounds(view.position, facing);
            this.minimap.update(this.store, view.position.x, view.position.z, facing);
            if (this.lighting.areaLight < DARK_AREA && !this.editMode && !footage) this.hints.situation('dark', this.lighting.flashlightOn);
            if (this.editMode) this.editTool.update(vr ? this.vr.aim : camera, this.store);
        }
        if (vr) {
            this.vr.setFlashlight(this.lighting.flashlightOn);
            this.vr.setLaser(playing && this.editMode ? this.editTool.hitDistance ?? EDIT_REACH : null);
        }
        this.hud.setCoordinates(chunkCoord(cellCoord(player.position.x)), chunkCoord(cellCoord(player.position.z)));

        this.renderer.info.reset();
        // No VHS pass in VR: post-processing doesn't work with WebXR, and a rolling, wobbling picture strapped
        // to your face would make you feel sick anyway.
        if (vr) this.renderer.render(this.scene, camera);
        else this.post.render(dt);

        if (this._stillRequested) {
            // Straight after rendering, while the frame is still in the canvas.
            this._stillRequested = false;
            saveStill(this.canvas, this.seed);
            this.toast.flash('Still saved.');
        }

        if (this.settings.graphics.showStats) this._updateStats(now, dt);
    }

    _updateZoom(dt) {
        const previous = this.zoom;
        this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-dt * 9));
        if (Math.abs(this.zoomTarget - this.zoom) < 0.002) this.zoom = this.zoomTarget;
        if (this.zoom === previous) {
            this.audio.setZoomMotor(0);
            return;
        }
        this._updateFov();
        this.hud.showZoom((this.zoom - 1) / (MAX_ZOOM - 1));
        this.audio.setZoomMotor(dt > 0 ? Math.abs(this.zoom - previous) / dt / 3 : 0);
    }

    /**
     * A failing tube close by buzzes every time it flickers back on.
     * @param {Vector3} listener Where it's heard from.
     * @param {number} yaw Which way the listener faces.
     */
    _updateFlickerSounds(listener, yaw) {
        if (!this.settings.audio.ambience || this.lighting.blackout > 0.5) return;
        const { x, z } = listener;
        const time = this.lighting.time;
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);
        const firstX = Math.floor((x - BUZZ_RANGE - 1) / 2) * 2 + 1;
        const firstZ = Math.floor((z - BUZZ_RANGE - 1) / 2) * 2 + 1;
        for (let px = firstX; px <= x + BUZZ_RANGE; px += 2) {
            for (let pz = firstZ; pz <= z + BUZZ_RANGE; pz += 2) {
                const data = this.store.panelData(px, pz);
                const offset = this.store.panelOffset(px, pz);
                const pattern = data[offset + 2];
                if (pattern === 0 || data[offset] === 0) continue;
                const key = px * 1048576 + pz;
                const lit = panelFlicker(pattern, time) === 1;
                const wasLit = this._flickerLit.get(key) ?? true;
                this._flickerLit.set(key, lit);
                if (!lit || wasLit) continue;
                const distance = Math.hypot(px - x, pz - z, 0.5);
                if (distance > BUZZ_RANGE) continue;
                const pan = ((px - x) * rightX + (pz - z) * rightZ) / distance;
                this.audio.buzz((1 - distance / BUZZ_RANGE) ** 2, pan);
            }
        }
        if (this._flickerLit.size > 400) this._flickerLit.clear();
    }

    _readMoveInput() {
        const kb = this.keyboard;
        const input = this._moveInput;
        const touch = this.touchControls.move;
        const pad = this.gamepad;
        const stick = pad.leftStick;
        const padUp = (pad.held(BUTTON.A) ? 1 : 0) - (pad.held(BUTTON.B) ? 1 : 0);
        const vr = this._vrMove;
        input.forward = MathUtils.clamp(kb.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) + touch.forward - stick.y + vr.forward, -1, 1);
        input.right = MathUtils.clamp(kb.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) + touch.right + stick.x + vr.right, -1, 1);
        input.up = MathUtils.clamp(kb.axis(['KeyE'], ['Space', 'KeyQ']) + padUp + vr.up, -1, 1);
        input.sprint = kb.isDown('ShiftLeft', 'ShiftRight') || touch.sprint || this._stickSprint || vr.sprint;
        // On a tape you can only run so far, and not at all once it's over.
        if (this.footage.active) this.footage.filterInput(input);
        return input;
    }

    /** VR controllers (and pinching hands), read every frame while playing in a headset. */
    _vrPlay(dt) {
        const { vr, look } = this;
        // Walking around the room moves you too, but not through walls.
        vr.trackedMovement(look.yaw, _tracked);
        this.player.shift(_tracked.x, _tracked.z, this._boxesNear);

        const move = this._vrMove;
        move.forward = move.right = move.up = 0;
        if (!vr.visible) {
            // The headset's own menu is up.
            move.sprint = false;
            return;
        }
        const [left, right] = vr.hands;

        // Left stick walks (towards where you're looking), or a held pinch walks straight ahead. Clicking
        // the stick runs until it's let go.
        const walk = left.stick;
        move.forward = -walk.y + (vr.walking ? 1 : 0);
        move.right = walk.x;
        if (left.pressed(XR_BUTTON.STICK)) {
            move.sprint = true;
            this.hints.markUsed('sprint');
        } else if (Math.hypot(walk.x, walk.y) < STICK_SPRINT_RELEASE) {
            move.sprint = false;
        }

        // Right stick turns: in steps (easier on the stomach), or smoothly if that's what's set.
        const turn = right.stick;
        const snap = this.settings.vr.snapTurn;
        if (snap > 0) {
            if (!this._snapped && Math.abs(turn.x) > SNAP_PRESS) {
                look.yaw -= Math.sign(turn.x) * MathUtils.degToRad(snap);
                this._snapped = true;
            } else if (Math.abs(turn.x) < SNAP_RELEASE) {
                this._snapped = false;
            }
        } else if (turn.x !== 0) {
            look.yaw -= turn.x * Math.abs(turn.x) * STICK_TURN_SPEED * this.settings.gameplay.stickSensitivity * dt;
        }
        // In edit mode, pushing it up and down flies.
        if (this.editMode && Math.abs(turn.y) > Math.abs(turn.x)) move.up = -turn.y;

        for (const hand of vr.hands) {
            if (hand.pressed(XR_BUTTON.A)) this._flashlightInHand(hand);
        }
        if (left.pressed(XR_BUTTON.B) || right.pressed(XR_BUTTON.B)) this._toggleEditMode();

        if (!this.editMode) return;
        if (right.pressed(XR_BUTTON.STICK)) this._cycleTool(1);
        for (const hand of vr.hands) {
            const build = hand.pressed(XR_BUTTON.TRIGGER);
            if (!build && !hand.pressed(XR_BUTTON.SQUEEZE)) continue;
            if (vr.aimHand !== hand) {
                // Aim with this hand from now on.
                vr.aimHand = hand;
                this.editTool.update(hand.aim, this.store);
            }
            this._edit(build ? 'build' : 'remove');
        }
    }

    /** A or X in VR: the flashlight comes on in that hand, moves over to it from the other, or goes off. */
    _flashlightInHand(hand) {
        const moving = this.lighting.flashlightOn && this.vr.lightHand !== hand;
        this.vr.lightHand = hand;
        if (moving) this.hints.markUsed('flashlight');
        else this._toggleFlashlight();
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
        const zone = this.store.getChunk(chunkCoord(cellCoord(p.x)), chunkCoord(cellCoord(p.z))).zone;
        this.hud.setStats([
            `FPS    ${stats.fps} (${stats.frameMs.toFixed(1)} ms)`,
            `CALLS  ${info.render.calls}`,
            `TRIS   ${(info.render.triangles / 1000).toFixed(1)}k`,
            `CHUNKS ${this.world.loadedCount}`,
            `POS    ${p.x.toFixed(1)} ${p.y.toFixed(2)} ${p.z.toFixed(1)}`,
            `ZONE   ${ZONE_NAMES[zone.type]}`,
            `LIGHT  ${this.lighting.areaLight.toFixed(2)}${this.lighting.blackout > 0 ? ` CUT ${this.lighting.blackout.toFixed(2)}` : ''}`,
            `SEED   ${this.seed}`,
            ...(this.footage.active ? [`TAPE   ${this.footage.found} notes, ${this.footage.watcher.state} ${this.footage.watcher.distance.toFixed(1)} exp ${this.footage.exposure.toFixed(2)}`] : []),
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
