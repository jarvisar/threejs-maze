import { BoxGeometry, EdgesGeometry, Group, LineSegments, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    DOOR_HEIGHT,
    DOOR_WIDTH,
    EDIT_REACH,
    EYE_HEIGHT,
    PILLAR_SIZE,
    PLAYER_RADIUS,
    WALL_HEIGHT,
    WALL_THICKNESS,
} from '../config.js';
import { PROP_BOTTLES, PROP_CHAIR, PROP_MONITOR, PROP_SIGN, makeProp } from '../world/decorations.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, cellCoord, edgeBoxes, pillarBox } from '../world/grid.js';
import { propBounds, propFootprint, propShapeKey, templateFor, uprightVariant } from '../world/props.js';
import { raycastWorld } from './raycast.js';

// What can be built, in two groups for the tool strip: the level itself, then things to leave lying about
// (see decorations.js; not the fallen ceiling tile, which belongs under the hole it came from).
export const EDIT_TOOL_GROUPS = /** @type {const} */ ([['wall', 'doorway', 'pillar'], ['chair', 'monitor', 'bottles', 'sign']]);
export const EDIT_TOOLS = EDIT_TOOL_GROUPS.flat();
/** @type {Map<string, number>} */
const PROP_TOOLS = new Map([['chair', PROP_CHAIR], ['monitor', PROP_MONITOR], ['bottles', PROP_BOTTLES], ['sign', PROP_SIGN]]);

// Outlines are a little bigger than what they outline, so their edges aren't hidden inside it.
const PAD = 0.014;
const OUTLINE_INSET = 0.003;
const PROP_OUTLINE_SCALE = 1.04;
// Outlines of props that have been aimed at are kept for next time, but not all of them: bottles come in too
// many arrangements.
const MAX_PROP_OUTLINES = 8;
// How far a prop put down keeps from the walls and pillars, which have baseboards standing a little proud of them.
const CLEARANCE = 0.015;
// From the middle of a cell to the nearest a prop may come to a wall, or to the corner a pillar could be on.
const WALL_REACH = 0.5 - WALL_THICKNESS / 2 - CLEARANCE;
// (Less where the level's pillars are bigger than Level 0's; see levels.js.)
const cornerReach = (pillarHalf) => 0.5 - pillarHalf - CLEARANCE;
// Props are aimed at as a slightly bigger box than they are, so that a lone bottle isn't fiddly to hit.
const PICK_PAD = 0.01;
const PICK_MIN_HALF = 0.04;
const _direction = new Vector3();

/**
 * For a prop, `current` is whether it's already there (rather than where a new one would go), and x, z is
 * its cell.
 * @typedef {{ kind: 'edge', x: number, z: number, axis: 0 | 1, current: number }
 *     | { kind: 'pillar', x: number, z: number, current: boolean }
 *     | { kind: 'prop', x: number, z: number, prop: import('../world/decorations.js').Prop, current: boolean }} EditTarget
 */

/**
 * Edit mode: aim at something and left click to remove it; right click builds with the current tool.
 * Aiming at the floor picks the nearest cell border (or corner, for pillars), where a preview shows what
 * would be built. Building on an existing wall turns it into a doorway and back.
 *
 * The other tools put things down (a chair, a monitor...) where the aim meets the floor, kept inside that
 * cell and facing whoever put them there. Aiming at one, with any tool, picks it to be removed.
 */
export class EditTool {
    /**
     * @param {import('three').Scene} scene
     * @param {{ build: import('three').Material, select: import('three').Material }} materials
     */
    constructor(scene, materials) {
        this.materials = materials;
        /** Half the width of the pillars of the level being edited. */
        this._pillarHalf = PILLAR_SIZE / 2;
        this.group = new Group();
        this.group.name = 'edit outline';
        this.shapes = {
            wall: outline(new BoxGeometry(1 + WALL_THICKNESS + PAD, WALL_HEIGHT, WALL_THICKNESS + PAD)),
            doorway: outline(doorwayGeometry()),
            pillar: outline(new BoxGeometry(PILLAR_SIZE + PAD, WALL_HEIGHT, PILLAR_SIZE + PAD)),
            // Its geometry is the outline of whichever prop is aimed at (see _showProp).
            prop: new LineSegments(),
        };
        for (const shape of [this.shapes.wall, this.shapes.doorway, this.shapes.pillar]) shape.geometry.translate(0, WALL_HEIGHT / 2, 0);
        for (const shape of Object.values(this.shapes)) {
            shape.visible = false;
            this.group.add(shape);
        }
        scene.add(this.group);
        /** @type {Map<string, EdgesGeometry>} */
        this._propOutlines = new Map();
        this._propOutlineKey = '';
        this._setPropOutline(makeProp(PROP_CHAIR, 0, 0, 0, 1));

        this.toolIndex = 0;
        /** @type {EditTarget | null} */
        this.target = null;
        /** How far away the aim landed, or null if it didn't reach anything. */
        this.hitDistance = null;
        // The next prop put down: a new one after each, so a row of them isn't all the same.
        this._variant = randomVariant();
    }

