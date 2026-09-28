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
import { PALM_WALL, PROP_CHAIR, PROP_GUEST, PROP_NAMES, PROP_PALM, isHungProp, makeProp } from '../world/decorations.js';
import { DIRECTIONS, EDGE_DOOR, EDGE_NONE, EDGE_WALL, cellCoord, chunkCoord, edgeBoxes, pillarBox } from '../world/grid.js';
import { LEVELS_IN_ORDER, levelById } from '../world/levels.js';
import { OUTLET_HEIGHT, OUTLET_WIDTH, OUTLET_Y, outletReach } from '../world/outlets.js';
import { GUEST_POP, PARTY_DECORATIONS } from '../world/party.js';
import { propBounds, propFootprint, propGlowTemplate, propShapeKey, propVertexCount, templateFor, uprightVariant } from '../world/props.js';
import { hashInts } from '../world/random.js';
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
    { name: null, tools: ['wall', 'doorway', 'pillar', 'outlet', 'light'] },
    ...LEVELS_IN_ORDER.map((level) => ({ name: level.name, tools: level.decorations.map((type) => PROP_NAMES[type]) })),
    { name: 'Level Fun', tools: PARTY_DECORATIONS.map((type) => PROP_NAMES[type]), levelFun: true },
];
/** Every tool there is. */
export const EDIT_TOOLS = EDIT_SECTIONS.flatMap((section) => section.tools);
/** @type {Map<string, number>} */
const PROP_TOOLS = new Map(EDIT_SECTIONS.slice(1).flatMap((section) => section.tools.map((name) => [name, PROP_NAMES.indexOf(name)])));

/** The kind of prop a tool puts down (see PROP_NAMES), or undefined for one that builds the level itself. */
export function toolProp(tool) {
    return PROP_TOOLS.get(tool);
}

// Outlines are a little bigger than what they outline, so their edges aren't hidden inside it.
const PAD = 0.014;
const OUTLET_PAD = 0.008;
const OUTLINE_INSET = 0.003;
const PROP_OUTLINE_SCALE = 1.04;
// Outlines of props aimed at are kept for next time, but not all of them: bottles come in too many arrangements.
const MAX_PROP_OUTLINES = 8;
// How far a prop put down keeps from the walls and pillars, which have baseboards standing a little proud of them.
const CLEARANCE = 0.015;
// From the middle of a cell to the nearest a prop may come to a wall, or to the corner a pillar could be on.
const WALL_REACH = 0.5 - WALL_THICKNESS / 2 - CLEARANCE;
// (Less where the level's pillars are bigger than Level 0's, see levels.js.)
const cornerReach = (pillarHalf) => 0.5 - pillarHalf - CLEARANCE;
// How near a wall's face the aim has to land for what's put down to go up against it, its back to the wall.
const SNAP = 0.18;
// Aiming at a wall with something to put down on the floor puts it at the foot of the wall: this far out from its middle.
const FOOT = WALL_THICKNESS / 2 + 0.06;
// How far off a wall's face what hangs on it stands (it's a hair proud of it, so it isn't in it).
const HANG_OFF = 0.002;
// Props are aimed at as a slightly bigger box than they are, so that a lone bottle isn't fiddly to hit.
const PICK_PAD = 0.01;
const PICK_MIN_HALF = 0.04;
const QUARTER_TURN = Math.PI / 2;
// What's put down is turned an eighth at a time (see rotate).
const TURNS = 8;
/**
 * How many vertices what's been put down in one chunk can come to (see propVertexCount): a couple hundred
 * things, or a few dozen of the heaviest. Past that, a change to the chunk would take too long to rebuild in
 * the frame it happens, and drawing it would cost more than a chunk should.
 */
