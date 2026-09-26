import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, HALF_CHUNK, PLAYER_RADIUS, WALL_HEIGHT } from '../src/config.js';
import { arenaOptions, placeNotes } from '../src/footage/arena.js';
import { moveAndCollide } from '../src/player/collision.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { buildChunkGeometry } from '../src/world/chunkGeometry.js';
import { EDGE_NONE, EDGE_WALL } from '../src/world/grid.js';
import { BANNER_TEXT, GEL_HUES, GEL_NONE, GEL_WHITE, PARTY_CAKE, PARTY_PRESENTS } from '../src/world/party.js';

const N = CHUNK_SIZE;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** A world with Level Fun on, and every chunk in a square round the origin generated. */
function partyStore(seed, reach = 2, options = {}) {
    const store = new ChunkStore(seed, null, options);
    store.setParty(true);
    for (let cx = -reach; cx <= reach; cx++) for (let cz = -reach; cz <= reach; cz++) store.getChunk(cx, cz);
    return store;
}

/** Each chunk within `reach` of the origin, for a few seeds (with a ring of neighbours generated round them). */
function* dressedChunks(seeds = 8, reach = 2) {
    for (let seed = 0; seed < seeds; seed++) {
        const store = partyStore(seed, reach + 1);
        for (const chunk of [...store.chunks.values()]) {
            if (Math.abs(chunk.cx) <= reach && Math.abs(chunk.cz) <= reach) yield { store, chunk };
        }
    }
}

