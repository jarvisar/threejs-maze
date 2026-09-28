import { DIRECTIONS, EDGE_DOOR, EDGE_NONE, EDGE_WALL, cellCoord } from '../world/grid.js';

// Cells across the map.
const VIEW_CELLS = 12;
// Sizes in cells. Walls are drawn thicker and doorways wider than real so they read at this size.
const WALL = 0.16;
const HALF_DOOR = 0.26;
const PILLAR = 0.3;
// Only cells near you that are reachable through floor and doorways (not walls) get revealed, so most of the
// map stays dark until you've walked there. The extra steps past the radius let it wrap around a wall's end.
export const REVEAL_RADIUS = 2.5;
const REVEAL_STEPS = 4;
// Half-angle of the view cone (radians).
const VIEW_ANGLE = 0.6;

const FLOOR_COLOR = 'rgba(232, 216, 106, 0.28)';
// Level 37 pools deeper than wading depth get a water color (see ChunkStore.groundAt).
const POOL_COLOR = 'rgba(70, 190, 150, 0.5)';
const POOL_DEPTH = -0.15;
const WALL_COLOR = 'whitesmoke';
const PLAYER_COLOR = '#ff3b30';
const SHADOW_COLOR = 'rgba(0, 0, 0, 0.55)';
// Seen Found Footage TVs (see FoundFootage.js). A dot in the TV light color, MARK_RADIUS in hundredths of the
// map. Ones off the map get pinned EDGE_MARGIN in from the edge at EDGE_MARK_SIZE scale. With EDGE_MARKS off
// they only show once they're on the map.
const MARK_COLOR = 'rgb(180, 200, 230)';
const MARK_RADIUS = 3.2;
const EDGE_MARKS = true;
const EDGE_MARGIN = 5;
const EDGE_MARK_SIZE = 0.7;
const NO_MARKS = Object.freeze([]);

export const cellKey = (x, z) => x * 1048576 + z;

/**
 * Corner minimap. Only shows cells you've been near. Rotates with you so forward is up, with an N on the edge.
 * Marks (seen TVs) are drawn wherever they are.
 */
