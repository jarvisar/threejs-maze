import { DoubleSide, FrontSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Ambience } from '../src/audio/Ambience.js';
import { PoolroomsAudio } from '../src/audio/Poolrooms.js';
import { CHUNK_SIZE, EYE_HEIGHT, HALF_CHUNK, PLAYER_RADIUS, STEP_HEIGHT, WALL_HEIGHT, WALL_THICKNESS } from '../src/config.js';
import { Player } from '../src/player/Player.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { buildChunkGeometry } from '../src/world/chunkGeometry.js';
import { EDGE_WALL } from '../src/world/grid.js';
import { HEIGHT_STEP } from '../src/world/ground.js';
import { LEVELS, TAPE_LEVELS, leadsToParty, levelById } from '../src/world/levels.js';
import { CHEST, DECK, POOLROOMS_ZONES, SLOT_SKY, poolroomsOptions } from '../src/world/poolrooms.js';
import { COLUMN_RADIUS, SKY_TOP, archCurve, headroomAt } from '../src/world/poolroomsGeometry.js';
import { ZONE_BATHS } from '../src/world/zones.js';
import { misfacing, tJunctions } from './meshes.js';

const N = CHUNK_SIZE;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const LEVEL = LEVELS.findIndex((level) => level.name === 'Level 37');

function poolrooms(seed) {
    return new ChunkStore(seed, null, poolroomsOptions(seed));
}

/** Each chunk within `reach` of the origin, for a few seeds. */
function* chunks(seeds = 5, reach = 2) {
    for (let seed = 0; seed < seeds; seed++) {
        const store = poolrooms(seed);
        for (let cx = -reach; cx <= reach; cx++) {
            for (let cz = -reach; cz <= reach; cz++) yield { store, chunk: store.getChunk(cx, cz) };
        }
    }
}

/** A cell's floor at its side DIRECTIONS[d], for walking across it (a stair's sides count as its top). */
function edgeHeight(ground, k, d) {
    const stair = ground.stairs[k];
    if (stair === 0 || d === stair - 1) return ground.heights[k];
    return ground.tops[k];
}