const PLACED_VERTICES = 150000;
// How many guests can be put down in one chunk: each is drawn on its own (it turns to watch you).
const GUESTS_PER_CHUNK = 6;
// How far out of reach a guest is put down (see GUEST_POP), so it doesn't pop as soon as it's there.
const GUEST_ROOM = 0.1;
// A light switched on is as bright as a new one. One made to flicker is just as bright, in a pattern of its own.
const LIGHT_ON = 255;
// How a light's outline sits under the ceiling: its size across, and how deep.
const LIGHT_OUTLINE = 0.3;
const LIGHT_OUTLINE_DEPTH = 0.03;
const _direction = new Vector3();

/**
 * For a prop, `current` is whether it's already there (rather than where a new one would go), and x, z is
 * its cell. A new one aimed at a wall has that wall as its `edge`, which removing removes too. The same for
 * an outlet: `side` is which side of the wall it's on, `along` is how far along from its middle. A light is
 * the slot over cell (x, z) (see ChunkData.lights), and how it is.
 * @typedef {{ kind: 'edge', x: number, z: number, axis: 0 | 1, current: number }
 *     | { kind: 'pillar', x: number, z: number, current: boolean }
 *     | { kind: 'prop', x: number, z: number, prop: import('../world/decorations.js').Prop, current: boolean, edge?: { kind: 'edge', x: number, z: number, axis: 0 | 1, current: number } }
 *     | { kind: 'outlet', x: number, z: number, axis: 0 | 1, side: number, along: number, current: boolean }
 *     | { kind: 'light', x: number, z: number, brightness: number, flicker: number }} EditTarget
 */

/**
 * Why nothing's aimed at, when that's worth saying: what's in hand won't go where it's aimed (in the way of something,
 * or of you), it hangs on a wall and the aim's on the floor, the light's in hand and the aim's not on the ceiling, or
 * there's no light there to switch, or the chunk has as much put down in it as it can take.
 * @typedef {'room' | 'wall' | 'ceiling' | 'light' | 'full' | null} Blocked
 */

