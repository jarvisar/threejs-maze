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
import { PROP_CHAIR, PROP_NAMES, makeProp } from '../world/decorations.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, cellCoord, edgeBoxes, pillarBox } from '../world/grid.js';
import { LEVELS, levelById } from '../world/levels.js';
import { OUTLET_HEIGHT, OUTLET_WIDTH, OUTLET_Y, outletReach } from '../world/outlets.js';
import { PARTY_DECORATIONS } from '../world/party.js';
import { propBounds, propFootprint, propShapeKey, templateFor, uprightVariant } from '../world/props.js';
import { raycastWorld } from './raycast.js';

/**
 * @typedef {object} EditSection
 * @property {string | null} name
 * @property {readonly string[]} tools
 * @property {boolean} [levelFun] Only once Level Fun's been found (see setLevelFun).
 */

/**
 * What can be built, in sections for the tool strip: the level itself (unnamed), then each level's things to leave
 * lying about (see `decorations` in levels.js), and Level Fun's (see party.js), which can go down on any level.
 * @type {readonly EditSection[]}
 */
export const EDIT_SECTIONS = [
    { name: null, tools: ['wall', 'doorway', 'pillar', 'outlet'] },
    ...LEVELS.map((level) => ({ name: level.name, tools: level.decorations.map((type) => PROP_NAMES[type]) })),
    { name: 'Level Fun', tools: PARTY_DECORATIONS.map((type) => PROP_NAMES[type]), levelFun: true },
];
/** Every tool there is. */
export const EDIT_TOOLS = EDIT_SECTIONS.flatMap((section) => section.tools);
/** @type {Map<string, number>} */
const PROP_TOOLS = new Map(EDIT_SECTIONS.slice(1).flatMap((section) => section.tools.map((name) => [name, PROP_NAMES.indexOf(name)])));

// Outlines are a little bigger than what they outline, so their edges aren't hidden inside it.
const PAD = 0.014;
const OUTLET_PAD = 0.008;
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
const QUARTER_TURN = Math.PI / 2;
const _direction = new Vector3();

/**
 * For a prop, `current` is whether it's already there (rather than where a new one would go), and x, z is
 * its cell. The same for an outlet, on the `side` of the wall facing the aim, `along` it from its middle.
 * @typedef {{ kind: 'edge', x: number, z: number, axis: 0 | 1, current: number }
 *     | { kind: 'pillar', x: number, z: number, current: boolean }
 *     | { kind: 'prop', x: number, z: number, prop: import('../world/decorations.js').Prop, current: boolean }
 *     | { kind: 'outlet', x: number, z: number, axis: 0 | 1, side: number, along: number, current: boolean }} EditTarget
 */

