import { AdditiveBlending, Mesh, Sprite, SpriteMaterial, Vector3 } from 'three';
import { CHUNK_SIZE, WALL_HEIGHT } from '../config.js';
import { DISCO_MAX, worldLighting } from './materials.js';
import { PROP_CAKE, PROP_GUEST } from './decorations.js';
import { GUEST_POP, PARTY_CAKE, partyPropThing } from './party.js';
import { GUEST_FACE, createDiscoGeometry, createFaceGeometry, createGuestGeometry } from './partyGeometry.js';
import { createGlowTexture } from './partyTextures.js';

/*
 * Moving parts of Level Fun (see party.js). Mirror balls spin and the nearest few get passed to the shaders for their
 * light (see materials.js). Guests turn to face you and pop when you get close. Edit-mode guests work on any level
 * and come back after a while. Cake candles flicker.
 *
 * Added to each chunk's group as it's built (see WorldView) and removed when it goes.
 */

const DISCO_SPEED = 0.42; // mirror ball spin (rad/s)
const GUEST_TURN = 1.5; // max guest turn speed (rad/s)
// Popped edit-mode guests come back after RETURN_AFTER (s), once you're RETURN_DISTANCE away and not looking.
// OUT_OF_SIGHT is the cosine of the angle off your view direction past which a guest counts as hidden.
const RETURN_AFTER = 6;
const RETURN_DISTANCE = 1.5;
const OUT_OF_SIGHT = 0.4;
// Size and height of the glow over a cake's candles.
const GLOW_SIZE = 0.2;
const GLOW_HEIGHT = 0.37;

/**
 * @typedef {object} Attached Everything added to one chunk.
 * @property {import('three').Group} group
 * @property {{ disco: import('./party.js').Disco, mesh: Mesh }[]} discos
 * @property {Guest[]} guests
 * @property {Sprite[]} glows
 * @property {{ x: number, z: number }[]} cakes
 */

/**
 * @typedef {object} Guest
 * @property {string | null} key Position key for a party guest (see popped). Null for edit-mode guests.
 * @property {import('./decorations.js').Prop | null} prop Set for edit-mode guests.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} yaw
 * @property {Mesh} mesh
 * @property {number | null} back Time a popped edit-mode guest comes back (see RETURN_AFTER). Null while it's there.
 */

const _behind = new Vector3();

export class PartyLayer {
    /** @param {ReturnType<import('./materials.js').createMaterials>['party']} materials */
    constructor(materials) {
        this.materials = materials;
        this.discoGeometry = createDiscoGeometry();
        this.guestGeometry = createGuestGeometry();
        this.faceGeometry = createFaceGeometry(GUEST_FACE.size);
        this.glowMaterial = new SpriteMaterial({ map: createGlowTexture(), color: 0xffd9a0, blending: AdditiveBlending, depthWrite: false, fog: false });
        /** @type {Map<import('./WorldView.js').Chunk, Attached>} */
        this.attached = new Map();
        /** Popped party guests by position key, so they stay gone for this world. */
        this.popped = new Set();
        /**
         * Popped edit-mode guests and when each comes back. Keyed by prop so a chunk rebuild after a nearby edit
         * doesn't bring them back early.
         * @type {WeakMap<import('./decorations.js').Prop, number>}
         */
        this.away = new WeakMap();
        this.turn = 0;
        this.time = 0;
        /** Distance to the nearest mirror ball as of the last update. */
        this.discoDistance = Infinity;
        this._near = [];
        /** @type {Guest[]} */
        this._pops = [];
    }

    /** Textures to upload during the loading screen. */
    get textures() {
        return [this.glowMaterial.map];
    }

