import { Camera, Euler, Group, Quaternion, Vector3 } from 'three';
import { EYE_HEIGHT, VR_METERS_PER_UNIT } from '../config.js';
import { VRHand } from './VRHand.js';
import { VRPanel } from './VRPanel.js';

const SCALE = 1 / VR_METERS_PER_UNIT;
// Where the headset is assumed to be when the device can't tell where the floor is (metres).
const STANDING_HEIGHT = 1.6;
const SESSION_OPTIONS = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };

const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _one = new Vector3(1, 1, 1);
const _euler = new Euler();

/**
 * Playing in a VR headset through WebXR.
 *
 * The headset's tracking space (in metres) sits in a rig that stands on the floor under the player and
 * turns with them, scaled so that one world unit is VR_METERS_PER_UNIT metres. Only the size of the
 * player's movements changes, though: the eyes' view matrices are kept free of that scale (see `place`),
 * so the fog, the far plane and the ceiling lights, which all work in view space, look exactly as they do
 * on a screen.
 *
 * Dispatches `support` (when it turns out VR is or isn't available), `start`, `end` and `inputs` (when
 * controllers or hands come or go).
 */
export class VR extends EventTarget {
    /**
     * @param {import('three').WebGLRenderer} renderer
     * @param {import('three').Scene} scene
     * @param {import('three').PerspectiveCamera} camera The game's camera; the headset drives it while presenting.
     * @param {import('three').Material} laserMaterial For the pointer in edit mode.
     */
    constructor(renderer, scene, camera, laserMaterial) {
        super();
        this.renderer = renderer;
        this.camera = camera;
        /** Whether a VR headset can be used (the browser supports it and one is connected). */
        this.available = false;
        /** @type {XRSession | null} */
        this.session = null;
        /** False while the headset is showing its own menu over the game. */
        this.visible = false;

        this.rig = new Group();
        this.rig.name = 'vr rig';
        this.rig.visible = false;
        this.space = new Group();
        this.space.scale.setScalar(SCALE);
        this.rig.add(this.space);
        scene.add(this.rig);

        this.hands = [new VRHand('left', laserMaterial), new VRHand('right', laserMaterial)];
        for (const hand of this.hands) this.space.add(hand.grip, hand.ray);
        /**
         * The hand holding the flashlight (the last one to switch it on) and the one aiming in edit mode
         * (the last one to build or remove something).
         * @type {VRHand}
         */
        this.lightHand = this.hands[1];
        /** @type {VRHand} */
        this.aimHand = this.hands[1];
        this.panel = new VRPanel();
        /** The headset in world units, for everything that looks from the eyes. */
        this.head = new Camera();
        // The headset in the tracking space (between the eyes, unlike three.js's camera, which sits a little
        // behind them so its view covers both eyes').
        this._viewer = new Group();
        this.space.add(this._viewer);

        this._headLocal = new Vector3();
        this._headPrevious = new Vector3();
        this._headKnown = false;
        this._headYaw = 0;
        /** @type {Set<XRInputSource>} Hands pinching or screens held, which walk (they have no sticks). */
        this._selecting = new Set();

        renderer.xr.enabled = true;
        // The XR cameras are updated in `place`, where the scale can be taken back out of them.
        renderer.xr.cameraAutoUpdate = false;

        this._checkSupport();
        globalThis.navigator?.xr?.addEventListener?.('devicechange', () => this._checkSupport());
    }

    get presenting() {
        return this.session !== null;
    }

    /**
     * What the player has to move with: 'controllers', 'hands' (tracked hands, which pinch), 'gaze' (a
     * phone in a viewer, which taps), or null if nothing's connected yet.
     * @returns {'controllers' | 'hands' | 'gaze' | null}
     */
    get inputKind() {
        if (this.hands.some((hand) => hand.hasButtons)) return 'controllers';
        const sources = this.session ? [...this.session.inputSources] : [];
        if (sources.some((source) => source.hand)) return 'hands';
        if (sources.some((source) => source.targetRayMode === 'gaze' || source.targetRayMode === 'screen')) return 'gaze';
        return null;
    }