    get tool() {
        return EDIT_TOOLS[this.toolIndex];
    }

    /** @param {number} direction +1 or −1 */
    cycleTool(direction = 1) {
        this.toolIndex = (this.toolIndex + direction + EDIT_TOOLS.length) % EDIT_TOOLS.length;
        return this.tool;
    }

    /** Shows every outline at once (used to compile their shaders behind the loading screen). */
    showAll() {
        for (const shape of Object.values(this.shapes)) shape.visible = true;
        this.shapes.wall.material = this.materials.build;
        this.shapes.doorway.material = this.materials.select;
        this.shapes.pillar.material = this.materials.build;
        this.shapes.prop.material = this.materials.build;
    }

    /**
     * Re-aims from the camera. Call every frame while edit mode is on.
     * @param {import('three').Camera} camera Or a VR controller's aim.
     * @param {import('../world/ChunkStore.js').ChunkStore} store
     * @param {import('three').Vector3 | null} [playerPosition] Nothing is put down where it would be in the way.
     */
    update(camera, store, playerPosition = null) {
        this._pillarHalf = store.pillarHalf;
        camera.getWorldDirection(_direction);
        const p = camera.position;
        const hit = raycastWorld(p.x, p.y, p.z, _direction.x, _direction.y, _direction.z, EDIT_REACH, store, pickBox);

        this.target = null;
        this.hitDistance = hit ? hit.distance : null;
        if (hit) {
            const [hx, , hz] = hit.point;
            const propType = PROP_TOOLS.get(this.tool);
            if (hit.kind === 'prop') {
                this.target = { kind: 'prop', x: hit.x, z: hit.z, prop: /** @type {import('../world/decorations.js').Prop} */ (hit.prop), current: true };
            } else if (hit.kind === 'pillar') {
                this.target = { kind: 'pillar', x: hit.x, z: hit.z, current: true };
            } else if (propType !== undefined) {
                // Things go down on the floor; a wall aimed at can still be removed.
                if (hit.kind === 'floor') this.target = this._placement(propType, hx, hz, store, playerPosition);
                else if (hit.kind === 'edge') this.target = { kind: 'edge', x: hit.x, z: hit.z, axis: hit.axis, current: store.edge(hit.x, hit.z, hit.axis) };
            } else if (this.tool === 'pillar') {
                // The corner nearest to where the ray landed.
                const x = Math.floor(hx);
                const z = Math.floor(hz);
                this.target = { kind: 'pillar', x, z, current: store.pillar(x, z) };
            } else if (hit.kind === 'edge') {
                this.target = { kind: 'edge', x: hit.x, z: hit.z, axis: hit.axis, current: store.edge(hit.x, hit.z, hit.axis) };
            } else {
                const edge = nearestEdge(hx, hz);
                this.target = { ...edge, kind: 'edge', current: store.edge(edge.x, edge.z, edge.axis) };
            }
        }
        this._showTarget(p.y > WALL_HEIGHT);
    }

    hide() {
        for (const shape of Object.values(this.shapes)) shape.visible = false;
        this.target = null;
    }

    /** @returns {{ x: number, z: number } | null} The cell whose surroundings changed. */
    remove(store) {
        const target = this.target;
        if (!target) return null;
        let changed;
        if (target.kind === 'prop') changed = target.current && store.removeProp(target.prop);
        else if (target.kind === 'pillar') changed = store.setPillar(target.x, target.z, false);
        else changed = store.setEdge(target.x, target.z, target.axis, EDGE_NONE);
        return changed ? { x: target.x, z: target.z } : null;
    }

    /**
     * Builds with the current tool at the target.
     * @param {import('three').Vector3} playerPosition
     * @returns {{ x: number, z: number } | null} The cell whose surroundings changed.
     */
    place(store, playerPosition) {
        const target = this.target;
        if (!target) return null;
        let changed = false;
        if (target.kind === 'prop') {
            // Checked again: the player may have moved since it was aimed.
            if (target.current || !fits(target.prop, store, playerPosition)) return null;
            store.addProp(target.prop);
            this._variant = randomVariant();
            return { x: target.x, z: target.z };
        }
        // With a prop in hand, a wall or pillar aimed at is only there to be removed.
        if (PROP_TOOLS.has(this.tool)) return null;
        if (target.kind === 'pillar') {
            if (target.current || overlapsPlayer([pillarBox(target.x, target.z, store.pillarHalf)], playerPosition)) return null;
            changed = store.setPillar(target.x, target.z, true);
        } else {
            // Building on a wall with the wall tool (or a doorway with the doorway tool) swaps the two.
            let type = this.tool === 'doorway' ? EDGE_DOOR : EDGE_WALL;
            if (target.current === type) type = type === EDGE_WALL ? EDGE_DOOR : EDGE_WALL;
            // Only a new wall, or a doorway where there was nothing, adds anything solid.
            const boxes = [];
            edgeBoxes(target.x, target.z, target.axis, type, boxes);
            if ((type === EDGE_WALL || target.current === EDGE_NONE) && overlapsPlayer(boxes, playerPosition)) return null;
            changed = store.setEdge(target.x, target.z, target.axis, type);
        }
        return changed ? { x: target.x, z: target.z } : null;
    }

