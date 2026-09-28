import { CHUNK_SIZE, HALF_CHUNK, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { isHungProp, settleProp } from './decorations.js';
import { EDIT_EDGE_X, EDIT_EDGE_Z, EDIT_LIGHT, EDIT_OUTLET, EDIT_PILLAR } from './edits.js';
import { PANELS_PER_SIDE } from './generator.js';
import { EDGE_NONE, EDGE_WALL, cellCoord, chunkCoord, chunkKey, edgeBoxes, pillarBox } from './grid.js';
import { HEIGHT_STEP, groundIn } from './ground.js';
import { levelById } from './levels.js';
import { decodeOutlet, encodeOutlet, outletSlot, seededOutlet } from './outlets.js';
import { balloonsOver, dressChunk, undressChunk } from './party.js';

/**
 * Source of truth for the world: walls, doorways, pillars, props and ceiling lights. See grid.js for how edges and
 * corners are addressed.
 *
 * Chunk (cx, cz) covers cells x ∈ [cx·16 − 8, cx·16 + 7] (same for z). Layouts come from the seed and chunk
 * coordinates, so the same seed always makes the same world. Chunks stay in memory once generated. They're about
 * 1 kB each so that's fine even after hours of play, and it means edits survive walking away.
 */
export class ChunkStore {
    /**
     * @param {number} seed
     * @param {import('./edits.js').EditLog | null} [edits] Edit mode's saved changes.
     * @param {import('./generator.js').WorldOptions} [options] Game mode tweaks to the level.
     */
    constructor(seed, edits = null, options = {}) {
        this.seed = seed >>> 0;
        this.edits = edits;
        this.options = options;
        /** Level id (see levels.js). Level Fun is a normal level with party dressing. */
        this.level = options.level ?? 0;
        this._generate = levelById(this.level).generate;
        this.pillarHalf = levelById(this.level).shape.pillarSize / 2;
        /** Anything that hangs below the ceiling on this level (see headroomAt). */
        this._headroom = levelById(this.level).shape.headroom;
        /** True if the seed places outlets. Edit mode can add them on any level. */
        this._seededOutlets = levelById(this.level).shape.outlets;
        /** Which light slots edit mode can switch (see `switchable` in levels.js). */
        this._switchable = levelById(this.level).switchable;
        /**
         * Called on every world change, for edit mode's undo (see EditHistory.js).
         * @type {((change: EditChange) => void) | null}
         */
        this.onChange = null;
        /** Level Fun: every chunk gets party dressing (see party.js). */
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
            if (this.edits) {
                // Copy of the generated state so EditLog.record can tell when an edit is undone back to it.
                chunk.generated ={ edgesX: chunk.edgesX.slice(), edgesZ: chunk.edgesZ.slice(), pillars: chunk.pillars.slice(), lights: chunk.lights.slice() };
                this.edits.applyTo(chunk);
            }
            this.chunks.set(key, chunk);
            // Sit props on uneven floors. Has to happen after the set so groundAt can find the chunk.
            if (chunk.ground) for (const prop of chunk.props) this.settle(prop);
            if (this.party) dressChunk(this, chunk);
        }
        return chunk;
    }

    /**
     * Adds or removes Level Fun's party dressing on every chunk. Walls and the level's own props don't change.
     * Anything already added to a chunk, like a tape's notes, is worked around.
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

    /** Redo party dressing after a chunk's walls change, e.g. a tape's exit opening. */
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

    /** @returns {boolean} true if it changed. */
    setEdge(x, z, axis, type) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const chunk = this.getChunk(cx, cz);
        const i = localIndex(x, z, cx, cz);
        const edges = axis === 0 ? chunk.edgesX : chunk.edgesZ;
        const before = edges[i];
        if (before === type) return false;
        edges[i] = type;
        const made = axis === 0 ? chunk.generated?.edgesX : chunk.generated?.edgesZ;
        this.edits?.record(cx, cz, axis === 0 ? EDIT_EDGE_X : EDIT_EDGE_Z, i, type, made?.[i] === type);
        this.onChange?.({ kind: 'edge', x, z, axis, before, after: type });
        // Anything hanging on the wall goes with it.
        if (type !== EDGE_WALL) this._unhang(x, z, axis);
        return true;
    }

    /** Removes hung props from both faces of the wall on the +x (axis 0) or +z (axis 1) side of cell (x, z). */
    _unhang(x, z, axis) {
        const line = (axis === 0 ? x : z) + 0.5;
        for (const [cellX, cellZ] of axis === 0 ? [[x, z], [x + 1, z]] : [[x, z], [x, z + 1]]) {
            for (const prop of [...this.propsAt(cellX, cellZ)]) {
                if (isHungProp(prop.type) && Math.abs((axis === 0 ? prop.x : prop.z) - line) < WALL_THICKNESS) this.removeProp(prop);
            }
        }
    }

    /** Edge between cell (x, z) and neighbor (x + dx, z + dz). Exactly one of dx, dz is ±1. */
    edgeBetween(x, z, dx, dz) {
        if (dx === 1) return this.edge(x, z, 0);
        if (dx === -1) return this.edge(x - 1, z, 0);
        if (dz === 1) return this.edge(x, z, 1);
        return this.edge(x, z - 1, 1);
    }

    /** Pillar at the corner (x + 0.5, z + 0.5). */
    pillar(x, z) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        return this.getChunk(cx, cz).pillars[localIndex(x, z, cx, cz)] === 1;
    }

    /** @returns {boolean} true if it changed. */
    setPillar(x, z, on) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const chunk = this.getChunk(cx, cz);
        const i = localIndex(x, z, cx, cz);
        const value = on ? 1 : 0;
        if (chunk.pillars[i] === value) return false;
        chunk.pillars[i] = value;
        this.edits?.record(cx, cz, EDIT_PILLAR, i, value, chunk.generated?.pillars[i] === value);
        this.onChange?.({ kind: 'pillar', x, z, before: !on, after: on });
        return true;
    }

    /**
     * Outlet on one face of the edge on the +x (axis 0) or +z (axis 1) side of cell (x, z), even if there's no wall.
     * Returns its offset from the wall's middle, or null.
     * @param {0 | 1} axis
     * @param {number} side 1 for the face toward +x (or +z), −1 for the other.
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
     * Places an outlet `along` the wall from its middle, or removes it with null.
     * @returns {boolean} true if it changed.
     */
    setOutlet(x, z, axis, side, along) {
        // Round to the position it'll have when edits are reloaded (see edits.js).
        const value = encodeOutlet(along);
        along = decodeOutlet(value);
        const before = this.outlet(x, z, axis, side);
        if (before === along) return false;
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const chunk = this.getChunk(cx, cz);
        const slot = outletSlot(localIndex(x, z, cx, cz), axis, side);
        (chunk.outlets ??= new Map()).set(slot, along);
        const seeded = this._seededOutlets ? seededOutlet(this.seed, x, z, axis, side) : null;
        this.edits?.record(cx, cz, EDIT_OUTLET, slot, value, encodeOutlet(seeded) === value);
        this.onChange?.({ kind: 'outlet', x, z, axis, side, before, after: along });
        return true;
    }

    /**
     * Props in cell (x, z). The returned array is reused between calls.
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
     * Must be inside its cell, same as generated props (see decorations.js).
     * @param {import('./decorations.js').Prop} prop
     */
    addProp(prop) {
        this.settle(prop);
        const cx = chunkCoord(cellCoord(prop.x));
        const cz = chunkCoord(cellCoord(prop.z));
        this.getChunk(cx, cz).props.push(prop);
        this.edits?.addProp(cx, cz, prop);
        this.onChange?.({ kind: 'prop', prop, added: true });
    }

    /**
     * Sits a prop on the floor if the floor isn't flat (see settleProp).
     * @param {import('./decorations.js').Prop} prop
     */
    settle(prop) {
        if (this.getChunk(chunkCoord(cellCoord(prop.x)), chunkCoord(cellCoord(prop.z))).ground) settleProp(prop, this.groundAt(prop.x, prop.z));
    }

    /**
     * Works for generated and placed props.
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
        this.onChange?.({ kind: 'prop', prop, added: false });
        return true;
    }

    /**
     * Light data for the panel over cell (x, z). Coordinates must be odd.
     * @returns {Uint8Array} 4 bytes at `this.panelOffset(x, z)`. See ChunkData.lights.
     */
    panelData(x, z) {
        return this.getChunk(chunkCoord(x), chunkCoord(z)).lights;
    }

    /**
     * [brightness, flicker] of the light over odd cell (x, z). 0 brightness is dead, 0 flicker is steady (see
     * ChunkData.lights).
     * @returns {[number, number]}
     */
    light(x, z) {
        const lights = this.panelData(x, z);
        const k = this.panelOffset(x, z);
        return [lights[k], lights[k + 2]];
    }

    /** True if the slot over odd cell (x, z) has a switchable light. */
    hasLight(x, z) {
        return this._switchable(this.getChunk(chunkCoord(x), chunkCoord(z)), this.panelOffset(x, z) / 4);
    }

    /**
     * Sets the light over odd cell (x, z) (see light). The caller has to update the GPU copy (see
     * PanelLightMap.writeChunk).
     * @returns {boolean} true if it changed.
     */
    setLight(x, z, brightness, flicker) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const chunk = this.getChunk(cx, cz);
        const k = this.panelOffset(x, z);
        const before = [chunk.lights[k], chunk.lights[k + 2]];
        if (before[0] === brightness && before[1] === flicker) return false;
        chunk.lights[k] = brightness;
        chunk.lights[k + 2] = flicker;
        const made = chunk.generated?.lights;
        this.edits?.record(cx, cz, EDIT_LIGHT, k / 4, brightness | (flicker << 8), made?.[k] === brightness && made?.[k + 2] === flicker);
        this.onChange?.({ kind: 'light', x, z, before, after: [brightness, flicker] });
        return true;
    }

    panelOffset(x, z) {
        const lx = x - chunkCoord(x) * CHUNK_SIZE + HALF_CHUNK;
        const lz = z - chunkCoord(z) * CHUNK_SIZE + HALF_CHUNK;
        return (((lx - 1) >> 1) * PANELS_PER_SIDE + ((lz - 1) >> 1)) * 4;
    }

    /**
     * Floor height at (x, z). Always 0 unless the level has uneven floors (Level 37, see ground.js).
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
     * Height of the lowest thing over (x, z): the ceiling, or anything hanging below it (Level 37's vaults and
     * arches, Level Fun's balloons). Jumps stop here (see Player).
     * @param {number} x
     * @param {number} z
     */
    headroomAt(x, z) {
        let top = this._headroom ? this._headroom(this, x, z) : WALL_HEIGHT;
        if (this.party) {
            // Balloons stay inside their cell, so only this chunk matters.
            const party = this.getChunk(chunkCoord(cellCoord(x)), chunkCoord(cellCoord(z))).party;
            if (party) top = Math.min(top, balloonsOver(party, x, z));
        }
        return top;
    }

    /**
     * Floor height of cell (x, z), or null on a stair (see ground.js).
     * @param {number} x
     * @param {number} z
     * @returns {number | null}
     */
    flatFloor(x, z) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const ground = this.getChunk(cx, cz).ground;
        if (!ground) return 0;
        const k = localIndex(x, z, cx, cz);
        return ground.stairs[k] === 0 ? ground.heights[k] * HEIGHT_STEP : null;
    }

    /**
     * Pool ladder within `reach` of (x, z) when (x, z) is on its water side (Level 37, see poolrooms.js).
     * @param {number} x
     * @param {number} z
     * @param {number} reach
     * @returns {import('./poolrooms.js').Ladder | null}
     */
    ladderAt(x, z, reach) {
        // Pools stay clear of chunk edges, so the ladder is always in the current chunk.
        const ladders = this.getChunk(chunkCoord(cellCoord(x)), chunkCoord(cellCoord(z))).ladders;
        if (!ladders) return null;
        for (const ladder of ladders) {
            const out = (x - ladder.x) * ladder.nx + (z - ladder.z) * ladder.nz;
            const side = (x - ladder.x) * ladder.nz - (z - ladder.z) * ladder.nx;
            if (out > 0 && out < reach && Math.abs(side) < 0.15) return ladder;
        }
        return null;
    }

    /** Area light at a point, 0..1, blended from the 4 nearest panels. Must match the shaders' version. */
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
     * Solid boxes (walls, door frames, pillars, solid props) that might overlap the rectangle, as
     * [minX, minZ, maxX, maxZ]. The returned array is reused between calls.
     * @param {boolean} [doorsSolid] Treat doorways as walls, for things too tall to fit through.
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
        // Props (and party tables and presents) stay inside their cell, so only the touched chunks need checking.
        for (let cx = chunkCoord(x0); cx <= chunkCoord(x1); cx++) {
            for (let cz = chunkCoord(z0); cz <= chunkCoord(z1); cz++) {
                const chunk = this.getChunk(cx, cz);
                for (const { box } of chunk.props) {
                    if (box && box[2] > minX && box[0] < maxX && box[3] > minZ && box[1] < maxZ) boxes.push(box);
                }
                for (const box of chunk.party?.boxes ?? []) {
                    if (box[2] > minX && box[0] < maxX && box[3] > minZ && box[1] < maxZ) boxes.push(box);
                }
                // Level solids like Level 1's cars also stay inside their chunk.
                for (const box of chunk.solids ?? []) {
                    if (box[2] > minX && box[0] < maxX && box[3] > minZ && box[1] < maxZ) boxes.push(box);
                }
            }
        }
        return boxes;
    }
}

/**
 * @typedef {{ kind: 'edge', x: number, z: number, axis: 0 | 1, before: number, after: number }
 *     | { kind: 'pillar', x: number, z: number, before: boolean, after: boolean }
 *     | { kind: 'outlet', x: number, z: number, axis: 0 | 1, side: number, before: number | null, after: number | null }
 *     | { kind: 'prop', prop: import('./decorations.js').Prop, added: boolean }
 *     | { kind: 'light', x: number, z: number, before: [number, number], after: [number, number] }} EditChange
 *     One world change.
 */

function localIndex(x, z, cx, cz) {
    return (x - cx * CHUNK_SIZE + HALF_CHUNK) * CHUNK_SIZE + (z - cz * CHUNK_SIZE + HALF_CHUNK);
}

export { cellCoord, chunkCoord, chunkKey } from './grid.js';