export class Minimap {
    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
        /** @type {import('../world/ChunkStore.js').ChunkStore | null} */
        this.store = null;
        /** @type {Set<number>} Cells seen in this world. */
        this.seen = new Set();
        this._size = 0;
        this._cell = NaN;
        this._x = NaN;
        this._z = NaN;
        this._yaw = NaN;
        /** @type {CanvasGradient | null} */
        this._fade = null;
        /** @type {CanvasGradient | null} */
        this._cone = null;
        /** @type {readonly { x: number, z: number }[]} */
        this._marks = NO_MARKS;
        // Match the screen resolution so lines stay sharp.
        new ResizeObserver(() => this._resize()).observe(canvas);
    }

    setEnabled(enabled) {
        this.canvas.hidden = !enabled;
    }

    /**
     * @param {import('../world/ChunkStore.js').ChunkStore} store
     * @param {number} x Player position.
     * @param {number} z
     * @param {number} yaw Player facing.
     * @param {readonly { x: number, z: number }[]} [marks] Positions to mark. Redraws when the list changes.
     */
    update(store, x, z, yaw, marks = NO_MARKS) {
        let changed = this.reveal(store, x, z);
        if (marks !== this._marks) {
            this._marks = marks;
            changed = true;
        }
        const size = this._size;
        if (size === 0 || this.canvas.hidden) return;
        const scale = size / VIEW_CELLS;
        if (!changed && Math.hypot(x - this._x, z - this._z) * scale < 0.3 && Math.abs(yaw - this._yaw) * size < 0.6) return;
        this._x = x;
        this._z = z;
        this._yaw = yaw;
        this._draw(x, z, yaw);
    }

    /**
     * Marks the cells around (x, z) as seen, without drawing. Enough in VR, where the page can't be seen.
     * @param {import('../world/ChunkStore.js').ChunkStore} store
     * @param {number} x
     * @param {number} z
     * @returns {boolean} Whether that's a new cell.
     */
    reveal(store, x, z) {
        // New world or tape starts with a blank map.
        if (store !== this.store) {
            this.store = store;
            this.seen.clear();
            this._cell = NaN;
        }
        const key = cellKey(cellCoord(x), cellCoord(z));
        if (key === this._cell) return false;
        this._cell = key;
        revealAround(store, this.seen, x, z);
        return true;
    }

    _resize() {
        const size = Math.round(this.canvas.clientWidth * Math.min(devicePixelRatio, 2));
        if (size === this._size) return;
        this._size = size;
        this.canvas.width = size;
        this.canvas.height = size;
        const half = size / 2;
        // Map fades out toward its edges, view cone toward its far end.
        this._fade = this.ctx.createRadialGradient(half, half, half * 0.6, half, half, half * 1.35);
        this._fade.addColorStop(0, '#000');
        this._fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this._cone = this.ctx.createRadialGradient(0, 0, 0, 0, 0, half * 0.8);
        this._cone.addColorStop(0, 'rgba(245, 245, 245, 0.3)');
        this._cone.addColorStop(1, 'rgba(245, 245, 245, 0)');
        // Resizing clears the canvas. Redraw now since we might be paused with no updates coming.
        if (size > 0 && !Number.isNaN(this._x)) this._draw(this._x, this._z, this._yaw);
    }

    _draw(x, z, yaw) {
        const { ctx, store, seen } = this;
        const size = this._size;
        const half = size / 2;
        const unit = size / 100;
        // Far enough to reach the corners of the rotated map (half diagonal is ~0.71 of its width).
        const range = VIEW_CELLS * 0.71 + 1;
        const x0 = Math.floor(x - range);
        const x1 = Math.ceil(x + range);
        const z0 = Math.floor(z - range);
        const z1 = Math.ceil(z + range);
        const isSeen = (cx, cz) => seen.has(cellKey(cx, cz));

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, size, size);

        // World space in cells, rotated so forward is up.
        ctx.save();
        ctx.translate(half, half);
        ctx.rotate(yaw);
        ctx.scale(size / VIEW_CELLS, size / VIEW_CELLS);
        ctx.translate(-x, -z);

        // Floor as one rect per run of seen cells so there are no seams.
        ctx.beginPath();
        for (let cx = x0; cx <= x1; cx++) {
            let start = NaN;
            for (let cz = z0; cz <= z1 + 1; cz++) {
                if (cz <= z1 && isSeen(cx, cz)) {
                    if (Number.isNaN(start)) start = cz;
                } else if (!Number.isNaN(start)) {
                    ctx.rect(cx - 0.5, start - 0.5, 1, cz - start);
                    start = NaN;
                }
            }
        }
        ctx.fillStyle = FLOOR_COLOR;
        ctx.fill();
        ctx.beginPath();
        for (let cx = x0; cx <= x1; cx++) {
            for (let cz = z0; cz <= z1; cz++) if (isSeen(cx, cz) && store.groundAt(cx, cz) < POOL_DEPTH) ctx.rect(cx - 0.5, cz - 0.5, 1, 1);
        }
        ctx.fillStyle = POOL_COLOR;
        ctx.fill();

        // Walls and pillars next to seen cells.
        ctx.beginPath();
        for (let cx = x0 - 1; cx <= x1; cx++) {
            for (let cz = z0 - 1; cz <= z1; cz++) {
                const here = isSeen(cx, cz);
                const east = isSeen(cx + 1, cz);
                const south = isSeen(cx, cz + 1);
                if (here || east) this._edge(cx, cz, 0);
                if (here || south) this._edge(cx, cz, 1);
                if ((here || east || south || isSeen(cx + 1, cz + 1)) && store.pillar(cx, cz)) {
                    ctx.rect(cx + 0.5 - PILLAR / 2, cz + 0.5 - PILLAR / 2, PILLAR, PILLAR);
                }
            }
        }
        ctx.fillStyle = WALL_COLOR;
        ctx.fill();
        ctx.restore();

        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = /** @type {CanvasGradient} */ (this._fade);
        ctx.fillRect(0, 0, size, size);
        ctx.globalCompositeOperation = 'source-over';

        // Marks go on top of the fade so ones on the edge stay clear.
        if (this._marks.length > 0) {
            ctx.beginPath();
            for (const mark of this._marks) {
                const place = markPlace(mark.x - x, mark.z - z, yaw, half);
                if (!place) continue;
                const [px, py, edge] = place;
                const radius = MARK_RADIUS * unit * (edge ? EDGE_MARK_SIZE : 1);
                ctx.moveTo(px + radius, py);
                ctx.arc(px, py, radius, 0, Math.PI * 2);
            }
            ctx.lineWidth = 1.5 * unit;
            ctx.strokeStyle = SHADOW_COLOR;
            ctx.stroke();
            ctx.fillStyle = MARK_COLOR;
            ctx.fill();
        }

        // Player arrow in the middle, with the view cone.
        ctx.save();
        ctx.translate(half, half);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, half * 0.8, -Math.PI / 2 - VIEW_ANGLE, -Math.PI / 2 + VIEW_ANGLE);
        ctx.closePath();
        ctx.fillStyle = /** @type {CanvasGradient} */ (this._cone);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(0, -6 * unit);
        ctx.lineTo(4.5 * unit, 5 * unit);
        ctx.lineTo(0, 2.5 * unit);
        ctx.lineTo(-4.5 * unit, 5 * unit);
        ctx.closePath();
        ctx.lineJoin = 'round';
        ctx.lineWidth = 1.5 * unit;
        ctx.strokeStyle = SHADOW_COLOR;
        ctx.stroke();
        ctx.fillStyle = PLAYER_COLOR;
        ctx.fill();
        ctx.restore();

        // N marker on the map edge.
        const nx = Math.sin(yaw);
        const nz = -Math.cos(yaw);
        const reach = (half - 8 * unit) / Math.max(Math.abs(nx), Math.abs(nz));
        ctx.font = `${Math.round(11 * unit)}px 'VCR OSD Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = SHADOW_COLOR;
        ctx.fillText('N', half + nx * reach + unit, half + nz * reach + unit);
        ctx.fillStyle = WALL_COLOR;
        ctx.fillText('N', half + nx * reach, half + nz * reach);
    }

    /** Adds a wall or doorway to the path, on the +x (axis 0) or +z (axis 1) side of cell (x, z). */
    _edge(x, z, axis) {
        const type = /** @type {import('../world/ChunkStore.js').ChunkStore} */ (this.store).edge(x, z, axis);
        if (type === EDGE_NONE) return;
        const t = WALL / 2;
        // "a" runs across the wall, "b" along it. Walls reach half a thickness past their ends to meet at corners.
        const a = (axis === 0 ? x : z) + 0.5;
        const b = axis === 0 ? z : x;
        const pieces = type === EDGE_DOOR
            ? [[b - 0.5 - t, b - HALF_DOOR], [b + HALF_DOOR, b + 0.5 + t]]
            : [[b - 0.5 - t, b + 0.5 + t]];
        for (const [b0, b1] of pieces) {
            if (axis === 0) this.ctx.rect(a - t, b0, WALL, b1 - b0);
            else this.ctx.rect(b0, a - t, b1 - b0, WALL);
        }
    }
}

/**
 * Map position (px from top left) of something at (dx, dz) from the player, rotated like _draw. The flag is
 * true if it's off the map and got pinned to the edge. Null for off-map marks when edgeMarks is off.
 * @param {number} dx
 * @param {number} dz
 * @param {number} yaw Player facing.
 * @param {number} half Half the map size (px).
 * @param {boolean} [edgeMarks] Pin off-map marks to the edge.
 * @returns {[number, number, boolean] | null}
 */
export function markPlace(dx, dz, yaw, half, edgeMarks = EDGE_MARKS) {
    const scale = (2 * half) / VIEW_CELLS;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const px = (dx * cos - dz * sin) * scale;
    const py = (dx * sin + dz * cos) * scale;
    // Distance out relative to the edge. The map is square, so use the larger axis.
    const out = Math.max(Math.abs(px), Math.abs(py)) / (half - (EDGE_MARGIN * half) / 50);
    if (out <= 1) return [half + px, half + py, false];
    if (!edgeMarks) return null;
    return [half + px / out, half + py / out, true];
}

/**
 * Marks cells within REVEAL_RADIUS of (x, z) as seen, if they're reachable from the player's cell without
 * crossing a wall.
 * @param {{ edgeBetween(x: number, z: number, dx: number, dz: number): number }} store
 * @param {Set<number>} seen Cell keys (see cellKey), added to.
 * @param {number} x Player position.
 * @param {number} z
 */
export function revealAround(store, seen, x, z) {
    const cx = cellCoord(x);
    const cz = cellCoord(z);
    const queue = [cx, cz, 0];
    const reached = new Set([cellKey(cx, cz)]);
    seen.add(cellKey(cx, cz));
    for (let i = 0; i < queue.length; i += 3) {
        const qx = queue[i];
        const qz = queue[i + 1];
        const steps = queue[i + 2];
        if (steps === REVEAL_STEPS) continue;
        for (const [dx, dz] of DIRECTIONS) {
            const nx = qx + dx;
            const nz = qz + dz;
            const key = cellKey(nx, nz);
            if (reached.has(key) || Math.hypot(nx - x, nz - z) > REVEAL_RADIUS) continue;
            if (store.edgeBetween(qx, qz, dx, dz) === EDGE_WALL) continue;
            reached.add(key);
            seen.add(key);
            queue.push(nx, nz, steps + 1);
        }
    }
}