describe('Level Fun', () => {
    it('dresses the same place the same way every time', () => {
        const a = partyStore(12).getChunk(1, -1);
        const b = partyStore(12).getChunk(1, -1);
        expect(a.party).toEqual(b.party);
        expect(Array.from(a.lights)).toEqual(Array.from(b.lights));
    });

    it('leaves the level underneath as it was, and takes everything down again', () => {
        const plain = new ChunkStore(40).getChunk(-1, 2);
        const store = partyStore(40);
        const dressed = store.getChunk(-1, 2);
        expect(Array.from(dressed.edgesX)).toEqual(Array.from(plain.edgesX));
        expect(Array.from(dressed.edgesZ)).toEqual(Array.from(plain.edgesZ));
        expect(dressed.props).toEqual(plain.props);
        expect(dressed.party).not.toBeNull();
        store.setParty(false);
        expect(dressed.party).toBeNull();
        expect(Array.from(dressed.lights)).toEqual(Array.from(plain.lights));
    });

    it('puts a gel over every light, and only while it is on', () => {
        for (const { chunk } of dressedChunks(3)) {
            for (let k = 3; k < chunk.lights.length; k += 4) {
                const gel = chunk.lights[k];
                expect(gel === GEL_WHITE || gel < GEL_WHITE).toBe(true);
            }
        }
        const plain = new ChunkStore(3).getChunk(0, 0);
        for (let k = 3; k < plain.lights.length; k += 4) expect(plain.lights[k]).toBe(GEL_NONE);
        // Mostly colours, some white, some going round.
        const kinds = { white: 0, hue: 0, cycling: 0 };
        for (const { chunk } of dressedChunks(3)) {
            for (let k = 3; k < chunk.lights.length; k += 4) {
                const gel = chunk.lights[k];
                kinds[gel === GEL_WHITE ? 'white' : gel < GEL_HUES ? 'hue' : 'cycling']++;
            }
        }
        const total = kinds.white + kinds.hue + kinds.cycling;
        expect(kinds.hue / total).toBeGreaterThan(0.45);
        expect(kinds.white / total).toBeGreaterThan(0.15);
        expect(kinds.cycling / total).toBeGreaterThan(0.05);
    });

    it('only collides with its tables and presents, and only while it is on', () => {
        const store = partyStore(5);
        const boxes = [...store.chunks.values()].flatMap((chunk) => chunk.party.boxes);
        expect(boxes.length).toBeGreaterThan(0);
        const [x0, z0, x1, z1] = boxes[0];
        expect(store.boxesNear(x0, z0, x1, z1)).toContainEqual(boxes[0]);
        store.setParty(false);
        expect(store.boxesNear(x0, z0, x1, z1)).not.toContainEqual(boxes[0]);
    });

    it('keeps tables and presents inside their cell, and never in the way', () => {
        let checked = 0;
        for (const { store, chunk } of dressedChunks(10)) {
            for (const [x0, z0, x1, z1] of chunk.party.boxes) {
                const cx = Math.round((x0 + x1) / 2);
                const cz = Math.round((z0 + z1) / 2);
                // Clear of the walls' faces (0.46 from the middle of the cell).
                expect(Math.max(Math.abs(x0 - cx), Math.abs(x1 - cx), Math.abs(z0 - cz), Math.abs(z1 - cz))).toBeLessThan(0.44);
                // From every open side, you can still walk into the middle of the cell (past the walls and the
                // party's things; the level's own props are its own business).
                const props = new Set([...store.chunks.values()].flatMap((c) => c.props.map((p) => p.box)));
                const boxesNear = (a, b, c, d, doors) => store.boxesNear(a, b, c, d, doors).filter((box) => !props.has(box));
                for (const [dx, dz] of DIRECTIONS) {
                    if (store.edgeBetween(cx, cz, dx, dz) !== EDGE_NONE) continue;
                    const at = { x: cx + dx, z: cz + dz };
                    for (let step = 0; step < 40; step++) moveAndCollide(at, -dx * 0.025, -dz * 0.025, PLAYER_RADIUS, boxesNear);
                    expect(Math.hypot(at.x - cx, at.z - cz), `seed ${store.seed} cell ${cx},${cz} from ${dx},${dz}`).toBeLessThan(0.05);
                    checked++;
                }
            }
        }
        expect(checked).toBeGreaterThan(20);
    });

    it('comes with cakes, presents, balloons, streamers, bunting and the odd mirror ball and guest', () => {
        const count = { cakes: 0, presents: 0, balloons: 0, streamers: 0, bunting: 0, discos: 0, guests: 0, chunks: 0 };
        for (const { chunk } of dressedChunks(10)) {
            const party = chunk.party;
            count.cakes += party.things.filter((t) => t.kind === PARTY_CAKE).length;
            count.presents += party.things.filter((t) => t.kind === PARTY_PRESENTS).length;
            count.balloons += party.balloons.length;
            count.streamers += party.streamers.length;
            count.bunting += party.bunting.length;
            count.discos += party.discos.length;
            count.guests += party.guests.length;
            count.chunks++;
        }
        expect(count.balloons / count.chunks).toBeGreaterThan(8);
        for (const key of ['cakes', 'presents', 'streamers', 'bunting', 'discos', 'guests']) {
            expect(count[key] / count.chunks, key).toBeGreaterThan(0.1);
        }
    });

    it('hangs mirror balls only where there are no walls for their light to go through', () => {
        let found = 0;
        for (const { store, chunk } of dressedChunks(12)) {
            for (const disco of chunk.party.discos) {
                if (disco.x === 0 && disco.z === -0.5) continue; // the first room's
                found++;
                for (let x = disco.x - 3; x < disco.x + 3; x++) {
                    for (let z = disco.z - 3; z <= disco.z + 3; z++) expect(store.edgeBetween(x, z, 1, 0)).toBe(EDGE_NONE);
                }
                for (let x = disco.x - 3; x <= disco.x + 3; x++) {
                    for (let z = disco.z - 3; z < disco.z + 3; z++) expect(store.edgeBetween(x, z, 0, 1)).toBe(EDGE_NONE);
                }
            }
        }
        expect(found).toBeGreaterThan(3);
    });

    it('swags streamers from wall to wall, with nothing in between', () => {
        let found = 0;
        for (const { store, chunk } of dressedChunks(6)) {
            for (const { ax, az, bx, bz } of chunk.party.streamers) {
                const alongX = az === bz;
                const [dx, dz] = alongX ? [1, 0] : [0, 1];
                const fixed = Math.round(alongX ? az : ax);
                const from = Math.round(alongX ? ax + 0.5 : az + 0.5);
                const to = Math.round(alongX ? bx - 0.5 : bz - 0.5);
                const cell = (k) => (alongX ? [k, fixed] : [fixed, k]);
                expect(store.edgeBetween(...cell(from), -dx, -dz)).not.toBe(EDGE_NONE);
                expect(store.edgeBetween(...cell(to), dx, dz)).not.toBe(EDGE_NONE);
                for (let k = from; k < to; k++) expect(store.edgeBetween(...cell(k), dx, dz)).toBe(EDGE_NONE);
                found++;
            }
        }
        expect(found).toBeGreaterThan(10);
    });

    it('welcomes you in the first room, with someone waiting in the next', () => {
        const party = partyStore(7).getChunk(0, 0).party;
        const banner = party.bunting.find((b) => b.letters);
        expect(banner.letters).toBe(BANNER_TEXT);
        expect(party.discos.some((d) => d.x === 0 && d.z === -0.5)).toBe(true);
        expect(party.guests.some((g) => g.x === -1 && g.z < -3)).toBe(true);
        expect(party.things.some((t) => t.kind === PARTY_CAKE)).toBe(true);
    });

    it('dresses a tape around its notes, with no guests (it has its own)', () => {
        for (const seed of [2, 9, 31]) {
            const store = new ChunkStore(seed, null, arenaOptions(seed));
            const notes = placeNotes(store, seed);
            store.setParty(true);
            const boxesNear = (a, b, c, d, doors) => store.boxesNear(a, b, c, d, doors);
            for (const note of notes) {
                const chunk = store.getChunk(Math.floor((note.cellX + HALF_CHUNK) / N), Math.floor((note.cellZ + HALF_CHUNK) / N));
                expect(chunk.party.guests).toEqual([]);
                // Still nothing in the way of walking up to it.
                const from = { x: note.cellX, z: note.cellZ };
                moveAndCollide(from, note.nx * -0.3, note.nz * -0.3, PLAYER_RADIUS, boxesNear);
                expect(Math.hypot(from.x - note.x, from.z - note.z)).toBeLessThan(0.62);
            }
            // Nothing outside its walls.
            expect(store.getChunk(3, 3).party).toBeNull();
        }
    });

    it('builds well-formed meshes, and only the balloons move', () => {
        for (const seed of [1, 7]) {
            const store = partyStore(seed, 1);
            for (const [cx, cz] of [[0, 0], [1, -1], [-1, 1]]) {
                const geometry = buildChunkGeometry(store, cx, cz);
                for (const part of ['partyThings', 'partyDecals', 'balloons', 'flames']) {
                    const g = geometry[part];
                    if (!g) continue;
                    const count = g.attributes.position.count;
                    for (const name of ['normal', 'uv', 'color']) expect(g.attributes[name].count).toBe(count);
                    expect(!!g.attributes.sway).toBe(part === 'balloons');
                    expect(Math.max(...g.index.array)).toBeLessThan(count);
                    expect(g.index.count % 3).toBe(0);
                    const p = g.attributes.position.array;
                    for (let i = 0; i < p.length; i += 3) {
                        expect(Number.isFinite(p[i] + p[i + 1] + p[i + 2])).toBe(true);
                        expect(Math.abs(p[i])).toBeLessThanOrEqual(HALF_CHUNK + 1);
                        expect(p[i + 1]).toBeGreaterThanOrEqual(-0.001);
                        expect(p[i + 1]).toBeLessThanOrEqual(WALL_HEIGHT + 0.001);
                        expect(Math.abs(p[i + 2])).toBeLessThanOrEqual(HALF_CHUNK + 1);
                    }
                    // Every triangle faces the way its normals say (or it'd be culled from the side it's seen from).
                    const n = g.attributes.normal.array;
                    const index = g.index.array;
                    let backwards = 0;
                    for (let t = 0; t < index.length; t += 3) {
                        const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
                        const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
                        const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
                        const face = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
                        const area = Math.hypot(...face);
                        if (area < 1e-9) continue;
                        const facing = [0, 1, 2].reduce((sum, k) => sum + face[k] * (n[a + k] + n[b + k] + n[c + k]), 0);
                        if (facing < 0) backwards++;
                    }
                    expect(backwards, `${part} of chunk ${cx},${cz}`).toBe(0);
                }
            }
            // Without the party, none of it.
            store.setParty(false);
            const plain = buildChunkGeometry(store, 0, 0);
            expect([plain.partyThings, plain.partyDecals, plain.balloons, plain.flames]).toEqual([null, null, null, null]);
        }
    });

    it('does not hang anything off a wall that is not there', () => {
        for (const { store, chunk } of dressedChunks(6)) {
            for (const bunting of chunk.party.bunting) {
                // The wall is just behind the bunting's line, the other way from the way it faces.
                const along = bunting.az === bunting.bz;
                for (let t = 0.1; t < 1; t += 0.2) {
                    const x = bunting.ax + (bunting.bx - bunting.ax) * t;
                    const z = bunting.az + (bunting.bz - bunting.az) * t;
                    const cx = Math.round(x);
                    const cz = Math.round(z);
                    expect(store.edgeBetween(cx, cz, -bunting.nx, -bunting.nz), `seed ${store.seed} ${along}`).not.toBe(EDGE_NONE);
                }
            }
            for (const scrawl of chunk.party.scrawls) {
                const cx = Math.round(scrawl.x + scrawl.nx * 0.1);
                const cz = Math.round(scrawl.z + scrawl.nz * 0.1);
                expect(store.edgeBetween(cx, cz, -scrawl.nx, -scrawl.nz)).toBe(EDGE_WALL);
            }
        }
    });
});
