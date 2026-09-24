import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, cellCoord } from '../world/grid.js';

// How many cells fit across the map.
const VIEW_CELLS = 12;
// Sizes in cells. Walls are drawn thicker than they are and doorways a bit wider, so they read at this size.
const WALL = 0.16;
const HALF_DOOR = 0.26;
const PILLAR = 0.3;
// The map fills in around you: through open floor and doorways (not walls), as far as you can see in the haze.
const REVEAL_RADIUS = 4.5;
const REVEAL_STEPS = 7;
// Half the width of the view cone in front of you, in radians.
const VIEW_ANGLE = 0.6;

const FLOOR_COLOR = 'rgba(232, 216, 106, 0.28)';
const WALL_COLOR = 'whitesmoke';
const PLAYER_COLOR = '#ff3b30';
const SHADOW_COLOR = 'rgba(0, 0, 0, 0.55)';

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const cellKey = (x, z) => x * 1048576 + z;

/**
 * The map in the corner. Only the places you've been near are on it; the rest stays dark. It turns with you,
 * so straight ahead is always up, with an N on the edge for north.
 */
export class Minimap {
    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
        /** @type {import('../world/ChunkStore.js').ChunkStore | null} */
        this.store = null;
        /** @type {Set<number>} Every cell that's been seen in this world. */
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
        // Drawn at the screen's own resolution so the lines stay sharp.
        new ResizeObserver(() => this._resize()).observe(canvas);
    }

    setEnabled(enabled) {
        this.canvas.hidden = !enabled;
    }

    /**
     * @param {import('../world/ChunkStore.js').ChunkStore} store
     * @param {number} x Where the player is.
     * @param {number} z
     * @param {number} yaw Which way they face.
     */
    update(store, x, z, yaw) {
        // A new world (or a new tape) starts with a blank map.
        if (store !== this.store) {
            this.store = store;
            this.seen.clear();
            this._cell = NaN;
        }
        const cx = cellCoord(x);
        const cz = cellCoord(z);
        const key = cellKey(cx, cz);
        let changed = false;
        if (key !== this._cell) {
            this._cell = key;
            this._reveal(cx, cz, x, z);
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

    _resize() {
        const size = Math.round(this.canvas.clientWidth * Math.min(devicePixelRatio, 2));
        if (size === this._size) return;
        this._size = size;
        this.canvas.width = size;
        this.canvas.height = size;
        const half = size / 2;
        // The map fades out towards its edges, and the view cone towards its end.
        this._fade = this.ctx.createRadialGradient(half, half, half * 0.6, half, half, half * 1.35);
        this._fade.addColorStop(0, '#000');
        this._fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this._cone = this.ctx.createRadialGradient(0, 0, 0, 0, 0, half * 0.8);
        this._cone.addColorStop(0, 'rgba(245, 245, 245, 0.3)');
        this._cone.addColorStop(1, 'rgba(245, 245, 245, 0)');
        // Resizing clears the canvas; draw it again (it may be paused, with no updates coming).
        if (size > 0 && !Number.isNaN(this._x)) this._draw(this._x, this._z, this._yaw);
    }

    _reveal(cx, cz, x, z) {
        const { store, seen } = this;
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

    _draw(x, z, yaw) {
        const { ctx, store, seen } = this;
        const size = this._size;
        const half = size / 2;
        const unit = size / 100;
        // Everything within reach of a corner of the (turned) map.
        const range = VIEW_CELLS * 0.71 + 1;
        const x0 = Math.floor(x - range);
        const x1 = Math.ceil(x + range);
        const z0 = Math.floor(z - range);
        const z1 = Math.ceil(z + range);
        const isSeen = (cx, cz) => seen.has(cellKey(cx, cz));

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, size, size);

        // The world, in cells, turned so that straight ahead is up.
        ctx.save();
        ctx.translate(half, half);
        ctx.rotate(yaw);
        ctx.scale(size / VIEW_CELLS, size / VIEW_CELLS);
        ctx.translate(-x, -z);

        // The floor, one rectangle per run of seen cells so there are no seams between them.
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

        // Walls and pillars next to anywhere seen.
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

        // You: an arrow in the middle, with what the camera sees in front of it.
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

        // North, on the edge of the map.
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

    /** Adds one wall (or doorway) to the path: the +x side (axis 0) or +z side (axis 1) of cell (x, z). */
    _edge(x, z, axis) {
        const type = /** @type {import('../world/ChunkStore.js').ChunkStore} */ (this.store).edge(x, z, axis);
        if (type === EDGE_NONE) return;
        const t = WALL / 2;
        // "a" runs across the wall, "b" along it; walls reach half a thickness past their ends to meet at corners.
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
