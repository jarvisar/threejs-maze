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
import { PartyAudio } from './audio/Party.js';
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
import { desktop } from './desktop.js';
import { NOTE_COUNT } from './footage/arena.js';
import { FoundFootage } from './footage/FoundFootage.js';
import { formatTime } from './footage/records.js';
import { Confetti } from './fx/Confetti.js';
import { PostProcessing } from './fx/PostProcessing.js';
import { Reflection } from './fx/Reflection.js';
import { dedicatedGpu, gpuName } from './gpu.js';
import { BUTTON, GamepadInput } from './input/Gamepad.js';
import { KonamiCode, konamiButton, konamiKey, listenForGestures } from './input/konami.js';
import { Keyboard } from './input/Keyboard.js';
import { LookControls } from './input/LookControls.js';
import { TouchControls } from './input/TouchControls.js';
import { findFreeSpot } from './player/collision.js';
import { EditHistory, builds, changedCells } from './player/EditHistory.js';
import { EditTool } from './player/EditTool.js';
import { Player } from './player/Player.js';
import { raycastWorld } from './player/raycast.js';
import { DEFAULT_SETTINGS, applyDeviceDefaults, flushSettings, loadSettings, resetSettings, saveSettings } from './settings.js';
import { Catalogue } from './ui/Catalogue.js';
import { Fullscreen, WindowFullscreen } from './ui/Fullscreen.js';
import { Hints } from './ui/Hints.js';
import { Hud } from './ui/Hud.js';
import { Menu } from './ui/Menu.js';
import { Minimap } from './ui/Minimap.js';
import { SettingsMenu } from './ui/SettingsMenu.js';
import { settingsPages } from './ui/settingsPages.js';
import { saveStill } from './ui/stills.js';
import { Thumbnails } from './ui/thumbnails.js';
import { Toast } from './ui/Toast.js';
import { findLevelFun, levelFunFound } from './unlocks.js';
import { Blackouts } from './world/blackouts.js';
import { ChunkStore, cellCoord, chunkCoord } from './world/ChunkStore.js';
import { EditLog } from './world/edits.js';
import { LEVELS, LEVELS_IN_ORDER, TAPE_LEVELS, isFirstTapeLevel, levelById, nextTapeLevel, partyLevel } from './world/levels.js';
import { Lighting } from './world/lighting.js';
import { compileForLevel, createMaterials, whenCompiled, worldLighting } from './world/materials.js';
import { PanelLightMap } from './world/panelLights.js';
import { PartyLayer } from './world/PartyLayer.js';
import { parseSeed, randomSeed, wallpaperOffset } from './world/random.js';
import { storm } from './world/storm.js';
import { loadTextures } from './world/textures.js';
import { WorldView } from './world/WorldView.js';
import { ZONE_NAMES } from './world/zones.js';
import { VR } from './xr/VR.js';
import { XR_BUTTON } from './xr/VRHand.js';

const STEP = 1 / PHYSICS_RATE;
const MAX_FRAME_TIME = 0.25; // don't try to catch up on more than this after a stall
const MENU_FPS = 30; // title/pause screens are mostly static, no need to burn power on them
const CHUNK_BUILDS_PER_FRAME = 1;
// Max time per frame for loading and building chunks (ms). The rest waits for the next frame, including the rest of a
// chunk being built (see WorldView.update).
const CHUNK_BUDGET = 4;
// Readying a new world (see settle): build time per frame (ms), and how long (s) before the wait shows on the Start
// button or, while playing, as a fade out.
const SETTLE_BUDGET = 10;
const SETTLE_SHOWS_AFTER = 0.3;
// Readying the other levels while a menu is up (see _prepareLevels): delay before starting and gap between steps (s),
// so the menu stays responsive.
const PREPARE_AFTER = 1;
const PREPARE_GAP = 0.1;
// A long menu frame (from a step or anything else) holds off the next step for this many times the hitch, up to the
// max (s). A step can block for a few hundred ms on a phone, and back to back that's a constant stutter.
const PREPARE_BACKOFF = 10;
const PREPARE_BACKOFF_MAX = 8;
// Area light below this counts as "in the dark" for the flashlight hint.
const DARK_AREA = 0.45;
// Holding build/remove repeats on each new thing you sweep over, but only after this long (s) so a click doesn't
// act twice.
const EDIT_HOLD_DELAY = 0.25;
const THUMBNAIL_BUDGET = 2; // ms per frame for drawing catalogue thumbnails
// Controller right stick turn speed at full push (rad/s, pitch a bit slower) and trigger zoom speed.
const STICK_TURN_SPEED = 2.6;
const STICK_PITCH_SCALE = 0.75;
const TRIGGER_ZOOM_SPEED = 1.6;
// Clicking the left stick sprints until the stick comes back to about here.
const STICK_SPRINT_RELEASE = 0.3;
// VR walks slower than on screen since fast movement you don't make yourself causes motion sickness. Snap turn fires
// once per flick past SNAP_PRESS, then waits for the stick to come back past SNAP_RELEASE.
const VR_SPEED = 0.6;
const SNAP_PRESS = 0.7;
const SNAP_RELEASE = 0.35;
// How far up the right stick has to go to jump in VR.
const VR_JUMP = 0.7;
// Expensive effects get turned off when the frame rate can't keep up (see _watchFrameRate). The first SETTLE_SECONDS
// after starting or resuming are ignored. AO goes first, once fps stays under OCCLUSION_FPS * TARGET_FPS (or the FPS
// limit if lower) for OCCLUSION_SLOW_SECONDS. It's a fraction because frames never land exactly on time.
// Dynamic lights are the last resort, after AO is off, under LIGHTS_MIN_FPS (or 3/4 of the FPS limit) for
// LIGHTS_SLOW_SECONDS.
const SETTLE_SECONDS = 3;
const TARGET_FPS = 60;
const OCCLUSION_FPS = 0.85;
const OCCLUSION_SLOW_SECONDS = 2;
const LIGHTS_MIN_FPS = 40;
const LIGHTS_SLOW_SECONDS = 5;
// Level Fun: music box hearing range for a cake, and how close a mirror ball has to be before you're at the party
// instead of hearing it through the walls.
const MUSIC_BOX_RANGE = 7;
const PARTY_ROOM = 1.5;
const PARTY_NEAR = 4.5;