    /**
     * @param {import('./WorldView.js').Chunk} chunk
     * @param {import('./generator.js').ChunkData} data
     */
    attach(chunk, data) {
        const party = data.party;
        // Edit-mode cakes get lit candles and edit-mode guests show up even without a party in the chunk.
        const cakes = [...(party?.things ?? []), ...data.props.filter((prop) => prop.type === PROP_CAKE).map(partyPropThing)]
            .filter((thing) => thing.kind === PARTY_CAKE);
        const placed = data.props.filter((prop) => prop.type === PROP_GUEST);
        if (!party && cakes.length === 0 && placed.length === 0) return;
        const ox = chunk.cx * CHUNK_SIZE;
        const oz = chunk.cz * CHUNK_SIZE;
        /** @type {Attached} */
        const attached = { group: chunk.group, discos: [], guests: [], glows: [], cakes: [] };
        for (const disco of party?.discos ?? []) {
            const mesh = new Mesh(this.discoGeometry, this.materials.disco);
            mesh.name = 'mirror ball';
            mesh.position.set(disco.x - ox, disco.y, disco.z - oz);
            mesh.matrixAutoUpdate = false;
            mesh.receiveShadow = true;
            mesh.updateMatrix();
            chunk.group.add(mesh);
            attached.discos.push({ disco, mesh });
        }
        for (const guest of party?.guests ?? []) {
            const key = `${guest.x.toFixed(2)},${guest.z.toFixed(2)}`;
            if (this.popped.has(key)) continue;
            const mesh = this._guestMesh(guest.x - ox, 0, guest.z - oz, guest.yaw);
            chunk.group.add(mesh);
            attached.guests.push({ key, prop: null, x: guest.x, y: 0, z: guest.z, yaw: guest.yaw, mesh, back: null });
        }
        for (const prop of placed) {
            const y = prop.y ?? 0;
            const mesh = this._guestMesh(prop.x - ox, y, prop.z - oz, prop.yaw);
            const back = this.away.get(prop) ?? null;
            if (back === null) chunk.group.add(mesh);
            attached.guests.push({ key: null, prop, x: prop.x, y, z: prop.z, yaw: prop.yaw, mesh, back });
        }
        for (const thing of cakes) {
            // The candles sit a little back from the middle of the table.
            const x = thing.x - Math.sin(thing.yaw) * 0.01;
            const z = thing.z - Math.cos(thing.yaw) * 0.01;
            const glow = new Sprite(this.glowMaterial);
            glow.position.set(x - ox, (thing.y ?? 0) + GLOW_HEIGHT, z - oz);
            glow.scale.setScalar(GLOW_SIZE);
            glow.matrixAutoUpdate = false;
            glow.updateMatrix();
            chunk.group.add(glow);
            attached.glows.push(glow);
            attached.cakes.push({ x, z });
        }
        this.attached.set(chunk, attached);
    }

    /** Guest mesh with its face, in chunk-local coordinates. */
    _guestMesh(x, y, z, yaw) {
        const mesh = new Mesh(this.guestGeometry, this.materials.things);
        mesh.name = 'guest';
        mesh.receiveShadow = true;
        const face = new Mesh(this.faceGeometry, this.materials.decal);
        face.position.set(0, GUEST_FACE.y, GUEST_FACE.z);
        face.matrixAutoUpdate = false;
        face.updateMatrix();
        mesh.add(face);
        mesh.position.set(x, y, z);
        mesh.rotation.y = yaw;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        return mesh;
    }

    /** @param {import('./WorldView.js').Chunk} chunk */
    detach(chunk) {
        const attached = this.attached.get(chunk);
        if (!attached) return;
        for (const { mesh } of attached.discos) attached.group.remove(mesh);
        for (const { mesh } of attached.guests) attached.group.remove(mesh);
        for (const glow of attached.glows) attached.group.remove(glow);
        this.attached.delete(chunk);
    }

    /** New world, so every popped guest comes back. */
    reset() {
        this.popped.clear();
        this.away = new WeakMap();
    }