describe('Level 37', () => {
    it('is where a tape ends: down into it from Level 2, and out of it into Level Fun', () => {
        expect(TAPE_LEVELS.indexOf(LEVEL)).toBe(TAPE_LEVELS.indexOf(LEVELS.findIndex((level) => level.number === 2)) + 1);
        expect(leadsToParty(LEVEL)).toBe(true);
    });

    it('is one of the levels, under water, with its own sound', () => {
        expect(LEVEL).toBeGreaterThan(0);
        const level = levelById(LEVEL);
        expect(level.water).toBe(true);
        expect(level.options(3).level).toBe(LEVEL);
        expect(typeof level.sound).toBe('function');
        for (const other of LEVELS) if (other !== level) expect(other.water).toBe(false);
        // Where every world starts is a hall of pools.
        expect(POOLROOMS_ZONES.start).toBe(ZONE_BATHS);
    });

    it('is the same world every time for the same seed', () => {
        const a = poolrooms(7).getChunk(1, -2);
        const b = poolrooms(7).getChunk(1, -2);
        expect(Array.from(a.ground.heights)).toEqual(Array.from(b.ground.heights));
        expect(Array.from(a.ground.stairs)).toEqual(Array.from(b.ground.stairs));
        expect(Array.from(a.edgesX)).toEqual(Array.from(b.edgesX));
        expect(Array.from(a.lights)).toEqual(Array.from(b.lights));
        expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    });

    it('starts on a walkway, looking at steps down into a pool', () => {
        const store = poolrooms(1);
        expect(store.groundAt(0, 0)).toBeCloseTo(DECK * HEIGHT_STEP);
        expect(store.groundAt(0, -5)).toBeCloseTo(CHEST * HEIGHT_STEP);
        // Down the steps ahead, the floor only ever goes down.
        let last = Infinity;
        for (let z = -1.5; z >= -3; z -= 0.05) {
            const here = store.groundAt(0, z);
            expect(here).toBeLessThanOrEqual(last + 1e-9);
            last = here;
        }
    });

    it('keeps its pools a cell clear of every chunk edge, so the floor meets the next chunk at walking height', () => {
        for (const { chunk } of chunks()) {
            const { heights, stairs } = chunk.ground;
            for (let k = 0; k < N; k++) {
                for (const [i, j] of [[0, k], [N - 1, k], [k, 0], [k, N - 1]]) {
                    expect(heights[i * N + j]).toBeGreaterThan(-8);
                    expect(stairs[i * N + j]).toBe(0);
                }
            }
        }
    });

    it('has steps into every pool, from floor you can walk on, with nothing walled across them', () => {
        for (const { chunk } of chunks()) {
            const { heights, stairs, tops } = chunk.ground;
            for (const pool of chunk.poolrooms.pools) {
                let found = false;
                for (let i = pool.i0; i < pool.i1; i++) {
                    for (let j = pool.j0; j < pool.j1; j++) {
                        const k = i * N + j;
                        if (stairs[k] === 0) continue;
                        expect(tops[k]).toBeGreaterThan(heights[k]);
                        // The cell above it: its top is that cell's floor (or the bottom of the stair before it).
                        const [dx, dz] = DIRECTIONS[stairs[k] - 1];
                        const above = (i - dx) * N + (j - dz);
                        expect(heights[above]).toBe(tops[k]);
                        const wall = dx !== 0 ? chunk.edgesX[(dx > 0 ? i - 1 : i) * N + j] : chunk.edgesZ[i * N + (dz > 0 ? j - 1 : j)];
                        expect(wall).not.toBe(EDGE_WALL);
                        if (stairs[above] === 0) found = true;
                    }
                }
                expect(found, `pool at ${pool.i0},${pool.j0} of chunk ${chunk.cx},${chunk.cz}`).toBe(true);
            }
        }
    });

    it('never traps you: from every cell there is a way to the edge of its chunk, down steps and up stairs', () => {
        for (const { chunk } of chunks(4)) {
            const ground = chunk.ground;
            const between = (i, j, d) => {
                const [di, dj] = DIRECTIONS[d];
                if (di === 1) return chunk.edgesX[i * N + j];
                if (di === -1) return chunk.edgesX[(i - 1) * N + j];
                if (dj === 1) return chunk.edgesZ[i * N + j];
                return chunk.edgesZ[i * N + j - 1];
            };
            const out = new Uint8Array(N * N);
            const queue = [];
            for (let i = 0; i < N; i++) {
                for (let j = 0; j < N; j++) {
                    if (i === 0 || j === 0 || i === N - 1 || j === N - 1) {
                        out[i * N + j] = 1;
                        queue.push(i * N + j);
                    }
                }
            }
            while (queue.length > 0) {
                const k = queue.pop();
                const i = Math.floor(k / N);
                const j = k % N;
                for (let d = 0; d < 4; d++) {
                    const [di, dj] = DIRECTIONS[d];
                    const ni = i + di;
                    const nj = j + dj;
                    if (ni < 0 || nj < 0 || ni >= N || nj >= N || out[ni * N + nj]) continue;
                    if (between(i, j, d) === EDGE_WALL) continue;
                    // Stepping from the neighbour into this cell, the way (−di, −dj).
                    const leave = edgeHeight(ground, ni * N + nj, d ^ 1);
                    const enter = edgeHeight(ground, k, d);
                    if (enter > leave + STEP_HEIGHT / HEIGHT_STEP) continue;
                    out[ni * N + nj] = 1;
                    queue.push(ni * N + nj);
                }
            }
            expect(out.every((reached) => reached === 1), `chunk ${chunk.cx},${chunk.cz}`).toBe(true);
        }
    });

    it('builds every chunk into meshes with nothing out of place', () => {
        const store = poolrooms(2);
        for (let cx = -1; cx <= 1; cx++) {
            for (let cz = -1; cz <= 1; cz++) {
                const geometry = buildChunkGeometry(store, cx, cz);
                for (const [name, mesh] of Object.entries(geometry.extras)) {
                    if (!mesh) continue;
                    for (const attribute of Object.values(mesh.attributes)) {
                        expect(attribute.array.every(Number.isFinite), `${name}.${attribute.name}`).toBe(true);
                    }
                }
                expect(geometry.extras.tiles).toBeTruthy();
                // Nothing of the ceiling is above the skylights' glass, or of the floor below the deepest pool.
                const heights = geometry.extras.tiles.attributes.position.array.filter((_, k) => k % 3 === 1);
                expect(heights.reduce((a, b) => Math.max(a, b))).toBeLessThanOrEqual(1.31);
                expect(heights.reduce((a, b) => Math.min(a, b))).toBeGreaterThanOrEqual(-1.9);
            }
        }
    });

    it('curves its arches and vaults from low on the columns up to the ceiling, and no higher', () => {
        expect(archCurve(1, 1)[0]).toBeLessThan(0.35);
        expect(archCurve(0, 1)[0]).toBeCloseTo(WALL_HEIGHT);
        for (let u = -1; u <= 1; u += 0.05) expect(archCurve(u, 1)[0]).toBeLessThanOrEqual(WALL_HEIGHT);
    });
});

