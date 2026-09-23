import { Vector3 } from 'three';
import {
    ACCELERATION,
    DAMPING,
    DOOR_HEIGHT,
    EYE_HEIGHT,
    FLY_CEILING,
    PLAYER_RADIUS,
    SPRINT_MULTIPLIER,
    WALL_HEIGHT,
} from '../config.js';
import { findFreeSpot, moveAndCollide, overlapsSolid } from './collision.js';

// Below this eye height the player's body overlaps the walls vertically and collides with them.
const WALL_TOP_EYE_HEIGHT = WALL_HEIGHT + EYE_HEIGHT;
// Above this eye height (only reachable when flying), the head would be in a doorway's lintel, so doorways
// are as solid as walls.
const DOOR_EYE_HEIGHT = DOOR_HEIGHT - 0.04;
// Head bob: one dip per step.
const STEP_LENGTH = 0.45;
const BOB_HEIGHT = 0.009;
const BOB_SWAY = 0.005;

/**
 * @typedef {object} MoveInput
 * @property {number} forward -1..1
 * @property {number} right -1..1
 * @property {number} up -1..1 (only used while flying)
 * @property {boolean} sprint
 */

/**
 * First-person movement, simulated in fixed steps so it feels the same at 30 fps and at 240 fps.
 * (The original tied movement to the frame rate and capped the frame rate at 100 to keep it sane.)
 */
export class Player {
    constructor() {
        this.position = new Vector3(0, EYE_HEIGHT, 0);
        /** Position at the previous step, for interpolating between steps when rendering. */
        this.previousPosition = this.position.clone();
        /** Camera-relative velocity: x = strafe, y = vertical, z = forward (per step). */
        this.velocity = new Vector3();
        /** Edit mode: fly freely and pass over walls. */
        this.flying = false;

        this._bobPhase = 0;
        this._bobWeight = 0;
        /** Footsteps taken so far (one per dip of the head bob), and how hard the last one landed (0..1.5). */
        this.steps = 0;
        this.stepWeight = 0;
    }

    /** Teleports the player (e.g. back to spawn for a new world). */
    reset(x = 0, z = 0) {
        this.position.set(x, EYE_HEIGHT, z);
        this.previousPosition.copy(this.position);
        this.velocity.set(0, 0, 0);
        this._bobPhase = 0;
        this._bobWeight = 0;
    }

    /**
     * Advances one fixed simulation step.
     * @param {MoveInput} input
     * @param {number} yaw Camera yaw in radians.
     * @param {number} speed Movement-speed multiplier from settings.
     * @param {import('./collision.js').BoxQuery} boxesNear
     */
    step(input, yaw, speed, boxesNear) {
        const position = this.position;
        const velocity = this.velocity;
        this.previousPosition.copy(position);

        let forward = input.forward;
        let right = input.right;
        const length = Math.hypot(forward, right);
        if (length > 1) {
            // Diagonal movement shouldn't be faster than straight movement.
            forward /= length;
            right /= length;
        }

        const acceleration = ACCELERATION * speed;
        velocity.z += forward * acceleration * (input.sprint && forward > 0 ? SPRINT_MULTIPLIER : 1);
        velocity.x += right * acceleration;
        if (this.flying) velocity.y += input.up * acceleration;
        else if (position.y > EYE_HEIGHT) velocity.y -= acceleration * 1.5; // settle back down after flying
        velocity.multiplyScalar(DAMPING);

        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        const dx = -sin * velocity.z + cos * velocity.x;
        const dz = -cos * velocity.z - sin * velocity.x;

        if (position.y < WALL_TOP_EYE_HEIGHT) moveAndCollide(position, dx, dz, PLAYER_RADIUS, boxesNear, position.y > DOOR_EYE_HEIGHT);
        else position.set(position.x + dx, position.y, position.z + dz);

        this._moveVertically(boxesNear);

        // Head bob follows distance actually travelled on the ground, so it stops when you walk into a wall.
        const travelled = Math.hypot(position.x - this.previousPosition.x, position.z - this.previousPosition.z);
        const grounded = position.y <= EYE_HEIGHT + 1e-4;
        const previousPhase = this._bobPhase;
        this._bobPhase += (travelled * Math.PI) / STEP_LENGTH;
        const targetWeight = grounded ? Math.min(travelled / 0.018, 1.5) : 0; // 0.018 = walking speed per step
        this._bobWeight += (targetWeight - this._bobWeight) * 0.1;
        // A foot lands at the bottom of every dip.
        if (grounded && Math.floor(this._bobPhase / Math.PI) > Math.floor(previousPhase / Math.PI)) {
            this.steps++;
            this.stepWeight = Math.max(this._bobWeight, targetWeight);
        }
    }

    /**
     * Moves the player outside the fixed steps (walking around the room in VR), still stopping at walls.
     * @param {number} dx
     * @param {number} dz
     * @param {import('./collision.js').BoxQuery} boxesNear
     */
    shift(dx, dz, boxesNear) {
        if (dx === 0 && dz === 0) return;
        const position = this.position;
        const { x, z } = position;
        if (position.y < WALL_TOP_EYE_HEIGHT) moveAndCollide(position, dx, dz, PLAYER_RADIUS, boxesNear, position.y > DOOR_EYE_HEIGHT);
        else position.set(x + dx, position.y, z + dz);
        // Carry the previous position along too, so rendering doesn't interpolate back across the move.
        this.previousPosition.x += position.x - x;
        this.previousPosition.z += position.z - z;
    }

    /**
     * Camera offset for head bob, along the camera's up and right axes.
     * @returns {{ up: number, right: number }}
     */
    headBob() {
        const w = this._bobWeight;
        return {
            up: -BOB_HEIGHT * w * (1 - Math.cos(2 * this._bobPhase)) * 0.5,
            right: BOB_SWAY * w * Math.sin(this._bobPhase),
        };
    }

    _moveVertically(boxesNear) {
        const position = this.position;
        const velocity = this.velocity;
        if (velocity.y === 0 && position.y <= EYE_HEIGHT) return;

        let y = position.y + velocity.y;
        let stopped = false;
        if (y <= EYE_HEIGHT) {
            y = EYE_HEIGHT;
            stopped = true;
        } else if (y >= FLY_CEILING) {
            y = FLY_CEILING;
            stopped = true;
        }

        // Flying up from inside a doorway: stop under the lintel.
        const risingIntoLintel = position.y <= DOOR_EYE_HEIGHT && y > DOOR_EYE_HEIGHT;
        if (risingIntoLintel && overlapsSolid(position.x, position.z, PLAYER_RADIUS, boxesNear, true)) {
            y = DOOR_EYE_HEIGHT;
            stopped = true;
        }

        const crossingWallTops = position.y >= WALL_TOP_EYE_HEIGHT && y < WALL_TOP_EYE_HEIGHT;
        if (crossingWallTops && overlapsSolid(position.x, position.z, PLAYER_RADIUS, boxesNear, true)) {
            if (this.flying) {
                // Stand on top of the wall (or the lintel over a doorway).
                y = WALL_TOP_EYE_HEIGHT;
                stopped = true;
            } else {
                // Leaving edit mode above a wall: drop down next to it instead of inside it.
                const spot = findFreeSpot(position.x, position.z, PLAYER_RADIUS, boxesNear, true);
                position.x = spot.x;
                position.z = spot.z;
                this.previousPosition.x = spot.x;
                this.previousPosition.z = spot.z;
            }
        }

        if (stopped) velocity.y = 0;
        position.y = y;
    }
}