    /**
     * Spins the mirror balls and sends the nearest to the shaders. Turns guests to face you and pops any you walk up
     * to (flying over doesn't count). Brings popped edit-mode guests back. Flickers the candles.
     * @param {number} dt
     * @param {import('three').Object3D} viewer Camera or headset.
     * @param {boolean} playing Whether guests can pop.
     * @param {(x: number, y: number, z: number) => void} onPop Called with where a guest popped (y is what it stood on).
     */
    update(dt, viewer, playing, onPop) {
        this.time += dt;
        this.turn = (this.turn + dt * DISCO_SPEED) % (Math.PI * 2);
        const vx = viewer.position.x;
        const vy = viewer.position.y;
        const vz = viewer.position.z;
        // Backwards view direction. It's from last frame's matrix but that's close enough for an out-of-sight check.
        _behind.setFromMatrixColumn(viewer.matrixWorld, 2);
        const near = this._near;
        near.length = 0;
        const pops = this._pops;
        for (const attached of this.attached.values()) {
            for (const entry of attached.discos) {
                const { disco, mesh } = entry;
                mesh.rotation.y = this.turn + disco.phase;
                mesh.updateMatrix();
                near.push({ disco, distance: Math.hypot(disco.x - vx, disco.z - vz) });
            }
            for (let k = attached.guests.length - 1; k >= 0; k--) {
                const guest = attached.guests[k];
                const dx = vx - guest.x;
                const dz = vz - guest.z;
                const distance = Math.hypot(dx, dz);
                if (guest.back !== null) {
                    // (dx, dz) points from the guest to you, so it lines up with _behind when the guest is in front of you.
                    const hidden = dx * _behind.x + dz * _behind.z < OUT_OF_SIGHT * distance * Math.hypot(_behind.x, _behind.z);
                    if (this.time < guest.back || distance < RETURN_DISTANCE || !hidden) continue;
                    attached.group.add(guest.mesh);
                    guest.back = null;
                    if (guest.prop) this.away.delete(guest.prop);
                }
                if (playing && distance < GUEST_POP && vy < guest.y + WALL_HEIGHT) {
                    attached.group.remove(guest.mesh);
                    pops.push(guest);
                    if (guest.prop) {
                        guest.back = this.time + RETURN_AFTER;
                        this.away.set(guest.prop, guest.back);
                        continue;
                    }
                    attached.guests.splice(k, 1);
                    this.popped.add(guest.key);
                    continue;
                }
                // Turn toward you, capped at GUEST_TURN.
                let diff = Math.atan2(dx, dz) - guest.yaw;
                diff = Math.atan2(Math.sin(diff), Math.cos(diff));
                guest.yaw += Math.max(-GUEST_TURN * dt, Math.min(GUEST_TURN * dt, diff));
                guest.mesh.rotation.y = guest.yaw;
                guest.mesh.updateMatrix();
            }
        }

        // Only call onPop once every chunk has been gone through.
        for (const guest of pops) onPop(guest.x, guest.y, guest.z);
        pops.length = 0;

        near.sort((a, b) => a.distance - b.distance);
        this.discoDistance = near.length > 0 ? near[0].distance : Infinity;
        const count = Math.min(near.length, DISCO_MAX);
        for (let i = 0; i < count; i++) {
            const { disco } = near[i];
            worldLighting.discoBalls.value[i].set(disco.x, disco.y, disco.z, this.turn + disco.phase);
            worldLighting.discoRanges.value[i] = disco.range;
        }
        worldLighting.discoCount.value = count;

        // All candles flicker together, same as the TVs on a tape.
        const flicker = 0.88 + 0.07 * Math.sin(this.time * 13.1) * Math.sin(this.time * 7.7) + 0.05 * Math.random();
        this.glowMaterial.opacity = flicker;
        this.materials.flame.color.setScalar(0.9 + 0.1 * flicker);
    }

    /**
     * Nearest cake to (x, z) within `range`, or null.
     * @returns {{ x: number, z: number, distance: number } | null}
     */
    nearestCake(x, z, range) {
        let best = null;
        let bestDistance = range;
        for (const attached of this.attached.values()) {
            for (const cake of attached.cakes) {
                const distance = Math.hypot(cake.x - x, cake.z - z);
                if (distance < bestDistance) {
                    best = cake;
                    bestDistance = distance;
                }
            }
        }
        return best && { x: best.x, z: best.z, distance: bestDistance };
    }
}
