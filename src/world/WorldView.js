import { Group, Mesh } from 'three';
import { CHUNK_LOAD_DISTANCE, CHUNK_SIZE, CHUNK_UNLOAD_DISTANCE, HALF_CHUNK } from '../config.js';
import { chunkCoord, chunkKey } from './ChunkStore.js';
import { buildChunkWalls, createCeilingGeometry, createFixtureGeometry, createFloorGeometry } from './chunkGeometry.js';
import { FIXTURE_FRAME_COLOR, FIXTURE_PANEL_COLOR } from './materials.js';

// Half-extent of a chunk's footprint, including the half cell that walls stick out past the floor grid.
const CHUNK_EXTENT = HALF_CHUNK + 0.5;

/**
 * @typedef {object} Chunk
 * @property {number} cx
 * @property {number} cz
 * @property {Group} group
 * @property {Mesh | null} walls
 * @property {Mesh | null} baseboards
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
     */
    constructor(scene, store, materials) {
        this.store = store;
        this.materials = materials;
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
    update(x, z, maxBuilds = 2) {
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
     * Rebuilds whatever a changed cell affects right away: its own chunk, plus the neighbouring chunk when
     * it sits on a chunk edge (that neighbour's wall faces depend on it).
     */
    refreshCell(x, z) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const lx = x - cx * CHUNK_SIZE + HALF_CHUNK;
        const lz = z - cz * CHUNK_SIZE + HALF_CHUNK;
        this._rebuildIfLoaded(cx, cz);
        if (lx === 0) this._rebuildIfLoaded(cx - 1, cz);
        if (lx === CHUNK_SIZE - 1) this._rebuildIfLoaded(cx + 1, cz);
        if (lz === 0) this._rebuildIfLoaded(cx, cz - 1);
        if (lz === CHUNK_SIZE - 1) this._rebuildIfLoaded(cx, cz + 1);
    }

    get loadedCount() {
        return this.chunks.size;
    }

    _rebuildIfLoaded(cx, cz) {
        const chunk = this.chunks.get(chunkKey(cx, cz));
        if (chunk) this._build(chunk);
    }

    _load(cx, cz) {
        const group = new Group();
        group.name = `chunk ${cx},${cz}`;
        group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

        const floor = new Mesh(this.floorGeometry, this.materials.floor);
        floor.receiveShadow = true;
        const ceiling = new Mesh(this.ceilingGeometry, this.materials.ceiling);
        ceiling.receiveShadow = true;
        const fixtures = new Mesh(this.fixtureGeometry, this.materials.fixture);
        group.add(floor, ceiling, fixtures);

        freeze(group);
        this.root.add(group);
        return { cx, cz, group, walls: null, baseboards: null, dirty: true, distance: 0 };
    }

    _build(chunk) {
        const { walls, baseboards } = buildChunkWalls(this.store, chunk.cx, chunk.cz);
        chunk.walls = this._setMesh(chunk, chunk.walls, walls, this.materials.wall, true);
        chunk.baseboards = this._setMesh(chunk, chunk.baseboards, baseboards, this.materials.baseboard, false);
        chunk.dirty = false;
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
        chunk.walls?.geometry.dispose();
        chunk.baseboards?.geometry.dispose();
        this.root.remove(chunk.group);
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