/**
 * Edit mode: aim at something and left click to remove it; right click builds with the current tool.
 * Aiming at the floor picks the nearest cell border (or corner, for pillars), where a preview shows what
 * would be built. Building on an existing wall turns it into a doorway and back.
 *
 * The other tools put things down (a chair, a monitor...) where the aim meets the floor, kept inside that
 * cell and facing whoever put them there; or, aimed near a wall, up against it and facing away from it. Each can be
 * turned an eighth at a time (rotate), and given another look (restyle). Aiming at one, with any tool, picks it to be
 * removed, or copied (copy). What hangs on a wall (a clock, a portrait) goes up where the aim meets a wall. The outlet
 * tool puts one on the side of a wall aimed at, or picks the one that's there; the light tool switches on the light in
 * the ceiling nearest the aim, makes it flicker and stop again, and removing switches it off.
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
            // Round a light slot, just under the ceiling.
            light: outline(new BoxGeometry(LIGHT_OUTLINE, LIGHT_OUTLINE_DEPTH, LIGHT_OUTLINE).translate(0, WALL_HEIGHT - LIGHT_OUTLINE_DEPTH / 2 - OUTLINE_INSET, 0)),
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
        /** @type {Blocked} */
        this.blocked = null;
        /** How far away the aim landed, or null if it didn't reach anything. */
        this.hitDistance = null;
        /** How far what's put down is turned from how it would face, in eighths of a turn (see rotate). */
        this.turn = 0;
        // The next prop put down: a new one after each, so a row of them isn't all the same, unless it's a copy.
        this._variant = randomVariant();
        // Put down exactly as it is (see copy): not stood up, and the same again after each.
        this._exact = false;
    }

    get tool() {
        return this._tools[this.toolIndex];
    }

    /** Which of `sections` the tool is in. */
    get section() {
        return this._starts.findLastIndex((start) => start <= this.toolIndex);
    }

    /** The tools there are to pick from, in order (every section's, one after another). */
    get tools() {
        return this._tools;
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
        return this._pick((this.toolIndex + direction + this._tools.length) % this._tools.length);
    }

    /**
     * Over to the next section (or back to the one before), to the tool last picked in it.
     * @param {number} direction +1 or −1
     */
    cycleSection(direction = 1) {
        const count = this.sections.length;
        return this._pick(this._sectionTools[(this.section + direction + count) % count]);
    }

    /**
     * Takes up a tool by its name (from the catalogue).
     * @param {string} tool
     * @returns {boolean} Whether it's one there is to pick.
     */
    select(tool) {
        const index = this._tools.indexOf(tool);
        if (index < 0) return false;
        this._pick(index);
        return true;
    }

    _pick(index) {
        if (index !== this.toolIndex && this._exact) {
            this._exact = false;
            this._variant = randomVariant();
        }
        this.toolIndex = index;
        this._sectionTools[this.section] = index;
        return this.tool;
    }

    /**
     * Turns what's put down an eighth of a turn (−1 the other way). Something too long to fit a cell at an angle only
     * goes round a quarter at a time.
     * @param {number} [direction]
     */
    rotate(direction = 1) {
        this.turn = (this.turn + direction + TURNS) % TURNS;
    }

    /** Another look for what's put down next (see a prop's variant), if it has more than one. */
    restyle() {
        this._variant = randomVariant();
        this._exact = false;
    }

    /**
     * Takes up the tool for what's aimed at, to make another like it: a prop that looks exactly like it (until another
     * tool's taken up, or another look; see restyle), or a wall, a doorway, a pillar, an outlet or a light.
     * @returns {string | null} The tool, or null if there's nothing aimed at, or no tool makes it (a fallen tile).
     */
    copy() {
        // (Aimed at a wall with something to put down, it's the wall.)
        const target = this.target?.kind === 'prop' && !this.target.current ? this.target.edge ?? null : this.target;
        if (!target) return null;
        let tool = target.kind;
        if (target.kind === 'prop') {
            if (!target.current || !this.select(PROP_NAMES[target.prop.type])) return null;
            this._variant = target.prop.variant;
            this._exact = true;
            return this.tool;
        }
        if (target.kind === 'edge') {
            if (target.current === EDGE_NONE) return null;
            tool = target.current === EDGE_DOOR ? 'doorway' : 'wall';
        } else if (target.kind === 'pillar' || target.kind === 'outlet') {
            if (!target.current) return null;
        }
        return this.select(tool) ? tool : null;
    }

    /** Shows every outline at once (used to compile their shaders behind the loading screen). */
    showAll() {
        for (const shape of Object.values(this.shapes)) shape.visible = true;
        this.shapes.wall.material = this.materials.build;
        this.shapes.doorway.material = this.materials.select;
        this.shapes.pillar.material = this.materials.build;
        this.shapes.outlet.material = this.materials.build;
        this.shapes.light.material = this.materials.select;
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
        this.blocked = null;
        this.hitDistance = hit ? hit.distance : null;
        if (hit) {
            const [hx, , hz] = hit.point;
            const propType = PROP_TOOLS.get(this.tool);
            const edgeAt = (x, z, axis) => ({ kind: 'edge', x, z, axis, current: store.edge(x, z, axis) });
            if (hit.kind === 'prop') {
                this.target = { kind: 'prop', x: hit.x, z: hit.z, prop: /** @type {import('../world/decorations.js').Prop} */ (hit.prop), current: true };
            } else if (hit.kind === 'pillar') {
                this.target = { kind: 'pillar', x: hit.x, z: hit.z, current: true };
            } else if (this.tool === 'light') {
                // The light nearest where the aim meets the ceiling (or, from over the walls, the floor); a wall aimed
                // at can still be removed.
                if (hit.kind === 'edge') this.target = edgeAt(hit.x, hit.z, hit.axis);
                else if (hit.kind === 'ceiling' || p.y > WALL_HEIGHT) this.target = this._light(hx, hz, store);
                else this.blocked = 'ceiling';
            } else if (this.tool === 'outlet') {
                // On a wall; a doorway aimed at can still be removed.
                if (hit.kind === 'edge') {
                    this.target = store.edge(hit.x, hit.z, hit.axis) === EDGE_WALL
                        ? this._outlet(hit.x, hit.z, hit.axis, hx, hz, p, store)
                        : edgeAt(hit.x, hit.z, hit.axis);
                }
            } else if (propType !== undefined && isHungProp(propType)) {
                // Up on a wall (which can still be removed); a doorway aimed at can be removed.
                if (hit.kind === 'edge') {
                    const edge = edgeAt(hit.x, hit.z, hit.axis);
                    const hung = edge.current === EDGE_WALL ? this._hung(propType, hit.x, hit.z, hit.axis, hx, hz, p, store) : null;
                    this.target = hung ? { ...hung, edge } : edge;
                } else {
                    this.blocked = 'wall';
                }
            } else if (propType !== undefined) {
                // Things go down on the floor; aimed at a wall, at the foot of it on this side, up against it (and the
                // wall can still be removed).
                if (hit.kind === 'floor') this.target = this._placement(propType, hx, hz, store, playerPosition);
                else if (hit.kind === 'edge') {
                    const edge = edgeAt(hit.x, hit.z, hit.axis);
                    const line = (hit.axis === 0 ? hit.x : hit.z) + 0.5;
                    const foot = line + ((hit.axis === 0 ? p.x : p.z) >= line ? 1 : -1) * FOOT;
                    const placed = hit.axis === 0 ? this._placement(propType, foot, hz, store, playerPosition) : this._placement(propType, hx, foot, store, playerPosition);
                    this.target = placed ? { ...placed, edge } : edge;
                }
            } else if (this.tool === 'pillar') {
                // The corner nearest to where the ray landed.
                const x = Math.floor(hx);
                const z = Math.floor(hz);
                this.target = { kind: 'pillar', x, z, current: store.pillar(x, z) };
            } else if (hit.kind === 'edge') {
                this.target = edgeAt(hit.x, hit.z, hit.axis);
            } else {
                const { x, z, axis } = nearestEdge(hx, hz);
                this.target = edgeAt(x, z, axis);
            }
        }
        this._showTarget(p.y > WALL_HEIGHT, p);
    }

    hide() {
        for (const shape of Object.values(this.shapes)) shape.visible = false;
        this.target = null;
        this.blocked = null;
    }

    /**
     * Removes what's aimed at (or switches off the light).
     * @param {import('../world/ChunkStore.js').ChunkStore} store
     * @returns {{ x: number, z: number } | null} The cell whose surroundings changed.
     */
    remove(store) {
        // (Aimed at a wall with something to put down, it's the wall.)
        const target = this.target?.kind === 'prop' ? this.target.edge ?? this.target : this.target;
        if (!target) return null;
        let changed;
        if (target.kind === 'prop') changed = target.current && store.removeProp(target.prop);
        else if (target.kind === 'outlet') changed = target.current && store.setOutlet(target.x, target.z, target.axis, target.side, null);
        else if (target.kind === 'light') changed = store.setLight(target.x, target.z, 0, 0);
        else if (target.kind === 'pillar') changed = store.setPillar(target.x, target.z, false);
        else changed = store.setEdge(target.x, target.z, target.axis, EDGE_NONE);
        return changed ? { x: target.x, z: target.z } : null;
    }

    /**
     * Builds with the current tool at the target.
     * @param {import('../world/ChunkStore.js').ChunkStore} store
     * @param {import('three').Vector3} playerPosition
     * @returns {{ x: number, z: number } | null} The cell whose surroundings changed.
     */
    place(store, playerPosition) {
        const target = this.target;
        if (!target) return null;
        let changed = false;
        if (target.kind === 'prop') {
            // Checked again: the player may have moved since it was aimed.
            if (target.current || !fits(target.prop, store, playerPosition) || !roomFor(target.prop, store)) return null;
            store.addProp(target.prop);
            if (!this._exact) this._variant = randomVariant();
            return { x: target.x, z: target.z };
        }
        if (target.kind === 'outlet') {
            changed = !target.current && store.setOutlet(target.x, target.z, target.axis, target.side, target.along);
            return changed ? { x: target.x, z: target.z } : null;
        }
        if (target.kind === 'light') {
            const [brightness, flicker] = nextLight(store, target);
            return store.setLight(target.x, target.z, brightness, flicker) ? { x: target.x, z: target.z } : null;
        }
        // With a prop, an outlet or the light in hand, a wall or pillar aimed at is only there to be removed.
        if (PROP_TOOLS.has(this.tool) || this.tool === 'outlet' || this.tool === 'light') return null;
        if (target.kind === 'pillar') {
            // Not where walls meet, where it'd be half inside them (the level never puts one there either).
            if (target.current || !this._pillarFits(store, target, playerPosition)) return null;
            changed = store.setPillar(target.x, target.z, true);
        } else {
            const type = this._edgeType(target);
            if (type === null || !edgeFits(store, target, type, playerPosition)) return null;
            changed = store.setEdge(target.x, target.z, target.axis, type);
        }
        return changed ? { x: target.x, z: target.z } : null;
    }

    /**
     * Whether a button held down may act on what's aimed at now, as it sweeps over one thing after another: building
     * only where there's nothing yet (never turning a wall into a doorway and back, or switching a light on and off
     * again), and removing anything.
     * @param {'build' | 'remove'} action
     */
    repeatable(action) {
        const target = action === 'remove' && this.target?.kind === 'prop' ? this.target.edge ?? this.target : this.target;
        if (!target || target.kind === 'light') return false;
        if (action === 'remove') return target.kind === 'edge' ? target.current !== EDGE_NONE : target.current === true;
        return target.kind === 'edge' ? target.current === EDGE_NONE : !target.current;
    }

    /**
     * A name for what building (or with `remove`, removing) acts on, the same while it's the same thing: to act on each
     * thing only once in a sweep.
     * @param {boolean} [remove]
     */
    targetKey(remove = false) {
        const target = remove && this.target?.kind === 'prop' ? this.target.edge ?? this.target : this.target;
        if (!target) return '';
        if (target.kind === 'prop') return target.current ? `prop ${target.prop.x} ${target.prop.z} ${target.prop.type}` : `new ${target.x} ${target.z}`;
        if (target.kind === 'edge' || target.kind === 'outlet') return `${target.kind} ${target.x} ${target.z} ${target.axis}`;
        return `${target.kind} ${target.x} ${target.z}`;
    }

    /**
     * What the buttons do to what's aimed at, in a few words each for the display under the crosshair (see Hud): what
     * building does (null for nothing), what removing does, and else why there's nothing to do.
     * @returns {{ build: string | null, remove: string | null, note: string | null }}
     */
    describe() {
        const target = this.target;
        const notes = { room: 'NO ROOM', wall: 'AIM AT A WALL', ceiling: 'AIM AT A LIGHT', light: 'NO LIGHT', full: 'CHUNK FULL' };
        // (Why what's in hand can't go where it's aimed, even where something else there can be removed.)
        const none = { build: null, remove: null, note: this.blocked ? notes[this.blocked] : null };
        if (!target) return none;
        const upper = (text) => text.toUpperCase();
        if (target.kind === 'prop') {
            const name = upper(PROP_NAMES[target.prop.type]);
            if (target.current) return { ...none, remove: `REMOVE ${name}` };
            const wall = target.edge ? `REMOVE ${target.edge.current === EDGE_DOOR ? 'DOORWAY' : 'WALL'}` : null;
            return { ...none, build: `${isHungProp(target.prop.type) ? 'HANG' : 'PLACE'} ${name}`, remove: wall };
        }
        if (target.kind === 'outlet') return target.current ? { ...none, remove: 'REMOVE OUTLET' } : { ...none, build: 'PLACE OUTLET' };
        if (target.kind === 'light') {
            if (target.brightness === 0) return { ...none, build: 'LIGHT ON' };
            return { ...none, build: target.flicker === 0 ? 'FLICKER' : 'STEADY', remove: 'LIGHT OFF' };
        }
        if (target.kind === 'pillar') return target.current ? { ...none, remove: 'REMOVE PILLAR' } : { ...none, build: 'BUILD PILLAR' };
        const building = !PROP_TOOLS.has(this.tool) && this.tool !== 'outlet' && this.tool !== 'light' ? this._edgeType(target) : null;
        const names = { [EDGE_WALL]: 'WALL', [EDGE_DOOR]: 'DOORWAY' };
        return {
            build: building === null ? null : target.current === EDGE_NONE ? `BUILD ${names[building]}` : `MAKE ${names[building]}`,
            remove: target.current === EDGE_NONE ? null : `REMOVE ${names[target.current]}`,
            note: none.note,
        };
    }

    /** What building on an edge makes of it with the tool in hand: a wall or a doorway (the other, over one of them). */
    _edgeType(target) {
        let type = this.tool === 'doorway' ? EDGE_DOOR : EDGE_WALL;
        // Building on a wall with the wall tool (or a doorway with the doorway tool) swaps the two.
        if (target.current === type) type = type === EDGE_WALL ? EDGE_DOOR : EDGE_WALL;
        return type;
    }

    _pillarFits(store, target, playerPosition) {
        return !wallsMeetAt(store, target.x, target.z) && !overlapsPlayer([pillarBox(target.x, target.z, store.pillarHalf)], playerPosition);
    }

    /**
     * Where a new prop would go, aiming at (hx, hz) on the floor: as near there as it can be while keeping
     * inside the cell, clear of its walls and of the pillars that could be on its corners (so it never ends
     * up inside one built later), and facing back along the aim; or, aimed near a wall, up against it and facing away
     * from it. Turned as far as rotate has it. Null if it would be in the way of the player or of another prop, or if
     * the chunk has as much in it as it can take.
     * @returns {EditTarget | null}
     */
    _placement(type, hx, hz, store, playerPosition) {
        const x = cellCoord(hx);
        const z = cellCoord(hz);
        // The wall it goes up against, if the aim's near one: the way to it.
        let wall = null;
        let nearest = SNAP;
        for (const [dx, dz] of DIRECTIONS) {
            if (store.edgeBetween(x, z, dx, dz) !== EDGE_WALL) continue;
            const off = 0.5 - WALL_THICKNESS / 2 - (dx !== 0 ? (hx - x) * dx : (hz - z) * dz);
            if (off < nearest) {
                nearest = off;
                wall = [dx, dz];
            }
        }
        let yaw = (wall ? Math.atan2(-wall[0], -wall[1]) : Math.atan2(-_direction.x, -_direction.z)) + (this.turn * Math.PI * 2) / TURNS;
        let variant = this._exact ? this._variant : uprightVariant(type, this._variant);
        // A palm against a wall spreads over the floor in front of it, not into the wall.
        if (type === PROP_PALM && !this._exact) variant = (wall && this.turn === 0 ? variant | PALM_WALL : variant & ~PALM_WALL) >>> 0;
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
        // Against the wall: right up to it.
        if (wall?.[0] && x1 - x0 <= 2 * WALL_REACH) ox = wall[0] > 0 ? WALL_REACH - x1 : -WALL_REACH - x0;
        if (wall?.[1] && z1 - z0 <= 2 * WALL_REACH) oz = wall[1] > 0 ? WALL_REACH - z1 : -WALL_REACH - z0;
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
        if (!fits(prop, store, playerPosition)) {
            this.blocked = 'room';
            return null;
        }
        if (!roomFor(prop, store)) {
            this.blocked = 'full';
            return null;
        }
        return { kind: 'prop', x, z, prop, current: false };
    }

    /**
     * Where something that hangs on a wall would go, aimed at (hx, hz) on the wall on the +x (axis 0) or +z (axis 1)
     * side of cell (x, z): on the side of it facing the eye, where it's aimed, as far along as it can go without
     * reaching its ends (where pillars could be), and facing out of it. Null where it won't fit (see _placement).
     * @param {number} type
     * @param {0 | 1} axis
     * @param {import('three').Vector3} eye
     * @returns {EditTarget | null}
     */
    _hung(type, x, z, axis, hx, hz, eye, store) {
        const side = (axis === 0 ? eye.x - (x + 0.5) : eye.z - (z + 0.5)) >= 0 ? 1 : -1;
        const yaw = axis === 0 ? (side * Math.PI) / 2 : side > 0 ? 0 : Math.PI;
        const variant = this._exact ? this._variant : uprightVariant(type, this._variant);
        const [x0, , , x1] = propBounds(makeProp(type, 0, 0, 0, variant));
        const reach = Math.max(0, 0.5 - store.pillarHalf - CLEARANCE - Math.max(-x0, x1));
        const face = 0.5 + side * (WALL_THICKNESS / 2 + HANG_OFF);
        const along = Math.min(Math.max(axis === 0 ? hz - z : hx - x, -reach), reach);
        const prop = axis === 0 ? makeProp(type, x + face, z + along, yaw, variant) : makeProp(type, x + along, z + face, yaw, variant);
        if (!fits(prop, store, null)) {
            this.blocked = 'room';
            return null;
        }
        if (!roomFor(prop, store)) {
            this.blocked = 'full';
            return null;
        }
        return { kind: 'prop', x: cellCoord(prop.x), z: cellCoord(prop.z), prop, current: false };
    }

    /**
     * The light slot nearest (hx, hz) (they're over the cells with odd coordinates), if there's a light in it to switch.
     * @returns {EditTarget | null}
     */
    _light(hx, hz, store) {
        const x = 2 * Math.round((hx - 1) / 2) + 1;
        const z = 2 * Math.round((hz - 1) / 2) + 1;
        if (!store.hasLight(x, z)) {
            this.blocked = 'light';
            return null;
        }
        const [brightness, flicker] = store.light(x, z);
        return { kind: 'light', x, z, brightness, flicker };
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

    _showTarget(above, eye) {
        for (const shape of Object.values(this.shapes)) shape.visible = false;
        const target = this.target;
        if (!target) return;
        if (target.kind === 'prop') {
            this._showProp(target.prop, target.current, eye);
            return;
        }
        if (target.kind === 'outlet') {
            this._showOutlet(target);
            return;
        }
        if (target.kind === 'light') {
            const shape = this.shapes.light;
            shape.position.set(target.x, 0, target.z);
            shape.material = target.brightness > 0 ? this.materials.select : this.materials.build;
            shape.visible = true;
            shape.updateMatrix();
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

    /**
     * The outline of a prop: the edges of its own shape, placed and turned just as it is (or will be). A guest that's
     * there has turned to watch you (see PartyLayer.js).
     */
    _showProp(prop, exists, eye) {
        const shape = this.shapes.prop;
        this._setPropOutline(prop);
        shape.position.set(prop.x, (prop.y ?? 0) + OUTLINE_INSET, prop.z);
        shape.rotation.y = exists && prop.type === PROP_GUEST ? Math.atan2(eye.x - prop.x, eye.z - prop.z) : prop.yaw;
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
            geometry = propEdges(prop);
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

/** The edges of a prop's shape (what gives off light of its own too), for its outline. */
function propEdges(prop) {
    const edges = new EdgesGeometry(templateFor(prop));
    const glow = propGlowTemplate(prop);
    if (!glow) return edges;
    const lit = new EdgesGeometry(glow);
    const merged = /** @type {import('three').BufferGeometry} */ (mergeGeometries([edges, lit]));
    edges.dispose();
    lit.dispose();
    return /** @type {EdgesGeometry} */ (merged);
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

/** Whether any wall or doorway comes to the corner on the +x+z side of cell (x, z). */
function wallsMeetAt(store, x, z) {
    return store.edge(x, z, 0) !== EDGE_NONE || store.edge(x, z + 1, 0) !== EDGE_NONE || store.edge(x, z, 1) !== EDGE_NONE || store.edge(x + 1, z, 1) !== EDGE_NONE;
}

/**
 * Whether an edge can become `type`: not a new wall or doorway into a pillar at either end of it, and nothing solid
 * where the player is (only a new wall, or a doorway where there was nothing, adds anything solid).
 */
function edgeFits(store, target, type, playerPosition) {
    const ends = target.axis === 0 ? [[target.x, target.z - 1], [target.x, target.z]] : [[target.x - 1, target.z], [target.x, target.z]];
    if (target.current === EDGE_NONE && ends.some(([x, z]) => store.pillar(x, z))) return false;
    const boxes = [];
    edgeBoxes(target.x, target.z, target.axis, type, boxes);
    return !((type === EDGE_WALL || target.current === EDGE_NONE) && overlapsPlayer(boxes, playerPosition));
}

function overlapsPlayer(boxes, player) {
    if (!player || player.y - EYE_HEIGHT >= WALL_HEIGHT) return false; // flying above the walls
    const r = PLAYER_RADIUS;
    return boxes.some(([minX, minZ, maxX, maxZ]) =>
        player.x + r > minX && player.x - r < maxX && player.z + r > minZ && player.z - r < maxZ);
}

/**
 * Whether a prop can go where it is: not where the player stands (nor a guest where it would pop straight away), and
 * not into another prop (which all keep inside their own cells, so only this cell's could be in the way). What hangs
 * on a wall is only in the way of what's as high as it is: a clock over a sofa is fine.
 * @param {import('../world/decorations.js').Prop} prop
 * @param {import('../world/ChunkStore.js').ChunkStore} store
 * @param {import('three').Vector3 | null} player
 */
function fits(prop, store, player) {
    const footprint = propFootprint(prop);
    if (player && !isHungProp(prop.type) && overlapsPlayer([footprint], player)) return false;
    if (player && prop.type === PROP_GUEST && player.y < (prop.y ?? 0) + WALL_HEIGHT && Math.hypot(prop.x - player.x, prop.z - player.z) < GUEST_POP + GUEST_ROOM) return false;
    const [low, high] = heights(prop);
    for (const other of store.propsAt(cellCoord(prop.x), cellCoord(prop.z))) {
        const [minX, minZ, maxX, maxZ] = propFootprint(other);
        const [otherLow, otherHigh] = heights(other);
        if (footprint[2] > minX && footprint[0] < maxX && footprint[3] > minZ && footprint[1] < maxZ && high > otherLow && low < otherHigh) return false;
    }
    return true;
}

/** How high up a prop goes, from its bottom to its top. */
function heights(prop) {
    const [, y0, , , y1] = propBounds(prop);
    return [(prop.y ?? 0) + y0, (prop.y ?? 0) + y1];
}

/** Whether there's room in its chunk for another prop to be put down (see PLACED_VERTICES and GUESTS_PER_CHUNK). */
function roomFor(prop, store) {
    const chunk = store.getChunk(chunkCoord(cellCoord(prop.x)), chunkCoord(cellCoord(prop.z)));
    if (prop.type === PROP_GUEST && chunk.props.filter((other) => other.type === PROP_GUEST).length >= GUESTS_PER_CHUNK) return false;
    let total = propVertexCount(prop);
    // (What the level put there itself doesn't count against it.)
    for (const other of chunk.props) if (other.index === undefined) total += propVertexCount(other);
    return total <= PLACED_VERTICES;
}

/**
 * What building on a light makes of it: one that's off comes on; one that's on starts to flicker, and one that
 * flickers stops. (Removing it switches it off.) A light that flickers does it in a pattern of its own (see
 * panelFlicker in panelLights.js), the same for that slot every time.
 * @param {import('../world/ChunkStore.js').ChunkStore} store
 * @param {{ x: number, z: number, brightness: number, flicker: number }} light
 * @returns {[number, number]} Its brightness and flicker.
 */
function nextLight(store, { x, z, brightness, flicker }) {
    if (brightness === 0) return [LIGHT_ON, 0];
    if (flicker === 0) return [brightness, 1 + (hashInts(store.seed, 0x11d, x, z) % 255)];
    return [brightness, 0];
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