    /** Whether a hand is pinching (or the screen held) to walk where the player is looking. */
    get walking() {
        return this._selecting.size > 0;
    }

    /** Where edit mode aims from: the aiming hand, or failing that the other one, or else the headset. */
    get aim() {
        return this._aimingHand()?.aim ?? this.head;
    }

    /**
     * Starts a VR session. Has to be called from a click or key press: browsers don't allow it otherwise.
     * Rejects if the headset can't be started.
     */
    async enter() {
        if (this.session || !navigator.xr) return;
        const session = await navigator.xr.requestSession('immersive-vr', SESSION_OPTIONS);
        const xr = this.renderer.xr;
        try {
            // Nearly every headset knows where the floor is. For one that doesn't, stand at a typical height.
            const floor = await session.requestReferenceSpace('local-floor').then(() => true, () => false);
            xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
            this.space.position.y = floor ? 0 : STANDING_HEIGHT * SCALE;
            await xr.setSession(session);
        } catch (error) {
            session.end().catch(() => {});
            throw error;
        }

        this.session = session;
        this.visible = true;
        this._headKnown = false;
        // After three.js's own listener, so it has restored the canvas size by the time the game hears.
        session.addEventListener('end', () => this._onEnd());
        session.addEventListener('visibilitychange', () => {
            this.visible = session.visibilityState === 'visible';
            if (!this.visible) this._selecting.clear();
        });
        session.addEventListener('inputsourceschange', (event) => this._updateSources(event.added, event.removed));
        session.addEventListener('selectstart', (event) => this._onSelect(event, true));
        session.addEventListener('selectend', (event) => this._onSelect(event, false));
        // Recentring the view jumps the tracking space; don't treat that as walking.
        xr.getReferenceSpace()?.addEventListener('reset', () => {
            this._headKnown = false;
        });

        this.space.add(this.camera);
        this.camera.add(this.panel.mesh);
        this.rig.visible = true;
        this._updateSources(session.inputSources, []);
        this.dispatchEvent(new Event('start'));
    }

    exit() {
        this.session?.end().catch(() => {});
    }

    /** Shows every VR-only object at once (used to compile their shaders behind the loading screen). */
    showAll() {
        this.rig.visible = true;
        this.rig.add(this.panel.mesh);
        this.panel.mesh.visible = true;
        for (const hand of this.hands) {
            hand.grip.visible = true;
            hand.ray.visible = true;
            hand.laser.visible = true;
        }
    }

    hideAll() {
        this.rig.visible = false;
        this.rig.remove(this.panel.mesh);
        this.panel.mesh.visible = this.panel.message !== null;
        for (const hand of this.hands) {
            hand.clear();
            hand.laser.visible = false;
        }
    }

    /**
     * Reads the headset and controllers. Call at the start of every frame while presenting.
     * @param {XRFrame | undefined} frame
     */
    beginFrame(frame) {
        const space = this.renderer.xr.getReferenceSpace();
        if (!frame || !space) return;
        const pose = frame.getViewerPose(space);
        if (pose) {
            const { position, orientation } = pose.transform;
            _position.set(position.x, position.y, position.z);
            this._headPrevious.copy(this._headKnown ? this._headLocal : _position);
            this._headLocal.copy(_position);
            this._headKnown = true;
            this._viewer.position.copy(_position);
            this._viewer.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
            this._headYaw = _euler.setFromQuaternion(this._viewer.quaternion, 'YXZ').y;
        } else {
            this._headPrevious.copy(this._headLocal);
        }
        for (const hand of this.hands) hand.update(frame, space);
    }

    /**
     * How far the player has walked across their room since the last frame, in world units.
     * @param {number} yaw The rig's turn (the game's look yaw).
     * @param {{ x: number, z: number }} out
     */
    trackedMovement(yaw, out) {
        const dx = this._headLocal.x - this._headPrevious.x;
        const dz = this._headLocal.z - this._headPrevious.z;
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        out.x = (dx * cos + dz * sin) * SCALE;
        out.z = (dz * cos - dx * sin) * SCALE;
        return out;
    }

