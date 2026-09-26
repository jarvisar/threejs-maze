import { AdditiveBlending, Mesh, Sprite, SpriteMaterial } from 'three';
import { CHUNK_SIZE } from '../config.js';
import { DISCO_MAX, worldLighting } from './materials.js';
import { PARTY_CAKE } from './party.js';
import { GUEST_FACE, createDiscoGeometry, createFaceGeometry, createGuestGeometry } from './partyGeometry.js';
import { createGlowTexture } from './partyTextures.js';

/*
 * The parts of Level Fun that move (see party.js): the mirror balls turning, and which of them throw their light
 * (the nearest few; the shaders do the rest, see materials.js); the guests, who turn to watch you and go pop
 * if you get too close; and the glow of the candles on the cakes.
 *
 * They're put into each chunk's group as it's built (see WorldView), and taken out as it goes.
 */

// How fast the mirror balls turn (radians per second), and how fast a guest turns to face you, at most.
const DISCO_SPEED = 0.42;
const GUEST_TURN = 1.5;
// How close you can get to a guest before it pops.
const POP_DISTANCE = 0.42;
// How big the glow over a cake's candles is, and how high.
const GLOW_SIZE = 0.2;
const GLOW_HEIGHT = 0.37;

/**
 * @typedef {object} Attached What's been put into one chunk.
 * @property {import('three').Group} group
 * @property {{ disco: import('./party.js').Disco, mesh: Mesh }[]} discos
 * @property {{ key: string, x: number, z: number, yaw: number, mesh: Mesh }[]} guests
 * @property {Sprite[]} glows
 * @property {{ x: number, z: number }[]} cakes
 */

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
        /** Guests that have popped (by where they stood), so they stay gone while you're in this world. */
        this.popped = new Set();
        this.turn = 0;
        this.time = 0;
        /** How far the nearest mirror ball is, after the last update. */
        this.discoDistance = Infinity;
        this._near = [];
    }

    /** The textures to upload behind the loading screen. */
    get textures() {
        return [this.glowMaterial.map];
    }

    /**
     * @param {import('./WorldView.js').Chunk} chunk
     * @param {import('./generator.js').ChunkData} data
     */
    attach(chunk, data) {
        const party = data.party;
        if (!party) return;
        const ox = chunk.cx * CHUNK_SIZE;
        const oz = chunk.cz * CHUNK_SIZE;
        /** @type {Attached} */
        const attached = { group: chunk.group, discos: [], guests: [], glows: [], cakes: [] };
        for (const disco of party.discos) {
            const mesh = new Mesh(this.discoGeometry, this.materials.disco);
            mesh.name = 'mirror ball';
            mesh.position.set(disco.x - ox, disco.y, disco.z - oz);
            mesh.matrixAutoUpdate = false;
            mesh.receiveShadow = true;
            mesh.updateMatrix();
            chunk.group.add(mesh);
            attached.discos.push({ disco, mesh });
        }
        for (const guest of party.guests) {
            const key = `${guest.x.toFixed(2)},${guest.z.toFixed(2)}`;
            if (this.popped.has(key)) continue;
            const mesh = new Mesh(this.guestGeometry, this.materials.things);
            mesh.name = 'guest';
            mesh.receiveShadow = true;
            const face = new Mesh(this.faceGeometry, this.materials.decal);
            face.position.set(0, GUEST_FACE.y, GUEST_FACE.z);
            face.matrixAutoUpdate = false;
            face.updateMatrix();
            mesh.add(face);
            mesh.position.set(guest.x - ox, 0, guest.z - oz);
            mesh.rotation.y = guest.yaw;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            chunk.group.add(mesh);
            attached.guests.push({ key, x: guest.x, z: guest.z, yaw: guest.yaw, mesh });
        }
        for (const thing of party.things) {
            if (thing.kind !== PARTY_CAKE) continue;
            // Over the candles, which are a little back from the middle of the table.
            const x = thing.x - Math.sin(thing.yaw) * 0.01;
            const z = thing.z - Math.cos(thing.yaw) * 0.01;
            const glow = new Sprite(this.glowMaterial);
            glow.position.set(x - ox, GLOW_HEIGHT, z - oz);
            glow.scale.setScalar(GLOW_SIZE);
            glow.matrixAutoUpdate = false;
            glow.updateMatrix();
            chunk.group.add(glow);
            attached.glows.push(glow);
            attached.cakes.push({ x, z });
        }
        this.attached.set(chunk, attached);
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

    /** A different world: everyone who popped is back (in their own world). */
    reset() {
        this.popped.clear();
    }

    /**
     * Turns the mirror balls and hands the nearest to the shaders, turns the guests to face you (and pops any
     * you've walked up to), and makes the candles flicker.
     * @param {number} dt
     * @param {import('three').Object3D} viewer The camera, or the headset.
     * @param {boolean} playing Whether guests can be popped.
     * @param {(x: number, z: number) => void} onPop
     */
    update(dt, viewer, playing, onPop) {
        this.time += dt;
        this.turn = (this.turn + dt * DISCO_SPEED) % (Math.PI * 2);
        const vx = viewer.position.x;
        const vz = viewer.position.z;
        const near = this._near;
        near.length = 0;
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
                if (playing && Math.hypot(dx, dz) < POP_DISTANCE) {
                    attached.group.remove(guest.mesh);
                    attached.guests.splice(k, 1);
                    this.popped.add(guest.key);
                    onPop(guest.x, guest.z);
                    continue;
                }
                // Turning, not too fast, to face you.
                let diff = Math.atan2(dx, dz) - guest.yaw;
                diff = Math.atan2(Math.sin(diff), Math.cos(diff));
                guest.yaw += Math.max(-GUEST_TURN * dt, Math.min(GUEST_TURN * dt, diff));
                guest.mesh.rotation.y = guest.yaw;
                guest.mesh.updateMatrix();
            }
        }

        near.sort((a, b) => a.distance - b.distance);
        this.discoDistance = near.length > 0 ? near[0].distance : Infinity;
        const count = Math.min(near.length, DISCO_MAX);
        for (let i = 0; i < count; i++) {
            const { disco } = near[i];
            worldLighting.discoBalls.value[i].set(disco.x, disco.y, disco.z, this.turn + disco.phase);
            worldLighting.discoRanges.value[i] = disco.range;
        }
        worldLighting.discoCount.value = count;

        // Candles: every flame at once, like the TVs on a tape.
        const flicker = 0.88 + 0.07 * Math.sin(this.time * 13.1) * Math.sin(this.time * 7.7) + 0.05 * Math.random();
        this.glowMaterial.opacity = flicker;
        this.materials.flame.color.setScalar(0.9 + 0.1 * flicker);
    }

    /**
     * The nearest cake to (x, z), if there's one within `range`.
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
