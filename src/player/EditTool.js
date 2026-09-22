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
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, edgeBoxes, pillarBox } from '../world/grid.js';
import { raycastWorld } from './raycast.js';

export const EDIT_TOOLS = /** @type {const} */ (['wall', 'doorway', 'pillar']);

// Outlines are a little bigger than what they outline, so their edges aren't hidden inside it.
const PAD = 0.014;
const OUTLINE_INSET = 0.003;
const _direction = new Vector3();

/**
 * @typedef {{ kind: 'edge', x: number, z: number, axis: 0 | 1, current: number }
 *     | { kind: 'pillar', x: number, z: number, current: boolean }} EditTarget
 */

/**
 * Edit mode: aim at something and left click to remove it; right click builds with the current tool.
 * Aiming at the floor picks the nearest cell border (or corner, for pillars), where a preview shows what
 * would be built. Building on an existing wall turns it into a doorway and back.
 */
export class EditTool {
    /**
     * @param {import('three').Scene} scene
     * @param {{ build: import('three').Material, select: import('three').Material }} materials
     */
    constructor(scene, materials) {
        this.materials = materials;
        this.group = new Group();
        this.group.name = 'edit outline';
        this.shapes = {
            wall: outline(new BoxGeometry(1 + WALL_THICKNESS + PAD, WALL_HEIGHT, WALL_THICKNESS + PAD)),
            doorway: outline(doorwayGeometry()),
            pillar: outline(new BoxGeometry(PILLAR_SIZE + PAD, WALL_HEIGHT, PILLAR_SIZE + PAD)),
        };
        for (const shape of Object.values(this.shapes)) {
            shape.geometry.translate(0, WALL_HEIGHT / 2, 0);
            shape.visible = false;
            this.group.add(shape);
        }
        scene.add(this.group);

        this.toolIndex = 0;
        /** @type {EditTarget | null} */
        this.target = null;
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
    }

    /**
     * Re-aims from the camera. Call every frame while edit mode is on.
     * @param {import('three').Camera} camera
     * @param {import('../world/ChunkStore.js').ChunkStore} store
     */
    update(camera, store) {
        camera.getWorldDirection(_direction);
        const p = camera.position;
        const hit = raycastWorld(p.x, p.y, p.z, _direction.x, _direction.y, _direction.z, EDIT_REACH, store);

        this.target = null;
        if (hit) {
            const [hx, , hz] = hit.point;
            if (hit.kind === 'pillar') {
                this.target = { kind: 'pillar', x: hit.x, z: hit.z, current: true };
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
        const changed = target.kind === 'pillar'
            ? store.setPillar(target.x, target.z, false)
            : store.setEdge(target.x, target.z, target.axis, EDGE_NONE);
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
        if (target.kind === 'pillar') {
            if (target.current || overlapsPlayer([pillarBox(target.x, target.z)], playerPosition)) return null;
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

    _showTarget(above) {
        for (const shape of Object.values(this.shapes)) shape.visible = false;
        const target = this.target;
        if (!target) return;

        let shape;
        let exists;
        if (target.kind === 'pillar') {
            shape = this.shapes.pillar;
            exists = target.current;
            shape.position.set(target.x + 0.5, 0, target.z + 0.5);
            shape.rotation.y = 0;
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
