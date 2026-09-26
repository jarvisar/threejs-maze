import { BoxGeometry, Group, Mesh, PlaneGeometry, Sprite } from 'three';
import { CHUNK_LOAD_DISTANCE, CHUNK_SIZE, CHUNK_UNLOAD_DISTANCE, HALF_CHUNK } from '../config.js';
import { buildChunkGeometry, createCeilingGeometry, createFixtureGeometry, createFloorGeometry } from './chunkGeometry.js';
import { chunkCoord, chunkKey } from './grid.js';
import { levelById } from './levels.js';
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
 * @property {Mesh | null} shade
 * @property {Mesh | null} details
 * @property {Mesh | null} decals Stains on the walls and floor.
 * @property {Mesh | null} ceilingDecals
 * @property {Mesh | null} props
 * @property {Mesh | null} partyThings Level Fun's (see partyGeometry.js).
 * @property {Mesh | null} partyDecals
 * @property {Mesh | null} balloons
 * @property {Mesh | null} flames
 * @property {Map<string, Mesh>} extras The level's own meshes (its shape's extras; see levels.js), by the name of
 *     the material that draws each.
 * @property {boolean} dirty Wall meshes need (re)building.
 * @property {number} distance Distance from the player to the chunk's footprint at the last update.
 */

/**
 * @typedef {object} PartyHooks What moves in Level Fun (see PartyLayer.js), put into a chunk when it's built
 *     and taken out when it goes.
 * @property {(chunk: Chunk, data: import('./generator.js').ChunkData) => void} attach
 * @property {(chunk: Chunk) => void} detach
 * @property {() => void} reset A different world.
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
        /** @type {PlaneGeometry | null} */
        this._warmUpGeometry = null;
        /** @type {PartyHooks | null} */
        this.party = null;

        // What's seen past the far end of the view, on a level with more there than the haze's colour (see
        // LevelSurfaces.backdrop). Drawn after everything else that's solid, where there's nothing in front of it.
        this.backdrop = new Mesh(new BoxGeometry(2, 2, 2));
        this.backdrop.name = 'backdrop';
        this.backdrop.frustumCulled = false;
        this.backdrop.renderOrder = 1;
        scene.add(this.backdrop);
        this._showBackdrop();
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
        const { things, decal, balloon, flame, disco, chalk } = this.materials.party;
        const party = [things, decal, balloon, flame, disco, chalk];
        // Every level's, whichever is showing.
        const levels = this.materials.levels.flatMap(({ wall, floor, ceiling, details, extras, backdrop }) => [wall, floor, ceiling, details, ...Object.values(extras), ...(backdrop ? [backdrop] : [])]);
        for (const material of new Set([this.materials.shade, this.materials.decal, this.materials.ceilingDecal, this.materials.prop, ...party, ...levels, ...extra])) {
            // (A sprite as a sprite: it's a shader of its own.)
            const mesh = material.isSpriteMaterial ? new Sprite(material) : new Mesh(geometry, material);
            mesh.position.set(0, 0.5, -1);
            group.add(mesh);
        }
        // The panels too, with their own geometry: it has no normals, which makes it a shader of its own.
        const panels = new Mesh(this.fixtureGeometry, this.materials.fixture);
        panels.position.set(0, 0.5, -1);
        group.add(panels);
        this._warmUpGeometry = geometry;
        this._warmUp = group;
        this.root.add(group);
    }

    hideWarmUp() {
        if (!this._warmUp) return;
        this.root.remove(this._warmUp);
        this._warmUpGeometry.dispose();
        this._warmUp = null;
    }

    /** Swaps in a different world (e.g. a new seed), dropping every loaded chunk. */
    setStore(store) {
        for (const chunk of this.chunks.values()) this._unload(chunk);
        this.chunks.clear();
        this.store = store;
        this.party?.reset();
        this._showBackdrop();
    }

    _showBackdrop() {
        const material = this._surfaces().backdrop;
        this.backdrop.visible = material !== undefined;
        if (material) this.backdrop.material = material;
    }

    /**
     * Rebuilds every loaded chunk, nearest first over the next frames (and its lights straight away): for Level
     * Fun going on or off, which changes what's in them but not their walls, so the old meshes stay up until the
     * new ones are ready.
     */
    refreshAll() {
        for (const chunk of this.chunks.values()) {
            this.panelLights.writeChunk(this.store.getChunk(chunk.cx, chunk.cz));
            chunk.dirty = true;
        }
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

        // The level's own floor and ceiling (unless its extras build them: Level 37's aren't flat), and its light
        // panels if they're the kind every chunk has the same of. An empty chunk (outside a game mode's walls) is a
        // bare floor and ceiling.
        const surfaces = this._surfaces();
        const shape = levelById(this.store.level).shape;
        const empty = this.store.options.isVoid?.(cx, cz) === true;
        if ((shape.floor ?? true) || empty) {
            const floor = new Mesh(this.floorGeometry, surfaces.floor);
            floor.receiveShadow = true;
            group.add(floor);
        }
        if ((shape.ceiling ?? true) || empty) {
            const ceiling = new Mesh(this.ceilingGeometry, surfaces.ceiling);
            ceiling.receiveShadow = true;
            group.add(ceiling);
        }
        if (shape.panels && !empty) group.add(new Mesh(this.fixtureGeometry, this.materials.fixture));

        freeze(group);
        this.root.add(group);
        this.panelLights.writeChunk(this.store.getChunk(cx, cz));
        this.version++;
        return {
            cx,
            cz,
            group,
            walls: null,
            baseboards: null,
            details: null,
            shade: null,
            decals: null,
            ceilingDecals: null,
            props: null,
            partyThings: null,
            partyDecals: null,
            balloons: null,
            flames: null,
            extras: new Map(),
            dirty: true,
            distance: 0,
        };
    }

    _build(chunk) {
        const geometry = buildChunkGeometry(this.store, chunk.cx, chunk.cz);
        const materials = this.materials;
        const surfaces = this._surfaces();
        chunk.walls = this._setMesh(chunk, chunk.walls, geometry.walls, surfaces.wall, true);
        chunk.baseboards = this._setMesh(chunk, chunk.baseboards, geometry.baseboards, materials.baseboard, false);
        chunk.details = this._setMesh(chunk, chunk.details, geometry.details, surfaces.details, false);
        chunk.shade = this._setMesh(chunk, chunk.shade, geometry.shade, materials.shade, false);
        chunk.decals = this._setMesh(chunk, chunk.decals, geometry.decals, materials.decal, false);
        chunk.ceilingDecals = this._setMesh(chunk, chunk.ceilingDecals, geometry.ceilingDecals, materials.ceilingDecal, false);
        chunk.props = this._setMesh(chunk, chunk.props, geometry.props, materials.prop, true);
        chunk.partyThings = this._setMesh(chunk, chunk.partyThings, geometry.partyThings, materials.party.things, true);
        chunk.partyDecals = this._setMesh(chunk, chunk.partyDecals, geometry.partyDecals, materials.party.decal, false);
        chunk.balloons = this._setMesh(chunk, chunk.balloons, geometry.balloons, materials.party.balloon, false);
        chunk.flames = this._setMesh(chunk, chunk.flames, geometry.flames, materials.party.flame, false);
        // The level's own, each drawn by its material of the same name. (A mesh it had before but not now goes.)
        for (const name of new Set([...chunk.extras.keys(), ...Object.keys(geometry.extras)])) {
            const material = surfaces.extras[name];
            const mesh = this._setMesh(chunk, chunk.extras.get(name) ?? null, geometry.extras[name] ?? null, material, surfaces.shadows.includes(name));
            if (mesh) chunk.extras.set(name, mesh);
            else chunk.extras.delete(name);
        }
        if (this.party) {
            this.party.detach(chunk);
            this.party.attach(chunk, this.store.getChunk(chunk.cx, chunk.cz));
        }
        // Its walls may have changed (see PanelLightMap.cells).
        this.panelLights.writeCells(this.store.getChunk(chunk.cx, chunk.cz));
        chunk.dirty = false;
        this.version++;
    }

    /** The materials of the level that's showing (see materials.js). */
    _surfaces() {
        return this.materials.levels[this.store.level] ?? this.materials.levels[0];
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
        for (const mesh of [chunk.walls, chunk.baseboards, chunk.details, chunk.shade, chunk.decals, chunk.ceilingDecals, chunk.props, chunk.partyThings, chunk.partyDecals, chunk.balloons, chunk.flames, ...chunk.extras.values()]) {
            mesh?.geometry.dispose();
        }
        this.party?.detach(chunk);
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
