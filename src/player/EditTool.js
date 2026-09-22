import { BoxGeometry, EdgesGeometry, LineSegments, Vector3 } from 'three';
import { EDIT_REACH, EYE_HEIGHT, PLAYER_RADIUS, WALL_HEIGHT } from '../config.js';
import { raycastGrid } from './raycast.js';

const OUTLINE_INSET = 0.003;
const _direction = new Vector3();

/**
 * Edit mode: aim with the crosshair, left click removes the wall you're looking at, right click places a
 * wall against the face you're looking at (or on the floor/ceiling cell you're looking at).
 */
export class EditTool {
    /**
     * @param {import('three').Scene} scene
     * @param {import('three').Material} material
     */
    constructor(scene, material) {
        // Slightly wider than a wall (and its baseboard) so the edges aren't hidden inside it.
        const box = new BoxGeometry(1.014, WALL_HEIGHT, 1.014).translate(0, WALL_HEIGHT / 2, 0);
        this.outline = new LineSegments(new EdgesGeometry(box), material);
        box.dispose();
        this.outline.visible = false;
        this.outline.name = 'edit outline';
        scene.add(this.outline);

        /** Wall cell that a left click would remove. */
        this.removeTarget = null;
        /** Empty cell that a right click would fill. */
        this.placeTarget = null;
    }

    /**
     * Re-aims from the camera. Call every frame while edit mode is on.
     * @param {import('three').Camera} camera
     * @param {import('../world/ChunkStore.js').ChunkStore} store
     */
    update(camera, store) {
        camera.getWorldDirection(_direction);
        const p = camera.position;
        const hit = raycastGrid(p.x, p.y, p.z, _direction.x, _direction.y, _direction.z, EDIT_REACH, (x, z) => store.isWall(x, z));

        this.removeTarget = null;
        this.placeTarget = null;
        if (hit?.kind === 'wall') {
            this.removeTarget = { x: hit.x, z: hit.z };
            // Walls are a single layer, so there's nothing to place against a wall's top face.
            if (hit.normal[1] === 0) this.placeTarget = { x: hit.x + hit.normal[0], z: hit.z + hit.normal[2] };
        } else if (hit) {
            this.placeTarget = { x: hit.x, z: hit.z };
        }

        const shown = this.removeTarget ?? this.placeTarget;
        this.outline.visible = shown !== null;
        if (shown) {
            // Keep the top/bottom edges just off the floor and ceiling (or just above the wall tops when
            // looking down from above) so they don't z-fight with those surfaces.
            const above = p.y > WALL_HEIGHT;
            this.outline.position.set(shown.x, OUTLINE_INSET, shown.z);
            this.outline.scale.y = above ? 1 : (WALL_HEIGHT - 2 * OUTLINE_INSET) / WALL_HEIGHT;
        }
    }

    hide() {
        this.outline.visible = false;
        this.removeTarget = null;
        this.placeTarget = null;
    }

    /** @returns {{ x: number, z: number } | null} The removed cell. */
    remove(store) {
        const target = this.removeTarget;
        if (!target || !store.setWall(target.x, target.z, false)) return null;
        return target;
    }

    /**
     * @param {import('three').Vector3} playerPosition
     * @returns {{ x: number, z: number } | null} The filled cell.
     */
    place(store, playerPosition) {
        const target = this.placeTarget;
        if (!target || store.isWall(target.x, target.z)) return null;
        if (overlapsPlayer(target.x, target.z, playerPosition)) return null;
        store.setWall(target.x, target.z, true);
        return target;
    }
}

function overlapsPlayer(x, z, player) {
    if (player.y - EYE_HEIGHT >= WALL_HEIGHT) return false; // flying above the walls
    return Math.abs(player.x - x) < 0.5 + PLAYER_RADIUS && Math.abs(player.z - z) < 0.5 + PLAYER_RADIUS;
}
