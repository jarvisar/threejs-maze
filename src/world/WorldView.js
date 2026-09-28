import { BoxGeometry, BufferGeometry, Group, Mesh, PlaneGeometry, Sphere, Sprite, Vector3 } from 'three';
import { CHUNK_LOAD_DISTANCE, CHUNK_SIZE, CHUNK_UNLOAD_DISTANCE, HALF_CHUNK, VIEW_DISTANCE } from '../config.js';
import { chunkGeometrySteps, createCeilingGeometry, createFixtureGeometry, createFloorGeometry, createPanelGlowGeometry, finish } from './chunkGeometry.js';
import { usesEditPictures } from './decorations.js';
import { chunkCoord, chunkKey } from './grid.js';
import { levelById } from './levels.js';
import { PANEL_EDGE_COLOR, PANEL_FLANGE_COLOR, PANEL_LENS_COLOR } from './materials.js';

// Half-extent of a chunk's footprint, plus slack for border walls.
const CHUNK_EXTENT = HALF_CHUNK + 0.5;
// While walking, a chunk is built a step at a time over as many frames as it takes (see update), but one that hasn't
// been drawn yet is finished at once when it gets this close. The haze hides all but a few percent past here.
const BUILD_NOW_DISTANCE = VIEW_DISTANCE - 1.5;
// Chunks this close get their data generated on frames with nothing else to do. Building a chunk reads its
// neighbours, so otherwise the frame that builds one coming into range also generates up to three more.
const GENERATE_AHEAD = CHUNK_LOAD_DISTANCE + CHUNK_SIZE;
// Chunk meshes with more triangles than this are drawn a quarter of the chunk at a time (see splitByQuarter). That's
// the pipes, furniture, cars and pool tiles of the later levels, up to 100k triangles a chunk. Level 0 has none.
const SPLIT_TRIANGLES = 5000;
// Attributes of meshes whose vertex shader moves them (glow spots, floats, balloons), so their triangles aren't
// drawn where their positions say. Those keep one mesh.
const MOVED = ['corner', 'drift', 'sway'];

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
 * @property {boolean} built Has been built at least once, so it has walls to show while it's rebuilt.
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
        // Never moves either, same as the chunks (see freeze).
        this.root.matrixAutoUpdate = false;
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
        /**
         * The chunk being built a step at a time, and its steps (see update). Dropped whenever anything else builds,
         * since the builders are shared, or the world changes under it.
         * @type {{ chunk: Chunk, steps: Generator<void, void> } | null}
         */
        this._job = null;
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
        this.backdrop.renderOrder = 2;
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
        this._job = null;
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
        // A chunk halfway through was reading the world as it was.
        this._job = null;
        for (const chunk of this.chunks.values()) {
            this.panelLights.writeChunk(this.store.getChunk(chunk.cx, chunk.cz));
            chunk.dirty = true;
        }
    }

    /**
     * Loads chunks near (x, z), unloads far ones, and builds up to `maxBuilds` wall meshes, nearest first. Pass
     * `Infinity` to build everything now (e.g. before the first frame). With a `budget` (ms) it stops once that's
     * used up, but always does at least the nearest one. `pending` counts what's left for the next call.
     *
     * With both a budget and a number of builds (walking around), a chunk is built a step at a time instead, over as
     * many frames as it takes (see chunkGeometrySteps). Built whole, a chunk of the busier levels took 10-40 ms, and
     * five times that on a phone, in one frame. Frames with nothing to build generate chunks coming up instead (see
     * GENERATE_AHEAD).
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
        if (queue.length === 0) {
            if (!worked && budget !== Infinity) this._generateAhead(x, z);
            return;
        }
        queue.sort((a, b) => a.distance - b.distance);
        if (budget === Infinity || maxBuilds === Infinity || maxBuilds < 1) {
            const builds = Math.min(queue.length, maxBuilds);
            for (let i = 0; i < builds; i++) {
                if (worked && spent()) break;
                this._build(queue[i]);
                this.pending--;
                worked = true;
            }
            return;
        }

        const nearest = queue[0];
        const urgent = (chunk) => !chunk.built && chunk.distance < BUILD_NOW_DISTANCE;
        let job = this._job;
        if (job && (!job.chunk.dirty || this.chunks.get(chunkKey(job.chunk.cx, job.chunk.cz)) !== job.chunk)) job = null;
        if (job && job.chunk !== nearest && urgent(nearest)) job = null;
        job ??= { chunk: nearest, steps: this._buildSteps(nearest) };
        this._job = job;
        const now = urgent(job.chunk);
        for (;;) {
            if (worked && !now && spent()) return;
            const step = job.steps.next();
            worked = true;
            if (step.done) {
                this._job = null;
                this.pending--;
                return;
            }
        }
    }

    /** Generates the nearest chunk within GENERATE_AHEAD that hasn't been, if any. */
    _generateAhead(x, z) {
        const store = this.store;
        const reach = GENERATE_AHEAD + CHUNK_EXTENT;
        let nearest = GENERATE_AHEAD;
        let found = false;
        let fx = 0;
        let fz = 0;
        for (let cx = chunkCoord(Math.floor(x - reach)); cx <= chunkCoord(Math.ceil(x + reach)); cx++) {
            for (let cz = chunkCoord(Math.floor(z - reach)); cz <= chunkCoord(Math.ceil(z + reach)); cz++) {
                if (store.chunks.has(chunkKey(cx, cz))) continue;
                const distance = distanceToChunk(x, z, cx, cz);
                if (distance > nearest) continue;
                nearest = distance;
                found = true;
                fx = cx;
                fz = cz;
            }
        }
        if (found) store.getChunk(fx, fz);
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

    /**
     * Like refreshCell, but the chunks are rebuilt with the rest, a step at a time (see update). For a change the
     * player can't see yet, like a tape's way out opening on the far side of it.
     */
    refreshCellLater(x, z) {
        // Whatever's halfway through may have read the cell as it was.
        this._job = null;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const chunk = this.chunks.get(chunkKey(chunkCoord(x + dx), chunkCoord(z + dz)));
                if (chunk) chunk.dirty = true;
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
        // Both are drawn after everything else solid (but before the backdrop). Walls and furniture hide most of them,
        // and GPUs that don't sort by depth themselves (Mali, for one) only skip shading what's hidden when what hides
        // it was drawn first. Nothing solid lies in their planes (see tests/geometry.test.js), so it looks the same.
        const surfaces = this.surfaces();
        const shape = levelById(this.store.level).shape;
        const empty = this.store.options.isVoid?.(cx, cz) === true;
        if (shape.floor || empty) {
            const floor = new Mesh(shape.floor ? this.floorGeometry : this.cellFloorGeometry, surfaces.floor);
            floor.receiveShadow = true;
            floor.renderOrder = 1;
            group.add(floor);
        }
        if (shape.ceiling || empty) {
            const ceiling = new Mesh(shape.ceiling ? this.ceilingGeometry : this.cellCeilingGeometry, surfaces.ceiling);
            ceiling.receiveShadow = true;
            ceiling.renderOrder = 1;
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
            built: false,
            distance: 0,
        };
    }

    /** Builds a chunk whole, now. */
    _build(chunk) {
        // It shares the builders with the chunk being built in steps.
        this._job = null;
        finish(this._buildSteps(chunk));
    }

    /**
     * Builds a chunk's meshes and puts them in place of its old ones, in steps (see update): its meshes, then each
     * heavy one sorted for culling (see splitByQuarter), then the lot swapped in at once.
     * @param {Chunk} chunk
     */
    *_buildSteps(chunk) {
        const geometry = yield* chunkGeometrySteps(this.store, chunk.cx, chunk.cz);
        const materials = this.materials;
        // Some edit mode props use pictures that are only drawn on first use.
        if (this.store.getChunk(chunk.cx, chunk.cz).props.some((prop) => usesEditPictures(prop.type))) materials.editPictures();
        const surfaces = this.surfaces();
        const { party } = materials;
        // Each mesh: its place on the chunk, what it's made of, what draws it, and whether it casts shadows. Level
        // extras are drawn by the material with the same name, and ones that are no longer built get removed.
        /** @type {[string, BufferGeometry | null, import('three').Material, boolean, boolean][]} */
        const meshes = [
            ['walls', geometry.walls, surfaces.wall, true, false],
            ['baseboards', geometry.baseboards, materials.baseboard, false, false],
            ['details', geometry.details, surfaces.details, false, false],
            ['shade', geometry.shade, materials.shade, false, false],
            ['decals', geometry.decals, materials.decal, false, false],
            ['ceilingDecals', geometry.ceilingDecals, materials.ceilingDecal, false, false],
            ['props', geometry.props, materials.prop, true, false],
            ['propGlows', geometry.propGlows, materials.propGlow, false, false],
            ['partyThings', geometry.partyThings, party.things, true, false],
            ['partyDecals', geometry.partyDecals, party.decal, false, false],
            ['balloons', geometry.balloons, party.balloon, false, false],
            ['flames', geometry.flames, party.flame, false, false],
        ];
        for (const name of new Set([...chunk.extras.keys(), ...Object.keys(geometry.extras)])) {
            meshes.push([name, geometry.extras[name] ?? null, surfaces.extras[name], surfaces.shadows.includes(name), true]);
        }
        // Sorting one is a step of its own: Level 5's woodwork takes a couple of ms.
        for (const [, built, material] of meshes) {
            if (!splits(built, material)) continue;
            regroupByQuarter(built);
            yield;
        }
        for (const [name, built, material, castShadow, extra] of meshes) {
            if (!extra) {
                chunk[name] = this._setMesh(chunk, chunk[name], built, material, castShadow);
                continue;
            }
            const mesh = this._setMesh(chunk, chunk.extras.get(name) ?? null, built, material, castShadow);
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
        chunk.built = true;
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
            disposeMesh(mesh);
            if (!geometry) {
                chunk.group.remove(mesh);
                return null;
            }
            mesh.geometry = geometry;
        } else {
            if (!geometry) return null;
            mesh = new Mesh(geometry, material);
            mesh.castShadow = castShadow;
            mesh.receiveShadow = true;
            freeze(mesh);
            chunk.group.add(mesh);
        }
        splitByQuarter(mesh);
        return mesh;
    }

    _unload(chunk) {
        for (const mesh of [chunk.walls, chunk.baseboards, chunk.details, chunk.shade, chunk.decals, chunk.ceilingDecals, chunk.props, chunk.propGlows, chunk.partyThings, chunk.partyDecals, chunk.balloons, chunk.flames, ...chunk.extras.values()]) {
            if (mesh) disposeMesh(mesh);
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

/**
 * Chunks never move, so skip recomputing their matrices every frame. This only helps because the root and the scene
 * are frozen too. A parent that updates its matrix makes all its children recompute their world matrices.
 */
function freeze(object) {
    object.traverse((child) => {
        child.matrixAutoUpdate = false;
        child.updateMatrix();
    });
}

/** Frees a chunk mesh's geometry, and its quarters' (see splitByQuarter). */
function disposeMesh(mesh) {
    mesh.geometry.dispose();
    for (const quarter of mesh.children) quarter.geometry.dispose();
    mesh.clear();
}

/**
 * Culling works on whole meshes, so a heavy chunk mesh barely in view (or in the flashlight's beam, for the shadow
 * map) used to be drawn in full. This regroups its triangles by which quarter of the chunk they're in and draws each
 * quarter as its own mesh with its own bounds, which about halves the triangles drawn on the later levels. The
 * quarters share the mesh's vertex and index buffers (each draws its own range of the index), so they cost no memory
 * or uploads. The mesh draws the first quarter and the others hang off it.
 * @param {Mesh} mesh
 */
function splitByQuarter(mesh) {
    const geometry = mesh.geometry;
    if (!splits(geometry, mesh.material)) return;
    const quarters = geometry.userData.quarters ?? regroupByQuarter(geometry);
    if (quarters.length < 2) return;
    const [first, ...rest] = quarters;
    geometry.setDrawRange(first.start, first.count);
    geometry.boundingSphere = first.bounds;
    for (const { start, count, bounds } of rest) {
        const part = new BufferGeometry();
        for (const name of Object.keys(geometry.attributes)) part.setAttribute(name, geometry.attributes[name]);
        part.setIndex(geometry.index);
        part.setDrawRange(start, count);
        part.boundingSphere = bounds;
        const quarter = new Mesh(part, mesh.material);
        quarter.castShadow = mesh.castShadow;
        quarter.receiveShadow = mesh.receiveShadow;
        // Same place as the mesh. Frozen like it, after one update to pick up its world matrix.
        quarter.matrixAutoUpdate = false;
        quarter.updateMatrix();
        mesh.add(quarter);
    }
}

/**
 * Whether a chunk mesh gets split up (see splitByQuarter). Only heavy, opaque ones, since drawn in pieces a transparent
 * one would blend in a different order.
 * @param {BufferGeometry | null} geometry
 * @param {import('three').Material | undefined} material
 */
function splits(geometry, material) {
    const index = geometry?.index;
    if (!geometry || !index || index.count / 3 <= SPLIT_TRIANGLES || material?.transparent || geometry.groups.length > 0) return false;
    return !MOVED.some((name) => geometry.attributes[name]) && geometry.attributes.position.itemSize === 3;
}

// Scratch space for regroupByQuarter, grown as needed.
let _quarterOf = new Uint8Array(0);
let _indices = new Uint32Array(0);
const _bounds = new Float32Array(24);

/**
 * Sorts an indexed geometry's triangles by chunk quarter, in place, going by each triangle's middle. Chunk mesh
 * positions are relative to the chunk's middle, so the quarter is just the signs of x and z. Keeps what it found in
 * `userData.quarters` for splitByQuarter.
 * @param {BufferGeometry} geometry Not drawn yet.
 * @returns {{ start: number, count: number, bounds: Sphere }[]} Index range and bounds of each quarter with anything
 *     in it.
 */
function regroupByQuarter(geometry) {
    const position = geometry.attributes.position.array;
    const index = /** @type {import('three').BufferAttribute} */ (geometry.index).array;
    const triangles = index.length / 3;
    if (_quarterOf.length < triangles) _quarterOf = new Uint8Array(triangles * 2);
    if (_indices.length < index.length) _indices = new Uint32Array(index.length * 2);
    const quarterOf = _quarterOf;
    const bounds = _bounds;
    // Min x, y, z then max x, y, z, per quarter.
    for (let q = 0; q < 24; q += 6) {
        bounds.fill(Infinity, q, q + 3);
        bounds.fill(-Infinity, q + 3, q + 6);
    }
    const counts = [0, 0, 0, 0];
    for (let t = 0; t < triangles; t++) {
        const a = index[t * 3] * 3;
        const b = index[t * 3 + 1] * 3;
        const c = index[t * 3 + 2] * 3;
        const q = (position[a] + position[b] + position[c] >= 0 ? 1 : 0) + (position[a + 2] + position[b + 2] + position[c + 2] >= 0 ? 2 : 0);
        quarterOf[t] = q;
        counts[q]++;
        grow(bounds, q * 6, position, a);
        grow(bounds, q * 6, position, b);
        grow(bounds, q * 6, position, c);
    }
    const next = [0, counts[0], counts[0] + counts[1], counts[0] + counts[1] + counts[2]];
    const starts = next.slice();
    const copy = _indices;
    copy.set(index);
    for (let t = 0; t < triangles; t++) {
        const at = next[quarterOf[t]]++ * 3;
        index[at] = copy[t * 3];
        index[at + 1] = copy[t * 3 + 1];
        index[at + 2] = copy[t * 3 + 2];
    }
    const quarters = [];
    for (let q = 0; q < 4; q++) {
        if (counts[q] === 0) continue;
        const o = q * 6;
        const center = new Vector3((bounds[o] + bounds[o + 3]) / 2, (bounds[o + 1] + bounds[o + 4]) / 2, (bounds[o + 2] + bounds[o + 5]) / 2);
        const radius = Math.hypot(bounds[o + 3] - bounds[o], bounds[o + 4] - bounds[o + 1], bounds[o + 5] - bounds[o + 2]) / 2;
        quarters.push({ start: starts[q] * 3, count: counts[q] * 3, bounds: new Sphere(center, radius) });
    }
    geometry.userData.quarters = quarters;
    return quarters;
}

/** Grows box `o` in `bounds` (see regroupByQuarter) to take in the vertex at `v` in `position`. */
function grow(bounds, o, position, v) {
    const x = position[v];
    const y = position[v + 1];
    const z = position[v + 2];
    if (x < bounds[o]) bounds[o] = x;
    if (y < bounds[o + 1]) bounds[o + 1] = y;
    if (z < bounds[o + 2]) bounds[o + 2] = z;
    if (x > bounds[o + 3]) bounds[o + 3] = x;
    if (y > bounds[o + 4]) bounds[o + 4] = y;
    if (z > bounds[o + 5]) bounds[o + 5] = z;
}
