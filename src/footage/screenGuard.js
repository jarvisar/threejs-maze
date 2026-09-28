import { Box3, Frustum, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { VIEW_DISTANCE } from '../config.js';

/*
 * Decides where the Watcher can change without being seen. It should never be seen appearing, jumping or vanishing.
 *
 * The checked view is the full camera frustum (up and down count) and wider than the screen because the view keeps
 * moving. It adds a margin for the figure's arms and head bob, uses the widest FOV so zooming out can't reveal a new
 * spot, checks a moment ahead along the current turn, and one VR snap turn each way. While the camera whips around,
 * everywhere counts as in view.
 *
 * Pure three.js math, no rendering, so tests can run it directly.
 */

// Extra FOV on every side (radians).
const MARGIN = MathUtils.degToRad(8);
// How far ahead of a turn to look (s).
const LOOKAHEAD = [0.1, 0.2, 0.3, 0.4];
// Above this turn rate (rad/s) nowhere is safe.
const WHIP = 5;
// Decay rate (per s) of the turn speed after it stops, so a pause mid-sweep isn't treated as the end.
const SPIN_DECAY = 4;
// Figure bounding box: a bit wider than its arms, full height.
const FIGURE_RADIUS = 0.2;
const FIGURE_HEIGHT = 0.95;

const _delta = new Quaternion();
const _inverse = new Quaternion();
const _turn = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _matrix = new Matrix4();

export class ScreenGuard {
    constructor() {
        this._proxy = new PerspectiveCamera(70, 1, 0.01, VIEW_DISTANCE + 0.5);
        /** @type {Frustum[]} First `_count` are live: now, ahead along the turn, snap each way. */
        this._frustums = [];
        this._count = 0;
        this._box = new Box3();
        this._position = new Vector3();
        this._quaternion = new Quaternion();
        this._lastPosition = new Vector3();
        this._lastQuaternion = new Quaternion();
        this._velocity = new Vector3();
        this._axis = new Vector3(0, 1, 0);
        /** Camera turn rate (rad/s), held briefly after a turn stops. */
        this.spin = 0;
        this._primed = false;
    }

    /** Clears the camera motion (new run, or after a teleport). */
    reset() {
        this._primed = false;
        this.spin = 0;
        this._velocity.set(0, 0, 0);
        this._count = 0;
    }

    /** Eye position as of the last update. */
    get position() {
        return this._position;
    }

    /** Eye velocity (units/s). */
    get velocity() {
        return this._velocity;
    }

    /** True if the camera is turning too fast for anywhere to be safe. */
    get whipping() {
        return this.spin > WHIP;
    }

    /**
     * Call once a frame, after the camera moves and before anything checks visibility.
     * @param {number} dt
     * @param {Vector3} position Eye position.
     * @param {Quaternion} quaternion World rotation.
     * @param {number} fov Widest vertical FOV the view can have (degrees).
     * @param {number} aspect Width over height.
     * @param {number} [snap] Snap turn about the vertical (radians) that could happen at any moment.
     */
    update(dt, position, quaternion, fov, aspect, snap = 0) {
        this._position.copy(position);
        this._quaternion.copy(quaternion);
        if (!this._primed) {
            this._primed = true;
        } else if (dt > 0) {
            // Rotation since last frame as axis and angle.
            _delta.multiplyQuaternions(this._quaternion, _inverse.copy(this._lastQuaternion).invert());
            if (_delta.w < 0) _delta.set(-_delta.x, -_delta.y, -_delta.z, -_delta.w);
            const angle = 2 * Math.acos(Math.min(1, _delta.w));
            const s = Math.sqrt(Math.max(0, 1 - _delta.w * _delta.w));
            if (angle > 1e-5 && s > 1e-6) this._axis.set(_delta.x / s, _delta.y / s, _delta.z / s);
            this.spin = Math.max(angle / dt, this.spin * Math.exp(-SPIN_DECAY * dt));
            this._velocity.subVectors(this._position, this._lastPosition).divideScalar(dt);
        }
        this._lastPosition.copy(this._position);
        this._lastQuaternion.copy(this._quaternion);

        // Widen the lens on every side.
        const vertical = MathUtils.degToRad(fov) / 2;
        const horizontal = Math.atan(Math.tan(vertical) * aspect);
        const v = Math.min(vertical + MARGIN, 1.5);
        const h = Math.min(horizontal + MARGIN, 1.5);
        this._proxy.fov = MathUtils.radToDeg(2 * v);
        this._proxy.aspect = Math.tan(h) / Math.tan(v);
        this._proxy.updateProjectionMatrix();

        let count = 0;
        const add = (turn, ahead) => {
            this._proxy.position.copy(this._position).addScaledVector(this._velocity, ahead);
            this._proxy.quaternion.multiplyQuaternions(turn, this._quaternion);
            this._proxy.updateMatrixWorld();
            const frustum = this._frustums[count] ?? (this._frustums[count] = new Frustum());
            frustum.setFromProjectionMatrix(_matrix.multiplyMatrices(this._proxy.projectionMatrix, this._proxy.matrixWorldInverse));
            count++;
        };
        add(_turn.identity(), 0);
        if (this.spin > 0.05) {
            for (const ahead of LOOKAHEAD) add(_turn.setFromAxisAngle(this._axis, this.spin * ahead), ahead);
        }
        if (snap > 0) {
            add(_turn.setFromAxisAngle(_up, snap), 0);
            add(_turn.setFromAxisAngle(_up, -snap), 0);
        }
        this._count = count;
    }

    /**
     * True if the figure at (x, z) is in view now or could be in a moment. Ignores walls. Before the first update
     * everywhere counts.
     */
    covers(x, z) {
        if (this._count === 0 || this.whipping) return true;
        this._box.min.set(x - FIGURE_RADIUS, 0, z - FIGURE_RADIUS);
        this._box.max.set(x + FIGURE_RADIUS, FIGURE_HEIGHT, z + FIGURE_RADIUS);
        for (let i = 0; i < this._count; i++) if (this._frustums[i].intersectsBox(this._box)) return true;
        return false;
    }
}
