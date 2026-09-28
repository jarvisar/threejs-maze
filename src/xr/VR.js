import { Camera, Euler, Group, Quaternion, Vector3 } from 'three';
import { EYE_HEIGHT, VR_METERS_PER_UNIT } from '../config.js';
import { VRHand } from './VRHand.js';
import { VRFade, VRPanel } from './VRPanel.js';

const SCALE = 1 / VR_METERS_PER_UNIT;
// Assumed headset height (m) when the device doesn't know where the floor is.
const STANDING_HEIGHT = 1.6;
const SESSION_OPTIONS = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };
// Most headsets suggest a resolution a bit under the panel's to save work. We render at the native panel
// resolution instead, capped at this multiple of the suggested one.
const MAX_FRAMEBUFFER_SCALE = 1.5;

const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _one = new Vector3(1, 1, 1);
const _euler = new Euler();

/**
 * WebXR VR support.
 *
 * The headset's tracking space (meters) sits in a rig on the floor under the player that turns with them,
 * scaled so one world unit is VR_METERS_PER_UNIT meters. The scale only affects movement. It's taken back out
 * of the eye view matrices (see `place`) so fog, the far plane and ceiling lights, which work in view space,
 * look the same as on a screen.
 *
 * Dispatches `support` (availability changed), `start`, `end` and `inputs` (controllers or hands changed).
 */
export class VR extends EventTarget {
    /**
     * @param {import('three').WebGLRenderer} renderer
     * @param {import('three').Scene} scene
     * @param {import('three').PerspectiveCamera} camera The game's camera, driven by the headset while presenting.
     * @param {import('three').Material} laserMaterial For the pointer in edit mode.
     */
    constructor(renderer, scene, camera, laserMaterial) {
        super();
        this.renderer = renderer;
        this.camera = camera;
        /** Browser supports VR and a headset is connected. */
        this.available = false;
        /** @type {XRSession | null} */
        this.session = null;
        /** False while the headset's own menu is over the game. */
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
         * lightHand holds the flashlight (last hand to turn it on). aimHand aims in edit mode (last hand to
         * build or remove).
         * @type {VRHand}
         */
        this.lightHand = this.hands[1];
        /** @type {VRHand} */
        this.aimHand = this.hands[1];
        /** Toast card in front of you. */
        this.panel = new VRPanel();
        /** Camcorder title (level name), further away and a little higher. */
        this.title = new VRPanel({ width: 2.4, distance: 2.5, drop: -0.3, fontSize: 110, lines: 2, box: false });
        this.title.flicker = true;
        /** Headset pose in world units, for anything that looks from the eyes. */
        this.head = new Camera();
        // Headset pose in tracking space, between the eyes. three.js's XR camera sits a little behind them so its
        // view covers both eyes.
        this._viewer = new Group();
        /** Fade to black or white around the eyes. */
        this.fade = new VRFade();
        this._viewer.add(this.fade.mesh);
        this.space.add(this._viewer, this.panel.mesh, this.title.mesh);

        this._headLocal = new Vector3();
        this._headPrevious = new Vector3();
        this._headKnown = false;
        this._headYaw = 0;
        /** @type {Set<XRInputSource>} Pinching hands or held screens. They have no sticks so this walks. */
        this._selecting = new Set();

        renderer.xr.enabled = true;
        // three.js defaults to full fixed foveation, which renders the edges at a fraction of the resolution with a
        // visible step. The scene is light enough to go without.
        renderer.xr.setFoveation(0);
        // XR cameras are updated in `place` so the scale can be removed from them.
        renderer.xr.cameraAutoUpdate = false;

        this._checkSupport();
        globalThis.navigator?.xr?.addEventListener?.('devicechange', () => this._checkSupport());
    }

    get presenting() {
        return this.session !== null;
    }

    /**
     * Player input type. 'hands' is tracked hands (pinch), 'gaze' is a phone in a viewer (tap). Null if nothing
     * is connected yet.
     * @returns {'controllers' | 'hands' | 'gaze' | null}
     */
    get inputKind() {
        if (this.hands.some((hand) => hand.hasButtons)) return 'controllers';
        const sources = this.session ? [...this.session.inputSources] : [];
        if (sources.some((source) => source.hand)) return 'hands';
        if (sources.some((source) => source.targetRayMode === 'gaze' || source.targetRayMode === 'screen')) return 'gaze';
        return null;
    }

    /** A pinch or screen hold, which walks toward where the player is looking. */
    get walking() {
        return this._selecting.size > 0;
    }

    /** Edit mode aim. The aiming hand, then the other hand, then the headset. */
    get aim() {
        return this._aimingHand()?.aim ?? this.head;
    }

