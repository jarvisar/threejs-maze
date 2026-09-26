import { InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { WALL_HEIGHT } from '../config.js';
import { PARTY_PALETTE } from '../world/party.js';

/*
 * Confetti in the air, for Level Fun: thrown up and out in a burst (a guest going pop), or let go from the
 * ceiling to rain down (the party starting). Each piece tumbles as it falls, drifts from side to side the way
 * paper does, and lands flat; a while later it's gone. (The carpet has plenty of its own; see materials.js.)
 */

const MAX = 1200;
// Paper this light falls at no more than GRAVITY / DRAG (about 30 cm a second), and drifts FLUTTER to the side.
const GRAVITY = 1.3;
const DRAG = 4.5;
const FLUTTER = 0.09;
// Seconds a piece lies on the floor, then how long it takes to go.
const LYING = 10;
const GOING = 1.5;

const _matrix = new Matrix4();
const _position = new Vector3();
const _axis = new Vector3();
const _quaternion = new Quaternion();
const _flat = new Quaternion();
const _turn = new Quaternion();
const _scale = new Vector3();
const _hidden = new Matrix4().makeScale(0, 0, 0);
const _up = new Vector3(0, 1, 0);
const _flatten = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

export class Confetti {
    /**
     * @param {import('three').Scene} scene
     * @param {import('three').Material} material
     */
    constructor(scene, material) {
        this.mesh = new InstancedMesh(new PlaneGeometry(0.013, 0.0075), material, MAX);
        this.mesh.name = 'confetti';
        this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        scene.add(this.mesh);

        this.position = new Float32Array(MAX * 3);
        this.velocity = new Float32Array(MAX * 3);
        this.axis = new Float32Array(MAX * 3);
        this.angle = new Float32Array(MAX);
        this.spin = new Float32Array(MAX);
        this.phase = new Float32Array(MAX);
        this.age = new Float32Array(MAX);
        /** Seconds on the floor, or −1 while it's in the air. */
        this.lying = new Float32Array(MAX);
        /** Seconds before it appears (a shower lets pieces go over a while). */
        this.delay = new Float32Array(MAX);
        this.alive = new Uint8Array(MAX);
        this._next = 0;
        /** One past the highest slot in use. */
        this._used = 0;
        this._live = 0;
    }

    /**
     * Throws `count` pieces from (x, y, z), up and out.
     * @param {number} speed Units per second.
     */
    burst(x, y, z, count, speed = 1.3) {
        for (let k = 0; k < count; k++) {
            const a = Math.random() * Math.PI * 2;
            const up = 0.35 + Math.random() * 0.65;
            const out = Math.sqrt(1 - up * up);
            const s = speed * (0.45 + Math.random() * 0.55);
            this._spawn(x, y, z, Math.cos(a) * out * s, up * s, Math.sin(a) * out * s, Math.random() * 0.05);
        }
    }

    /** Lets `count` pieces go from just under the ceiling over a circle round (x, z), over `seconds`. */
    shower(x, z, radius, count, seconds) {
        for (let k = 0; k < count; k++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * radius;
            const drift = () => (Math.random() - 0.5) * 0.2;
            this._spawn(x + Math.cos(a) * r, WALL_HEIGHT - 0.02 - Math.random() * 0.06, z + Math.sin(a) * r, drift(), -Math.random() * 0.1, drift(), Math.random() * seconds);
        }
    }

    /** Gone, all of it (a new world). */
    clear() {
        this.alive.fill(0);
        this._used = 0;
        this._live = 0;
        this.mesh.count = 0;
    }

    _spawn(x, y, z, vx, vy, vz, delay) {
        const i = this._next;
        this._next = (this._next + 1) % MAX;
        if (!this.alive[i]) this._live++;
        this.alive[i] = 1;
        this._used = Math.max(this._used, i + 1);
        this.position.set([x, y, z], i * 3);
        this.velocity.set([vx, vy, vz], i * 3);
        _axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        this.axis.set([_axis.x, _axis.y, _axis.z], i * 3);
        this.angle[i] = Math.random() * Math.PI * 2;
        this.spin[i] = (4 + Math.random() * 9) * (Math.random() < 0.5 ? -1 : 1);
        this.phase[i] = Math.random() * Math.PI * 2;
        this.age[i] = 0;
        this.lying[i] = -1;
        this.delay[i] = delay;
        const hex = PARTY_PALETTE[Math.floor(Math.random() * PARTY_PALETTE.length)];
        this.mesh.instanceColor.setXYZ(i, ((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
        this.mesh.instanceColor.needsUpdate = true;
    }

    /** @param {number} dt */
    update(dt) {
        if (this._live === 0) return;
        const p = this.position;
        const v = this.velocity;
        const drag = Math.exp(-DRAG * dt);
        for (let i = 0; i < this._used; i++) {
            if (!this.alive[i]) {
                this.mesh.setMatrixAt(i, _hidden);
                continue;
            }
            if (this.delay[i] > 0) {
                this.delay[i] -= dt;
                if (this.delay[i] > 0) {
                    this.mesh.setMatrixAt(i, _hidden);
                    continue;
                }
            }
            const j = i * 3;
            this.age[i] += dt;
            let scale = 1;
            if (this.lying[i] < 0) {
                v[j + 1] -= GRAVITY * dt;
                v[j] *= drag;
                v[j + 1] *= drag;
                v[j + 2] *= drag;
                const sway = Math.sin(this.age[i] * 4.3 + this.phase[i]) * FLUTTER;
                p[j] += (v[j] + Math.cos(this.phase[i]) * sway) * dt;
                p[j + 1] += v[j + 1] * dt;
                p[j + 2] += (v[j + 2] + Math.sin(this.phase[i]) * sway) * dt;
                this.angle[i] += this.spin[i] * dt;
                if (p[j + 1] <= 0.002) {
                    // Landed: flat on the carpet, a hair apart from the next so they don't flicker.
                    p[j + 1] = 0.0015 + (i % 7) * 0.0002;
                    this.lying[i] = 0;
                }
                _axis.set(this.axis[j], this.axis[j + 1], this.axis[j + 2]);
                _quaternion.setFromAxisAngle(_axis, this.angle[i]);
            } else {
                this.lying[i] += dt;
                if (this.lying[i] > LYING + GOING) {
                    this.alive[i] = 0;
                    this._live--;
                    this.mesh.setMatrixAt(i, _hidden);
                    continue;
                }
                scale = this.lying[i] > LYING ? 1 - (this.lying[i] - LYING) / GOING : 1;
                _turn.setFromAxisAngle(_up, this.phase[i] * 3);
                _quaternion.multiplyQuaternions(_turn, _flat.copy(_flatten));
            }
            _matrix.compose(_position.set(p[j], p[j + 1], p[j + 2]), _quaternion, _scale.setScalar(scale));
            this.mesh.setMatrixAt(i, _matrix);
        }
        this.mesh.count = this._live > 0 ? this._used : 0;
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this._live === 0) this._used = 0;
    }
}