    /**
     * Which way the headset faces in the world.
     * @param {number} yaw The rig's turn (the game's look yaw).
     */
    headYaw(yaw) {
        return yaw + this._headYaw;
    }

    /**
     * Stands the rig so the headset is over `position`, turned by `yaw`, and updates the XR cameras,
     * `head` and the hands' aims to match.
     * @param {import('three').Vector3} position The player's eye position (only its height above the
     *     floor comes from the headset, though).
     * @param {number} yaw
     */
    place(position, yaw) {
        const { x, z } = this._headLocal;
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        this.rig.position.set(
            position.x - (x * cos + z * sin) * SCALE,
            position.y - EYE_HEIGHT,
            position.z - (z * cos - x * sin) * SCALE,
        );
        this.rig.rotation.y = yaw;
        this.rig.updateMatrixWorld(true);

        const xr = this.renderer.xr;
        xr.updateCamera(this.camera);
        // three.js carries the rig's scale into the eyes' view matrices. Taking it back out keeps the
        // positions (so the eyes are closer together, and the world looks bigger) but leaves view space
        // in world units.
        const cameraXR = xr.getCamera();
        removeScale(cameraXR);
        for (const view of cameraXR.cameras) removeScale(view);

        this._viewer.matrixWorld.decompose(this.head.position, this.head.quaternion, _scale);
        this.head.updateMatrixWorld();
        for (const hand of this.hands) hand.updateAim();
    }

    /** @param {boolean} on Whether the flashlight is on (in `lightHand`). */
    setFlashlight(on) {
        for (const hand of this.hands) hand.setLit(on && hand === this.lightHand);
    }

    /** @param {number | null} distance How far the edit-mode pointer reaches (world units), or null for none. */
    setLaser(distance) {
        const aiming = this._aimingHand();
        for (const hand of this.hands) hand.setLaser(distance !== null && hand === aiming ? distance / SCALE : null);
    }

    /** @returns {VRHand | null} */
    _aimingHand() {
        if (this.aimHand.tracked) return this.aimHand;
        const other = this.hands[this.aimHand === this.hands[0] ? 1 : 0];
        return other.tracked ? other : null;
    }

    async _checkSupport() {
        let available = false;
        try {
            available = (await globalThis.navigator?.xr?.isSessionSupported('immersive-vr')) === true;
        } catch {
            // Blocked by a permissions policy, for example.
        }
        if (available === this.available) return;
        this.available = available;
        this.dispatchEvent(new Event('support'));
    }

    /**
     * @param {ArrayLike<XRInputSource>} added
     * @param {ArrayLike<XRInputSource>} removed
     */
    _updateSources(added, removed) {
        for (const source of Array.from(removed)) {
            this._selecting.delete(source);
            for (const hand of this.hands) if (hand.source === source) hand.clear();
        }
        for (const source of Array.from(added)) {
            // Gaze and screen taps have nothing to show; they only walk (see _onSelect).
            if (source.targetRayMode !== 'tracked-pointer') continue;
            this.hands[source.handedness === 'left' ? 0 : 1].source = source;
        }
        this.dispatchEvent(new Event('inputs'));
    }

    /** Hands, gaze and screen taps have no sticks: holding a pinch or tap walks instead. */
    _onSelect(event, down) {
        const source = event.inputSource;
        if (source.gamepad && !source.hand) return;
        if (down) this._selecting.add(source);
        else this._selecting.delete(source);
    }

    _onEnd() {
        this.session = null;
        this.visible = false;
        this._selecting.clear();
        this.space.remove(this.camera);
        this.camera.remove(this.panel.mesh);
        this.camera.scale.set(1, 1, 1);
        this.rig.visible = false;
        for (const hand of this.hands) hand.clear();
        this.dispatchEvent(new Event('end'));
    }
}

/** @param {import('three').Camera} camera */
function removeScale(camera) {
    camera.matrixWorld.decompose(_position, _quaternion, _scale);
    camera.matrixWorld.compose(_position, _quaternion, _one);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
}