    /**
     * Must be called from a click or key press, browsers require it. Rejects if the headset can't start.
     */
    async enter() {
        if (this.session || !navigator.xr) return;
        const session = await navigator.xr.requestSession('immersive-vr', SESSION_OPTIONS);
        const xr = this.renderer.xr;
        try {
            // Almost every headset knows where the floor is. If not, assume a typical standing height.
            const floor = await session.requestReferenceSpace('local-floor').then(() => true, () => false);
            xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
            this.space.position.y = floor ? 0 : STANDING_HEIGHT * SCALE;
            const native = globalThis.XRWebGLLayer?.getNativeFramebufferScaleFactor?.(session) ?? 1;
            xr.setFramebufferScaleFactor(Math.min(Math.max(native, 1), MAX_FRAMEBUFFER_SCALE));
            await xr.setSession(session);
        } catch (error) {
            session.end().catch(() => {});
            throw error;
        }

        this.session = session;
        this.visible = true;
        this._headKnown = false;
        // Added after three.js's listener so the canvas size is restored before the game gets the event.
        session.addEventListener('end', () => this._onEnd());
        session.addEventListener('visibilitychange', () => {
            this.visible = session.visibilityState === 'visible';
            if (!this.visible) this._selecting.clear();
        });
        session.addEventListener('inputsourceschange', (event) => this._updateSources(event.added, event.removed));
        session.addEventListener('selectstart', (event) => this._onSelect(event, true));
        session.addEventListener('selectend', (event) => this._onSelect(event, false));
        // Recentering jumps the tracking space. Don't count it as walking, and move the cards back in front.
        xr.getReferenceSpace()?.addEventListener('reset', () => {
            this._headKnown = false;
            this.panel.recentre();
            this.title.recentre();
        });

        this.space.add(this.camera);
        this.panel.recentre();
        this.title.recentre();
        this.rig.visible = true;
        this._updateSources(session.inputSources, []);
        this.dispatchEvent(new Event('start'));
    }

    exit() {
        this.session?.end().catch(() => {});
    }

    /** Shows all VR-only objects so their shaders compile behind the loading screen. */
    showAll() {
        this.rig.visible = true;
        for (const mesh of [this.panel.mesh, this.title.mesh, this.fade.mesh]) mesh.visible = true;
        for (const hand of this.hands) {
            hand.grip.visible = true;
            hand.ray.visible = true;
            hand.laser.visible = true;
        }
    }

    hideAll() {
        this.rig.visible = false;
        this.panel.mesh.visible = this.panel.message !== null;
        this.title.mesh.visible = this.title.message !== null;
        this.fade.clear();
        for (const hand of this.hands) {
            hand.clear();
            hand.laser.visible = false;
        }
    }

    /**
     * Reads the headset and controllers and updates the cards and fade. Call at the start of each frame while
     * presenting.
     * @param {XRFrame | undefined} frame
     * @param {number} dt
     */
    beginFrame(frame, dt) {
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
        this.panel.follow(this._viewer, dt);
        this.title.follow(this._viewer, dt);
        this.fade.update(dt);
    }

    /**
     * Real-world walking since the last frame, in world units.
     * @param {number} yaw Rig yaw (the game's look yaw).
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
     * Headset facing in the world.
     * @param {number} yaw Rig yaw (the game's look yaw).
     */
    headYaw(yaw) {
        return yaw + this._headYaw;
    }

    /**
     * Moves the rig so the headset is over `position`, rotated by `yaw`, then updates the XR cameras, `head`
     * and the hand aims.
     * @param {import('three').Vector3} position Player eye position. Eye height above the floor comes from the
     *     headset instead.
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
        // three.js carries the rig scale into the eye view matrices. Removing it keeps the scaled positions
        // (eyes closer together, so the world looks bigger) but leaves view space in world units.
        const cameraXR = xr.getCamera();
        removeScale(cameraXR);
        for (const view of cameraXR.cameras) removeScale(view);

        this._viewer.matrixWorld.decompose(this.head.position, this.head.quaternion, _scale);
        this.head.updateMatrixWorld();
        for (const hand of this.hands) hand.updateAim();
    }

    /**
     * Controller vibration. Does nothing for tracked hands.
     * @param {number} intensity 0..1
     * @param {number} ms
     * @param {VRHand} [hand] Both if omitted.
     */
    pulse(intensity, ms, hand) {
        if (!this.session) return;
        for (const each of hand ? [hand] : this.hands) each.pulse(intensity, ms);
    }

    /** @param {boolean} on Shown in `lightHand`. */
    setFlashlight(on) {
        for (const hand of this.hands) hand.setLit(on && hand === this.lightHand);
    }

    /** @param {number | null} distance Edit mode pointer length (world units), or null to hide it. */
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
            // Gaze and screen taps have no model. They only walk (see _onSelect).
            if (source.targetRayMode !== 'tracked-pointer') continue;
            this.hands[source.handedness === 'left' ? 0 : 1].source = source;
        }
        this.dispatchEvent(new Event('inputs'));
    }

    /** Hands, gaze and screen taps have no sticks, so holding a pinch or tap walks. */
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
        this.camera.scale.set(1, 1, 1);
        this.title.show(null);
        this.fade.clear();
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