const _cameraRight = new Vector3();
const _forward = new Vector3();
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

        // Phones and tablets get on-screen controls instead of keyboard, mouse and pointer lock.
        this.touch = !matchMedia('(any-pointer: fine)').matches && navigator.maxTouchPoints > 0;
        // CSS uses this to show matching controls and hints.
        document.documentElement.dataset.input = this.touch ? 'touch' : 'mouse';

        const params = new URLSearchParams(location.search);
        this.seed = parseSeed(params.get('seed')) ?? randomSeed();
        this.debug = import.meta.env.DEV || params.has('debug');
        /** @type {GameMode} What Start starts: endless Explore or a Found Footage tape. */
        this.mode = params.get('mode') === 'footage' ? 'footage' : params.get('mode') === 'explore' ? 'explore' : this.settings.world.mode;
        const level = params.get('level');
        /** Explore level, from the title screen or the URL. Tapes always start at the first of TAPE_LEVELS. */
        this.level = /^\d+$/.test(level ?? '') && LEVELS[Number(level)] ? Number(level) : levelById(this.settings.world.level).id;
        /** Level Fun unlocked, by finishing a tape or the Konami code (see unlocks.js). */
        this.levelFunFound = levelFunFound();
        /**
         * Level Fun is a level dressed for a party (see party.js). Once found it can be picked for Explore like the
         * others.
         */
        this.party = this.levelFunFound && (level === 'fun' || (level === null && this.mode === 'explore' && this.settings.world.fun));
        if (this.party) this.level = partyLevel();
        this.konami = new KonamiCode();

        this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('scene'));
        this.menu = new Menu();
        this.menu.touch = this.touch;
        this.hud = new Hud();
        this.minimap = new Minimap(/** @type {HTMLCanvasElement} */ (document.getElementById('minimap')));
        this.toast = new Toast(/** @type {HTMLElement} */ (document.getElementById('toast')));
        this.hints = new Hints(this.toast);
        this.fullscreen = desktop ? new WindowFullscreen(desktop) : new Fullscreen();
        this.keyboard = new Keyboard();
        this.gamepad = new GamepadInput();
        this.audio = new Ambience();
        this.dread = new Dread(this.audio);
        this.partyAudio = new PartyAudio(this.audio);
        /**
         * Per-level sound on top of the ambience, indexed by level number (see levels.js).
         * @type {(import('./world/levels.js').LevelSound | null)[]}
         */
        this.levelSounds = LEVELS.map((level) => level.sound?.(this.audio) ?? null);
        this._onGuestPop = (x, y, z) => this._guestPopped(x, y, z);
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
        /** Time (ms) of the last animation frame callback, drawn or not, and the display's frame time (s) from them. */
        this._lastCallback = 0;
        this._displayFrame = 1 / 60;
        /** Longest time (ms) between callbacks since the last drawn frame (see _offerPrepareStep). */
        this._longestGap = 0;
        this._size = ''; // canvas size and pixel ratio at the last resize
        this._stats ={ frames: 0, time: 0, fps: 0, frameMs: 0, nextUpdate: 0 };
        this._moveInput = { forward: 0, right: 0, up: 0, sprint: false, jump: false };
        this._boxesNear = (minX, minZ, maxX, maxZ, doorsSolid) => this.store.boxesNear(minX, minZ, maxX, maxZ, doorsSolid);
        /**
         * Uneven floor under water for the player to walk down into (Level 37, see levels.js). Null on flat levels.
         * @type {import('./player/Player.js').Terrain | null}
         */
        this.terrain = null;
        this._groundAt = (x, z) => this.store.groundAt(x, z);
        this._ladderAt = (x, z, reach) => this.store.ladderAt(x, z, reach);
        this._headroomAt = (x, z) => this.store.headroomAt(x, z);
        this._stepsHeard = 0;
        this._landingsHeard = 0;
        this._strokesHeard = 0;
        // Next water ripple slot to use (see worldLighting.poolRipples).
        this._rippleNext = 0;
        this._stillRequested = false;
        this._toolScroll = 0;
        /** Edit mode undo/redo (see EditHistory.js). */
        this.history = new EditHistory();
        /**
         * Build/remove button held in edit mode (see _holdEdit). Tracks the input source and button, start time (s),
         * and what it has already acted on.
         * @type {{ action: 'build' | 'remove', source: 'mouse' | 'pad' | import('./xr/VRHand.js').VRHand, button: number, since: number, done: Set<string> } | null}
         */
        this._editHold = null;
        /** Edit mode key help under the time is expanded (see _showEditHelp). */
        this._editHelpOpen = true;
        /** All catalogue thumbnails are drawn (see Thumbnails.prepare). */
        this._thumbnailsReady = false;
        /** @type {import('./input/Gamepad.js').ButtonLabels | null} Button names while a controller is in use. */
        this._controller = null;
        this._stickSprint = false;
        /** Movement from VR controllers or pinching, merged with the other inputs. */
        this._vrMove = { forward: 0, right: 0, up: 0, sprint: false, jump: false };
        this._snapped = false;
        this._vrHelpShown = false;
        /** @type {EditLog | null} Explore edits for the current seed, kept while a tape is playing. */
        this._edits = null;
        /** Auto-disable AO, then dynamic lights, on low frame rate. Each stops once the player changes that setting. */
        this._watchOcclusion = true;
        this._watchLights = true;
        this._frameWatch = { settle: SETTLE_SECONDS, time: 0, frames: 0, slow: 0 };
        /** Default FPS limit for this device (see _applyDeviceDefaults). */
        this._fpsLimitByDefault = DEFAULT_SETTINGS.graphics.fpsLimit;
        /** Explore level to return to after the Konami code moved us to Level Fun from a level that can't be dressed. */
        this._partyFrom = null;
        /**
         * World that's in place but not ready to show yet (see settle), or null.
         * @type {{ since: number, held: boolean, told: boolean, surfaces: boolean, textures: import('three').Texture[] | null, compiling: boolean, then: (() => void)[] } | null}
         */
        this._settling = null;
        /** Levels with all shaders compiled (see _prepareLevels). */
        this._prepared = new Set();
        /** When the menu was last idle enough to prepare another level (see _prepareLevels), and the pending step. */
        this._prepareAt = Infinity;
        /** @type {(() => void) | null} */
        this._prepareStep = null;
    }

    async init() {
        try {
            this.menu.setProgress(0, 'Loading');
            this._createRenderer();
            this._applyDeviceDefaults();
            await this._loadAssets();
            await this._createWorld();
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
        this._showLevels();
        this._showMode();
        this.hud.coordinates.hidden = false;
        if (this.touch) this.hints.touchOnly();
        else if (!matchMedia('(any-pointer: fine)').matches && this.gamepad.connected === 0) {
            this.menu.setNote('This game needs a keyboard and mouse, a controller, or a touch screen.');
        }
        this.renderer.setAnimationLoop((time, xrFrame) => this._frame(time, xrFrame));
        this._prepareAt = performance.now() / 1000 + PREPARE_AFTER;
        this._prepareLevels().catch((error) => console.warn('Could not get the other levels ready:', error));

        if (this.debug) window.__backrooms = this;
    }

    // ------------------------------------------------------------------ setup

    _createRenderer() {
        // three.js only gives the VR eye buffers MSAA if the canvas has it, and reads that when the renderer is created.
        // The canvas doesn't need it, but VR renders straight to the eyes with nothing else to smooth edges, so we
        // fake antialias: true just while the renderer is made.
        const context = globalThis.WebGL2RenderingContext?.prototype;
        const getAttributes = context?.getContextAttributes;
        if (context && getAttributes) {
            context.getContextAttributes = function () {
                const attributes = getAttributes.call(this);
                return attributes && { ...attributes, antialias: true };
            };
        }
        try {
            this.renderer = new WebGLRenderer({
                canvas: this.canvas,
                antialias: false, // everything goes through post-processing render targets anyway
                stencil: false,
                powerPreference: 'high-performance',
            });
        } catch (error) {
            throw new WebGLUnavailableError(error);
        } finally {
            if (context && getAttributes) context.getContextAttributes = getAttributes;
        }
        const renderer = this.renderer;
        renderer.outputColorSpace = LinearSRGBColorSpace; // see colorManagement.js
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = PCFShadowMap;
        // A frame is several render passes. Count them all for the stats readout.
        renderer.info.autoReset = false;

        this.scene = new Scene();
        // The scene never moves. Left on, its matrix update makes every object under it recompute its world matrix on
        // every render (a few per frame), frozen chunks included (see freeze in WorldView.js).
        this.scene.matrixAutoUpdate = false;
        // Scene background instead of the renderer clear color because it survives a WebGL context restore.
        this.scene.background = new Color(CLEAR_COLOR);
        this.scene.fog = new FogExp2(FOG_COLOR, FOG_DENSITY);
        // Near plane is close enough that walls don't clip even when you're pressed against them.
        this.camera = new PerspectiveCamera(this.settings.gameplay.fieldOfView, innerWidth / innerHeight, 0.03, VIEW_DISTANCE);
        this.camera.position.set(0, EYE_HEIGHT, 0);
    }

    /** Device-dependent defaults for unset settings: no FPS limit on a dedicated GPU (see gpu.js), else 60. */
    _applyDeviceDefaults() {
        if (dedicatedGpu(gpuName(this.renderer.getContext()))) this._fpsLimitByDefault = 0;
        applyDeviceDefaults(this.settings, { fpsLimit: this._fpsLimitByDefault });
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

    /**
     * Builds the world behind the title screen in steps, yielding a frame between each so the page and loading bar
     * stay live. Making a level's textures and chunks takes seconds on a phone.
     */
    async _createWorld() {
        this.menu.setProgress(0.62, 'Generating level');
        await nextFrame();
        this.store = new ChunkStore(this.seed, this._editLog(), this._levelOptions());
        this.store.setParty(this.party);
        this.panelLights = new PanelLightMap();
        this.materials = createMaterials(this.textures, this.panelLights.texture, this.renderer.capabilities.getMaxAnisotropy(), this.panelLights.cells);
        await nextFrame();
        // Only make materials for the first level shown (a tape starts on its first level). The rest are made later
        // (see _prepareLevels).
        this.materials.level(this.mode === 'footage' ? TAPE_LEVELS[0] : this.store.level);
        await nextFrame();
        this.lighting = new Lighting(this.scene, this.materials.ceiling, this.materials.ceilingDecal);
        this.world = new WorldView(this.scene, this.store, this.materials, this.panelLights);
        this.partyLayer = new PartyLayer(this.materials.party);
        this.world.party = this.partyLayer;
        this.confetti = new Confetti(this.scene, this.materials.party.confetti);
        this.player = new Player();
        this.look = new LookControls(this.canvas);
        this.touchControls = new TouchControls(/** @type {HTMLElement} */ (document.getElementById('touch')), this.look);
        this.editTool = new EditTool(this.scene, { build: this.materials.highlight, select: this.materials.selection });
        this.editTool.setLevelFun(this.levelFunFound);
        this.thumbnails = new Thumbnails(this.renderer, this.materials.prop.map, this.materials.party.atlas);
        this.catalogue = new Catalogue(/** @type {HTMLElement} */ (document.getElementById('catalogue')), this.thumbnails);
        this.post = new PostProcessing(this.renderer, this.scene, this.camera);
        this.reflection = new Reflection(this.renderer);
        this.vr = new VR(this.renderer, this.scene, this.camera, this.materials.highlight);
        // Same as on screen: no title flicker or fades with reduced motion.
        this.vr.title.flicker = !this.reducedMotion;
        this.vr.fade.instant = this.reducedMotion;
        this._resize();

        // Found Footage has its own world, built when the mode is picked. Only the title screen world is built now.
        this.footage = new FoundFootage(this);
        await nextFrame();
        this._applyParty();
        this._applyLevel();
        if (this.mode === 'footage') {
            this.footage.prepare(this.seed);
        } else {
            this.settle();
            this.lighting.update(0, this.store.areaLight(0, 0), true);
        }
        // Build its chunks a few per frame. _warmUp does the rest of what settle would.
        this._surfacesReady();
        for (;;) {
            this.world.update(0, 0, Infinity, SETTLE_BUDGET);
            if (this.world.pending === 0) break;
            await nextFrame();
        }
    }

    /**
     * Does all first-use GPU work for the current level behind the loading screen. Otherwise three.js compiles
     * shaders and uploads textures the first time something comes into view, which is what made the old version
     * freeze. Other levels are prepared once the title screen is up (see _prepareLevels).
     */
    async _warmUp() {
        const { renderer, scene, camera } = this;
        const level = this.store.level;

        this.menu.setProgress(0.66, 'Uploading textures');
        for (const texture of Object.values(this.textures)) renderer.initTexture(texture);
        renderer.initTexture(this.panelLights.texture);
        renderer.initTexture(this.panelLights.cells);
        renderer.initTexture(this.materials.decal.map);
        renderer.initTexture(this.materials.prop.map);
        renderer.initTexture(this.materials.party.wallpaper);
        renderer.initTexture(this.materials.party.atlas);
        for (const texture of [...this.footage.textures, ...this.partyLayer.textures]) renderer.initTexture(texture);
        for (const texture of surfaceTextures(this.materials.level(level))) renderer.initTexture(texture);
        await nextFrame();

        this.menu.setProgress(0.72, 'Compiling shaders');
        this.editTool.showAll();
        this.vr.showAll();
        const warmUp = this.world.warmUp(level, this._warmUpExtras());
        await whenCompiled(renderer, await compileForLevel(renderer, scene, camera, level, { also: [warmUp.objects] }));
        warmUp.dispose();
        this.vr.hideAll();

        // Draw a few frames with everything on (flashlight shadows, bloom, VHS, water reflection, AO if enabled) to
        // catch shaders compile() misses and get every resource onto the GPU once.
        this.menu.setProgress(0.9, 'Warming up');
        await this._applyAmbientOcclusion();
        this.lighting.setFlashlight(true);
        this.post.setEnabled(true, true);
        const reflect = levelById(level).reflections;
        this.reflection.setActive(reflect);
        for (let i = 0; i < 4; i++) {
            this.look.yaw = (i * Math.PI) / 2;
            this.look.applyTo(camera);
            this.lighting.updateFlashlight(camera, this.world.version);
            if (reflect) this.reflection.render(scene, camera);
            this.post.render(0);
            await nextFrame();
        }
        this.look.yaw = 0;
        this.editTool.hide();
        this.lighting.setFlashlight(false);
        this.reflection.setActive(false);
        this._settling = null;
        this._prepared.add(level);
        this.menu.setProgress(1, 'Ready');
    }

    /** Materials the game modes add on top of the level's own, to compile up front. */
    _warmUpExtras() {
        return [...Object.values(this.footage.materials), this.partyLayer.glowMaterial];
    }

    _createSettingsMenu() {
        const root = /** @type {HTMLElement} */ (document.getElementById('settings'));
        this.settingsMenu = new SettingsMenu(root, this.settings, settingsPages(() => String(this.seed), () => String(this.store.edits?.size ?? 0), () => this.state === 'paused'), {
            onChange: (path) => {
                if (path === 'graphics.ambientOcclusion') this._watchOcclusion = false;
                if (path === 'graphics.dynamicLights') this._watchLights = false;
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
        // Page focus doesn't matter in VR. The headset reports when it's in use (see VR.visible).
        window.addEventListener('blur', () => {
            if (!this.vr.presenting) this._releaseControls();
        });
        document.addEventListener('visibilitychange', () => {
            // Mute hidden tabs, except in VR where the headset keeps it running.
            if (!this.vr.presenting) this.audio.setHidden(document.hidden);
            if (!document.hidden) return;
            if (!this.vr.presenting) this._releaseControls();
            // Otherwise changes made right before closing the tab get lost.
            flushSettings();
            this._edits?.save();
        });
        window.addEventListener('pagehide', () => {
            flushSettings();
            this._edits?.save();
        });
        // Don't ready levels while someone's using a menu (see _prepareLevels). A step can freeze a phone for a
        // second. Capture so scrolling inside the menu counts too.
        const menuInUse = () => {
            this._prepareAt = Math.max(this._prepareAt, performance.now() / 1000 + PREPARE_AFTER);
        };
        for (const type of ['pointerdown', 'keydown', 'wheel', 'touchmove', 'scroll']) {
            window.addEventListener(type, menuInUse, { capture: true, passive: true });
        }

        this.menu.addEventListener('start', (event) => this._requestPlay(/** @type {CustomEvent} */ (event).detail?.controller === true));
        this.menu.addEventListener('new-world', () => this.newWorld());
        this.menu.addEventListener('enter-vr', () => this._enterVR());
        this.menu.addEventListener('mode', (event) => this.setMode(/** @type {CustomEvent} */ (event).detail));
        this.menu.addEventListener('level', (event) => this.setLevel(/** @type {CustomEvent} */ (event).detail));
        // Retry starts on the level the tape ended on.
        this.menu.addEventListener('retry', (event) => this.startFootage(this.seed, /** @type {CustomEvent} */ (event).detail?.controller === true, this.footage.level));
        this.menu.addEventListener('new-run', (event) => this.startFootage(randomSeed(), /** @type {CustomEvent} */ (event).detail?.controller === true));
        this.menu.addEventListener('to-title', () => this.toTitle());

        // A headset can show up or get plugged in at any time.
        this.menu.setVR(this.vr.available);
        this.vr.addEventListener('support', () => this.menu.setVR(this.vr.available));
        this.vr.addEventListener('start', () => this._onVRStart());
        this.vr.addEventListener('end', () => this._onVREnd());
        this.vr.addEventListener('inputs', () => this._vrHelp());
        // Page overlays aren't visible in a headset, so show messages in front of the player.
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
        // A click or key press hands control back to mouse/keyboard or touch. It's also the first chance to start
        // audio after starting with a controller, since browsers don't count controller input as a user gesture.
        window.addEventListener('pointerdown', () => {
            this._setController(false);
            if (this.audio.blocked) this.audio.start();
        });
        // Browsers won't go full screen from a controller button, so tell the player how to finish it while the
        // request is waiting. The nbsp keeps "full screen" on one line when the note wraps.
        const finishFullscreen = this.touch ? 'Tap the screen to go full\u00a0screen.' : 'Click or press a key to go full\u00a0screen.';
        this.fullscreen.addEventListener('wait', () => this._fullscreenMessage(finishFullscreen, this.fullscreen.waitTime));
        this.fullscreen.addEventListener('waitend', () => {
            if (this.menu.note.textContent === finishFullscreen) this.menu.setNote('');
            this.toast.dismiss(finishFullscreen);
        });

        // Konami code on touch screens: swipes on the menus, then two taps.
        listenForGestures((input) => {
            if (this.konami.push(input)) this._konamiCode();
        }, () => this.touch && (this.state === 'title' || this.state === 'paused' || this.state === 'ended'));

        this.touchControls.addEventListener('pause', () => this._pause());
        this.touchControls.addEventListener('flashlight', () => this._toggleFlashlight());
        this.look.addEventListener('lock', () => this._play());
        this.look.addEventListener('unlock', () => this._pause());
        this.look.addEventListener('error', () => {
            this.menu.setNote('Couldn\'t capture the mouse. Click the button again.');
        });

        this.canvas.addEventListener('mousedown', (event) => this._onMouseDown(event));
        window.addEventListener('mouseup', (event) => this._onMouseUp(event));
        // Catalogue pointer while the mouse is captured (see Catalogue.movePointer).
        document.addEventListener('mousemove', (event) => {
            if (this.catalogue.isOpen && this.look.isLocked) this.catalogue.movePointer(event.movementX, event.movementY);
        });
        this.catalogue.addEventListener('pick', (event) => {
            const tool = /** @type {CustomEvent} */ (event).detail;
            if (this.editTool.select(tool)) this._toolPicked(tool);
        });
        this.catalogue.addEventListener('close', () => this._catalogueClosed());
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

    /** @param {boolean} [controller] Started with a controller button instead of a click or tap. */
    _requestPlay(controller = false) {
        if (this.contextLost) return;
        this.menu.setNote('');
        this.audio.start();
        this.levelSound?.prepare();
        if (this.touch) {
            // No pointer lock on touch, so go full screen if the browser allows it (the desktop app always can).
            if (desktop) {
                if (!this.fullscreen.active) this.fullscreen.toggle();
            } else {
                document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
            }
            this._play();
        } else if (controller) {
            // Controllers don't need the mouse captured, and browsers only allow that from a click anyway.
            // Clicking the view captures it later.
            this._play();
        } else {
            this.look.lock();
        }
    }

    /** Enter VR button. Play starts once the headset is on. */
    async _enterVR() {
        if (this.contextLost || this.vr.presenting || (this.state !== 'title' && this.state !== 'paused' && this.state !== 'ended')) return;
        this.menu.setNote('');
        // Full screen is meaningless in the headset. Don't let this click finish a pending controller request for it.
        this.fullscreen.cancel();
        this.audio.start();
        this.levelSound?.prepare();
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
        this._resetZoom();
        this.hints.setVR(true);
        this._snapped = false;
        this._vrHelpShown = false;
        this._play();
        this._vrHelp();
    }

    _onVREnd() {
        this.hints.setVR(false);
        // Keep facing the same way on screen.
        this.look.yaw = this.vr.headYaw(this.look.yaw);
        this.look.pitch = 0;
        this._vrMove.forward = this._vrMove.right = this._vrMove.up = 0;
        this._vrMove.sprint = this._vrMove.jump = false;
        this._lastFrameTime = -1;
        this._size = ''; // three.js restored the old canvas size, force a resize to catch any change since
        this._resize();
        this._updateFov();
        this._pause();
    }

    /** Movement help for the player's VR input, shown once per VR session. */
    _vrHelp() {
        if (this._vrHelpShown || this.state !== 'playing' || !this.vr.presenting) return;
        const kind = this.vr.inputKind;
        if (!kind) return; // nothing connected yet, runs again when something is
        this._vrHelpShown = true;
        if (kind === 'controllers') this.toast.flash('Left stick to walk, right stick to turn.', 4000);
        else if (kind === 'hands') this.toast.flash('Pinch and hold to walk where you\'re looking.', 5000);
        else this.toast.flash('Press and hold to walk where you\'re looking.', 5000);
    }

    /** Releases the mouse and pauses, e.g. when the tab loses focus. */
    _releaseControls() {
        this.look.unlock();
        // Unlocking pauses too, but async and only if the mouse was actually captured.
        this._pause();
    }

    _play() {
        if (this.contextLost || (this.state !== 'title' && this.state !== 'paused' && this.state !== 'ended')) return;
        // Tapes start from the title or ending screen, never from a pause.
        if (this.state !== 'paused' && this.mode === 'footage' && !this.footage.active) {
            this.hud.setFade(false);
            this.footage.begin();
            this.settingsMenu.refresh();
        }
        // Explore on a deeper level shows its title, like a tape does on the way down.
        if (this.state === 'title' && this.mode === 'explore' && !this.party && !isFirstTapeLevel(this.level)) this.hud.showTitle(levelById(this.level).title);
        // Every fresh start (not a resume) turns the flashlight on.
        if (this.state !== 'paused') this.lighting.setFlashlight(true);
        this.state = 'playing';
        this.started = true;
        // Stay faded out until the world is ready (see settle).
        this._holdFade();
        this.menu.setState('hidden');
        this.hud.setInGame(true);
        this._showEditHud();
        this.touchControls.setActive(this.touch && !this.vr.presenting);
        this.toast.resume();
        this.audio.setPaused(false);
        this._accumulator = 0;
        this._resetFrameWatch();
        this._glitch(0.7, 0.5);
    }

    _pause() {
        if (this.state !== 'playing') return;
        // Let the last seconds of a tape play out. The ending screen follows.
        if (this.footage.active && this.footage.ended) return;
        this.state = 'paused';
        this.keyboard.clear();
        this._stickSprint = false;
        this.touchControls.setActive(false);
        this.toast.suspend();
        this.hud.setOsdMode('pause');
        this.hud.setCrosshair(false);
        this.hud.setTools(null);
        this.hud.setEditLabel(null);
        this.hud.setEditHelp(null);
        this.hud.hideZoom();
        this._endEdit();
        this.catalogue.close();
        this.editTool.hide();
        this.audio.setPaused(true);
        // No pause menu in the headset, so pausing exits VR and the menu shows on screen.
        this.vr.exit();
        if (this.contextLost) return; // keep the error message up
        this.menu.setState('paused');
    }

    /**
     * Starts over in a new world, or a new tape in Found Footage.
     * @param {number} [seed] Random if left out.
     */
    newWorld(seed = randomSeed()) {
        if (this.mode === 'footage' && this.state === 'paused') {
            // From the pause menu, go straight into another tape.
            this.startFootage(seed, this.menu.controller !== null);
            return;
        }
        if (this.mode === 'footage') {
            // New tape waits on the title screen until Start.
            this.footage.stop();
            this.seed = seed;
            this.footage.prepare(seed);
            this._rememberSeed();
            this.settingsMenu.refresh();
            if (this.state !== 'title') this._showTitle();
            this.toast.flash('New tape.');
            this._glitch(1, 1.1);
            return;
        }
        this.seed = seed;
        this._makeExploreWorld();
        this.settingsMenu.refresh();
        this._rememberSeed();
        this.toast.flash('Entered a new world.');
        this._glitch(1, 1.1);
    }

    /** Builds the Explore world for the current seed and puts the player back at the start. */
    _makeExploreWorld() {
        this.store = new ChunkStore(this.seed, this._editLog(), this._levelOptions());
        this.store.setParty(this.party);
        this.world.setStore(this.store);
        this._applyLevel();
        this.settle();
        this.lighting.update(0, this.store.areaLight(0, 0), true);
        this.textures.wallpaper.offset.set(...wallpaperOffset(this.seed));
        this.player.reset();
        this.look.yaw = 0;
        this.look.pitch = 0;
    }

    /**
     * Explore edits for the current seed. Reuses the loaded log for the same world instead of reading it again,
     * since the last few edits may not be saved yet.
     */
    _editLog() {
        if (this._edits?.seed !== this.seed || this._edits.level !== this.level) {
            this._edits?.save();
            this._edits = new EditLog(this.seed, this.level);
        }
        return this._edits;
    }

    /** Generator options for the Explore level. */
    _levelOptions() {
        return levelById(this.level).options(this.seed);
    }

    /**
     * Applies the showing level's lighting, atmosphere and sound. Runs after every world change since a tape's level
     * can differ from Explore's.
     */
    _applyLevel() {
        const level = this.store.level;
        this.lighting.setLevel(level);
        this.blackouts.rate = levelById(level).atmosphere.powerCutRate;
        this.levelSounds.forEach((sound, id) => sound?.setEnabled(id === level));
        this.levelSounds[level]?.setWorld?.(this.store);
        // Heat shimmer, off with reduced motion since it's movement the player didn't make.
        this.post.vhs.heat.value = this.reducedMotion ? 0 : levelById(level).atmosphere.heat ?? 0;
        // AO reach and darkness for this level.
        this.post.occlusionPass.setLevel(levelById(level).atmosphere.occlusion);
        // Storm lightning is one soft flash per strike with reduced motion.
        storm.calm = this.reducedMotion;
        // Levels with their own sound bring their own hum instead of the ambience's. Every level has its own echo.
        this.audio.setHumScale(this.levelSounds[level] ? 0 : 1);
        this.audio.setRoom(levelById(level).room);
        this.terrain = levelById(level).water ? { groundAt: this._groundAt, water: 0, ladderAt: this._ladderAt } : null;
        for (const ripple of worldLighting.poolRipples.value) ripple.set(0, 0, 0, 0);
        // Flickering lights belonged to the old world.
        this.audio.forgetLights();
    }

    /**
     * Water ripple from (x, z) for a footstep or fall (see poolroomsShading.js).
     * @param {number} strength
     */
    _ripple(x, z, strength) {
        worldLighting.poolRipples.value[this._rippleNext].set(x, z, this.lighting.time, strength);
        this._rippleNext = (this._rippleNext + 1) % worldLighting.poolRipples.value.length;
    }

    /** Footstep at the player. Uses the level's own floor sound if it has one (Level 1 puddles, Level 37 water), else carpet. */
    _footstep(weight) {
        const { player } = this;
        if (this.levelSound) this.levelSound.step(weight, player.position.x, player.position.z, player.depth);
        else this.audio.footstep(weight);
    }

    /** Current level's own sound, if any. */
    get levelSound() {
        return this.levelSounds[this.store.level] ?? null;
    }

    /** Keeps the URL in sync so it can be shared. */
    _rememberSeed() {
        const url = new URL(location.href);
        url.searchParams.set('seed', String(this.seed));
        // Always set mode, otherwise the link opens whatever mode was last picked on that browser.
        url.searchParams.set('mode', this.mode);
        const level = this._levelParam();
        if (level) url.searchParams.set('level', level);
        else url.searchParams.delete('level');
        history.replaceState(null, '', url);
    }

    /** URL level: 'fun' for Level Fun, or Explore's level unless it's the first (where tapes start). */
    _levelParam() {
        if (this.party) return 'fun';
        return this.mode === 'explore' && !isFirstTapeLevel(this.level) ? String(this.level) : null;
    }

    // ------------------------------------------------------------------ Level Fun

    /**
     * Turns Level Fun on or off in the current world. Walls stay the same (see party.js).
     * @param {boolean} on
     * @param {boolean} [announce] Horns and confetti, or a sad trombone.
     */
    setParty(on, announce = false) {
        if (on === this.party) return;
        this.party = on;
        this._applyParty();
        this.store.setParty(on);
        this.world.refreshAll();
        const p = this.player.position;
        // Nearest chunks now, the rest spreading outward over the next few frames. A world that's still settling
        // gets built anyway (see settle).
        if (!this._settling) this.world.update(p.x, p.z, 4);
        // Don't leave the player stuck in a table that just appeared.
        if (on && p.y < EYE_HEIGHT + WALL_HEIGHT) {
            const spot = findFreeSpot(p.x, p.z, PLAYER_RADIUS, this._boxesNear);
            if (spot.x !== p.x || spot.z !== p.z) this.player.reset(spot.x, spot.z);
        }
        this._rememberSeed();
        this._showMode();
        if (!announce) return;
        this._glitch(0.7, 0.8);
        if (on) {
            this.partyAudio.arrive();
            const view = this.vr.presenting ? this.vr.head : this.camera;
            view.getWorldDirection(_forward);
            this.confetti.shower(view.position.x + _forward.x * 0.8, view.position.z + _forward.z * 0.8, 0.75, 380, 1.1);
            this.toast.flash('Level Fun =)', 2500);
            if (this.state === 'playing') this.hud.showTitle('LEVEL FUN =)');
        } else {
            this.partyAudio.sadTrombone();
            this.hud.hideTitle();
            this.toast.flash(`Back to ${levelById(this._partyFrom ?? this.level).name}.`, 2500);
        }
    }

    /** Level Fun parts outside the chunks: wallpaper, haze, sound, and the tape's changes. */
    _applyParty() {
        const on = this.party;
        this.materials.wall.map = on ? this.materials.party.wallpaper : this.textures.wallpaper;
        this.lighting.setParty(on);
        this.footage.setParty(on);
        this.partyAudio.setEnabled(on);
    }

    _konamiCode() {
        if (!this.party) this._foundLevelFun();
        if (this.party) {
            const from = this._partyFrom;
            this.setParty(false, true);
            this._partyFrom = null;
            if (from !== null) this._switchLevel(from);
            return;
        }
        // Level Fun dresses up the current level. On one that can't be dressed (Level 1), Explore switches to one
        // that can and comes back after. A tape stays on its level.
        if (!levelById(this.store.level).dressable) {
            if (this.mode !== 'explore') return;
            this._partyFrom = this.level;
            this._switchLevel(partyLevel());
        }
        this.setParty(true, true);
    }

    /** Unlocks Level Fun in this browser (see unlocks.js): adds it to the title screen and its props to edit mode. */
    _foundLevelFun() {
        if (this.levelFunFound) return;
        this.levelFunFound = true;
        findLevelFun();
        this._showLevels();
        this._showMode();
        this.editTool.setLevelFun(true);
        if (this.editMode) this.hud.setTools(this.editTool.sections, this.editTool.tool);
    }

    /** Title screen level list for Explore, plus Level Fun once found. */
    _showLevels() {
        const levels = LEVELS_IN_ORDER.map(({ id, name }) => ({ id: String(id), name }));
        if (this.levelFunFound) levels.push({ id: 'fun', name: 'Level Fun' });
        this.menu.setLevels(levels);
    }

    /** Switches Explore to another level while playing, starting at its origin. */
    _switchLevel(level) {
        this.level = level;
        this._makeExploreWorld();
        this._rememberSeed();
        this._showMode();
    }

    /**
     * Player took a tape level's way out. Fades through white into the next level down, or into Level Fun after the
     * last. The tape is already scored (see FoundFootage) and the recording keeps going.
     */
    leaveLevel() {
        const footage = this.footage;
        const next = nextTapeLevel(footage.level);
        if (next === null) {
            this.enterLevelFun();
            return;
        }
        const time = footage.time;
        const best = isFirstTapeLevel(footage.level) && footage.records.best === time;
        footage.continueTo(next);
        this._rememberSeed();
        this.settingsMenu.refresh();
        // Fade out of white once the next level is ready (see settle).
        this.hud.setFade(false);
        this.toast.clear();
        this._onSettled(() => {
            this.hud.showTitle(levelById(next).title, 4500);
            this.toast.resume();
            this.toast.show(best ? `You got out in ${formatTime(time)}. A new best.` : `You got out in ${formatTime(time)}.`, 3500);
            this._glitch(0.9, 1.4);
        });
    }

    /** Out of a tape's last level into Level Fun. The recording keeps going. */
    enterLevelFun() {
        this._foundLevelFun();
        const footage = this.footage;
        const time = footage.runTime;
        const best = footage.records.bestFinish === time;
        footage.stop();
        this.mode = 'explore';
        this.level = partyLevel();
        this.party = true;
        this._applyParty();
        this._makeExploreWorld();
        // Stopping the tape cleared the white. Hold it until Level Fun is ready.
        this._holdFade('white');
        this._rememberSeed();
        this._showMode();
        this.settingsMenu.refresh();
        // Fade out of white.
        this.hud.setFade(false);
        this.toast.clear();
        this._onSettled(() => {
            this.hud.showTitle('LEVEL FUN =)', 4500);
            this.toast.resume();
            this.toast.show(best ? `You got all the way out in ${formatTime(time)}. A new best.` : `You got all the way out in ${formatTime(time)}.`, 4500);
            this.partyAudio.arrive();
            this.confetti.shower(0, -0.9, 0.9, 480, 1.8);
            this._glitch(0.9, 1.4);
        });
    }

    /** Player walked up to the guest at (x, y, z). Pop and confetti. */
    _guestPopped(x, y, z) {
        this.confetti.burst(x, y + 0.45, z, 170, 1.5);
        this.partyAudio.pop(1, 0);
        this.partyAudio.horn(0.35, 1.5, 0.08);
    }

    /**
     * Level Fun audio at the listener: party distance, power, tape progress, and the nearest cake's music box.
     * @param {number} dt
     * @param {import('three').Object3D} view
     * @param {number} yaw Listener facing.
     */
    _updatePartySound(dt, view, yaw) {
        const audio = this.partyAudio;
        const { x, z } = view.position;
        audio.setNear(MathUtils.clamp(1 - (this.partyLayer.discoDistance - PARTY_ROOM) / (PARTY_NEAR - PARTY_ROOM), 0, 1));
        audio.setPower(1 - this.lighting.blackout);
        const footage = this.footage;
        audio.setWarp(footage.active ? Math.min(1, (0.5 * footage.found) / NOTE_COUNT + footage.exposure) : 0);
        const cake = this.partyLayer.nearestCake(x, z, MUSIC_BOX_RANGE);
        if (cake) {
            const d = cake.distance || 1;
            const dx = (cake.x - x) / d;
            const dz = (cake.z - z) / d;
            const hit = raycastWorld(x, 0.35, z, dx, 0, dz, d, this.store);
            const pan = dx * Math.cos(yaw) - dz * Math.sin(yaw);
            audio.setMusicBox((1 - cake.distance / MUSIC_BOX_RANGE) ** 2, pan, hit === null || hit.distance > d - 0.3);
        } else {
            audio.setMusicBox(0, 0, true);
        }
        audio.update(dt);
    }

    // ------------------------------------------------------------------ Found Footage

    /**
     * Sets the title screen mode. The world behind the title changes with it.
     * @param {GameMode} mode
     */
    setMode(mode) {
        if (mode !== 'explore' && mode !== 'footage') return;
        const changed = mode !== this.mode;
        this.mode = mode;
        this.settings.world.mode = mode;
        saveSettings(this.settings);
        this._showMode();
        this._rememberSeed();
        if (!changed || this.state !== 'title') return;
        if (mode === 'footage') {
            this.footage.prepare(this.seed);
        } else {
            this.footage.stop();
            this._makeExploreWorld();
        }
        this._glitch(0.6, 0.6);
    }

    /**
     * Sets Explore's level from the title screen. One of LEVELS, or 'fun' once Level Fun is found.
     * @param {number | 'fun'} level
     */
    setLevel(level) {
        const fun = level === 'fun';
        if ((fun ? !this.levelFunFound : !LEVELS[level]) || this.state !== 'title') return;
        const id = fun ? partyLevel() : /** @type {number} */ (level);
        const changed = id !== this.level || fun !== this.party;
        this.level = id;
        this._partyFrom = null;
        // Level Fun is saved separately so the previous level is still there if it's turned off again.
        if (!fun) this.settings.world.level = id;
        this.settings.world.fun = fun;
        saveSettings(this.settings);
        if (fun !== this.party) {
            this.party = fun;
            this._applyParty();
        }
        this._rememberSeed();
        this._showMode();
        if (!changed || this.mode !== 'explore') return;
        this._makeExploreWorld();
        this.settingsMenu.refresh();
        this._glitch(0.6, 0.6);
    }

    /** Updates the title screen mode, its description line, and Explore's level. */
    _showMode() {
        this.menu.setMode(this.mode, this._modeNote(), this.party ? 'fun' : this.level);
    }

    _modeNote() {
        if (this.mode === 'footage') return this.footage.describe();
        return this.party ? 'Level Fun. The party never ends. =)' : levelById(this.level).about;
    }

    /**
     * Starts a tape from the ending screen or the pause menu's New World.
     * @param {number} seed
     * @param {boolean} [controller] Started with a controller or touch, so no mouse to capture.
     * @param {number} [level] Level to start on for a retry. New tapes start on the first.
     */
    startFootage(seed, controller = false, level = TAPE_LEVELS[0]) {
        if (this.contextLost) return;
        this.footage.stop();
        this.seed = seed;
        this.mode = 'footage';
        this.footage.prepare(seed, level);
        this._rememberSeed();
        this._showMode(); // menu links and their warnings are for a tape now
        this.state = 'ended'; // whatever it was, so the next _play starts the tape
        this._requestPlay(controller || this.touch);
    }

    /** Tape over (player was caught). Shows the ending screen. */
    endFootage() {
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
        this.hud.hideTitle();
        this.audio.setZoomMotor(0);
        this.audio.setPaused(true);
        this.look.unlock();
        this.vr.exit();
        this.menu.showEnding(this.footage.summary());
        this._showMode();
        this.menu.setState('ended');
    }

    /**
     * Back to the title screen from the pause menu or the end of a tape. Keeps the mode and resets the preview to
     * the same world from its start (with edits), or the same tape before it begins.
     */
    toTitle() {
        if (this.state !== 'ended' && this.state !== 'paused') return;
        // Next Start is fresh, so reset the clock and the hints timed off it.
        this.playTime = 0;
        this.footage.stop();
        if (this.mode === 'footage') this.footage.prepare(this.seed);
        else this._makeExploreWorld();
        this.settingsMenu.refresh();
        this._showTitle();
        this._glitch(0.6, 0.6);
    }

    /** Shows the title screen and clears everything left over from playing. */
    _showTitle() {
        this.state = 'title';
        this.started = false;
        this.editMode = false;
        this.player.flying = false;
        this.editTool.hide();
        this._resetZoom();
        this.lighting.setFlashlight(false);
        // Don't leave a power cut (or a tape's lights failing) running on the title screen.
        if (this.blackouts.phase !== 'idle') {
            this.blackouts.cancel();
            this.audio.powerRestored();
        }
        this.lighting.setBlackout(0);
        this.toast.clear();
        this.confetti.clear();
        this.hud.setInGame(false);
        this.hud.setFade(false);
        this.hud.hideTitle();
        this.hud.setCrosshair(false);
        this.hud.setTools(null);
        this.hud.setEditLabel(null);
        this.hud.setEditHelp(null);
        this._endEdit();
        this.catalogue.close();
        this._showMode();
        this.menu.setState('title');
    }

    _goToSeed(text) {
        const seed = parseSeed(text);
        if (seed !== null) this.newWorld(seed);
    }

    async _copyWorldLink() {
        // The desktop app's own URL is useless to anyone else, so link to the website.
        const url = desktop ? new URL(desktop.webUrl) : new URL(location.pathname, location.origin);
        url.searchParams.set('seed', String(this.seed));
        url.searchParams.set('mode', this.mode);
        const level = this._levelParam();
        if (level) url.searchParams.set('level', level);
        try {
            await navigator.clipboard.writeText(url.href);
            this.toast.flash('Link copied. Anyone who opens it gets this same world.', 3000);
        } catch {
            this.toast.flash(`Seed: ${this.seed}`, 4000);
        }
    }

    /** Drops all edits in this world and restores it as generated. */
    _undoEdits() {
        const edits = this.store.edits;
        if (!edits || edits.size === 0) {
            this.toast.flash('Nothing to undo in this world.');
            return;
        }
        edits.clear();
        this.store = new ChunkStore(this.seed, edits, this._levelOptions());
        this.history.attach(this.store);
        this.store.setParty(this.party);
        this.world.setStore(this.store);
        this.levelSounds[this.store.level]?.setWorld?.(this.store);
        const p = this.player.position;
        this.settle(p.x, p.z);
        const spot = findFreeSpot(p.x, p.z, PLAYER_RADIUS, this._boxesNear);
        if (p.y < EYE_HEIGHT + WALL_HEIGHT) this.player.reset(spot.x, spot.z);
        this.settingsMenu.refresh();
        this.toast.flash('This world is back the way it was.');
    }

    _resetSettings() {
        // Mode is picked on the title screen, not in Settings, so keep it.
        const mode = this.settings.world.mode;
        resetSettings(this.settings);
        this.settings.world.mode = mode;
        this.settings.graphics.fpsLimit = this._fpsLimitByDefault;
        this._watchOcclusion = true;
        this._watchLights = true;
        this._applyAllSettings();
        this.settingsMenu.refresh();
        saveSettings(this.settings);
        this.toast.flash('Settings reset.');
    }

    /** Brief tape tracking glitch on picture (unless reduced motion) and sound. */
    _glitch(strength, seconds) {
        if (!this.reducedMotion) this.post.glitch(strength, seconds);
        this.audio.glitch(strength, seconds);
    }

    // ------------------------------------------------------------------ input

    _onKeyDown(event) {
        if (event.repeat || this.state === 'loading' || this.state === 'error') return;
        const target = /** @type {HTMLElement} */ (event.target);
        this._setController(false);
        if (this.audio.blocked) this.audio.start();
        if (target.closest?.('input, textarea, select, [contenteditable]')) return;
        if (this.konami.push(konamiKey(event.code))) this._konamiCode();
        const playing = this.state === 'playing';
        const graphics = this.settings.graphics;
        // The open catalogue takes the keys it uses. Other keys work as normal.
        if (this.catalogue.isOpen && this._catalogueKey(event)) return;
        const editing = playing && this.editMode;

        switch (event.code) {
            case 'Escape':
                // Only reaches the page when the mouse isn't captured, e.g. playing with a controller.
                if (playing && !this.look.isLocked) this._pause();
                break;
            case 'KeyF':
                if (!playing) return;
                this._toggleFlashlight();
                break;
            case 'KeyP':
                if (!playing || this.vr.presenting) return; // the canvas doesn't have the headset's image
                this._stillRequested = true;
                this.hints.markUsed('photo');
                break;
            case 'KeyR':
                if (editing) this._rotate(event.shiftKey ? -1 : 1);
                break;
            case 'KeyT':
                if (editing) this._restyle();
                break;
            case 'KeyC':
                if (editing) this._copy();
                break;
            case 'KeyZ':
                if (!editing) return;
                event.preventDefault();
                this._undo(event.shiftKey);
                break;
            case 'KeyY':
                if (!editing || !(event.ctrlKey || event.metaKey)) return;
                event.preventDefault();
                this._undo(true);
                break;
            case 'KeyH':
                if (editing) this._toggleEditHelp();
                break;
            case 'Tab':
                if (!editing) return;
                event.preventDefault();
                this._openCatalogue();
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
                this._watchLights = false;
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
            case 'KeyO':
                graphics.ambientOcclusion = !graphics.ambientOcclusion;
                this._watchOcclusion = false;
                this._settingChanged('graphics.ambientOcclusion');
                this.toast.flash(`Ambient occlusion ${graphics.ambientOcclusion ? 'on' : 'off'}`);
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

    /** Scroll wheel zooms, or cycles tools in edit mode. */
    _onWheel(event) {
        if (this.state !== 'playing') return;
        const delta = event.deltaY * (event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1);
        if (this.editMode) {
            // Trackpads send lots of tiny deltas, so wait for about one notch's worth.
            this._toolScroll += delta;
            if (Math.abs(this._toolScroll) >= 60) {
                // Scrolls the page when the catalogue is open.
                if (this.catalogue.isOpen) this.catalogue.scroll(Math.sign(this._toolScroll));
                else this._cycleTool(Math.sign(this._toolScroll));
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
        if (this.catalogue.isOpen) {
            // With the mouse captured, the catalogue's own pointer clicks. Otherwise the page gets the click.
            if (this.look.isLocked && event.button === 0) this.catalogue.click();
            return;
        }
        if (!this.touch && !this.look.isLocked) {
            // Controller play leaves the mouse free. Clicking the view captures it again.
            this.look.lock();
            return;
        }
        if (!this.editMode) return;
        if (event.button === 0) this._startEdit('remove', 'mouse', 0);
        else if (event.button === 2) this._startEdit('build', 'mouse', 2);
        else if (event.button === 1) {
            event.preventDefault();
            this._copy();
        }
    }

    _onMouseUp(event) {
        if (this._editHold?.source === 'mouse' && this._editHold.button === event.button) this._endEdit();
    }

    /**
     * Build/remove pressed in edit mode. Acts on the target right away, then on each new thing swept over while held
     * (see _holdEdit). The whole hold is one undo step.
     * @param {'build' | 'remove'} action
     * @param {'mouse' | 'pad' | import('./xr/VRHand.js').VRHand} source
     * @param {number} button
     * @returns {boolean} Whether anything changed.
     */
    _startEdit(action, source, button) {
        this._endEdit();
        this.history.attach(this.store);
        this.history.begin();
        this._editHold = { action, source, button, since: performance.now() / 1000, done: new Set([this.editTool.targetKey(action === 'remove')]) };
        return this._edit(action);
    }

    /** Button released or game paused. Closes the undo step. */
    _endEdit() {
        if (!this._editHold) return;
        this._editHold = null;
        this.history.end();
    }

    /** Per frame in edit mode. A held button acts on each new thing it's swept onto (see EditTool.repeatable). */
    _holdEdit() {
        const hold = this._editHold;
        if (!hold || performance.now() / 1000 - hold.since < EDIT_HOLD_DELAY) return;
        const key = this.editTool.targetKey(hold.action === 'remove');
        if (!key || hold.done.has(key) || !this.editTool.repeatable(hold.action)) return;
        hold.done.add(key);
        if (this._edit(hold.action) && typeof hold.source === 'object') this.vr.pulse(0.2, 20, hold.source);
    }

    /**
     * @param {'remove' | 'build'} action Applied to the current edit target.
     * @returns {boolean} Whether anything changed.
     */
    _edit(action) {
        this.history.attach(this.store);
        const light = this.editTool.target?.kind === 'light';
        const changed = action === 'remove' ? this.editTool.remove(this.store) : this.editTool.place(this.store, this.player.position);
        if (!changed) return false;
        // Lights get a switch click. Anything else plays positioned where it is.
        if (light) this.audio.click(action === 'build');
        else this._editSound(action === 'build', changed.x, changed.z);
        this._rebuildAround([changed], light);
        this.hints.situation('edits', false);
        return true;
    }

    /** Build or remove sound, panned to where it happened. */
    _editSound(build, x, z) {
        const view = this.vr.presenting ? this.vr.head : this.camera;
        const yaw = this.vr.presenting ? this.vr.headYaw(this.look.yaw) : this.look.yaw;
        const dx = x - view.position.x;
        const dz = z - view.position.z;
        const distance = Math.hypot(dx, dz);
        this.audio.edit(build, distance > 0 ? (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / distance : 0, distance);
    }

    /**
     * Rebuilds around edited cells, plus the shader light data if a light was switched. In Level Fun the party
     * decorations in the affected chunks are redone so nothing hangs off a removed wall or pokes through a new one.
     * Also moves the player out of anything that appeared on them (a table, an undone wall).
     * @param {{ x: number, z: number }[]} cells
     * @param {boolean} lights
     */
    _rebuildAround(cells, lights) {
        for (const { x, z } of cells) {
            if (this.party) {
                for (const cx of new Set([chunkCoord(x - 1), chunkCoord(x + 1)])) {
                    for (const cz of new Set([chunkCoord(z - 1), chunkCoord(z + 1)])) this.store.redress(cx, cz);
                }
            }
            this.world.refreshCell(x, z);
            if (lights) this.panelLights.writeChunk(this.store.getChunk(chunkCoord(x), chunkCoord(z)));
        }
        const p = this.player.position;
        if (p.y < EYE_HEIGHT + WALL_HEIGHT) {
            const spot = findFreeSpot(p.x, p.z, PLAYER_RADIUS, this._boxesNear);
            if (spot.x !== p.x || spot.z !== p.z) this.player.reset(spot.x, spot.z);
        }
    }

    /**
     * Undoes the last edit step, or redoes the last undone one.
     * @param {boolean} [redo]
     */
    _undo(redo = false) {
        this._endEdit();
        this.history.attach(this.store);
        const changes = redo ? this.history.redo() : this.history.undo();
        this.hud.flashEditNote(changes ? (redo ? 'REDO' : 'UNDO') : redo ? 'NOTHING TO REDO' : 'NOTHING TO UNDO');
        if (!changes) return;
        const cells = changedCells(changes);
        this._rebuildAround(cells, cells.some((cell) => cell.light));
        // Sound matches the effect, so undoing a build plays the remove sound.
        const [first] = changes;
        if (first.kind === 'light') this.audio.click(builds(first) === redo);
        else this._editSound(builds(first) === redo, cells[0].x, cells[0].z);
    }

    /** Rotates the next placement (−1 for the other way). */
    _rotate(direction) {
        this.editTool.rotate(direction);
        this.audio.click(direction > 0);
    }

    /** Next style for the next placement. */
    _restyle() {
        this.editTool.restyle();
        this.hud.flashEditNote('STYLE');
        this.audio.click(true);
    }

    /** Picks the tool for the aimed-at thing, to place another like it. */
    _copy() {
        const tool = this.editTool.copy();
        if (!tool) {
            this.hud.flashEditNote('NOTHING TO COPY');
            return;
        }
        this._toolPicked(tool);
        this.hud.flashEditNote('COPIED');
        this.audio.click(true);
    }

    _toggleFlashlight() {
        this.lighting.setFlashlight(!this.lighting.flashlightOn);
        this.audio.click(this.lighting.flashlightOn);
        this.hints.markUsed('flashlight');
    }

    /**
     * Switches hints and menus between controller button names and keys, based on what was used last.
     * @param {boolean} active
     */
    _setController(active) {
        const labels = active ? this.gamepad.labels : null;
        if (labels === this._controller) return;
        this._controller = labels;
        this.hints.setController(labels);
        this.menu.setController(labels);
        this._showEditHelp();
        if (this.gamepad.connected > 0) document.documentElement.dataset.controller = active ? 'active' : 'connected';
    }

    /** Gamepads have no button events, so poll every frame. */
    _pollController(now, dt) {
        const pad = this.gamepad;
        if (!pad.poll(now)) return;
        if (pad.active) this._setController(true);
        if (this.konami.push(konamiButton(pad))) {
            this._konamiCode();
            // That press finished the code, don't pass it to the menu.
            return;
        }
        if (this.state === 'playing') this._controllerPlay(pad, dt);
        else if (this.state === 'title' || this.state === 'paused' || this.state === 'ended') this._controllerMenu(pad);
    }

    /** @param {GamepadInput} pad */
    _controllerPlay(pad, dt) {
        if (pad.pressed(BUTTON.MENU)) {
            this._releaseControls();
            return;
        }
        if (this.catalogue.isOpen) {
            this._controllerCatalogue(pad);
            return;
        }

        const vr = this.vr.presenting;
        const stick = pad.rightStick;
        if (stick.x !== 0 || stick.y !== 0) {
            const { stickSensitivity, invertStickY } = this.settings.gameplay;
            // Scaled by stick distance so speed goes with its square. A nudge aims finely, full push turns fast.
            // Slower when zoomed in, like the mouse.
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
        // In edit mode the right stick opens the catalogue instead.
        if (pad.pressed(BUTTON.RIGHT_STICK)) {
            if (this.editMode && !vr) this._openCatalogue();
            else this._toggleFullscreen();
        }

        if (this.editMode) {
            if (pad.pressed(BUTTON.LB)) this._cycleTool(-1);
            if (pad.pressed(BUTTON.RB)) this._cycleTool(1);
            if (pad.pressed(BUTTON.LEFT)) this._cycleSection(-1);
            if (pad.pressed(BUTTON.RIGHT)) this._cycleSection(1);
            if (pad.pressed(BUTTON.UP)) this._rotate(1);
            if (pad.pressed(BUTTON.DOWN)) this._undo();
            if (pad.pressed(BUTTON.LT)) this._startEdit('remove', 'pad', BUTTON.LT);
            if (pad.pressed(BUTTON.RT)) this._startEdit('build', 'pad', BUTTON.RT);
            if (this._editHold?.source === 'pad' && !pad.held(this._editHold.button)) this._endEdit();
        } else if (!vr) {
            // Triggers are analog, squeeze harder to zoom faster.
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
        if (pad.pressed(BUTTON.RIGHT_STICK)) this._toggleFullscreen();
    }

    /** Right stick click toggles full screen. */
    async _toggleFullscreen() {
        if (this.vr.presenting) return; // full screen doesn't affect the headset
        if ((await this.fullscreen.toggle()) === 'unavailable') this._fullscreenMessage('Full screen isn\'t available here.');
    }

    /**
     * Shows a full screen message under the menu buttons, or as a toast while playing and on screens without the
     * note (settings, controls, tape ending).
     * @param {string} text
     * @param {number} [duration] Toast duration (ms).
     */
    _fullscreenMessage(text, duration) {
        if ((this.state === 'title' || this.state === 'paused') && this.menu.view === 'main') this.menu.setNote(text);
        else this.toast.flash(text, duration);
    }

    _toggleEditMode() {
        if (this.footage.active) {
            this.toast.flash('Edit mode is off in Found Footage.');
            return;
        }
        this.editMode = !this.editMode;
        this.player.flying = this.editMode;
        this.hints.markUsed('edit');
        this._endEdit();
        this.catalogue.close();
        if (this.editMode) {
            this.history.attach(this.store);
            // Textures for edit-only props. Catalogue thumbnails get drawn from these a few per frame from now on.
            this.materials.editPictures();
        }
        this._showEditHud();
        if (this.editMode) {
            // Aiming works best without zoom, and the wheel cycles tools now.
            this._resetZoom();
            // On screen the keys show under the time. In a headset this toast is the only help.
            if (this.vr.presenting && this.vr.inputKind === 'controllers') {
                this.toast.flash('Edit mode enabled.\nTrigger builds, grip removes.\nClick the right stick to pick what to build,\nthe left for each level\'s things.\nPush the right stick up or down to fly.', 6000);
            } else {
                this.toast.flash('Edit mode enabled.', 4000);
            }
        } else {
            this.editTool.hide();
            this.toast.flash('Edit mode disabled.');
        }
    }

    /** Sets the camcorder HUD for edit mode or recording: OSD mode, crosshair, target label, tools and keys. */
    _showEditHud() {
        // The catalogue has its own while open.
        const hud = this.editMode && !this.catalogue.isOpen;
        this.hud.setOsdMode(this.editMode ? 'edit' : 'rec');
        this.hud.setCrosshair(hud);
        this.hud.setTools(hud ? this.editTool.sections : null, this.editTool.tool);
        if (!hud) this.hud.setEditLabel(null);
        this._showEditHelp();
    }

    /** Edit mode key help under the time, for the current input. Hidden in VR or when stats are shown there. */
    _showEditHelp() {
        const shown = this.editMode && this.state === 'playing' && !this.catalogue.isOpen && !this.vr.presenting && !this.settings.graphics.showStats;
        this.hud.setEditHelp(shown ? this._editKeys() : null);
    }

    /** @returns {[string, string][]} */
    _editKeys() {
        const b = this._controller;
        if (b) return [[b.rt, 'BUILD'], [b.lt, 'REMOVE'], ['R STICK', 'CHOOSE'], [`${b.lb} ${b.rb}`, 'NEXT'], ['UP', 'TURN'], ['DOWN', 'UNDO'], [`${b.a} ${b.b}`, 'UP / DOWN']];
        if (!this._editHelpOpen) return [['H', 'KEYS']];
        return [
            ['RMB', 'BUILD'], ['LMB', 'REMOVE'], ['TAB', 'CHOOSE'], ['WHEEL', 'NEXT'], ['R', 'TURN'], ['T', 'STYLE'], ['MMB C', 'COPY'],
            ['Z', 'UNDO'], ['Q E', 'UP / DOWN'], ['H', 'HIDE'],
        ];
    }

    _toggleEditHelp() {
        this._editHelpOpen = !this._editHelpOpen;
        this._showEditHelp();
    }

    /** Build/remove button names for the crosshair label. */
    _editButtons() {
        const b = this._controller;
        return b ? { build: b.rt, remove: b.lt } : { build: 'RMB', remove: 'LMB' };
    }

    /** Per-frame edit mode update: aim, held button, crosshair label, and catalogue thumbnails. */
    _updateEdit(vr) {
        if (this.catalogue.isOpen) return;
        this.editTool.update(vr ? this.vr.aim : this.camera, this.store, this.player.position);
        this._holdEdit();
        if (vr) return;
        this.hud.setEditLabel(this.editTool.describe(), this._editButtons());
        if (!this._thumbnailsReady && this.thumbnails.warm()) this._thumbnailsReady = this.thumbnails.prepare(this.editTool.tools, THUMBNAIL_BUDGET);
    }

    /** Opens the build catalogue (see Catalogue.js). Not in VR. */
    _openCatalogue() {
        if (!this.editMode || this.state !== 'playing' || this.vr.presenting || this.catalogue.isOpen) return;
        this._endEdit();
        const b = this._controller;
        const captured = this.look.isLocked;
        const hint = b ? `${b.a} to choose, ${b.lb} / ${b.rb} for the next page, ${b.b} to close`
            : captured ? 'Click to choose, Q / E for the next page, Tab to close' : 'Click to choose';
        this.catalogue.open(this.editTool.sections, this.editTool.tool, { captured, hint });
        this.look.frozen = true;
        this.editTool.hide();
        this._showEditHud();
    }

    _catalogueClosed() {
        this.look.frozen = false;
        if (this.state === 'playing') this._showEditHud();
    }

    /**
     * Catalogue keys: arrows/WASD move, Q/E or PgUp/PgDn change page, Enter/Space choose, Tab/Esc close.
     * @param {KeyboardEvent} event
     * @returns {boolean} Whether the catalogue handled it.
     */
    _catalogueKey(event) {
        const moves = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] };
        const catalogue = this.catalogue;
        if (moves[event.code]) catalogue.move(...moves[event.code]);
        else if (event.code === 'KeyQ' || event.code === 'PageUp') catalogue.turnPage(-1);
        else if (event.code === 'KeyE' || event.code === 'PageDown') catalogue.turnPage(1);
        else if (event.code === 'Enter' || event.code === 'Space') catalogue.confirm();
        else if (event.code === 'Tab' || event.code === 'Escape') catalogue.close();
        else return false;
        event.preventDefault();
        return true;
    }

    /** @param {GamepadInput} pad */
    _controllerCatalogue(pad) {
        const catalogue = this.catalogue;
        const moves = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
        if (pad.direction) catalogue.move(...moves[pad.direction]);
        if (pad.pressed(BUTTON.LB)) catalogue.turnPage(-1);
        if (pad.pressed(BUTTON.RB)) catalogue.turnPage(1);
        if (pad.pressed(BUTTON.A)) catalogue.confirm();
        else if (pad.pressed(BUTTON.B) || pad.pressed(BUTTON.RIGHT_STICK)) catalogue.close();
    }

    /** Resets zoom instantly. */
    _resetZoom() {
        this.zoom = this.zoomTarget = 1;
        this._updateFov();
        this.hud.hideZoom();
        this.audio.setZoomMotor(0);
    }

    _cycleTool(direction) {
        this._toolPicked(this.editTool.cycleTool(direction));
    }

    /** Next or previous tool section (each level's props). */
    _cycleSection(direction) {
        this._toolPicked(this.editTool.cycleSection(direction));
    }

    _toolPicked(tool) {
        this.hud.setTools(this.editTool.sections, tool);
        // The tool list is only on screen, so toast it in the headset.
        if (this.vr.presenting) {
            const section = this.editTool.sections[this.editTool.section].name;
            this.toast.flash(`${section ? `${section}: ` : ''}${tool[0].toUpperCase()}${tool.slice(1)}`);
        }
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
            case 'graphics.ambientOcclusion':
                this._applyAmbientOcclusion();
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
                this._showEditHelp();
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
            'graphics.ambientOcclusion',
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

    /**
     * Applies the AO setting. AO loads the first time it's turned on (see fx/AmbientOcclusion.js). If that fails
     * (offline and never cached), it gets turned back off.
     * @returns {Promise<void>}
     */
    _applyAmbientOcclusion() {
        return this.post.setAmbientOcclusion(this.settings.graphics.ambientOcclusion).catch((error) => {
            console.warn('Could not load ambient occlusion:', error);
            this.settings.graphics.ambientOcclusion = false;
            this.post.setAmbientOcclusion(false);
            this.settingsMenu?.refresh();
            saveSettings(this.settings);
            this.toast.flash('Ambient occlusion couldn\'t be loaded.');
        });
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

        // On a tape the static shows the signal breaking up, so it's always on regardless of settings.
        const footage = this.footage?.active === true;
        if (footage) u.staticEnabled.value = true;
        const anyVhsStage = ['static', 'rgbShift', 'film', 'badTV', 'vignette'].some((key) => effects[key].enabled);
        this.post.setEnabled((effects.enabled && anyVhsStage) || footage, effects.enabled && effects.bloom.enabled);
    }

    /** FOV from the setting, narrowed by the camcorder zoom. */
    _updateFov() {
        const base = MathUtils.degToRad(this.settings.gameplay.fieldOfView);
        this.camera.fov = MathUtils.radToDeg(2 * Math.atan(Math.tan(base / 2) / this.zoom));
        this.camera.updateProjectionMatrix();
        this.look.zoom = this.zoom;
    }

    _resize() {
        // The headset sets the size while it's on (three.js won't change it).
        if (this.vr?.presenting) return;
        const width = innerWidth;
        const height = innerHeight;
        const pixelRatio = (Math.min(devicePixelRatio, 2) * this.settings.graphics.resolutionScale) / 100;
        // Phones send no-op resize events (e.g. browser bars showing and hiding). Resizing reallocates every render
        // target, which hitches, so only do it for a real change.
        const size = `${width}x${height}@${pixelRatio}`;
        if (size === this._size) return;
        this._size = size;
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.post.setSize(width, height, pixelRatio);
        this.reflection?.setSize(width, height, pixelRatio);
    }

    // ------------------------------------------------------------------ getting a world ready

    /**
     * Readies a newly placed world without blocking the page. Makes the level's materials if needed, builds chunks a
     * few per frame, then compiles shaders (in the background where the browser supports it). Nothing new is drawn
     * until done. The last frame stays up under the menu (Start shows busy if it takes a moment), or while playing
     * the picture fades out and the game waits (a tape's way out stays white).
     * Building it all at once and drawing before shaders were ready froze the game for a second or more on phones,
     * and several seconds on Windows, the first time a level was seen. VR has to draw every frame, so there it's
     * built immediately instead.
     * @param {number} [x] Player position to build around in VR. Elsewhere it uses the player's position each frame.
     * @param {number} [z]
     */
    settle(x = 0, z = 0) {
        this._settling = {
            since: performance.now() / 1000,
            // Already faded out (a tape's way out), so keep it that way.
            held: this.state === 'playing' && this.hud.fading,
            told: false,
            surfaces: false,
            textures: null,
            compiling: false,
            then: [],
        };
        if (this.vr.presenting) this._settleNow(x, z);
        else if (this._settling.held) this.hud.setHold(true);
    }

    /**
     * Readies the world all at once around (x, z). Used in VR, where every frame has to be drawn. Shaders compile on
     * first draw there.
     */
    _settleNow(x, z) {
        this.world.surfaces();
        this._surfacesReady();
        this.world.update(x, z, Infinity);
        this._settled();
    }

    _settled() {
        const { then } = this._settling;
        this._settling = null;
        this.menu.setBusy(false);
        this.hud.setHold(false);
        for (const fn of then) fn();
    }

    /**
     * Runs fn once the world is ready (see settle), or right away if it already is. Dropped if another world replaces
     * this one first.
     * @param {() => void} fn
     */
    _onSettled(fn) {
        if (this._settling) this._settling.then.push(fn);
        else fn();
    }

    /**
     * Keeps the picture faded out until the settling world is ready (see settle).
     * @param {'black' | 'white' | null} [color] See Hud.setHold.
     */
    _holdFade(color = null) {
        if (!this._settling) return;
        this._settling.held = true;
        this.hud.setHold(true, color);
    }

    /** One frame of readying a new world (see settle). */
    _updateSettle(now) {
        const settling = this._settling;
        const { x, z } = this.player.position;
        if (this.vr.presenting) {
            // VR started in the meantime.
            this._settleNow(x, z);
            return;
        }
        const level = this.store.level;
        const made = this.materials.hasLevel(level);
        // Making a level's materials can block for a second or so, so show the wait before starting it.
        const shows = settling.held || !made || now - settling.since > SETTLE_SHOWS_AFTER;
        this.menu.setBusy(shows);
        this.hud.setHold(shows && this.state === 'playing');
        if (settling.compiling) return;
        if (!made) {
            if (settling.told) this.world.surfaces();
            settling.told = true;
            return;
        }
        if (!settling.surfaces) {
            settling.surfaces = true;
            this._surfacesReady();
        }
        this.world.update(x, z, Infinity, SETTLE_BUDGET);
        if (this.world.pending > 0) return;
        // Upload its textures one per frame, skipping any _prepareLevels already did.
        settling.textures ??= [...surfaceTextures(this.materials.level(level))];
        while (settling.textures.length > 0) {
            const texture = /** @type {import('three').Texture} */ (settling.textures.pop());
            if (this.renderer.properties.get(texture).__version === texture.version) continue;
            this.renderer.initTexture(texture);
            return;
        }
        // Everything's built. Compile its shaders, including for level things that might come into view later.
        settling.compiling = true;
        const warmUp = this.world.warmUp(level, this._warmUpExtras());
        const cancelled = () => this._settling !== settling;
        compileForLevel(this.renderer, this.scene, this.camera, level, { also: [warmUp.objects], cancelled })
            .then((programs) => {
                warmUp.dispose();
                return whenCompiled(this.renderer, programs, { cancelled });
            })
            .then(() => {
                if (this._settling !== settling) return;
                this._prepared.add(level);
                this._settled();
            });
    }

    /** Setup that needs the current level's materials, once they exist. */
    _surfacesReady() {
        const { extras, unreflected = [] } = this.materials.level(this.store.level);
        // Water isn't in its own reflection, and neither is whatever the level excludes.
        this.reflection.hidden = [...(extras.water ? [extras.water] : []), ...unreflected.map((name) => extras[name])];
    }

    /**
     * Readies the other levels while a menu is up, likeliest next first (starting after the current tape level).
     * Makes materials, uploads textures and compiles shaders one step at a time with a gap between (see _menuFree),
     * so picking a level or reaching it on a tape barely waits. Never while playing since some steps block.
     */
    async _prepareLevels() {
        const { renderer, scene, camera } = this;
        for (let level = this._nextToPrepare(); level !== null; level = this._nextToPrepare()) {
            await this._menuFree();
            const surfaces = this.materials.level(level);
            for (const texture of surfaceTextures(surfaces)) {
                await this._menuFree();
                renderer.initTexture(texture);
            }
            await this._menuFree();
            // It may have been shown in the meantime, which readies it anyway.
            if (this._prepared.has(level)) continue;
            // Compile in small batches, each finished before the next is handed over. Handing over more than the
            // browser can compile in the background stalls drawing until it catches up.
            const warmUp = this.world.warmUp(level, this._warmUpExtras());
            const between = () => this._menuFree();
            const programs = await compileForLevel(renderer, scene, camera, level, {
                also: [warmUp.objects],
                between: async (handed) => {
                    await between();
                    await whenCompiled(renderer, handed, { between });
                },
            });
            warmUp.dispose();
            await whenCompiled(renderer, programs, { between });
            this._prepared.add(level);
        }
    }

    /** Next level to prepare (see _prepareLevels), or null when all are done. */
    _nextToPrepare() {
        const order = [...TAPE_LEVELS, ...LEVELS.map(({ id }) => id).filter((id) => !TAPE_LEVELS.includes(id))];
        const from = Math.max(0, order.indexOf(this.mode === 'footage' ? this.footage.level : this.store.level));
        for (let i = 1; i <= order.length; i++) {
            const level = order[(from + i) % order.length];
            if (!this._prepared.has(level)) return level;
        }
        return null;
    }

    /** Resolves on an idle menu frame, a short gap after the last step (see _prepareLevels). */
    _menuFree() {
        return new Promise((resolve) => {
            this._prepareStep = resolve;
        });
    }

    /** End of frame. Runs the next level prep step if it's time (see _prepareLevels). */
    _offerPrepareStep(now) {
        const menu = this.state === 'title' || this.state === 'paused' || this.state === 'ended';
        const gap = this._longestGap / 1000;
        this._longestGap = 0;
        if (!menu || this._settling || this.vr.presenting || this.contextLost) {
            this._prepareAt = Math.max(this._prepareAt, now + PREPARE_AFTER);
            return;
        }
        // Gaps count from the callbacks, not drawn frames, so this works under the menu FPS limit too. Shader
        // compiles in the background show up here as a stalled frame even though the step itself was quick.
        const hitch = gap - 2 * this._displayFrame;
        if (hitch > 0) this._prepareAt = Math.max(this._prepareAt, now + Math.min(hitch * PREPARE_BACKOFF, PREPARE_BACKOFF_MAX));
        if (!this._prepareStep || now < this._prepareAt) return;
        this._prepareAt = now + PREPARE_GAP;
        const step = this._prepareStep;
        this._prepareStep = null;
        step();
    }

    // ------------------------------------------------------------------ frame

    /**
     * @param {number} timeMs
     * @param {XRFrame} [xrFrame] While in VR.
     */
    _frame(timeMs, xrFrame) {
        const now = timeMs / 1000;
        const vr = this.vr.presenting;
        const since = timeMs - this._lastCallback;
        if (this._lastCallback > 0) this._longestGap = Math.max(this._longestGap, since);
        this._lastCallback = timeMs;
        if (since > 2 && since < 40) this._displayFrame += (since / 1000 - this._displayFrame) * 0.05;

        // Optional FPS limit, and a lower rate on the mostly static menus. Never in VR since the headset sets the
        // pace and shows a skipped frame as garbage. Not while settling either (see settle): nothing is drawn
        // then, and more frames means it's ready sooner. It skips a frame only when it's early by more than half a
        // display frame, and never on a display running at about the limit anyway: a "60 Hz" screen is often a
        // touch faster, and dropping a frame every few seconds to make up for it showed as a hitch.
        const limit = vr || this._settling ? 0 : this.state === 'playing' ? this.settings.graphics.fpsLimit : MENU_FPS;
        if (limit > 0 && this._displayFrame < 0.9 / limit) {
            if (now < this._nextFrameTime - this._displayFrame / 2) return;
            this._nextFrameTime = Math.max(this._nextFrameTime + 1 / limit, now);
        }

        const dt = this._lastFrameTime < 0 ? 0 : MathUtils.clamp(now - this._lastFrameTime, 0, MAX_FRAME_TIME);
        this._lastFrameTime = now;

        this._pollController(now, dt);
        if (vr) this.vr.beginFrame(xrFrame, dt);

        const { camera, player, look } = this;
        const playing = this.state === 'playing';
        const footage = this.footage.active;
        let alpha = 1;

        // Gameplay waits while a new world is settling (see settle).
        if (playing && !this._settling) {
            if (vr) this._vrPlay(dt);
            this._accumulator += dt;
            const input = this._readMoveInput();
            // In VR, forward is where the headset faces.
            const yaw = vr ? this.vr.headYaw(look.yaw) : look.yaw;
            const speed = this.settings.gameplay.movementSpeed * (vr ? VR_SPEED : 1);
            while (this._accumulator >= STEP) {
                player.step(input, yaw, speed, this._boxesNear, this.terrain, this._headroomAt);
                this._accumulator -= STEP;
            }
            alpha = this._accumulator / STEP;
            this.playTime += dt;
            this.hints.update(this.playTime);
            this.hud.setPlayTime(this.playTime);
            this._updateZoom(dt);
            this._watchFrameRate(dt);
            const { x, z } = player.position;
            if (player.steps !== this._stepsHeard) {
                this._stepsHeard = player.steps;
                this._footstep(player.stepWeight);
                // Every step in water makes a ripple.
                if (this.terrain && player.depth > 0.004) this._ripple(x, z, Math.min(1, 0.35 + player.depth * 4) * Math.max(player.stepWeight, 0.3));
            }
            if (player.strokes !== this._strokesHeard) {
                // Swimming stroke: water sound and a ripple.
                this._strokesHeard = player.strokes;
                this._footstep(player.strokeWeight * 0.8);
                this._ripple(x, z, 0.5 + player.strokeWeight * 0.4);
            }
            if (player.landings !== this._landingsHeard) {
                // Landing: a splash in deep water, otherwise a footstep.
                this._landingsHeard = player.landings;
                if (this.terrain && player.depth > 0.2) this.levelSound?.splash?.(player.landingWeight);
                else this._footstep(player.landingWeight);
                if (this.terrain && player.depth > 0.004) this._ripple(x, z, 1.6 + player.landingWeight);
            }
        } else if (this.state === 'title' && !this.reducedMotion && !vr) {
            // Slow idle pan on the title screen.
            look.yaw = Math.sin(now * 0.05) * 0.55;
            look.pitch = Math.sin(now * 0.037) * 0.04;
        }

        // Viewpoint: the camera, or the headset in VR (which moves the camera itself).
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

        if (this._settling) this._updateSettle(now);
        else this.world.update(player.position.x, player.position.z, CHUNK_BUILDS_PER_FRAME, CHUNK_BUDGET);
        this.lighting.update(dt, this.store.areaLight(view.position.x, view.position.z));
        // In VR the flashlight is in a hand, or head-mounted like on screen if no hand is tracked.
        const lightHand = vr && this.vr.lightHand.tracked ? this.vr.lightHand : null;
        this.lighting.updateFlashlight(lightHand ? lightHand.aim : view, this.world.version, lightHand !== null);
        this.audio.setAreaLight(this.lighting.areaLight);
        // Level Fun mirror balls, guests and confetti (frozen while paused), and its sound.
        this.partyLayer.update(this.state === 'paused' ? 0 : dt, view, playing, this._onGuestPop);
        if (this.state !== 'paused') this.confetti.update(dt);
        if (this.party) this._updatePartySound(dt, view, vr ? this.vr.headYaw(look.yaw) : look.yaw);
        else if (this.partyAudio.beacon > 0) this.partyAudio.update(dt);
        if (playing && !this._settling) {
            // Power cuts, or on a tape the lights failing as notes are found and as the Watcher gets close.
            const cut = this.blackouts.update(dt, this._onBlackoutEvent);
            if (footage) this.footage.update(dt, view);
            this.lighting.setBlackout(Math.max(cut, footage ? this.footage.gloom : 0));
            this.audio.update(dt);
            const sound = this.levelSound;
            if (sound) {
                sound.follow(view.position.x, view.position.z, this.lighting.areaLight, 1 - this.lighting.blackout, view.position.y);
                sound.update(dt);
            }
            const facing = vr ? this.vr.headYaw(look.yaw) : look.yaw;
            this.audio.listenToLights(this.store, view.position.x, view.position.z, facing, this.lighting.time, 1 - this.lighting.blackout);
            // The page (and the map on it) can't be seen in VR.
            if (vr) this.minimap.reveal(this.store, view.position.x, view.position.z);
            else this.minimap.update(this.store, view.position.x, view.position.z, facing, footage ? this.footage.marks : undefined);
            if (this.lighting.areaLight < DARK_AREA && !this.editMode && !footage) this.hints.situation('dark', this.lighting.flashlightOn);
            if (this.editMode) this._updateEdit(vr);
        }
        if (vr) {
            this.vr.setFlashlight(this.lighting.flashlightOn);
            // The page's fade and title aren't visible in the headset, so mirror them to its own.
            this.vr.fade.set(this.hud.fading, this.hud.fadeColor);
            this.vr.title.show(this.hud.titleText);
            this.vr.setLaser(playing && this.editMode ? this.editTool.hitDistance ?? EDIT_REACH : null);
        }
        this.hud.setCoordinates(chunkCoord(cellCoord(player.position.x)), chunkCoord(cellCoord(player.position.z)));

        this.renderer.info.reset();
        // Don't draw while settling (see settle). The last frame stays up.
        if (!this._settling) this._render(dt, vr);

        if (this.settings.graphics.showStats) this._updateStats(now, dt);
        this._offerPrepareStep(now);
    }

    /**
     * @param {number} dt
     * @param {boolean} vr
     */
    _render(dt, vr) {
        const camera = this.camera;
        // Levels with reflections (see levels.js) only get them with dynamic lights on (similar cost), and not in VR.
        const reflect = levelById(this.store.level).reflections && this.settings.graphics.dynamicLights && !vr;
        if (reflect !== this.reflection.active) this.reflection.setActive(reflect);
        if (reflect) this.reflection.render(this.scene, camera);
        // No VHS pass in VR. Post-processing doesn't work with WebXR, and a wobbling picture in a headset would
        // cause motion sickness anyway.
        if (vr) this.renderer.render(this.scene, camera);
        else this.post.render(dt);

        if (this._stillRequested) {
            // Right after rendering, while the frame is still in the canvas.
            this._stillRequested = false;
            saveStill(this.canvas, this.seed);
            this.toast.flash('Still saved.');
        }
    }

    _resetFrameWatch() {
        const watch = this._frameWatch;
        watch.settle = SETTLE_SECONDS;
        watch.time = watch.frames = watch.slow = 0;
    }

    /**
     * Turns AO off when the device can't keep up, then dynamic lights as a last resort (see SETTLE_SECONDS). VR
     * doesn't draw AO, so only the lights are watched there.
     */
    _watchFrameRate(dt) {
        const graphics = this.settings.graphics;
        const vr = this.vr.presenting;
        const occlusion = this._watchOcclusion && graphics.ambientOcclusion && !vr;
        const lights = this._watchLights && graphics.dynamicLights && (!graphics.ambientOcclusion || vr);
        if (!occlusion && !lights) return;
        const watch = this._frameWatch;
        if (watch.settle > 0) {
            watch.settle -= dt;
            return;
        }
        watch.time += dt;
        watch.frames++;
        if (watch.time < 1) return;
        const fps = watch.frames / watch.time;
        watch.time = watch.frames = 0;
        const limit = vr ? 0 : graphics.fpsLimit;
        if (occlusion) {
            const target = limit > 0 ? Math.min(limit, TARGET_FPS) : TARGET_FPS;
            watch.slow = fps < target * OCCLUSION_FPS ? watch.slow + 1 : 0;
            if (watch.slow < OCCLUSION_SLOW_SECONDS) return;
            this._watchOcclusion = false;
            graphics.ambientOcclusion = false;
            this._settingChanged('graphics.ambientOcclusion');
            this.toast.flash('Ambient occlusion turned off to keep the frame rate up.\nIt can be turned back on in Settings.', 4000);
            // Restart the watch so the lights get judged without AO.
            this._resetFrameWatch();
            return;
        }
        watch.slow = fps < (limit > 0 ? Math.min(LIGHTS_MIN_FPS, limit * 0.75) : LIGHTS_MIN_FPS) ? watch.slow + 1 : 0;
        if (watch.slow < LIGHTS_SLOW_SECONDS) return;
        this._watchLights = false;
        graphics.dynamicLights = false;
        this._settingChanged('graphics.dynamicLights');
        this.toast.flash('Dynamic lights turned off to keep the frame rate up.\nThey can be turned back on in Settings.', 4000);
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

    _readMoveInput() {
        const kb = this.keyboard;
        const input = this._moveInput;
        if (this.catalogue.isOpen) {
            input.forward = input.right = input.up = 0;
            input.sprint = input.jump = false;
            return input;
        }
        const touch = this.touchControls.move;
        const pad = this.gamepad;
        const stick = pad.leftStick;
        const padUp = (pad.held(BUTTON.A) ? 1 : 0) - (pad.held(BUTTON.B) ? 1 : 0);
        const vr = this._vrMove;
        input.forward = MathUtils.clamp(kb.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) + touch.forward - stick.y + vr.forward, -1, 1);
        input.right = MathUtils.clamp(kb.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) + touch.right + stick.x + vr.right, -1, 1);
        // Up/down flies in edit mode and swims in deep water. The same keys jump.
        input.up = MathUtils.clamp(kb.axis(['KeyE'], ['Space', 'KeyQ']) + padUp + (touch.jump ? 1 : 0) + vr.up, -1, 1);
        input.sprint = kb.isDown('ShiftLeft', 'ShiftRight') || touch.sprint || this._stickSprint || vr.sprint;
        input.jump = kb.isDown('Space') || pad.held(BUTTON.A) || touch.jump || vr.jump;
        // Tapes limit sprint with stamina, and block all movement once over.
        if (this.footage.active) this.footage.filterInput(input);
        return input;
    }

    /** Per-frame VR controller and hand pinch input while playing. */
    _vrPlay(dt) {
        const { vr, look } = this;
        // Walking around the room moves the player too, but not through walls.
        vr.trackedMovement(look.yaw, _tracked);
        this.player.shift(_tracked.x, _tracked.z, this._boxesNear);

        const move = this._vrMove;
        move.forward = move.right = move.up = 0;
        if (!vr.visible) {
            // Headset system menu is up.
            move.sprint = move.jump = false;
            return;
        }
        const [left, right] = vr.hands;

        // Left stick walks toward where you're looking, or a held pinch walks straight ahead. Clicking the stick
        // sprints until it's released.
        const walk = left.stick;
        move.forward = -walk.y + (vr.walking ? 1 : 0);
        move.right = walk.x;
        if (this.editMode && left.pressed(XR_BUTTON.STICK)) {
            // In edit mode it cycles tool sections instead.
            this._cycleSection(1);
        } else if (left.pressed(XR_BUTTON.STICK)) {
            move.sprint = true;
            this.hints.markUsed('sprint');
        } else if (Math.hypot(walk.x, walk.y) < STICK_SPRINT_RELEASE) {
            move.sprint = false;
        }

        // Right stick turns in steps (less nausea), or smoothly if snap turn is off.
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
        // Up/down on it flies in edit mode or swims in deep water. Up also jumps.
        if (Math.abs(turn.y) > Math.abs(turn.x)) move.up = -turn.y;
        move.jump = !this.editMode && move.up > VR_JUMP;

        for (const hand of vr.hands) {
            if (hand.pressed(XR_BUTTON.A)) {
                this._flashlightInHand(hand);
                vr.pulse(0.15, 20, hand);
            }
        }
        if (left.pressed(XR_BUTTON.B) || right.pressed(XR_BUTTON.B)) this._toggleEditMode();

        if (!this.editMode) return;
        if (right.pressed(XR_BUTTON.STICK)) this._cycleTool(1);
        for (const hand of vr.hands) {
            const build = hand.pressed(XR_BUTTON.TRIGGER);
            if (!build && !hand.pressed(XR_BUTTON.SQUEEZE)) continue;
            if (vr.aimHand !== hand) {
                // Switch aiming to this hand.
                vr.aimHand = hand;
                this.editTool.update(hand.aim, this.store, this.player.position);
            }
            if (this._startEdit(build ? 'build' : 'remove', hand, build ? XR_BUTTON.TRIGGER : XR_BUTTON.SQUEEZE)) vr.pulse(0.35, 35, hand);
        }
        const hold = this._editHold;
        if (hold && typeof hold.source === 'object' && !hold.source.held(hold.button)) this._endEdit();
    }

    /** A/X in VR. Turns the flashlight on in that hand, moves it over from the other hand, or turns it off. */
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
            `ZONE   ${ZONE_NAMES[zone.type]}${this.party ? ' =)' : ''}`,
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

/**
 * Textures used by a level's materials (see materials.js).
 * @param {import('./world/materials.js').LevelSurfaces} surfaces
 */
function surfaceTextures({ wall, floor, ceiling, details, extras }) {
    const textures = new Set();
    for (const material of [wall, floor, ceiling, details, ...Object.values(extras)]) {
        for (const texture of [material.map, material.bumpMap]) if (texture) textures.add(texture);
    }
    return textures;
}
