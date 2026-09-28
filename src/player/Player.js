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

// Below this eye height the body overlaps walls vertically and collides with them.
const WALL_TOP_EYE_HEIGHT = WALL_HEIGHT + EYE_HEIGHT;
// Above this eye height (flying only) the head would be in a door lintel, so doorways count as solid.
const DOOR_EYE_HEIGHT = DOOR_HEIGHT - 0.04;
// Head bob, one dip per step.
const STEP_LENGTH = 0.45;
const BOB_HEIGHT = 0.009;
const BOB_SWAY = 0.005;
// Uneven floors (see Terrain): camera follow speed down steps, and max slowdown in deep water.
const STEP_FOLLOW = 0.011;
const WATER_DRAG = 0.45;
// Per step: jump speed, gravity, and terminal fall speed. A jump pressed up to JUMP_BUFFER steps before landing
// still happens on landing.
const JUMP_SPEED = 0.021;
const GRAVITY = 0.0015;
const FALL_SPEED = 0.035;
const JUMP_BUFFER = 8;
// Swimming in water too deep to stand in. FLOAT_EYE is how far your eyes float above the surface. Then buoyancy,
// stroke force up/down, water damping (less while dropping in so you go under for a moment), and stroke length.
const FLOAT_EYE = 0.07;
const BUOYANCY = 0.0009;
const STROKE = 0.0016;
const WATER_HOLD = 0.9;
const PLUNGE_HOLD = 0.97;
const STROKE_LENGTH = 0.6;
// Max height above the water you can pull yourself out onto, and how fast.
const CLIMB_OUT = 0.05;
const CLIMB_SPEED = 0.01;
// Walking into a pool ladder from the water climbs it. Reach from the side, and climb speed.
const LADDER_REACH = PLAYER_RADIUS + 0.1;
const LADDER_SPEED = 0.008;
// Jumps stop with the eye this far under anything overhead (near plane plus a bit), checked this far around.
const HEAD_ROOM = 0.05;
const HEAD_REACH = 0.04;
const HEAD_AROUND = [[HEAD_REACH, 0], [-HEAD_REACH, 0], [0, HEAD_REACH], [0, -HEAD_REACH]];

/**
 * @typedef {object} MoveInput
 * @property {number} forward -1..1
 * @property {number} right -1..1
 * @property {number} up -1..1, for flying up/down or swimming
 * @property {boolean} sprint
 * @property {boolean} [jump] Held.
 */

/**
 * @typedef {object} Terrain Uneven floor (Level 37's pools and stairs, see ChunkStore.groundAt).
 * @property {(x: number, z: number) => number} groundAt Floor height at a point.
 * @property {number | null} water Water surface height, if any.
 * @property {(x: number, z: number, reach: number) => ({ x: number, z: number, nx: number, nz: number } | null)} [ladderAt]
 *     Pool ladder near a point, on its water side (see ChunkStore.ladderAt).
 */

/**
 * @typedef {(x: number, z: number) => number} Headroom Height of the lowest thing overhead at a point (Level 37's
 *     vaults and arches, Level Fun's balloons, see ChunkStore.headroomAt), else the ceiling height.
 */

/**
 * First-person movement in fixed steps so it feels the same at 30 and 240 fps. The original tied movement to the
 * frame rate and capped fps at 100 to keep it sane.
 */
export class Player {
    constructor() {
        this.position = new Vector3(0, EYE_HEIGHT, 0);
        /** Position at the previous step, for render interpolation. */
        this.previousPosition = this.position.clone();
        /** Camera-relative velocity per step: x = strafe, y = vertical, z = forward. */
        this.velocity = new Vector3();
        /** Edit mode: fly freely and pass over walls. */
        this.flying = false;

        this._bobPhase = 0;
        this._bobWeight = 0;
        /** Footstep count (one per head bob dip) and strength of the last one (0..1.5). */
        this.steps = 0;
        this.stepWeight = 0;
        /** Floor height under you (see Terrain) and water depth there. */
        this.floor = 0;
        this.depth = 0;
        /** Landing count (from a jump or into water) and strength of the last one (0..1.5). */
        this.landings = 0;
        this.landingWeight = 0;
        /** In water too deep to stand in, floating or under. */
        this.swimming = false;
        /** Climbing a pool ladder. */
        this.climbing = false;
        /** Surface stroke count and strength of the last one (0..1.5). */
        this.strokes = 0;
        this.strokeWeight = 0;

        this._jumping = false;
        this._jumpHeld = false;
        this._jumpBuffer = 0;
        this._strokePhase = 0;
    }

