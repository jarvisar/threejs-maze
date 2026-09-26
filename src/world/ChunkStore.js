import { CHUNK_SIZE, HALF_CHUNK } from '../config.js';
import { settleProp } from './decorations.js';
import { EDIT_EDGE_X, EDIT_EDGE_Z, EDIT_OUTLET, EDIT_PILLAR } from './edits.js';
import { PANELS_PER_SIDE } from './generator.js';
import { EDGE_NONE, EDGE_WALL, cellCoord, chunkCoord, chunkKey, edgeBoxes, pillarBox } from './grid.js';
import { groundIn } from './ground.js';
import { levelById } from './levels.js';
import { decodeOutlet, encodeOutlet, outletSlot, seededOutlet } from './outlets.js';
import { dressChunk, undressChunk } from './party.js';

/**
 * The world's source of truth: where the walls, doorways and pillars are, and the state of every ceiling
 * light. See grid.js for how edges and corners are addressed.
 *
 * Chunk (cx, cz) covers cells x ∈ [cx·16 − 8, cx·16 + 7] (same for z), so its centre sits near (cx·16, cz·16).
 * Chunk layouts are derived from the world seed and the chunk's coordinates, so the same seed always
 * produces the same world. Generated (and edited) chunks are kept in memory; at about 1 kB each that is
 * negligible even after hours of exploring, and it means edits survive walking away and coming back.
 */
export class ChunkStore {
    /**
     * @param {number} seed
     * @param {import('./edits.js').EditLog | null} [edits] Where changes made in edit mode are kept.
     * @param {import('./generator.js').WorldOptions} [options] A game mode's changes to the level.
     */
    constructor(seed, edits = null, options = {}) {
        this.seed = seed >>> 0;
        this.edits = edits;
        this.options = options;
        /** Which level this is (see levels.js). Level Fun is a level dressed for a party. */
        this.level = options.level ?? 0;
        this._generate = levelById(this.level).generate;
        /** Half the width of the level's pillars. */
        this.pillarHalf = levelById(this.level).shape.pillarSize / 2;
        /** Whether the seed puts outlets on its walls (edit mode can put them on any level's). */
        this._seededOutlets = levelById(this.level).shape.outlets ?? true;
        /** Level Fun: every chunk dressed for the party (see party.js). */
        this.party = false;
        /** @type {Map<number, import('./generator.js').ChunkData>} */
        this.chunks = new Map();
        /** @type {number[][]} */
        this._boxes = [];
        /** @type {import('./decorations.js').Prop[]} */
        this._props = [];
    }

    /** @returns {import('./generator.js').ChunkData} The chunk (generated on first access). */
    getChunk(cx, cz) {
        const key = chunkKey(cx, cz);
        let chunk = this.chunks.get(key);
        if (chunk === undefined) {
            chunk = this._generate(this.seed, cx, cz, this.options);
            this.edits?.applyTo(chunk);
            this.chunks.set(key, chunk);
            // Props put down on a floor that isn't flat stand on it (the chunk's in place now for groundAt).
            if (chunk.ground) for (const prop of chunk.props) this.settle(prop);
            if (this.party) dressChunk(this, chunk);
        }
        return chunk;
    }

    /**
     * Dresses every chunk for Level Fun, or takes it all down again. The walls and the level's own props don't
     * change, so the world stays the same world underneath. (Anything added to a chunk before this, like a
     * tape's notes, is worked around.)
     * @param {boolean} on
     */
    setParty(on) {
        if (on === this.party) return;
        this.party = on;
        for (const chunk of this.chunks.values()) {
            if (on) dressChunk(this, chunk);
            else undressChunk(chunk);
        }
    }

    /** Dresses a chunk again after its walls have changed (a tape's way out opening), if it's dressed. */
    redress(cx, cz) {
        const chunk = this.chunks.get(chunkKey(cx, cz));
        if (this.party && chunk) dressChunk(this, chunk);
    }