const HALF_THICKNESS = WALL_THICKNESS / 2;
const raycaster = new Raycaster();

/** Level 37's tiles for chunk (cx, cz) and the chunks round it, where they are in the world, to cast rays at. */
function tilesAround(store, cx, cz, side = FrontSide) {
    const material = new MeshBasicMaterial({ side });
    const meshes = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const mesh = new Mesh(buildChunkGeometry(store, cx + dx, cz + dz).extras.tiles, material);
            mesh.position.set((cx + dx) * N, 0, (cz + dz) * N);
            mesh.updateMatrixWorld();
            meshes.push(mesh);
        }
    }
    return meshes;
}

/** How far along the line from `from` to `to` it first meets the meshes (Infinity if it doesn't get there). */
function firstHit(meshes, from, to) {
    const direction = new Vector3().subVectors(to, from);
    raycaster.far = direction.length();
    raycaster.set(from, direction.normalize());
    return raycaster.intersectObjects(meshes, false)[0]?.distance ?? Infinity;
}

/** The cells of chunk (cx, cz). */
function* cellsOf(cx, cz) {
    for (let x = cx * N - HALF_CHUNK; x < cx * N + HALF_CHUNK; x++) {
        for (let z = cz * N - HALF_CHUNK; z < cz * N + HALF_CHUNK; z++) yield [x, z];
    }
}