/**
 * Edit mode: aim at something and left click to remove it; right click builds with the current tool.
 * Aiming at the floor picks the nearest cell border (or corner, for pillars), where a preview shows what
 * would be built. Building on an existing wall turns it into a doorway and back.
 *
 * The other tools put things down (a chair, a monitor...) where the aim meets the floor, kept inside that
 * cell and facing whoever put them there. Aiming at one, with any tool, picks it to be removed. The outlet
 * tool puts one on the side of a wall aimed at, or picks the one that's there.
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
            // Across x, standing half its depth out from the wall (see _showOutlet).
            outlet: outline(new BoxGeometry(OUTLET_WIDTH + OUTLET_PAD, OUTLET_HEIGHT + OUTLET_PAD, OUTLET_PAD).translate(0, OUTLET_Y, 0)),
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
        /** The sections there are to pick from: not Level Fun's until it's been found. */
        this.sections = EDIT_SECTIONS;
        this.setLevelFun(false);
        /** @type {EditTarget | null} */
        this.target = null;
        /** How far away the aim landed, or null if it didn't reach anything. */
        this.hitDistance = null;
        // The next prop put down: a new one after each, so a row of them isn't all the same.
        this._variant = randomVariant();
    }

    get tool() {
        return this._tools[this.toolIndex];
    }

    /** Which of `sections` the tool is in. */
    get section() {
        return this._starts.findLastIndex((start) => start <= this.toolIndex);
    }

    /**
     * Level Fun's things to pick from as well, once it's been found (or not). The tool in hand stays in hand, if it
     * still can be.
     * @param {boolean} found
     */
    setLevelFun(found) {
        const tool = this._tools?.[this.toolIndex];
        this.sections = EDIT_SECTIONS.filter((section) => found || !section.levelFun);
        this._tools = this.sections.flatMap((section) => section.tools);
        // Where each section starts in _tools, and the tool last picked in each, to go back to.
        this._starts = this.sections.map((_, k) => this.sections.slice(0, k).reduce((sum, section) => sum + section.tools.length, 0));
        this._sectionTools = [...this._starts];
        this.toolIndex = Math.max(this._tools.indexOf(tool), 0);
        this._sectionTools[this.section] = this.toolIndex;
    }

    /** @param {number} direction +1 or −1 */
    cycleTool(direction = 1) {
        this.toolIndex = (this.toolIndex + direction + this._tools.length) % this._tools.length;
        this._sectionTools[this.section] = this.toolIndex;
        return this.tool;
    }

    /**
     * Over to the next section (or back to the one before), to the tool last picked in it.
     * @param {number} direction +1 or −1
     */
    cycleSection(direction = 1) {
        const count = this.sections.length;
        this.toolIndex = this._sectionTools[(this.section + direction + count) % count];
        return this.tool;
    }

    /** Shows every outline at once (used to compile their shaders behind the loading screen). */
    showAll() {
        for (const shape of Object.values(this.shapes)) shape.visible = true;
        this.shapes.wall.material = this.materials.build;
        this.shapes.doorway.material = this.materials.select;
        this.shapes.pillar.material = this.materials.build;
        this.shapes.outlet.material = this.materials.build;
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
        let hit = raycastWorld(p.x, p.y, p.z, _direction.x, _direction.y, _direction.z, EDIT_REACH, store, pickBox);
        // On through the water, to anything lying on the bottom of a pool (Level 37's).
        if (hit?.kind === 'floor' && _direction.y < 0 && levelById(store.level).water) {
            const [hx, , hz] = hit.point;
            const depth = -store.groundAt(hx, hz);
            if (depth > 0) {
                const reach = Math.min(depth / -_direction.y + PICK_PAD, EDIT_REACH - hit.distance);
                const under = raycastWorld(hx, -1e-6, hz, _direction.x, _direction.y, _direction.z, reach, store, pickBox);
                if (under?.kind === 'prop') hit = { ...under, distance: hit.distance + under.distance };
            }
        }

        this.target = null;
        this.hitDistance = hit ? hit.distance : null;
        if (hit) {
            const [hx, , hz] = hit.point;
            const propType = PROP_TOOLS.get(this.tool);
            if (hit.kind === 'prop') {
                this.target = { kind: 'prop', x: hit.x, z: hit.z, prop: /** @type {import('../world/decorations.js').Prop} */ (hit.prop), current: true };
            } else if (hit.kind === 'pillar') {
                this.target = { kind: 'pillar', x: hit.x, z: hit.z, current: true };
            } else if (this.tool === 'outlet') {
                // On a wall; a doorway aimed at can still be removed.
                if (hit.kind === 'edge') {
                    const current = store.edge(hit.x, hit.z, hit.axis);
                    this.target = current === EDGE_WALL
                        ? this._outlet(hit.x, hit.z, hit.axis, hx, hz, p, store)
                        : { kind: 'edge', x: hit.x, z: hit.z, axis: hit.axis, current };
                }
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
        else if (target.kind === 'outlet') changed = target.current && store.setOutlet(target.x, target.z, target.axis, target.side, null);
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
        if (target.kind === 'outlet') {
            changed = !target.current && store.setOutlet(target.x, target.z, target.axis, target.side, target.along);
            return changed ? { x: target.x, z: target.z } : null;
        }
        // With a prop or an outlet in hand, a wall or pillar aimed at is only there to be removed.
        if (PROP_TOOLS.has(this.tool) || this.tool === 'outlet') return null;
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
        let yaw = Math.atan2(-_direction.x, -_direction.z);
        const variant = uprightVariant(type, this._variant);
        // What it covers, relative to where it stands.
        let [x0, z0, x1, z1] = propFootprint(makeProp(type, 0, 0, yaw, variant));
        const reach = cornerReach(store.pillarHalf);
        if (Math.max(x1 - x0, z1 - z0) > 2 * WALL_REACH || Math.min(x1 - x0, z1 - z0) > 2 * reach) {
            // Too long to fit in the cell at an angle, clear of the corners (a bay of racking): square to the walls.
            yaw = Math.round(yaw / QUARTER_TURN) * QUARTER_TURN;
            [x0, z0, x1, z1] = propFootprint(makeProp(type, 0, 0, yaw, variant));
        }
        // (Racking is even a hair longer than the room between two walls: it goes in the middle.)
        let ox = x1 - x0 > 2 * WALL_REACH ? -(x0 + x1) / 2 : Math.min(Math.max(hx - x, -WALL_REACH - x0), WALL_REACH - x1);
        let oz = z1 - z0 > 2 * WALL_REACH ? -(z0 + z1) / 2 : Math.min(Math.max(hz - z, -WALL_REACH - z0), WALL_REACH - z1);
        // Into a corner as well: out along whichever way is the shorter move (or the only way, for something
        // too long to keep clear of the corners the other way).
        const pastX = pastLimit(ox + x0, ox + x1, reach);
        const pastZ = pastLimit(oz + z0, oz + z1, reach);
        if (pastX !== 0 && pastZ !== 0) {
            const alongX = x1 - x0 <= 2 * reach && (z1 - z0 > 2 * reach || Math.abs(pastX) < Math.abs(pastZ));
            if (alongX) ox -= pastX;
            else oz -= pastZ;
        }
        const prop = makeProp(type, x + ox, z + oz, yaw, variant);
        store.settle(prop);
        return fits(prop, store, playerPosition) ? { kind: 'prop', x, z, prop, current: false } : null;
    }

    /**
     * An outlet on the side facing the eye of the wall on the +x (axis 0) or +z (axis 1) side of cell (x, z): the one
     * there, or a new one where the aim met the wall at (hx, hz), kept clear of the wall's ends.
     * @param {0 | 1} axis
     * @param {import('three').Vector3} eye
     * @returns {EditTarget}
     */
    _outlet(x, z, axis, hx, hz, eye, store) {
        const side = (axis === 0 ? eye.x - (x + 0.5) : eye.z - (z + 0.5)) >= 0 ? 1 : -1;
        const existing = store.outlet(x, z, axis, side);
        if (existing !== null) return { kind: 'outlet', x, z, axis, side, along: existing, current: true };
        const reach = outletReach(store.pillarHalf);
        const along = Math.min(Math.max(axis === 0 ? hz - z : hx - x, -reach), reach);
        return { kind: 'outlet', x, z, axis, side, along, current: false };
    }

    _showTarget(above) {
        for (const shape of Object.values(this.shapes)) shape.visible = false;
        const target = this.target;
        if (!target) return;
        if (target.kind === 'prop') {
            this._showProp(target.prop, target.current);
            return;
        }
        if (target.kind === 'outlet') {
            this._showOutlet(target);
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
        shape.position.set(prop.x, (prop.y ?? 0) + OUTLINE_INSET, prop.z);
        shape.rotation.y = prop.yaw;
        shape.scale.setScalar(PROP_OUTLINE_SCALE);
        shape.material = exists ? this.materials.select : this.materials.build;
        shape.visible = true;
        shape.updateMatrix();
    }

    /** @param {Extract<EditTarget, { kind: 'outlet' }>} target */
    _showOutlet({ x, z, axis, side, along, current }) {
        const shape = this.shapes.outlet;
        // On the face of the wall, half its thickness out from the middle of it.
        const face = 0.5 + (side * WALL_THICKNESS) / 2;
        if (axis === 0) shape.position.set(x + face, 0, z + along);
        else shape.position.set(x + along, 0, z + face);
        shape.rotation.y = axis === 0 ? Math.PI / 2 : 0;
        shape.material = current ? this.materials.select : this.materials.build;
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
