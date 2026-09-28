import { BoxGeometry, Group, Mesh, PlaneGeometry, Sprite } from 'three';
import { CHUNK_LOAD_DISTANCE, CHUNK_SIZE, CHUNK_UNLOAD_DISTANCE, HALF_CHUNK } from '../config.js';
import { buildChunkGeometry, createCeilingGeometry, createFixtureGeometry, createFloorGeometry, createPanelGlowGeometry } from './chunkGeometry.js';
import { usesEditPictures } from './decorations.js';
import { chunkCoord, chunkKey } from './grid.js';
import { levelById } from './levels.js';
import { PANEL_EDGE_COLOR, PANEL_FLANGE_COLOR, PANEL_LENS_COLOR } from './materials.js';

// Half-extent of a chunk's footprint, plus slack for border walls.
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
 * @property {Mesh | null} decals Wall and floor stains.
 * @property {Mesh | null} ceilingDecals
 * @property {Mesh | null} props
 * @property {Mesh | null} propGlows Self-lit prop parts (see buildPropGlowGeometry in props.js).
 * @property {Mesh | null} partyThings Level Fun (see partyGeometry.js).
 * @property {Mesh | null} partyDecals
 * @property {Mesh | null} balloons
 * @property {Mesh | null} flames
 * @property {Map<string, Mesh>} extras Level-specific meshes keyed by material name (shape extras in levels.js).
 * @property {boolean} dirty Wall meshes need (re)building.
 * @property {number} distance Player to chunk footprint at the last update.
 */

/**
 * @typedef {object} PartyHooks Level Fun's moving parts (see PartyLayer.js), attached when a chunk is built and
 *     detached when it unloads.
 * @property {(chunk: Chunk, data: import('./generator.js').ChunkData) => void} attach
 * @property {(chunk: Chunk) => void} detach
 * @property {() => void} reset New world.
 */

