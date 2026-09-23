import { Group, Mesh, PlaneGeometry } from 'three';
import { CHUNK_LOAD_DISTANCE, CHUNK_SIZE, CHUNK_UNLOAD_DISTANCE, HALF_CHUNK } from '../config.js';
import { buildChunkGeometry, createCeilingGeometry, createFixtureGeometry, createFloorGeometry } from './chunkGeometry.js';
import { chunkCoord, chunkKey } from './grid.js';
import { FIXTURE_FRAME_COLOR, FIXTURE_PANEL_COLOR } from './materials.js';

// Half-extent of a chunk's footprint, with some slack for walls on its border.
const CHUNK_EXTENT = HALF_CHUNK + 0.5;

/**
 * @typedef {object} Chunk
 * @property {number} cx
 * @property {number} cz
 * @property {Group} group
 * @property {Mesh | null} walls
 * @property {Mesh | null} baseboards
 * @property {Mesh | null} details
 * @property {Mesh | null} decals Stains on the walls and floor.
 * @property {Mesh | null} ceilingDecals
 * @property {Mesh | null} props
 * @property {boolean} dirty Wall meshes need (re)building.
 * @property {number} distance Distance from the player to the chunk's footprint at the last update.
 */

/**
 * Streams chunk meshes in and out around the player. Only chunks within view distance exist in the scene;
 * everything else is disposed, so memory and draw calls stay flat no matter how far you walk.
 */
export class WorldView {
    /**
     * @param {import('three').Scene} scene
     * @param {import('./ChunkStore.js').ChunkStore} store
     * @param {ReturnType<import('./materials.js').createMaterials>} materials
     * @param {import('./panelLights.js').PanelLightMap} panelLights
     */
    constructor(scene, store, materials, panelLights) {
        this.store = store;
        this.materials = materials;
        this.panelLights = panelLights;
        this.root = new Group();
        this.root.name = 'world';
        scene.add(this.root);

        // Floors, ceilings and light panels are identical in every chunk, so they share geometry.
        this.floorGeometry = createFloorGeometry();
        this.ceilingGeometry = createCeilingGeometry();
        this.fixtureGeometry = createFixtureGeometry(FIXTURE_PANEL_COLOR, FIXTURE_FRAME_COLOR);

        /** @type {Map<number, Chunk>} */
        this.chunks = new Map();
        /** @type {Chunk[]} */
        this._buildQueue = [];
        /** Goes up whenever a chunk is added, rebuilt or removed, i.e. whenever the walls may have changed. */
        this.version = 0;
        /** @type {Group | null} */
        this._warmUp = null;
    }

    /**
     * Puts something using each of the chunk materials that the spawn chunk might not into the scene, so
     * that compiling the scene's shaders behind the loading screen covers them too (the first decal or prop
     * to come into view would otherwise freeze the game while its shader compiled).
     * @param {import('three').Material[]} [extra] Other materials to cover (a game mode's).
     */
    showWarmUp(extra = []) {
        if (this._warmUp) return;
        const group = new Group();
        group.name = 'warm-up';
        const geometry = new PlaneGeometry(0.001, 0.001);
        for (const material of [this.materials.decal, this.materials.ceilingDecal, this.materials.prop, ...extra]) {
            const mesh = new Mesh(geometry, material);
            mesh.position.set(0, 0.5, -1);
            group.add(mesh);
        }
        this._warmUp = group;
        this.root.add(group);
    }

    hideWarmUp() {
        if (!this._warmUp) return;
        this.root.remove(this._warmUp);
        this._warmUp.children[0].geometry.dispose();
        this._warmUp = null;
    }

    /** Swaps in a different world (e.g. a new seed), dropping every loaded chunk. */
    setStore(store) {
        for (const chunk of this.chunks.values()) this._unload(chunk);
        this.chunks.clear();
        this.store = store;
    }

