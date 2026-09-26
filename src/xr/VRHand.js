import {
    BufferGeometry,
    Camera,
    CircleGeometry,
    CylinderGeometry,
    Float32BufferAttribute,
    Group,
    Line,
    Mesh,
    MeshBasicMaterial,
    Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyDeadzone } from '../input/Gamepad.js';

// Button numbers in the WebXR "xr-standard" layout (https://www.w3.org/TR/webxr-gamepads-module-1/), which
// Quest, Index, Vive, Windows Mixed Reality and Pico controllers all use.
export const XR_BUTTON = Object.freeze({
    TRIGGER: 0,
    SQUEEZE: 1,
    TOUCHPAD: 2,
    STICK: 3,
    A: 4, // A on the right controller, X on the left
    B: 5, // B on the right, Y on the left
});
const BUTTON_COUNT = 6;
// Same as for game controllers: down past PRESS, up again below RELEASE, so a trigger doesn't flicker.
const PRESS = 0.5;
const RELEASE = 0.3;

const BODY_COLOR = 0x1d1c19;
const LENS_ON = 0xfff6d8;
const LENS_OFF = 0x3a3830;

const _scale = new Vector3();

/**
 * One VR controller: where it is, what's pressed, and the small flashlight-shaped model drawn in its place.
 * Poses are in the headset's tracking space (metres); `aim` is the pointing ray in world units.
 */
export class VRHand {
    /**
     * @param {'left' | 'right'} handedness
     * @param {import('three').Material} laserMaterial
     */
    constructor(handedness, laserMaterial) {
        this.handedness = handedness;
        /** @type {XRInputSource | null} */
        this.source = null;
        /** Whether the controller's position is known this frame. */
        this.tracked = false;

        this.grip = new Group();
        this.grip.matrixAutoUpdate = false;
        this.grip.visible = false;
        this.ray = new Group();
        this.ray.matrixAutoUpdate = false;
        this.ray.visible = false;
        /** The pointing ray as a camera (looking down -z), for aiming edits and the flashlight. */
        this.aim = new Camera();

        // Modelled along -z, the way the grip space points.
        this.model = new Mesh(flashlightGeometry(), new MeshBasicMaterial({ color: BODY_COLOR, fog: false }));
        this.lens = new Mesh(new CircleGeometry(0.019, 16).rotateY(Math.PI).translate(0, 0, -0.1085), new MeshBasicMaterial({ color: LENS_OFF, fog: false }));
        this.grip.add(this.model, this.lens);

        // Unit length along the ray; scaled to reach whatever it's pointing at.
        this.laser = new Line(new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3)), laserMaterial);
        this.laser.visible = false;
        this.laser.frustumCulled = false;
        this.ray.add(this.laser);

        /** Thumbstick (or touchpad) after the dead zone. Up is negative y. */
        this.stick = { x: 0, y: 0 };
        this._values = new Float32Array(BUTTON_COUNT);
        this._down = new Uint8Array(BUTTON_COUNT);
        this._wasDown = new Uint8Array(BUTTON_COUNT);
    }

    /** A controller with buttons (not a tracked hand, which only pinches). */
    get hasButtons() {
        return Boolean(this.source?.gamepad) && !this.source?.hand;
    }

    /**
     * Reads the controller's pose and buttons. Call once per frame.
     * @param {XRFrame} frame
     * @param {XRReferenceSpace} space
     */
    update(frame, space) {
        const source = this.source;
        this._wasDown.set(this._down);
        this._values.fill(0);
        this.stick.x = 0;
        this.stick.y = 0;

        const rayPose = source ? frame.getPose(source.targetRaySpace, space) : null;
        const gripPose = source?.gripSpace ? frame.getPose(source.gripSpace, space) : null;
        this.tracked = Boolean(rayPose);
        this.ray.visible = this.tracked;
        if (rayPose) this.ray.matrix.fromArray(rayPose.transform.matrix);
        // Tracked hands are already visible as hands; only controllers get a model.
        this.grip.visible = Boolean(gripPose) && !source?.hand;
        if (gripPose) this.grip.matrix.fromArray(gripPose.transform.matrix);

        const pad = this.hasButtons ? source.gamepad : null;
        if (pad) {
            const buttons = Math.min(pad.buttons.length, BUTTON_COUNT);
            for (let i = 0; i < buttons; i++) {
                const button = pad.buttons[i];
                this._values[i] = button.value || (button.pressed ? 1 : 0);
            }
            // Thumbstick where there is one; older controllers (Vive wands) only have a touchpad.
            const [x, y] = pad.axes.length >= 4 ? [pad.axes[2], pad.axes[3]] : [pad.axes[0], pad.axes[1]];
            applyDeadzone(x, y, this.stick);
        }
        for (let i = 0; i < BUTTON_COUNT; i++) {
            this._down[i] = this._values[i] > (this._wasDown[i] ? RELEASE : PRESS) ? 1 : 0;
        }
    }

    /** Copies the ray's world pose into `aim`. Call after the rig has been placed for the frame. */
    updateAim() {
        this.ray.matrixWorld.decompose(this.aim.position, this.aim.quaternion, _scale);
        this.aim.updateMatrixWorld();
    }

    /** Whether the button went down this frame. */
    pressed(button) {
        return this._down[button] === 1 && this._wasDown[button] === 0;
    }

    held(button) {
        return this._down[button] === 1;
    }

    /**
     * A short buzz, where the controller can.
     * @param {number} intensity 0..1
     * @param {number} ms
     */
    pulse(intensity, ms) {
        const actuator = this.hasButtons ? this.source.gamepad.hapticActuators?.[0] : undefined;
        actuator?.pulse?.(intensity, ms)?.catch?.(() => {});
    }

    /** @param {boolean} lit Whether this hand's flashlight is on. */
    setLit(lit) {
        this.lens.material.color.setHex(lit ? LENS_ON : LENS_OFF);
    }

    /** @param {number | null} length In metres, or null to hide it. */
    setLaser(length) {
        this.laser.visible = length !== null;
        if (length !== null) {
            this.laser.scale.z = length;
            this.laser.updateMatrix();
        }
    }

    /** Forgets the controller (e.g. at the end of a session). */
    clear() {
        this.source = null;
        this.tracked = false;
        this.grip.visible = false;
        this.ray.visible = false;
        this._down.fill(0);
        this._wasDown.fill(0);
    }
}

/** A small hand torch, pointing down -z: a grip and a wider head. */
function flashlightGeometry() {
    const body = new CylinderGeometry(0.016, 0.018, 0.13, 12).rotateX(-Math.PI / 2).translate(0, 0, -0.01);
    const head = new CylinderGeometry(0.024, 0.017, 0.035, 12).rotateX(-Math.PI / 2).translate(0, 0, -0.09);
    const merged = mergeGeometries([body, head]);
    body.dispose();
    head.dispose();
    return merged;
}