describe('the curves of Level 37', () => {
    it('faces every tile the way it is lit from', () => {
        for (const seed of [2, 7]) {
            const store = poolrooms(seed);
            for (let cx = -1; cx <= 1; cx++) {
                for (let cz = -1; cz <= 1; cz++) expect(misfacing(buildChunkGeometry(store, cx, cz).extras.tiles), `chunk ${cx},${cz}`).toBe(0);
            }
        }
    });

    it('knows how low the vaults and arches come down over any point, as they are built (a jump stops under them)', () => {
        const material = new MeshBasicMaterial({ side: DoubleSide });
        const upward = new Vector3(0, 1, 0);
        let low = 0;
        for (const seed of [2, 7]) {
            const store = poolrooms(seed);
            const mesh = new Mesh(buildChunkGeometry(store, 0, 0).extras.tiles, material);
            mesh.updateMatrixWorld();
            const r = PLAYER_RADIUS;
            // Round every column in the chunk (well inside it: what's over a point there is the chunk's own), where the
            // player can stand, from its foot up.
            for (const [x, z] of cellsOf(0, 0)) {
                if (!store.pillar(x, z) || Math.abs(x + 0.5) > HALF_CHUNK - 1 || Math.abs(z + 0.5) > HALF_CHUNK - 1) continue;
                for (let k = 0; k < 24; k++) {
                    for (const d of [0.3, 0.38, 0.46]) {
                        const px = x + 0.5 + Math.cos(k * 0.27 + 0.1) * d;
                        const pz = z + 0.5 + Math.sin(k * 0.27 + 0.1) * d;
                        if (store.boxesNear(px - r, pz - r, px + r, pz + r).some((b) => b[2] > px - r && b[0] < px + r && b[3] > pz - r && b[1] < pz + r)) continue;
                        raycaster.set(new Vector3(px, 0.31, pz), upward);
                        raycaster.far = 2;
                        const built = 0.31 + (raycaster.intersectObject(mesh, false)[0]?.distance ?? Infinity);
                        const room = headroomAt(store, px, pz);
                        if (Math.min(built, room) >= 0.8) continue;
                        expect(Math.abs(built - room), `seed ${seed} at ${px.toFixed(3)},${pz.toFixed(3)}`).toBeLessThan(0.001);
                        low++;
                    }
                }
            }
            // Over the middle of a cell with nothing but the ceiling over it, that, and over a skylight, the glass.
            for (const [x, z] of cellsOf(0, 0)) {
                const sky = (x & 1) === 1 && (z & 1) === 1 && store.panelData(x, z)[store.panelOffset(x, z) + 3] === SLOT_SKY;
                if (sky) expect(headroomAt(store, x, z)).toBeCloseTo(SKY_TOP, 6);
            }
        }
        expect(low).toBeGreaterThan(50);
    });

    it('curves the walls into the floor and the ceiling, with no crease left in the corner', () => {
        const store = poolrooms(7);
        let corners = 0;
        for (const [cx, cz] of [[0, 1], [1, 1]]) {
            const meshes = tilesAround(store, cx, cz);
            for (const [x, z] of cellsOf(cx, cz)) {
                const floor = store.flatFloor(x, z);
                if (store.edge(x, z, 0) !== EDGE_WALL || floor === null) continue;
                // The wall on the cell's +x side, and a line into the corner it makes with the floor, and with the
                // ceiling: something takes the corner off before it gets there.
                const face = x + 0.5 - HALF_THICKNESS;
                for (const [y, up] of [[floor, 1], [WALL_HEIGHT, -1]]) {
                    const from = new Vector3(face - 0.25, y + up * 0.25, z);
                    expect(firstHit(meshes, from, new Vector3(face, y, z)), `${x},${z}`).toBeLessThan(0.25 * Math.SQRT2 - 0.02);
                    corners++;
                }
            }
        }
        expect(corners).toBeGreaterThan(20);
    });

    it('rounds the floor over the top of every drop into a pool, out over the drop', () => {
        const store = poolrooms(1);
        const meshes = tilesAround(store, 0, 0);
        let edges = 0;
        for (const [x, z] of cellsOf(0, 0)) {
            const here = store.flatFloor(x, z);
            const there = store.flatFloor(x + 1, z);
            if (store.edge(x, z, 0) === EDGE_WALL || here === null || there === null || Math.abs(here - there) < 0.05) continue;
            // From out over the lower side, straight at the face of the drop just under its top: the nose of the edge,
            // rounding over it, stands out in the way.
            const face = new Vector3(x + 0.5, Math.max(here, there) - 0.02, z);
            const from = face.clone().add(new Vector3(here < there ? -0.2 : 0.2, 0, 0));
            expect(firstHit(meshes, from, face), `${x},${z}`).toBeLessThan(0.2 - 0.01);
            edges++;
        }
        expect(edges).toBeGreaterThan(4);
    });

    it('curves every column out into the floor at its foot', () => {
        const store = poolrooms(1);
        const meshes = tilesAround(store, 0, 0);
        let columns = 0;
        for (const [x, z] of cellsOf(0, 0)) {
            // The quarter of its foot towards +x +z, in cell (x + 1, z + 1).
            const floor = store.flatFloor(x + 1, z + 1);
            if (!store.pillar(x, z) || floor === null) continue;
            const out = new Vector3(Math.SQRT1_2, 0, Math.SQRT1_2);
            const foot = new Vector3(x + 0.5, floor, z + 0.5).addScaledVector(out, COLUMN_RADIUS);
            const from = foot.clone().addScaledVector(out, 0.2).add(new Vector3(0, 0.2, 0));
            expect(firstHit(meshes, from, foot), `${x},${z}`).toBeLessThan(0.2 * Math.SQRT2 - 0.01);
            columns++;
        }
        expect(columns).toBeGreaterThan(4);
    });

    it('keeps the arches over the passages clear of anyone walking through, however they stand', () => {
        // As far across as you can stand from the middle, and as low and high as your eyes go.
        const reach = 0.5 - HALF_THICKNESS - PLAYER_RADIUS;
        let passages = 0;
        for (const seed of [7, 11]) {
            const store = poolrooms(seed);
            for (const [cx, cz] of [[0, 1], [1, 1], [-1, 0], [1, -1]]) {
                const meshes = tilesAround(store, cx, cz, DoubleSide);
                for (const [x, z] of cellsOf(cx, cz)) {
                    const floor = store.flatFloor(x, z);
                    const wallsX = store.edge(x - 1, z, 0) === EDGE_WALL && store.edge(x, z, 0) === EDGE_WALL;
                    const wallsZ = store.edge(x, z - 1, 1) === EDGE_WALL && store.edge(x, z, 1) === EDGE_WALL;
                    if (floor === null || floor < -8 * HEIGHT_STEP || wallsX === wallsZ) continue;
                    // In the passage's own terms: across it, along it, and up.
                    const at = (across, along, y) => (wallsX ? new Vector3(x + across, y, z + along) : new Vector3(x + along, y, z + across));
                    for (const eyes of [0.3, EYE_HEIGHT, 0.6]) {
                        const y = floor + eyes;
                        for (const along of [-0.4, 0, 0.4]) expect(firstHit(meshes, at(-reach, along, y), at(reach, along, y)), `${x},${z}`).toBe(Infinity);
                        for (const across of [-reach, 0, reach]) expect(firstHit(meshes, at(across, -0.5, y), at(across, 0.5, y)), `${x},${z}`).toBe(Infinity);
                    }
                    passages++;
                }
            }
        }
        expect(passages).toBeGreaterThan(10);
    });

    it('keeps its skylights out of the vaults, which stay whole: the ceiling round a skylight is flat', () => {
        let skylights = 0;
        let vaults = 0;
        for (const seed of [2, 7]) {
            const store = poolrooms(seed);
            const meshes = tilesAround(store, 0, 0);
            // How far up from halfway to the ceiling it is to the first tile over (x, z).
            const up = (x, z) => firstHit(meshes, new Vector3(x, WALL_HEIGHT / 2, z), new Vector3(x, WALL_HEIGHT + 0.1, z));
            for (const [x, z] of cellsOf(0, 0)) {
                const sky = (x & 1) === 1 && (z & 1) === 1 && store.panelData(x, z)[store.panelOffset(x, z) + 3] === SLOT_SKY;
                if (sky) {
                    // Just outside each corner of its opening.
                    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                        expect(up(x + dx * 0.27, z + dz * 0.27), `${x},${z}`).toBeCloseTo(WALL_HEIGHT / 2, 3);
                    }
                    skylights++;
                } else if (up(x, z) < WALL_HEIGHT / 2 - 0.02) {
                    vaults++;
                }
            }
        }
        expect(skylights).toBeGreaterThan(4);
        expect(vaults).toBeGreaterThan(4);
    });

    it('builds its floors and ceilings in pieces that meet corner to corner, leaving no pinholes between them', () => {
        for (const seed of [2, 7, 12345]) expect(tJunctions(tilesAround(poolrooms(seed), 0, 0)), `seed ${seed}`).toBe(0);
    });

    it('has no soft shade along its walls: they curve into the ceiling and each other instead', () => {
        const store = poolrooms(7);
        for (const [cx, cz] of [[0, 1], [1, 1]]) expect(buildChunkGeometry(store, cx, cz).shade).toBeNull();
    });
});