    /**
     * Loads chunks near (x, z), unloads far ones, and builds at most `maxBuilds` wall meshes, nearest first.
     * Pass `Infinity` to build everything that's needed right away (e.g. before the first frame).
     */
    update(x, z, maxBuilds = 1) {
        const reach = CHUNK_LOAD_DISTANCE + CHUNK_EXTENT;
        const cx0 = chunkCoord(Math.floor(x - reach));
        const cx1 = chunkCoord(Math.ceil(x + reach));
        const cz0 = chunkCoord(Math.floor(z - reach));
        const cz1 = chunkCoord(Math.ceil(z + reach));

        for (let cx = cx0; cx <= cx1; cx++) {
            for (let cz = cz0; cz <= cz1; cz++) {
                if (distanceToChunk(x, z, cx, cz) > CHUNK_LOAD_DISTANCE) continue;
                const key = chunkKey(cx, cz);
                if (!this.chunks.has(key)) this.chunks.set(key, this._load(cx, cz));
            }
        }

        const queue = this._buildQueue;
        queue.length = 0;
        for (const [key, chunk] of this.chunks) {
            chunk.distance = distanceToChunk(x, z, chunk.cx, chunk.cz);
            if (chunk.distance > CHUNK_UNLOAD_DISTANCE) {
                this._unload(chunk);
                this.chunks.delete(key);
            } else if (chunk.dirty) {
                queue.push(chunk);
            }
        }

        if (queue.length === 0) return;
        queue.sort((a, b) => a.distance - b.distance);
        const builds = Math.min(queue.length, maxBuilds);
        for (let i = 0; i < builds; i++) this._build(queue[i]);
    }

    /**
     * Rebuilds whatever an edited cell's edges and corner affect, right away: its own chunk, plus any
     * neighbouring chunk within a cell of it (their wall faces and corner posts depend on it).
     */
    refreshCell(x, z) {
        const rebuilt = new Set();
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = chunkKey(chunkCoord(x + dx), chunkCoord(z + dz));
                if (rebuilt.has(key)) continue;
                rebuilt.add(key);
                const chunk = this.chunks.get(key);
                if (chunk) this._build(chunk);
            }
        }
    }

    get loadedCount() {
        return this.chunks.size;
    }

    _load(cx, cz) {
        const group = new Group();
        group.name = `chunk ${cx},${cz}`;
        group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

        const floor = new Mesh(this.floorGeometry, this.materials.floor);
        floor.receiveShadow = true;
        const ceiling = new Mesh(this.ceilingGeometry, this.materials.ceiling);
        ceiling.receiveShadow = true;
        group.add(floor, ceiling);
        // An empty chunk (outside a game mode's walls) is a bare floor and ceiling.
        if (!this.store.options.isVoid?.(cx, cz)) group.add(new Mesh(this.fixtureGeometry, this.materials.fixture));

        freeze(group);
        this.root.add(group);
        this.panelLights.writeChunk(this.store.getChunk(cx, cz));
        this.version++;
        return { cx, cz, group, walls: null, baseboards: null, details: null, decals: null, ceilingDecals: null, props: null, dirty: true, distance: 0 };
    }

    _build(chunk) {
        const { walls, baseboards, details, decals, ceilingDecals, props } = buildChunkGeometry(this.store, chunk.cx, chunk.cz);
        chunk.walls = this._setMesh(chunk, chunk.walls, walls, this.materials.wall, true);
        chunk.baseboards = this._setMesh(chunk, chunk.baseboards, baseboards, this.materials.baseboard, false);
        chunk.details = this._setMesh(chunk, chunk.details, details, this.materials.details, false);
        chunk.decals = this._setMesh(chunk, chunk.decals, decals, this.materials.decal, false);
        chunk.ceilingDecals = this._setMesh(chunk, chunk.ceilingDecals, ceilingDecals, this.materials.ceilingDecal, false);
        chunk.props = this._setMesh(chunk, chunk.props, props, this.materials.prop, true);
        chunk.dirty = false;
        this.version++;
    }

    _setMesh(chunk, mesh, geometry, material, castShadow) {
        if (mesh) {
            mesh.geometry.dispose();
            if (!geometry) {
                chunk.group.remove(mesh);
                return null;
            }
            mesh.geometry = geometry;
            return mesh;
        }
        if (!geometry) return null;
        const created = new Mesh(geometry, material);
        created.castShadow = castShadow;
        created.receiveShadow = true;
        freeze(created);
        chunk.group.add(created);
        return created;
    }

    _unload(chunk) {
        for (const mesh of [chunk.walls, chunk.baseboards, chunk.details, chunk.decals, chunk.ceilingDecals, chunk.props]) mesh?.geometry.dispose();
        this.root.remove(chunk.group);
        this.version++;
    }
}

/** Distance in the XZ plane from (x, z) to the footprint of chunk (cx, cz); 0 when inside it. */
function distanceToChunk(x, z, cx, cz) {
    const dx = Math.max(Math.abs(x - cx * CHUNK_SIZE) - CHUNK_EXTENT, 0);
    const dz = Math.max(Math.abs(z - cz * CHUNK_SIZE) - CHUNK_EXTENT, 0);
    return Math.hypot(dx, dz);
}

/** Chunks never move, so skip recomputing their local matrices every frame. */
function freeze(object) {
    object.traverse((child) => {
        child.matrixAutoUpdate = false;
        child.updateMatrix();
    });
}
