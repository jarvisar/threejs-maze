import { Vector3 } from 'three';
import {
    ACCELERATION,
    DAMPING,
    DOOR_HEIGHT,
    EYE_HEIGHT,
    FLY_CEILING,
    PLAYER_RADIUS,
    SPRINT_MULTIPLIER,
    STEP_HEIGHT,
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
// Where the floor isn't flat (see Terrain): how fast the camera follows the floor down steps, and how much water slows
// you down, at its deepest.
const STEP_FOLLOW = 0.011;
const WATER_DRAG = 0.45;
// Jumping and falling (per step): how hard you push off, how much faster you fall each step, and the fastest you fall.
// A jump pressed up to JUMP_BUFFER steps before you land still happens when you do.
const JUMP_SPEED = 0.021;
const GRAVITY = 0.0015;
const FALL_SPEED = 0.035;
const JUMP_BUFFER = 8;
// In water too deep to stand in with your head out, you float with your eyes this far out of it. How hard it lifts
// you back up there, how hard a stroke pushes you up or down, how much it holds you back (less while you drop in,
// so you go under for a moment), and how far a stroke goes.
const FLOAT_EYE = 0.07;
const BUOYANCY = 0.0009;
const STROKE = 0.0016;
const WATER_HOLD = 0.9;
const PLUNGE_HOLD = 0.97;
const STROKE_LENGTH = 0.6;
// Floating at the surface, you can pull yourself out onto a side up to this far above the water, this fast.
const CLIMB_OUT = 0.05;
const CLIMB_SPEED = 0.01;
// Walking into a pool's ladder from the water climbs it, from this close to the side, this fast.
const LADDER_REACH = PLAYER_RADIUS + 0.1;
const LADDER_SPEED = 0.008;

/**
 * @typedef {object} MoveInput
 * @property {number} forward -1..1
 * @property {number} right -1..1
 * @property {number} up -1..1: flying up or down, or swimming
 * @property {boolean} sprint
 * @property {boolean} [jump] Held.
 */

/**
 * @typedef {object} Terrain A floor that isn't flat (Level 37's pools and stairs; see ChunkStore.groundAt).
 * @property {(x: number, z: number) => number} groundAt The height of the floor at a point.
 * @property {number | null} water The height of the water over it, if there's water to wade through.
 * @property {(x: number, z: number, reach: number) => ({ x: number, z: number, nx: number, nz: number } | null)} [ladderAt]
 *     A ladder out of the water near a point, on the water's side of it (see ChunkStore.ladderAt).
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
        /** The floor you're standing over (see Terrain), and how deep the water is on it. */
        this.floor = 0;
        this.depth = 0;
        /** Falls you've landed from so far (from a jump, or into the water), and how hard the last one was (0..1.5). */
        this.landings = 0;
        this.landingWeight = 0;
        /** In water too deep to stand in: floating, or under it. */
        this.swimming = false;
        /** Going up a ladder out of a pool. */
        this.climbing = false;
        /** Strokes swum at the surface so far, and how hard the last one was (0..1.5). */
        this.strokes = 0;
        this.strokeWeight = 0;

        this._jumping = false;
        this._jumpHeld = false;
        this._jumpBuffer = 0;
        this._strokePhase = 0;
    }

    /** Teleports the player (e.g. back to spawn for a new world). */
    reset(x = 0, z = 0) {
        this.position.set(x, EYE_HEIGHT, z);
        this.previousPosition.copy(this.position);
        this.velocity.set(0, 0, 0);
        this._bobPhase = 0;
        this._bobWeight = 0;
        this.floor = 0;
        this.depth = 0;
        this.swimming = false;
        this.climbing = false;
        this._jumping = false;
        this._jumpBuffer = 0;
    }

    /**
     * Advances one fixed simulation step.
     * @param {MoveInput} input
     * @param {number} yaw Camera yaw in radians.
     * @param {number} speed Movement-speed multiplier from settings.
     * @param {import('./collision.js').BoxQuery} boxesNear
     * @param {Terrain | null} [terrain] The floor, where it isn't flat.
     */
    step(input, yaw, speed, boxesNear, terrain = null) {
        const position = this.position;
        const velocity = this.velocity;
        this.previousPosition.copy(position);
        const standing = this.floor + EYE_HEIGHT;
        // In water you're slower the deeper it is, and where it's too deep to stand in, you float.
        const water = terrain ? terrain.water : null;
        this.depth = water !== null ? Math.max(0, water - this.floor) : 0;
        const inWater = water !== null && position.y - EYE_HEIGHT < water;
        this.swimming = inWater && !this.flying && this.depth > EYE_HEIGHT - FLOAT_EYE;
        const drag = this.flying ? 1 : 1 - WATER_DRAG * Math.min(this.depth / 0.6, 1);

        let forward = input.forward;
        let right = input.right;
        const length = Math.hypot(forward, right);
        if (length > 1) {
            // Diagonal movement shouldn't be faster than straight movement.
            forward /= length;
            right /= length;
        }

        const acceleration = ACCELERATION * speed;
        velocity.z += forward * acceleration * drag * (input.sprint && forward > 0 ? SPRINT_MULTIPLIER : 1);
        velocity.x += right * acceleration * drag;
        velocity.x *= DAMPING;
        velocity.z *= DAMPING;
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        this.climbing = !this.flying && inWater && this._atLadder(terrain, -sin * forward + cos * right, -cos * forward - sin * right);

        const jump = input.jump === true;
        if (jump && !this._jumpHeld) this._jumpBuffer = JUMP_BUFFER;
        this._jumpHeld = jump;
        if (this.flying) {
            velocity.y = (velocity.y + input.up * acceleration) * DAMPING;
            this._jumping = false;
            this._jumpBuffer = 0;
        } else if (this.climbing) {
            // Up the ladder, until you can step off it onto the side.
            velocity.y = LADDER_SPEED;
            this._jumping = false;
        } else if (this.swimming && position.y <= water + FLOAT_EYE) {
            // Float back up to the surface (and bob there), or swim up or down.
            const below = water + FLOAT_EYE - position.y;
            const lift = Math.min(below * 0.02, BUOYANCY);
            velocity.y += input.up < 0 ? input.up * STROKE : lift + input.up * (below > 0 ? STROKE : 0);
            velocity.y *= WATER_HOLD;
            this._jumping = false;
        } else if (this._jumpBuffer > 0 && !this.swimming && !this._jumping && position.y - standing < 0.03) {
            // Pushing off the floor (not as hard in deep water).
            velocity.y = JUMP_SPEED * drag;
            this._jumping = true;
            this._jumpBuffer = 0;
        } else if (position.y > standing) {
            // Falling (or coming back down after flying), slower through water.
            velocity.y = Math.max(velocity.y - GRAVITY, -FALL_SPEED);
            if (inWater) velocity.y *= this.swimming ? PLUNGE_HOLD : WATER_HOLD;
        }
        if (this._jumpBuffer > 0) this._jumpBuffer--;

        const dx = -sin * velocity.z + cos * velocity.x;
        const dz = -cos * velocity.z - sin * velocity.x;

        if (position.y < WALL_TOP_EYE_HEIGHT) moveAndCollide(position, dx, dz, PLAYER_RADIUS, boxesNear, position.y > DOOR_EYE_HEIGHT);
        else position.set(position.x + dx, position.y, position.z + dz);
        if (terrain && !this.flying) this._keepToFloor(terrain);

        this._moveVertically(boxesNear, terrain);

        // Into deep water from above, with a splash.
        const deep = water !== null && water - this.floor > EYE_HEIGHT - FLOAT_EYE;
        if (deep && !inWater && !this.flying && position.y - EYE_HEIGHT < water && velocity.y < -0.004) {
            this.landings++;
            this.landingWeight = Math.min(-velocity.y / 0.012, 1.5);
        }

        // Head bob follows distance actually travelled on the ground, so it stops when you walk into a wall.
        const travelled = Math.hypot(position.x - this.previousPosition.x, position.z - this.previousPosition.z);
        const grounded = !this.swimming && position.y <= this.floor + EYE_HEIGHT + (terrain ? 0.02 : 1e-4);
        const previousPhase = this._bobPhase;
        this._bobPhase += (travelled * Math.PI) / STEP_LENGTH;
        const targetWeight = grounded ? Math.min(travelled / 0.018, 1.5) : 0; // 0.018 = walking speed per step
        this._bobWeight += (targetWeight - this._bobWeight) * 0.1;
        // A foot lands at the bottom of every dip.
        if (grounded && Math.floor(this._bobPhase / Math.PI) > Math.floor(previousPhase / Math.PI)) {
            this.steps++;
            this.stepWeight = Math.max(this._bobWeight, targetWeight);
        }
        // Swimming at the surface, a stroke every so far.
        if (this.swimming && position.y > water) {
            this._strokePhase += travelled;
            if (this._strokePhase >= STROKE_LENGTH) {
                this._strokePhase -= STROKE_LENGTH;
                this.strokes++;
                this.strokeWeight = Math.min(travelled / 0.01, 1.5); // 0.01 = swimming speed per step
            }
        } else {
            this._strokePhase = 0;
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

    /**
     * Whether you're at a ladder out of the water, walking into it (the way (wx, wz), in the world), with your feet
     * still below the side it goes up to.
     * @param {Terrain | null} terrain
     */
    _atLadder(terrain, wx, wz) {
        const position = this.position;
        const ladder = terrain?.ladderAt?.(position.x, position.z, LADDER_REACH);
        if (!ladder || -(wx * ladder.nx + wz * ladder.nz) < 0.5) return false;
        return position.y - EYE_HEIGHT < terrain.groundAt(ladder.x - ladder.nx * 0.3, ladder.z - ladder.nz * 0.3);
    }

    /** The height of the floor under the player: the highest of it under their feet (so an edge holds you up). */
    _floorUnder(x, z, terrain) {
        const r = PLAYER_RADIUS * 0.7;
        return Math.max(
            terrain.groundAt(x, z),
            terrain.groundAt(x - r, z - r),
            terrain.groundAt(x + r, z - r),
            terrain.groundAt(x - r, z + r),
            terrain.groundAt(x + r, z + r),
        );
    }

    /**
     * Where the floor isn't flat: you can't walk up onto anything higher than a step (you need the stairs), so a move
     * that would is undone, one way at a time so you slide along the edge. In the air it's a step up from your feet,
     * and floating at the surface you can pull yourself out onto the side.
     */
    _keepToFloor(terrain) {
        const position = this.position;
        const { x: px, z: pz } = this.previousPosition;
        let limit = Math.max(this.floor, position.y - EYE_HEIGHT) + STEP_HEIGHT;
        if (this.swimming && position.y > terrain.water + FLOAT_EYE - 0.1) limit = Math.max(limit, terrain.water + CLIMB_OUT);
        if (this._floorUnder(position.x, position.z, terrain) <= limit) return;
        const { x, z } = position;
        if (this._floorUnder(x, pz, terrain) <= limit) position.z = pz;
        else if (this._floorUnder(px, z, terrain) <= limit) position.x = px;
        else position.set(px, position.y, pz);
    }

    _moveVertically(boxesNear, terrain = null) {
        const position = this.position;
        const velocity = this.velocity;
        // Where the floor isn't flat: what's under you now.
        if (terrain) this.floor = this._floorUnder(position.x, position.z, terrain);
        const standing = this.floor + EYE_HEIGHT;
        if (velocity.y === 0 && (terrain ? position.y === standing : position.y <= standing)) return;

        let y = position.y + velocity.y;
        let stopped = false;
        const rising = terrain !== null && !this.flying && position.y < standing - 1e-6;
        if (rising) {
            // Up a stair, or onto a walkway, without a jolt; out of the water onto the side, slowly.
            const below = standing - position.y;
            y = Math.min(standing, position.y + (below > 0.2 ? CLIMB_SPEED : Math.max(0.006, below * 0.3)));
            stopped = true;
            this._jumping = false;
        } else if (terrain && !this.flying && !this.swimming && !this._jumping && !this.climbing && y > standing && y - standing < 0.12 && velocity.y > -0.004) {
            // Down a stair, a step at a time (not a fall).
            y = Math.max(standing, y - STEP_FOLLOW);
            stopped = true;
        }
        if (rising) {
            // (Done: see above.)
        } else if (y <= standing) {
            // Landed from a jump or a fall (into water you can stand in; swimming down to the bottom isn't landing).
            if (velocity.y < -0.004 && !this.swimming) {
                this.landings++;
                this.landingWeight = Math.min(-velocity.y / 0.012, 1.5);
            }
            y = standing;
            stopped = true;
            this._jumping = false;
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
