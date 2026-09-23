import { Box3, Frustum, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { VIEW_DISTANCE } from '../config.js';

/*
 * Where the thing on the tape mustn't be seen arriving, moving or going.
 *
 * It only ever does any of those out of the picture, so nobody ever sees it pop in, jump or vanish. "Out
 * of the picture" is the camera's real view (so looking up or down counts), and wider than what's on
 * screen, because the picture never holds still:
 *
 * - a margin all round, for the figure's arms and the head bob;
 * - the widest the lens goes (not zoomed in), so zooming out can't show something that just arrived;
 * - where the camera is about to point: it's turning at some rate, so the picture a moment from now is
 *   checked too, along the turn;
 * - in VR with snap turning, the picture one snap either way, since a flick of the stick turns it at once;
 * - and while the camera is being whipped round, nowhere counts as out of the picture at all: it waits
 *   until you've stopped.
 *
 * All three.js maths and no rendering, so it can be run through in tests.
 */

// Extra field of view on every side (radians).
const MARGIN = MathUtils.degToRad(8);
// How far ahead of a turn to look (seconds).
const LOOKAHEAD = [0.1, 0.2, 0.3, 0.4];
// Turning faster than this (radians per second), nowhere is safe.
const WHIP = 5;
// How quickly a turn's speed is forgotten once it stops (per second), so a pause mid-sweep isn't taken
// for the end of it.
const SPIN_DECAY = 4;
// The figure, as a box around where it stands: a little wider than its arms, and as tall as it is.
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
        /** @type {Frustum[]} The pictures that count (the first `_count`): now, a moment along the turn, a snap either way. */
        this._frustums = [];
        this._count = 0;
        this._box = new Box3();
        this._position = new Vector3();
        this._quaternion = new Quaternion();
        this._lastPosition = new Vector3();
        this._lastQuaternion = new Quaternion();
        this._velocity = new Vector3();
        this._axis = new Vector3(0, 1, 0);
        /** How fast the camera is turning (radians per second), held for a moment after a turn stops. */
        this.spin = 0;
        this._primed = false;
    }

    /** Forgets the camera's motion (a new run, or after a jump in where it is). */
    reset() {
        this._primed = false;
        this.spin = 0;
        this._velocity.set(0, 0, 0);
        this._count = 0;
    }

    /** Where the eye is (as of the last update). */
    get position() {
        return this._position;
    }

    /** How fast the eye is moving (world units per second). */
    get velocity() {
        return this._velocity;
    }

    /** Whether the camera is turning too fast for anywhere to count as out of the picture. */
    get whipping() {
        return this.spin > WHIP;
    }

    /**
     * Follows the camera, once a frame, after it has been moved and before anything asks where it can see.
     * @param {number} dt
     * @param {Vector3} position Where the eye is.
     * @param {Quaternion} quaternion Which way it's looking (world).
     * @param {number} fov The widest vertical field of view the picture can have, in degrees.
     * @param {number} aspect Width over height.
     * @param {number} [snap] A turn about the vertical (radians) that could happen at any moment.
     */
    update(dt, position, quaternion, fov, aspect, snap = 0) {
        this._position.copy(position);
        this._quaternion.copy(quaternion);
        if (!this._primed) {
            this._primed = true;
        } else if (dt > 0) {
            // The rotation since last frame, as an angle about an axis.
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

        // The lens, widened on every side.
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
     * Whether any of the figure, standing at (x, z), is or could in a moment be in the picture, whatever is
     * in the way. Before the first update, everywhere is.
     */
    covers(x, z) {
        if (this._count === 0 || this.whipping) return true;
        this._box.min.set(x - FIGURE_RADIUS, 0, z - FIGURE_RADIUS);
        this._box.max.set(x + FIGURE_RADIUS, FIGURE_HEIGHT, z + FIGURE_RADIUS);
        for (let i = 0; i < this._count; i++) if (this._frustums[i].intersectsBox(this._box)) return true;
        return false;
    }
}