    /** Teleports the player, e.g. back to spawn for a new world. */
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
     * @param {Terrain | null} [terrain] Uneven floor, if any.
     * @param {Headroom | null} [headroom] Overhead limit for jumps.
     */
    step(input, yaw, speed, boxesNear, terrain = null, headroom = null) {
        const position = this.position;
        const velocity = this.velocity;
        this.previousPosition.copy(position);
        const standing = this.floor + EYE_HEIGHT;
        // Deeper water is slower. Too deep to stand and you float.
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
            // Climb until you can step off onto the side.
            velocity.y = LADDER_SPEED;
            this._jumping = false;
        } else if (this.swimming && position.y <= water + FLOAT_EYE) {
            // Float back up to the surface and bob, or swim up/down.
            const below = water + FLOAT_EYE - position.y;
            const lift = Math.min(below * 0.02, BUOYANCY);
            velocity.y += input.up < 0 ? input.up * STROKE : lift + input.up * (below > 0 ? STROKE : 0);
            velocity.y *= WATER_HOLD;
            this._jumping = false;
        } else if (this._jumpBuffer > 0 && !this.swimming && !this._jumping && position.y - standing < 0.03) {
            // Jump, weaker in deep water.
            velocity.y = JUMP_SPEED * drag;
            this._jumping = true;
            this._jumpBuffer = 0;
        } else if (position.y > standing) {
            // Falling (or coming down after flying), slower in water.
            velocity.y = Math.max(velocity.y - GRAVITY, -FALL_SPEED);
            if (inWater) velocity.y *= this.swimming ? PLUNGE_HOLD : WATER_HOLD;
        }
        if (this._jumpBuffer > 0) this._jumpBuffer--;

        const dx = -sin * velocity.z + cos * velocity.x;
        const dz = -cos * velocity.z - sin * velocity.x;

        this._moveAcross(dx, dz, boxesNear);
        if (terrain && !this.flying) this._keepToFloor(terrain);

        this._moveVertically(boxesNear, terrain, headroom);

        // Dropping into deep water counts as a landing (splash).
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
        // Footstep at the bottom of each dip.
        if (grounded && Math.floor(this._bobPhase / Math.PI) > Math.floor(previousPhase / Math.PI)) {
            this.steps++;
            this.stepWeight = Math.max(this._bobWeight, targetWeight);
        }
        // Stroke every STROKE_LENGTH swum at the surface.
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
     * Moves the player outside the fixed steps (VR room-scale walking), still colliding with walls.
     * @param {number} dx
     * @param {number} dz
     * @param {import('./collision.js').BoxQuery} boxesNear
     */
    shift(dx, dz, boxesNear) {
        if (dx === 0 && dz === 0) return;
        const position = this.position;
        const { x, z } = position;
        this._moveAcross(dx, dz, boxesNear);
        // Shift the previous position too so rendering doesn't interpolate across the move.
        this.previousPosition.x += position.x - x;
        this.previousPosition.z += position.z - z;
    }

    /** Horizontal move. Collides with walls below their tops, passes over them above. */
    _moveAcross(dx, dz, boxesNear) {
        const position = this.position;
        if (position.y < WALL_TOP_EYE_HEIGHT) moveAndCollide(position, dx, dz, PLAYER_RADIUS, boxesNear, position.y > DOOR_EYE_HEIGHT);
        else position.set(position.x + dx, position.y, position.z + dz);
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
     * True if you're walking into a pool ladder (wx, wz is the world move direction) with your feet still below
     * the top of the side.
     * @param {Terrain | null} terrain
     */
    _atLadder(terrain, wx, wz) {
        const position = this.position;
        const ladder = terrain?.ladderAt?.(position.x, position.z, LADDER_REACH);
        if (!ladder || -(wx * ladder.nx + wz * ladder.nz) < 0.5) return false;
        return position.y - EYE_HEIGHT < terrain.groundAt(ladder.x - ladder.nx * 0.3, ladder.z - ladder.nz * 0.3);
    }

    /** Highest floor point under the player's footprint, so standing on an edge holds you up. */
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
     * Blocks walking up anything higher than a step (use the stairs). The move is undone one axis at a time so you
     * slide along the edge. In the air the limit is a step above your feet. Floating at the surface you can pull
     * yourself out onto the side.
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

    _moveVertically(boxesNear, terrain = null, headroom = null) {
        const position = this.position;
        const velocity = this.velocity;
        // Uneven floor: update the height under you.
        if (terrain) this.floor = this._floorUnder(position.x, position.z, terrain);
        const standing = this.floor + EYE_HEIGHT;
        if (velocity.y === 0 && (terrain ? position.y === standing : position.y <= standing)) return;

        let y = position.y + velocity.y;
        let stopped = false;
        const rising = terrain !== null && !this.flying && position.y < standing - 1e-6;
        if (rising) {
            // Ease up a stair or onto a walkway. Climbing out of the water is slower.
            const below = standing - position.y;
            y = Math.min(standing, position.y + (below > 0.2 ? CLIMB_SPEED : Math.max(0.006, below * 0.3)));
            stopped = true;
            this._jumping = false;
        } else if (terrain && !this.flying && !this.swimming && !this._jumping && !this.climbing && y > standing && y - standing < 0.12 && velocity.y > -0.004) {
            // Step down stairs smoothly instead of falling.
            y = Math.max(standing, y - STEP_FOLLOW);
            stopped = true;
        }
        if (rising) {
            // Handled above.
        } else if (y <= standing) {
            // Landed from a jump or fall, including into shallow water. Swimming down to the bottom isn't a landing.
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

        // A jump stops at anything overhead (a low vault near a column, balloons) and you come back down.
        if (headroom && this._jumping && !this.flying && y > position.y) {
            let top = headroom(position.x, position.z);
            for (const [ox, oz] of HEAD_AROUND) top = Math.min(top, headroom(position.x + ox, position.z + oz));
            top -= HEAD_ROOM;
            if (y > top) {
                y = Math.max(position.y, top);
                stopped = true;
            }
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
                // Stand on top of the wall or door lintel.
                y = WALL_TOP_EYE_HEIGHT;
                stopped = true;
            } else {
                // Left edit mode above a wall. Drop next to it, not inside it.
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