    /**
     * Where a new prop would go, aiming at (hx, hz) on the floor: as near there as it can be while keeping
     * inside the cell, clear of its walls and of the pillars that could be on its corners (so it never ends
     * up inside one built later), and facing back along the aim. Null if it would be in the way of the
     * player or of another prop.
     * @returns {EditTarget | null}
     */
    _placement(type, hx, hz, store, playerPosition) {
        const x = cellCoord(hx);
        const z = cellCoord(hz);
        const yaw = Math.atan2(-_direction.x, -_direction.z);
        const variant = uprightVariant(type, this._variant);
        // What it covers, relative to where it stands.
        const [x0, z0, x1, z1] = propFootprint(makeProp(type, 0, 0, yaw, variant));
        let ox = Math.min(Math.max(hx - x, -WALL_REACH - x0), WALL_REACH - x1);
        let oz = Math.min(Math.max(hz - z, -WALL_REACH - z0), WALL_REACH - z1);
        // Into a corner as well: out along whichever way is the shorter move.
        const pastX = pastLimit(ox + x0, ox + x1, cornerReach(store.pillarHalf));
        const pastZ = pastLimit(oz + z0, oz + z1, cornerReach(store.pillarHalf));
        if (pastX !== 0 && pastZ !== 0) {
            if (Math.abs(pastX) < Math.abs(pastZ)) ox -= pastX;
            else oz -= pastZ;
        }
        const prop = makeProp(type, x + ox, z + oz, yaw, variant);
        return fits(prop, store, playerPosition) ? { kind: 'prop', x, z, prop, current: false } : null;
    }

    _showTarget(above) {
        for (const shape of Object.values(this.shapes)) shape.visible = false;
        const target = this.target;
        if (!target) return;
        if (target.kind === 'prop') {
            this._showProp(target.prop, target.current);
            return;
        }

        let shape;
        let exists;
        if (target.kind === 'pillar') {
            shape = this.shapes.pillar;
            exists = target.current;
            shape.position.set(target.x + 0.5, 0, target.z + 0.5);
            shape.rotation.y = 0;
            // As big as the level's pillars.
            const scale = (this._pillarHalf * 2 + PAD) / (PILLAR_SIZE + PAD);
            shape.scale.set(scale, 1, scale);
        } else {
            exists = target.current !== EDGE_NONE;
            const type = exists ? target.current : this.tool === 'doorway' ? EDGE_DOOR : EDGE_WALL;
            shape = type === EDGE_DOOR ? this.shapes.doorway : this.shapes.wall;
            // The shapes run along x; edges on axis 0 run along z.
            if (target.axis === 0) shape.position.set(target.x + 0.5, 0, target.z);
            else shape.position.set(target.x, 0, target.z + 0.5);
            shape.rotation.y = target.axis === 0 ? Math.PI / 2 : 0;
        }
        shape.material = exists ? this.materials.select : this.materials.build;
        shape.visible = true;
        // Keep the top/bottom edges just off the floor and ceiling (or just above the wall tops when
        // looking down from above) so they don't z-fight with those surfaces.
        shape.position.y = OUTLINE_INSET;
        shape.scale.y = above ? 1 : (WALL_HEIGHT - 2 * OUTLINE_INSET) / WALL_HEIGHT;
        shape.updateMatrix();
    }

    /** The outline of a prop: the edges of its own shape, placed and turned just as it is (or will be). */
    _showProp(prop, exists) {
        const shape = this.shapes.prop;
        this._setPropOutline(prop);
        shape.position.set(prop.x, OUTLINE_INSET, prop.z);
        shape.rotation.y = prop.yaw;
        shape.scale.setScalar(PROP_OUTLINE_SCALE);
        shape.material = exists ? this.materials.select : this.materials.build;
        shape.visible = true;
        shape.updateMatrix();
    }