/**
 * Streams chunk meshes in and out around the player. Only chunks in view distance are in the scene, so memory and
 * draw calls stay flat however far you walk.
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

        // Floors, ceilings and light panels are the same in every chunk so they share geometry. The cell versions
        // are for empty chunks on levels that build their own floor and ceiling, so the edges line up.
        this.floorGeometry = createFloorGeometry();
        this.ceilingGeometry = createCeilingGeometry();
        this.cellFloorGeometry = createFloorGeometry(true);
        this.cellCeilingGeometry = createCeilingGeometry(true);
        this.fixtureGeometry = createFixtureGeometry(PANEL_LENS_COLOR, PANEL_FLANGE_COLOR, PANEL_EDGE_COLOR);
        this.panelGlowGeometry = createPanelGlowGeometry();

        /** @type {Map<number, Chunk>} */
        this.chunks = new Map();
        /** @type {Chunk[]} */
        this._buildQueue = [];
        /** @type {{ cx: number, cz: number, distance: number }[]} */
        this._missing = [];
        /** Chunks near the player still waiting to load or build after the last update. */
        this.pending = 0;
        /** Bumped when a chunk is added, rebuilt or removed, i.e. when walls may have changed. */
        this.version = 0;
        /** @type {PartyHooks | null} */
        this.party = null;

        // Shown past the far end of the view on levels that want more than the fog color (see LevelSurfaces.backdrop).
        // Drawn after the other solid meshes, only where nothing is in front.
        this.backdrop = new Mesh(new BoxGeometry(2, 2, 2));
        this.backdrop.name = 'backdrop';
        this.backdrop.frustumCulled = false;
        this.backdrop.renderOrder = 1;
        scene.add(this.backdrop);
        this._showBackdrop();
    }

    /**
     * One tiny mesh per chunk material, for compiling shaders ahead of time (see compileForLevel in materials.js).
     * Otherwise the first decal or prop to show up freezes the game while its shader compiles. Not added to the
     * scene. Call `dispose` when done.
     * @param {number} level Level whose surfaces to include.
     * @param {import('three').Material[]} [extra] Other materials, e.g. a game mode's.
     * @returns {{ objects: Group, dispose: () => void }}
     */
    warmUp(level, extra = []) {
        const group = new Group();
        group.name = 'warm-up';
        const geometry = new PlaneGeometry(0.001, 0.001);
        const { things, decal, balloon, flame, disco, chalk } = this.materials.party;
        const party = [things, decal, balloon, flame, disco, chalk];
        const { wall, floor, ceiling, details, extras, backdrop } = this.materials.level(level);
        const own = [wall, floor, ceiling, details, ...Object.values(extras), ...(backdrop ? [backdrop] : [])];
        const { shade, decal: stains, ceilingDecal, prop, propGlow, fixture, baseboard } = this.materials;
        for (const material of new Set([shade, stains, ceilingDecal, prop, propGlow, fixture, baseboard, ...party, ...own, ...extra])) {
            // Sprites use their own shader so they need a real Sprite.
            group.add(material.isSpriteMaterial ? new Sprite(material) : new Mesh(geometry, material));
        }
        // Light panels and glow, with their real geometry.
        group.add(new Mesh(this.fixtureGeometry, this.materials.panel), new Mesh(this.panelGlowGeometry, this.materials.panelGlow));
        return { objects: group, dispose: () => geometry.dispose() };
    }

    /** Swaps in a new world (e.g. new seed) and drops every loaded chunk. */
    setStore(store) {
        for (const chunk of this.chunks.values()) this._unload(chunk);
        this.chunks.clear();
        this.store = store;
        this.party?.reset();
        this._showBackdrop();
    }

    _showBackdrop() {
        // Hidden until the level's surfaces exist (see surfaces).
        const level = this.store.level;
        const material = this.materials.hasLevel(level) ? this.materials.level(level).backdrop : undefined;
        this.backdrop.visible = material !== undefined;
        if (material) this.backdrop.material = material;
    }

    /**
     * Marks every loaded chunk for rebuild over the next frames, nearest first. Lights update now. Used when Level
     * Fun toggles. Walls don't change so the old meshes can stay up until the new ones are ready.
     */
    refreshAll() {
        for (const chunk of this.chunks.values()) {
            this.panelLights.writeChunk(this.store.getChunk(chunk.cx, chunk.cz));
            chunk.dirty = true;
        }
    }

    /**
     * Loads chunks near (x, z), unloads far ones, and builds up to `maxBuilds` wall meshes, nearest first. Pass
     * `Infinity` to build everything now (e.g. before the first frame). With a `budget` (ms) it stops once that's
     * used up, but always does at least the nearest one. `pending` counts what's left for the next call.
     */
    update(x, z, maxBuilds = 1, budget = Infinity) {
        const start = budget === Infinity ? 0 : performance.now();
        const spent = () => budget !== Infinity && performance.now() - start >= budget;
        const reach = CHUNK_LOAD_DISTANCE + CHUNK_EXTENT;
        const cx0 = chunkCoord(Math.floor(x - reach));
        const cx1 = chunkCoord(Math.ceil(x + reach));
        const cz0 = chunkCoord(Math.floor(z - reach));
        const cz1 = chunkCoord(Math.ceil(z + reach));

        const missing = this._missing;
        missing.length = 0;
        for (let cx = cx0; cx <= cx1; cx++) {
            for (let cz = cz0; cz <= cz1; cz++) {
                const distance = distanceToChunk(x, z, cx, cz);
                if (distance <= CHUNK_LOAD_DISTANCE && !this.chunks.has(chunkKey(cx, cz))) missing.push({ cx, cz, distance });
            }
        }
        let worked = false;
        if (budget !== Infinity) missing.sort((a, b) => a.distance - b.distance);
        let loaded = 0;
        for (; loaded < missing.length; loaded++) {
            if (worked && spent()) break;
            const { cx, cz } = missing[loaded];
            this.chunks.set(chunkKey(cx, cz), this._load(cx, cz));
            worked = true;
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

        this.pending = missing.length - loaded + queue.length;
        if (queue.length === 0) return;
        queue.sort((a, b) => a.distance - b.distance);
        const builds = Math.min(queue.length, maxBuilds);
        for (let i = 0; i < builds; i++) {
            if (worked && spent()) break;
            this._build(queue[i]);
            this.pending--;
            worked = true;
        }
    }

    /**
     * Rebuilds an edited cell's chunk right away, plus any neighbor chunk within one cell. Their wall faces and
     * corner posts depend on it.
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

        // Floor and ceiling, unless the level builds them in extras (Level 37's aren't flat). Light panels only if
        // they're the same in every chunk. Empty chunks outside a game mode's walls get a bare floor and ceiling.
        const surfaces = this.surfaces();
        const shape = levelById(this.store.level).shape;
        const empty = this.store.options.isVoid?.(cx, cz) === true;
        if (shape.floor || empty) {
            const floor = new Mesh(shape.floor ? this.floorGeometry : this.cellFloorGeometry, surfaces.floor);
            floor.receiveShadow = true;
            group.add(floor);
        }
        if (shape.ceiling || empty) {
            const ceiling = new Mesh(shape.ceiling ? this.ceilingGeometry : this.cellCeilingGeometry, surfaces.ceiling);
            ceiling.receiveShadow = true;
            group.add(ceiling);
        }
        if (shape.panels && !empty) group.add(new Mesh(this.fixtureGeometry, this.materials.panel), new Mesh(this.panelGlowGeometry, this.materials.panelGlow));

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
            propGlows: null,
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
        // Some edit mode props use pictures that are only drawn on first use.
        if (this.store.getChunk(chunk.cx, chunk.cz).props.some((prop) => usesEditPictures(prop.type))) materials.editPictures();
        const surfaces = this.surfaces();
        chunk.walls = this._setMesh(chunk, chunk.walls, geometry.walls, surfaces.wall, true);
        chunk.baseboards = this._setMesh(chunk, chunk.baseboards, geometry.baseboards, materials.baseboard, false);
        chunk.details = this._setMesh(chunk, chunk.details, geometry.details, surfaces.details, false);
        chunk.shade = this._setMesh(chunk, chunk.shade, geometry.shade, materials.shade, false);
        chunk.decals = this._setMesh(chunk, chunk.decals, geometry.decals, materials.decal, false);
        chunk.ceilingDecals = this._setMesh(chunk, chunk.ceilingDecals, geometry.ceilingDecals, materials.ceilingDecal, false);
        chunk.props = this._setMesh(chunk, chunk.props, geometry.props, materials.prop, true);
        chunk.propGlows = this._setMesh(chunk, chunk.propGlows, geometry.propGlows, materials.propGlow, false);
        chunk.partyThings = this._setMesh(chunk, chunk.partyThings, geometry.partyThings, materials.party.things, true);
        chunk.partyDecals = this._setMesh(chunk, chunk.partyDecals, geometry.partyDecals, materials.party.decal, false);
        chunk.balloons = this._setMesh(chunk, chunk.balloons, geometry.balloons, materials.party.balloon, false);
        chunk.flames = this._setMesh(chunk, chunk.flames, geometry.flames, materials.party.flame, false);
        // Level extras, each drawn by the material with the same name. Meshes that are no longer built get removed.
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
        // Walls may have changed (see PanelLightMap.cells).
        this.panelLights.writeCells(this.store.getChunk(chunk.cx, chunk.cz));
        chunk.dirty = false;
        this.version++;
    }

    /** Current level's materials (see materials.js). Creates them if needed, which can be slow (see Game.settle). */
    surfaces() {
        const made = this.materials.hasLevel(this.store.level);
        const surfaces = this.materials.level(this.store.level);
        if (!made) this._showBackdrop();
        return surfaces;
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
        for (const mesh of [chunk.walls, chunk.baseboards, chunk.details, chunk.shade, chunk.decals, chunk.ceilingDecals, chunk.props, chunk.propGlows, chunk.partyThings, chunk.partyDecals, chunk.balloons, chunk.flames, ...chunk.extras.values()]) {
            mesh?.geometry.dispose();
        }
        this.party?.detach(chunk);
        this.root.remove(chunk.group);
        this.version++;
    }
}

/** XZ distance from (x, z) to chunk (cx, cz)'s footprint. 0 when inside. */
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