describe('walking in Level 37', () => {
    const still = { forward: 0, right: 0, up: 0, sprint: false };
    const ahead = { forward: 1, right: 0, up: 0, sprint: false };

    function world() {
        const store = poolrooms(1);
        return {
            store,
            boxesNear: (a, b, c, d, doors) => store.boxesNear(a, b, c, d, doors),
            terrain: { groundAt: (x, z) => store.groundAt(x, z), water: 0 },
        };
    }

    function walk(player, w, input, yaw, steps) {
        for (let k = 0; k < steps; k++) player.step(input, yaw, 1, w.boxesNear, w.terrain);
    }

    it('goes down the steps into the pool, and back up them out of it', () => {
        const w = world();
        const player = new Player();
        player.reset(0, 0);
        walk(player, w, still, 0, 30);
        expect(player.position.y).toBeCloseTo(DECK * HEIGHT_STEP + EYE_HEIGHT, 3);
        // Ahead (−z), down the steps and across the pool to its far side.
        walk(player, w, ahead, 0, 900);
        expect(player.position.z).toBeLessThan(-5);
        expect(player.position.y).toBeCloseTo(CHEST * HEIGHT_STEP + EYE_HEIGHT, 2);
        expect(player.depth).toBeGreaterThan(0.3);
        // Its far wall is too high to climb.
        const z = player.position.z;
        walk(player, w, ahead, 0, 300);
        expect(player.position.z).toBeGreaterThan(-7.5);
        expect(Math.abs(player.position.z - z)).toBeLessThan(1.2);
        // Back the way it came, up the steps (and not on into the pool behind the start).
        walk(player, w, ahead, Math.PI, 520);
        expect(player.position.z).toBeGreaterThan(-1.5);
        expect(player.position.z).toBeLessThan(3);
        expect(player.position.y).toBeCloseTo(DECK * HEIGHT_STEP + EYE_HEIGHT, 3);
    });

    it('falls in off the side, and sinks slowly to the bottom', () => {
        const w = world();
        const player = new Player();
        player.reset(-4, -4.5);
        walk(player, w, still, 0, 30);
        const landings = player.landings;
        // Along +x, off the edge into the pool.
        let lowest = player.position.y;
        let fell = 0;
        for (let k = 0; k < 400; k++) {
            player.step(ahead, -Math.PI / 2, 1, w.boxesNear, w.terrain);
            if (player.position.y < lowest - 1e-6) fell++;
            lowest = Math.min(lowest, player.position.y);
        }
        expect(player.position.y).toBeCloseTo(CHEST * HEIGHT_STEP + EYE_HEIGHT, 2);
        expect(player.landings).toBe(landings + 1);
        // (Not in one go.)
        expect(fell).toBeGreaterThan(8);
        // And can't get back up the side it fell off.
        walk(player, w, ahead, Math.PI / 2, 400);
        expect(player.position.x).toBeGreaterThan(-3.5);
    });

    it('climbs a pool\'s ladder out of the water, by walking into it', () => {
        const store = poolrooms(1);
        const w = {
            boxesNear: (a, b, c, d, doors) => store.boxesNear(a, b, c, d, doors),
            terrain: { groundAt: (x, z) => store.groundAt(x, z), water: 0, ladderAt: (x, z, reach) => store.ladderAt(x, z, reach) },
        };
        const ladders = [];
        for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) ladders.push(...store.getChunk(cx, cz).ladders);
        expect(ladders.length).toBeGreaterThan(0);
        for (const ladder of ladders) {
            const player = new Player();
            player.reset(ladder.x + ladder.nx * 0.5, ladder.z + ladder.nz * 0.5);
            walk(player, w, still, 0, 400);
            expect(player.position.y).toBeLessThan(0.2);
            // Facing the ladder: forward is (−sin yaw, −cos yaw).
            const yaw = Math.atan2(ladder.nx, ladder.nz);
            let climbed = 0;
            let off = 0;
            let highest = -Infinity;
            // Up it, and a few steps on.
            for (let k = 0; k < 400 && (off === 0 || k < off + 30); k++) {
                player.step(ahead, yaw, 1, w.boxesNear, w.terrain);
                if (player.climbing && climbed === 0) climbed = k;
                if (climbed > 0 && !player.climbing && off === 0) off = k;
                highest = Math.max(highest, player.position.y);
            }
            expect(climbed).toBeGreaterThan(0);
            const out = (player.position.x - ladder.x) * ladder.nx + (player.position.z - ladder.z) * ladder.nz;
            expect(out).toBeLessThan(0);
            // Not with a bump at the top.
            expect(highest).toBeLessThanOrEqual(player.floor + EYE_HEIGHT + 1e-6);
            expect(player.position.y).toBeCloseTo(player.floor + EYE_HEIGHT, 5);
            expect(player.floor).toBeGreaterThan(-0.1);
        }
    });

    it('moves the same on a flat level as it always has', () => {
        const store = new ChunkStore(1);
        const boxesNear = (a, b, c, d, doors) => store.boxesNear(a, b, c, d, doors);
        const a = new Player();
        const b = new Player();
        for (let k = 0; k < 200; k++) {
            a.step(ahead, 0.3, 1, boxesNear);
            b.step(ahead, 0.3, 1, boxesNear, null);
        }
        expect(a.position.toArray()).toEqual(b.position.toArray());
        expect(a.position.y).toBe(EYE_HEIGHT);
    });
});

describe('Level 37 sound', () => {
    it('is safe to use before there is any sound (there is no audio context until the first click)', () => {
        const ambience = new Ambience();
        const audio = new PoolroomsAudio(ambience);
        expect(() => {
            audio.setEnabled(true);
            audio.follow(0, 0, 1, 1, 0.5);
            audio.follow(0, 0, 1, 0, -0.3);
            for (let i = 0; i < 600; i++) audio.update(1 / 60);
            audio.step(1.2, 0, 0, 0);
            audio.step(1.2, 0, 0, 0.1);
            audio.step(1.2, 0, 0, 0.5);
            audio.splash(1);
            audio.drip(1, -0.5, true);
            audio.setEnabled(false);
        }).not.toThrow();
        expect(audio.built).toBe(false);
    });
});