    _setPropOutline(prop) {
        const key = propShapeKey(prop);
        if (key === this._propOutlineKey) return;
        const outlines = this._propOutlines;
        let geometry = outlines.get(key);
        if (!geometry) {
            geometry = new EdgesGeometry(templateFor(prop));
            outlines.set(key, geometry);
        }
        this.shapes.prop.geometry = geometry;
        this._propOutlineKey = key;
        if (outlines.size > MAX_PROP_OUTLINES) {
            // The oldest, which can't be the one just put up.
            const [oldest, old] = outlines.entries().next().value;
            outlines.delete(oldest);
            old.dispose();
        }
    }
}

function outline(geometry) {
    const lines = new LineSegments(new EdgesGeometry(geometry));
    geometry.dispose();
    return lines;
}

/** A wall with a doorway through it, running along x, as three boxes (two sides and the lintel). */
function doorwayGeometry() {
    const length = 1 + WALL_THICKNESS + PAD;
    const side = (length - DOOR_WIDTH) / 2;
    const depth = WALL_THICKNESS + PAD;
    const parts = [
        new BoxGeometry(side, DOOR_HEIGHT, depth).translate(-(DOOR_WIDTH + side) / 2, DOOR_HEIGHT / 2 - WALL_HEIGHT / 2, 0),
        new BoxGeometry(side, DOOR_HEIGHT, depth).translate((DOOR_WIDTH + side) / 2, DOOR_HEIGHT / 2 - WALL_HEIGHT / 2, 0),
        new BoxGeometry(length, WALL_HEIGHT - DOOR_HEIGHT, depth).translate(0, (DOOR_HEIGHT + WALL_HEIGHT) / 2 - WALL_HEIGHT / 2, 0),
    ];
    const merged = mergeGeometries(parts.map((part) => part.toNonIndexed()));
    for (const part of parts) part.dispose();
    return merged;
}

/** The border of the cell under (x, z) that's closest to that point. */
function nearestEdge(x, z) {
    const cx = Math.floor(x + 0.5);
    const cz = Math.floor(z + 0.5);
    const options = [
        [cx + 0.5 - x, cx, cz, 0],
        [x - (cx - 0.5), cx - 1, cz, 0],
        [cz + 0.5 - z, cx, cz, 1],
        [z - (cz - 0.5), cx, cz - 1, 1],
    ];
    options.sort((a, b) => a[0] - b[0]);
    const [, ex, ez, axis] = options[0];
    return { x: ex, z: ez, axis: /** @type {0 | 1} */ (axis) };
}

function overlapsPlayer(boxes, player) {
    if (player.y - EYE_HEIGHT >= WALL_HEIGHT) return false; // flying above the walls
    const r = PLAYER_RADIUS;
    return boxes.some(([minX, minZ, maxX, maxZ]) =>
        player.x + r > minX && player.x - r < maxX && player.z + r > minZ && player.z - r < maxZ);
}

/**
 * Whether a prop can go where it is: not where the player stands, and not into another prop (which all keep
 * inside their own cells, so only this cell's could be in the way).
 * @param {import('../world/decorations.js').Prop} prop
 * @param {import('../world/ChunkStore.js').ChunkStore} store
 * @param {import('three').Vector3 | null} player
 */
function fits(prop, store, player) {
    const footprint = propFootprint(prop);
    if (player && overlapsPlayer([footprint], player)) return false;
    for (const other of store.propsAt(cellCoord(prop.x), cellCoord(prop.z))) {
        const [minX, minZ, maxX, maxZ] = propFootprint(other);
        if (footprint[2] > minX && footprint[0] < maxX && footprint[3] > minZ && footprint[1] < maxZ) return false;
    }
    return true;
}

/** How far the span min..max goes past ±limit: positive past +limit, negative past −limit, 0 if it doesn't. */
function pastLimit(min, max, limit) {
    if (max > limit) return max - limit;
    if (min < -limit) return min + limit;
    return 0;
}

/** @type {WeakMap<import('../world/decorations.js').Prop, number[]>} */
const pickBoxes = new WeakMap();

/** What the aim hits a prop as (see PICK_PAD): its box, a little bigger. */
function pickBox(prop) {
    let box = pickBoxes.get(prop);
    if (!box) {
        const [x0, y0, z0, x1, y1, z1] = propBounds(prop);
        const grow = (min, max) => {
            const half = Math.max((max - min) / 2 + PICK_PAD, PICK_MIN_HALF);
            return [(min + max) / 2 - half, (min + max) / 2 + half];
        };
        const [minX, maxX] = grow(x0, x1);
        const [minZ, maxZ] = grow(z0, z1);
        box = [minX, y0, minZ, maxX, Math.max(y1 + PICK_PAD, 2 * PICK_MIN_HALF), maxZ];
        pickBoxes.set(prop, box);
    }
    return box;
}

function randomVariant() {
    return (Math.random() * 4294967296) >>> 0;
}