    /**
     * The edge on the +x side (axis 0) or +z side (axis 1) of cell (x, z).
     * @returns {number} EDGE_NONE, EDGE_WALL or EDGE_DOOR.
     */
    edge(x, z, axis) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const chunk = this.getChunk(cx, cz);
        const i = localIndex(x, z, cx, cz);
        return axis === 0 ? chunk.edgesX[i] : chunk.edgesZ[i];
    }

    /**
     * Changes an edge.
     * @returns {boolean} true if it changed.
     */
    setEdge(x, z, axis, type) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const chunk = this.getChunk(cx, cz);
        const i = localIndex(x, z, cx, cz);
        const edges = axis === 0 ? chunk.edgesX : chunk.edgesZ;
        if (edges[i] === type) return false;
        edges[i] = type;
        this.edits?.record(cx, cz, axis === 0 ? EDIT_EDGE_X : EDIT_EDGE_Z, i, type);
        return true;
    }

    /** The edge between cell (x, z) and its neighbour (x + dx, z + dz), where exactly one of dx, dz is ±1. */
    edgeBetween(x, z, dx, dz) {
        if (dx === 1) return this.edge(x, z, 0);
        if (dx === -1) return this.edge(x - 1, z, 0);
        if (dz === 1) return this.edge(x, z, 1);
        return this.edge(x, z - 1, 1);
    }

    /** Whether the corner at (x + 0.5, z + 0.5) holds a pillar. */
    pillar(x, z) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        return this.getChunk(cx, cz).pillars[localIndex(x, z, cx, cz)] === 1;
    }

    /** @returns {boolean} true if it changed. */
    setPillar(x, z, on) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const pillars = this.getChunk(cx, cz).pillars;
        const i = localIndex(x, z, cx, cz);
        const value = on ? 1 : 0;
        if (pillars[i] === value) return false;
        pillars[i] = value;
        this.edits?.record(cx, cz, EDIT_PILLAR, i, value);
        return true;
    }

    /**
     * The outlet on one side of the wall on the +x side (axis 0) or +z side (axis 1) of cell (x, z), whether or not
     * there's a wall there: how far along from the wall's middle it is, or null if there's none.
     * @param {0 | 1} axis
     * @param {number} side 1 on the side facing +x (or +z), −1 on the other.
     * @returns {number | null}
     */
    outlet(x, z, axis, side) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const edited = this.getChunk(cx, cz).outlets?.get(outletSlot(localIndex(x, z, cx, cz), axis, side));
        if (edited !== undefined) return edited;
        return this._seededOutlets ? seededOutlet(this.seed, x, z, axis, side) : null;
    }

    /**
     * Puts an outlet up (`along` its wall from the middle), or takes it down (null).
     * @returns {boolean} true if it changed.
     */
    setOutlet(x, z, axis, side, along) {
        // Where it'll be when the edits are loaded again (see edits.js).
        const value = encodeOutlet(along);
        along = decodeOutlet(value);
        if (this.outlet(x, z, axis, side) === along) return false;
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const chunk = this.getChunk(cx, cz);
        const slot = outletSlot(localIndex(x, z, cx, cz), axis, side);
        (chunk.outlets ??= new Map()).set(slot, along);
        this.edits?.record(cx, cz, EDIT_OUTLET, slot, value);
        return true;
    }

    /**
     * The props standing in cell (x, z). The returned array is reused between calls.
     * @returns {import('./decorations.js').Prop[]}
     */
    propsAt(x, z) {
        const props = this._props;
        props.length = 0;
        for (const prop of this.getChunk(chunkCoord(x), chunkCoord(z)).props) {
            if (cellCoord(prop.x) === x && cellCoord(prop.z) === z) props.push(prop);
        }
        return props;
    }

    /**
     * Puts a prop down. Like the generated ones, it has to be inside its cell (see decorations.js).
     * @param {import('./decorations.js').Prop} prop
     */
    addProp(prop) {
        this.settle(prop);
        const cx = chunkCoord(cellCoord(prop.x));
        const cz = chunkCoord(cellCoord(prop.z));
        this.getChunk(cx, cz).props.push(prop);
        this.edits?.addProp(cx, cz, prop);
    }

    /**
     * Stands a prop on the floor where it is, on a level where that isn't flat (see settleProp).
     * @param {import('./decorations.js').Prop} prop
     */
    settle(prop) {
        if (this.getChunk(chunkCoord(cellCoord(prop.x)), chunkCoord(cellCoord(prop.z))).ground) settleProp(prop, this.groundAt(prop.x, prop.z));
    }

    /**
     * Takes a prop away, whether the chunk was generated with it or it was put down.
     * @param {import('./decorations.js').Prop} prop
     * @returns {boolean} true if it was there.
     */
    removeProp(prop) {
        const cx = chunkCoord(cellCoord(prop.x));
        const cz = chunkCoord(cellCoord(prop.z));
        const props = this.getChunk(cx, cz).props;
        const i = props.indexOf(prop);
        if (i < 0) return false;
        props.splice(i, 1);
        this.edits?.removeProp(cx, cz, prop);
        return true;
    }

    /**
     * The light data of the ceiling panel above cell (x, z), which must have odd coordinates.
     * @returns {Uint8Array} Four bytes starting at `this.panelOffset(x, z)`; see ChunkData.lights.
     */
    panelData(x, z) {
        return this.getChunk(chunkCoord(x), chunkCoord(z)).lights;
    }

    panelOffset(x, z) {
        const lx = x - chunkCoord(x) * CHUNK_SIZE + HALF_CHUNK;
        const lz = z - chunkCoord(z) * CHUNK_SIZE + HALF_CHUNK;
        return (((lx - 1) >> 1) * PANELS_PER_SIDE + ((lz - 1) >> 1)) * 4;
    }

    /**
     * The height of the floor at (x, z): 0, but on a level whose floor goes up and down (Level 37's; see ground.js).
     * @param {number} x
     * @param {number} z
     */
    groundAt(x, z) {
        const cellX = cellCoord(x);
        const cellZ = cellCoord(z);
        const cx = chunkCoord(cellX);
        const cz = chunkCoord(cellZ);
        const ground = this.getChunk(cx, cz).ground;
        return ground ? groundIn(ground, localIndex(cellX, cellZ, cx, cz), x - cellX, z - cellZ) : 0;
    }

    /**
     * A ladder out of a pool within `reach` of (x, z), on the water's side of it (Level 37's; see poolrooms.js), or null.
     * @param {number} x
     * @param {number} z
     * @param {number} reach
     * @returns {import('./poolrooms.js').Ladder | null}
     */
    ladderAt(x, z, reach) {
        // Pools keep clear of their chunk's edge, so a ladder you're at is in the chunk you're in.
        const ladders = this.getChunk(chunkCoord(cellCoord(x)), chunkCoord(cellCoord(z))).poolrooms?.ladders;
        if (!ladders) return null;
        for (const ladder of ladders) {
            const out = (x - ladder.x) * ladder.nx + (z - ladder.z) * ladder.nz;
            const side = (x - ladder.x) * ladder.nz - (z - ladder.z) * ladder.nx;
            if (out > 0 && out < reach && Math.abs(side) < 0.15) return ladder;
        }
        return null;
    }

    /**
     * How lit the area around a point is, 0..1: the panels' area light, blended between the four nearest
     * panels. (The shaders do exactly the same with the copy of this data on the GPU.)
     */
    areaLight(x, z) {
        const u = (x - 1) / 2;
        const v = (z - 1) / 2;
        const i = Math.floor(u);
        const j = Math.floor(v);
        const fu = u - i;
        const fv = v - j;
        const px = i * 2 + 1;
        const pz = j * 2 + 1;
        const at = (x0, z0) => this.panelData(x0, z0)[this.panelOffset(x0, z0) + 1] / 255;
        const a = at(px, pz);
        const b = at(px + 2, pz);
        const c = at(px, pz + 2);
        const d = at(px + 2, pz + 2);
        return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
    }

    /**
     * Every solid box (walls, doorway sides, pillars, and the things on the floor you can't walk through)
     * that might overlap the given rectangle, as [minX, minZ, maxX, maxZ]. The returned array is reused
     * between calls.
     * @param {boolean} [doorsSolid] Treat doorways as solid walls (for someone too tall to fit under them).
     */
    boxesNear(minX, minZ, maxX, maxZ, doorsSolid = false) {
        const boxes = this._boxes;
        boxes.length = 0;
        const x0 = Math.floor(minX) - 1;
        const x1 = Math.ceil(maxX) + 1;
        const z0 = Math.floor(minZ) - 1;
        const z1 = Math.ceil(maxZ) + 1;
        for (let x = x0; x <= x1; x++) {
            for (let z = z0; z <= z1; z++) {
                const ex = this.edge(x, z, 0);
                if (ex !== EDGE_NONE) edgeBoxes(x, z, 0, doorsSolid ? EDGE_WALL : ex, boxes);
                const ez = this.edge(x, z, 1);
                if (ez !== EDGE_NONE) edgeBoxes(x, z, 1, doorsSolid ? EDGE_WALL : ez, boxes);
                if (this.pillar(x, z)) boxes.push(pillarBox(x, z, this.pillarHalf));
            }
        }
        // Props keep inside their cell, so only the chunks the rectangle touches can hold one that overlaps. (The
        // same goes for the party's tables and presents.)
        for (let cx = chunkCoord(x0); cx <= chunkCoord(x1); cx++) {
            for (let cz = chunkCoord(z0); cz <= chunkCoord(z1); cz++) {
                const chunk = this.getChunk(cx, cz);
                for (const { box } of chunk.props) {
                    if (box && box[2] > minX && box[0] < maxX && box[3] > minZ && box[1] < maxZ) boxes.push(box);
                }
                for (const box of chunk.party?.boxes ?? []) {
                    if (box[2] > minX && box[0] < maxX && box[3] > minZ && box[1] < maxZ) boxes.push(box);
                }
                // (And anything solid of the level's own, like Level 1's cars, which keep inside their chunk.)
                for (const box of chunk.solids ?? []) {
                    if (box[2] > minX && box[0] < maxX && box[3] > minZ && box[1] < maxZ) boxes.push(box);
                }
            }
        }
        return boxes;
    }
}

function localIndex(x, z, cx, cz) {
    return (x - cx * CHUNK_SIZE + HALF_CHUNK) * CHUNK_SIZE + (z - cz * CHUNK_SIZE + HALF_CHUNK);
}

export { cellCoord, chunkCoord, chunkKey } from './grid.js';
