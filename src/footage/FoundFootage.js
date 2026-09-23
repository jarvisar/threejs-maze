import { BoxGeometry, Group, MathUtils, Mesh, MeshBasicMaterial, MeshPhongMaterial, PlaneGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { raycastWorld } from '../player/raycast.js';
import { ChunkStore, cellCoord, chunkCoord } from '../world/ChunkStore.js';
import { withBackroomsShading } from '../world/materials.js';
import { BLACKOUT_DARKNESS } from '../world/panelLights.js';
import { NOTE_COUNT, NOTE_HEIGHT, NOTE_WIDTH, arenaOptions, inArena, openExit, placeNotes } from './arena.js';
import { createNoteAtlas } from './noteTextures.js';
import { formatTime, loadRecords, saveRecords } from './records.js';
import { Watcher } from './Watcher.js';

/*
 * Found Footage: the game mode.
 *
 * A walled-in piece of the level with eight notes pinned to its walls. Take them all and the way out
 * opens in the wall. Something is in there with you; it comes once you've taken the first note, and more
 * often with every note after that (see Watcher.js). Look at it and the tape goes: static, the lights
 * failing, the sound. Let it get to 1 and the tape ends.
 *
 * With every note the level also gets a little darker and the tape a little worse, so the run itself is
 * the progression: the last stretch, to the way out, is dark, loud and crowded.
 *
 * This is the glue: it owns the arena (its own ChunkStore), the notes and their meshes, the figure's mesh,
 * the way out, the stamina, and it turns the Watcher's exposure into the picture and the sound.
 */

// How near, and how squarely, you have to face a note to take it.
const PICKUP_DISTANCE = 0.62;
const PICKUP_FACING = 0.35;
// Sprinting: seconds of it in a row, seconds to get it all back, and how much you need before you can again.
const SPRINT_SECONDS = 7;
const RECOVER_SECONDS = 11;
const EXHAUSTED_UNTIL = 0.35;
// The endings: how long the picture holds before the screen (the tape ending; the fade out of the door).
const CAUGHT_SECONDS = 1.1;
const ESCAPE_SECONDS = 1.6;
// From how far the way out can be heard.
const BEACON_RANGE = 44;
// Its eyes, and the flashlight's beam (half angle, matching the SpotLight).
const WATCHER_EYE = 0.55;
const FLASHLIGHT_CONE = Math.PI / 6;
const FLASHLIGHT_REACH = 9;

const _forward = new Vector3();

export class FoundFootage {
    /** @param {import('../Game.js').Game} game */
    constructor(game) {
        this.game = game;
        /** The arena is built and the notes hung (the title screen shows it). */
        this.prepared = false;
        /** A run is on. */
        this.active = false;
        /** @type {'caught' | 'escaped' | null} How the run ended, while its last seconds play out. */
        this.ended = null;
        this.seed = 0;
        this.records = loadRecords();

        this.noteAtlas = createNoteAtlas();
        this.materials = {
            note: withBackroomsShading(new MeshPhongMaterial({ map: this.noteAtlas.texture, shininess: 4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })),
            // Unlit, so it's a silhouette whatever the light; it fades into the haze like everything else.
            watcher: withBackroomsShading(new MeshBasicMaterial({ color: 0x07070a })),
            exit: new MeshBasicMaterial({ color: 0xffffff, fog: false }),
        };
        this.textures = [this.noteAtlas.texture];

        this.group = new Group();
        this.group.name = 'found footage';
        game.scene.add(this.group);

        /** @type {import('./arena.js').Note[]} */
        this.notes = [];
        /** @type {Mesh[]} */
        this.noteMeshes = [];
        /** @type {import('./arena.js').Exit | null} */
        this.exit = null;
        /** @type {Mesh | null} */
        this.exitMesh = null;
        this.watcherMesh = buildWatcherMesh(this.materials.watcher);
        this.watcherMesh.visible = false;
        this.group.add(this.watcherMesh);

        this.store = null;
        this.watcher = new Watcher({
            los: (ax, az, bx, bz) => this._clear(ax, az, bx, bz),
            free: (x, z) => inArena(x, z) && !this._blocked(x, z),
            lit: (x, z) => this._lit(x, z),
        });
        this._viewer = { x: 0, z: 0, fx: 0, fz: -1, halfFov: 1 };
        this._onWatcherEvent = (event) => this._watcherEvent(event);

        this.found = 0;
        this.time = 0;
        this.stamina = 1;
        this.exhausted = false;
        this._sprinting = false;
        /** How far gone the tape is right now, 0..1 (the Watcher's exposure). */
        this.exposure = 0;
        /** How much of the light is gone: the level darkening with the notes, and more when it's close. */
        this.gloom = 0;
        this._gloomAtEnd = 0;
        this._endTimer = 0;
    }

    /**
     * Builds the arena for a seed and hangs the notes, without starting the clock: the title screen shows
     * this world while the mode is selected.
     * @param {number} seed
     */
    prepare(seed) {
        const game = this.game;
        this._clearMeshes();
        this.seed = seed;
        this.store = new ChunkStore(seed, null, arenaOptions(seed));
        game.store = this.store;
        game.world.setStore(this.store);
        this.notes = placeNotes(this.store, seed);
        game.world.update(0, 0, Infinity);
        game.lighting.update(0, this.store.areaLight(0, 0), true);
        game.player.reset();
        game.look.yaw = 0;
        game.look.pitch = 0;

        for (const note of this.notes) {
            const mesh = new Mesh(noteGeometry(this.noteAtlas.uv(note.index)), this.materials.note);
            mesh.position.set(note.x, note.y, note.z);
            mesh.rotation.set(0, Math.atan2(note.nx, note.nz), note.tilt);
            mesh.receiveShadow = true;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            this.group.add(mesh);
            this.noteMeshes.push(mesh);
        }
        this.exit = null;
        this.watcher.reset();
        this.watcherMesh.visible = false;
        this.found = 0;
        this.time = 0;
        this.exposure = 0;
        this.gloom = 0;
        this.prepared = true;
    }

    /** Starts the run (from the title screen, or again after one ended). */
    begin() {
        const game = this.game;
        if (!this.prepared) this.prepare(this.seed);
        this.active = true;
        this.ended = null;
        this.stamina = 1;
        this.exhausted = false;
        this._sprinting = false;
        this.records.runs++;
        saveRecords(this.records);

        game.playTime = 0;
        game.hud.setFootage(true);
        game.hud.setNotes(0, NOTE_COUNT);
        game.hud.setStamina(1, false);
        game.hud.setFade(false);
        game.hints.markUsed('edit');
        game.dread.start();
        game.toast.clear();
        game.toast.show('Find the eight notes, then the way out.', 4500);
        game.toast.show('If you see it, look away.', 3500);
        game._applyEffects();
    }

    /** Ends the mode (leaving for the title, or for the other mode). The world is the caller's to replace. */
    stop() {
        this._clearMeshes();
        this.prepared = false;
        const wasActive = this.active;
        this.active = false;
        this.ended = null;
        this.gloom = 0;
        this.exposure = 0;
        this.game.hud.setFootage(false);
        this.game.hud.setFade(false);
        this.game.dread.stop();
        if (wasActive) this.game._applyEffects();
    }

    /**
     * One frame of the run.
     * @param {number} dt
     * @param {import('three').Object3D} view The camera, or the headset.
     */
    update(dt, view) {
        const game = this.game;
        if (!game.dread.built) game.dread.start();
        if (this.ended) {
            this._updateEnding(dt);
            return;
        }
        this.time += dt;
        this._updateStamina(dt);

        view.getWorldDirection(_forward);
        const length = Math.hypot(_forward.x, _forward.z) || 1;
        const viewer = this._viewer;
        viewer.x = view.position.x;
        viewer.z = view.position.z;
        viewer.fx = _forward.x / length;
        viewer.fz = _forward.z / length;
        viewer.halfFov = this._halfFov();

        this._pickUpNotes(viewer);

        const caught = this.watcher.update(dt, viewer, this._onWatcherEvent);
        this._placeWatcher(viewer);
        this.exposure = this.watcher.exposure;
        const progress = this.found / NOTE_COUNT;
        this.gloom = Math.min(0.92, 0.5 * progress + 0.45 * this.exposure);
        this._applyTape();

        const dread = game.dread;
        dread.setStatic(this.exposure);
        dread.setPresence(this.watcher.state === 'standing' ? Math.max(0, 1 - this.watcher.distance / 7) : 0);
        if (this.exit) {
            const dx = this.exit.x - viewer.x;
            const dz = this.exit.z - viewer.z;
            const distance = Math.hypot(dx, dz) || 1;
            // Right is (−fz, fx) for a forward of (fx, fz).
            dread.setBeacon(Math.max(0, 1 - distance / BEACON_RANGE) ** 1.5, (dx * -viewer.fz + dz * viewer.fx) / distance);
            if (!inArena(cellCoord(viewer.x), cellCoord(viewer.z))) this._end('escaped', viewer);
        }
        if (caught && !this.ended) this._end('caught', viewer);
        dread.update(dt);
    }

    /**
     * Applies the stamina to the player's input: no sprinting once spent, and nothing at all once the run
     * has ended.
     * @param {import('../player/Player.js').MoveInput} input
     */
    filterInput(input) {
        if (this.ended) {
            input.forward = input.right = input.up = 0;
            input.sprint = false;
            this._sprinting = false;
            return;
        }
        const wants = input.sprint && input.forward > 0.1;
        this._sprinting = wants && !this.exhausted;
        if (!this._sprinting) input.sprint = false;
    }

    /** What the ending screen shows. */
    summary() {
        const lines = [`Notes ${this.found}/${NOTE_COUNT}`, `Time ${formatTime(this.time)}`];
        if (this.records.best > 0) lines.push(`Best ${formatTime(this.records.best)}`);
        return {
            escaped: this.ended === 'escaped',
            title: this.ended === 'escaped' ? 'YOU GOT OUT' : 'SIGNAL LOST',
            lines,
        };
    }

    /** The line under the mode on the title screen. */
    describe() {
        const { runs, escapes, best } = this.records;
        const objective = 'Find the eight notes. Don\'t look at it.';
        if (best > 0) return `${objective}\nBest ${formatTime(best)} · escaped ${escapes}/${runs}`;
        return objective;
    }

    // ------------------------------------------------------------------ the run

    _updateStamina(dt) {
        this.stamina = MathUtils.clamp(this.stamina + (this._sprinting ? -dt / SPRINT_SECONDS : dt / RECOVER_SECONDS), 0, 1);
        if (this.stamina <= 0.01) this.exhausted = true;
        else if (this.exhausted && this.stamina >= EXHAUSTED_UNTIL) this.exhausted = false;
        this.game.hud.setStamina(this.stamina, this.exhausted);
        this.game.dread.setBreathing(this.stamina < 0.3);
    }

    /** @param {import('./Watcher.js').Viewer} viewer */
    _pickUpNotes(viewer) {
        for (let i = 0; i < this.notes.length; i++) {
            const mesh = this.noteMeshes[i];
            if (!mesh.visible) continue;
            const note = this.notes[i];
            const dx = note.x - viewer.x;
            const dz = note.z - viewer.z;
            const distance = Math.hypot(dx, dz);
            if (distance > PICKUP_DISTANCE) continue;
            // From in front of it (not through the wall it's on), looking at it.
            if (dx * note.nx + dz * note.nz > 0) continue;
            if (distance > 0.05 && (dx * viewer.fx + dz * viewer.fz) / distance < PICKUP_FACING) continue;
            this._take(i, viewer);
        }
    }

    _take(index, viewer) {
        const game = this.game;
        this.noteMeshes[index].visible = false;
        this.found++;
        game.hud.setNotes(this.found, NOTE_COUNT);
        game.hud.showNote(this.noteAtlas.images[this.notes[index].index]);
        game.dread.drum();
        game.dread.setLayers(this.found);
        game._glitch(0.35, 0.4);
        // Rises with each note: barely there after the first, never far after the last.
        this.watcher.aggression = Math.min(1, 0.1 + 0.9 * (this.found / NOTE_COUNT) ** 1.1);
        if (this.found === 1) this.watcher.activate();
        if (game.vr.presenting) game.toast.flash(`Note ${this.found} of ${NOTE_COUNT}.`, 2500);
        if (this.found === NOTE_COUNT) this._openExit(viewer);
    }

    _openExit(viewer) {
        const game = this.game;
        this.exit = openExit(this.store, viewer.x, viewer.z);
        for (const [x, z] of this.exit.cells) game.world.refreshCell(x, z);
        // Light, where there was a wall.
        const { x, z, dx, dz } = this.exit;
        const mesh = new Mesh(new PlaneGeometry(2, 1), this.materials.exit);
        mesh.position.set(x + dx * 0.3, 0.5, z + dz * 0.3);
        mesh.rotation.y = Math.atan2(-dx, -dz);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.group.add(mesh);
        this.exitMesh = mesh;
        this.watcher.aggression = 1;
        game.toast.flash('The way out is open. Listen for it.', 4500);
    }

    /** @param {import('./Watcher.js').WatcherEvent} event */
    _watcherEvent(event) {
        if (event === 'closer') {
            // The tape jumps.
            this.game._glitch(0.5, 0.6);
            const w = this.watcher;
            const v = this._viewer;
            const dx = w.x - v.x;
            const dz = w.z - v.z;
            const distance = Math.hypot(dx, dz) || 1;
            this.game.audio.buzz(0.3, (dx * -v.fz + dz * v.fx) / distance);
        }
    }

    /** @param {import('./Watcher.js').Viewer} viewer */
    _placeWatcher(viewer) {
        const w = this.watcher;
        const mesh = this.watcherMesh;
        if (w.state !== 'standing') {
            mesh.visible = false;
            return;
        }
        mesh.position.set(w.x, 0, w.z);
        mesh.rotation.y = Math.atan2(viewer.x - w.x, viewer.z - w.z);
        // The tape can't quite hold it: the odd frame drops out while it's in the picture.
        mesh.visible = !(w.seen && Math.random() < 0.06);
    }

    /** The tape: the settings' picture, worse with every note, and going to static with the exposure. */
    _applyTape() {
        const u = this.game.post.vhs;
        const e = this.game.settings.effects;
        const p = this.found / NOTE_COUNT;
        const x = this.exposure;
        u.staticAmount.value = e.static.amount + 0.06 * p + x * x * 0.9;
        u.badTVDistortion.value = e.badTV.distortion + 0.25 * p + x * 0.9;
        u.badTVDistortion2.value = e.badTV.distortion2 + 0.4 * p + x * 1.5;
        u.rgbShiftAmount.value = e.rgbShift.amount + x * 0.006;
        u.filmNoiseIntensity.value = e.film.noise + x * 0.4;
    }

    _halfFov() {
        const game = this.game;
        if (game.vr.presenting) return 0.85;
        const vertical = MathUtils.degToRad(game.camera.fov);
        return Math.atan(Math.tan(vertical / 2) * game.camera.aspect);
    }

    /**
     * @param {'caught' | 'escaped'} result
     * @param {import('./Watcher.js').Viewer} viewer
     */
    _end(result, viewer) {
        const game = this.game;
        this.ended = result;
        this._endTimer = 0;
        game.player.velocity.set(0, 0, 0);
        game.toast.suspend();
        if (result === 'caught') {
            // Right in front of you, filling the picture.
            const mesh = this.watcherMesh;
            mesh.position.set(viewer.x + viewer.fx * 0.42, 0, viewer.z + viewer.fz * 0.42);
            mesh.rotation.y = Math.atan2(-viewer.fx, -viewer.fz);
            mesh.visible = true;
            this.exposure = 1;
            // The lights go with the tape over the next second, not at once: for a beat it's a black shape
            // against a lit room.
            this._gloomAtEnd = this.gloom;
            this._applyTape();
            game.dread.setStatic(1);
            game.dread.caught();
            game._glitch(1, 1.5);
        } else {
            this.records.escapes++;
            if (this.records.best === 0 || this.time < this.records.best) this.records.best = this.time;
            saveRecords(this.records);
            game.dread.escaped();
            game.hud.setFade(true);
        }
    }

    _updateEnding(dt) {
        this._endTimer += dt;
        if (this.ended === 'caught') {
            // A beat with it right there in the picture, then the static takes the rest.
            const t = Math.min(this._endTimer / CAUGHT_SECONDS, 1);
            const u = this.game.post.vhs;
            this.gloom = this._gloomAtEnd + (0.92 - this._gloomAtEnd) * t;
            u.staticAmount.value = 0.25 + 0.75 * t * t;
            u.badTVDistortion2.value = 1.5 + 3 * t;
            u.rgbShiftAmount.value = 0.006 + 0.01 * t;
            const mesh = this.watcherMesh;
            mesh.visible = Math.random() > 0.12;
            mesh.position.y = (Math.random() - 0.5) * 0.02;
            if (this._endTimer >= CAUGHT_SECONDS) this.game.endFootage('caught');
        } else if (this._endTimer >= ESCAPE_SECONDS) {
            this.game.endFootage('escaped');
        }
    }

    // ------------------------------------------------------------------ the world, for the Watcher

    /** Whether nothing stands between two points at its eye height. */
    _clear(ax, az, bx, bz) {
        const dx = bx - ax;
        const dz = bz - az;
        const distance = Math.hypot(dx, dz);
        if (distance < 1e-6) return true;
        const hit = raycastWorld(ax, WATCHER_EYE, az, dx / distance, 0, dz / distance, distance, this.store);
        return hit === null || hit.distance > distance - 0.35;
    }

    /** Something solid in the middle of the cell (a chair, a sign). */
    _blocked(x, z) {
        for (const { box } of this.store.getChunk(chunkCoord(x), chunkCoord(z)).props) {
            if (box && box[0] < x + 0.25 && box[2] > x - 0.25 && box[1] < z + 0.25 && box[3] > z - 0.25) return true;
        }
        return false;
    }

    /** How much light there is at a spot to see a black shape against: the panels there, or the flashlight on it. */
    _lit(x, z) {
        const lighting = this.game.lighting;
        let light = this.store.areaLight(x, z) * (1 - BLACKOUT_DARKNESS * lighting.blackout) * 1.5;
        if (lighting.flashlightOn) {
            const v = this._viewer;
            const dx = x - v.x;
            const dz = z - v.z;
            const distance = Math.hypot(dx, dz) || 1;
            const angle = Math.acos(Math.max(-1, Math.min(1, (dx * v.fx + dz * v.fz) / distance)));
            if (angle < FLASHLIGHT_CONE && distance < FLASHLIGHT_REACH) light += 0.9 * (1 - distance / FLASHLIGHT_REACH);
        }
        return MathUtils.clamp(light, 0, 1);
    }

    _clearMeshes() {
        for (const mesh of this.noteMeshes) {
            this.group.remove(mesh);
            mesh.geometry.dispose();
        }
        this.noteMeshes.length = 0;
        this.notes = [];
        if (this.exitMesh) {
            this.group.remove(this.exitMesh);
            this.exitMesh.geometry.dispose();
            this.exitMesh = null;
        }
        this.exit = null;
        this.watcherMesh.visible = false;
    }
}

/** A sheet of paper, showing one note of the atlas. */
function noteGeometry({ u0, v0, u1, v1 }) {
    const geometry = new PlaneGeometry(NOTE_WIDTH, NOTE_HEIGHT);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    return geometry;
}

/** Tall and thin, arms to its knees, no face. Taller than a doorway. */
function buildWatcherMesh(material) {
    const parts = [
        new BoxGeometry(0.075, 0.09, 0.075).translate(0, 0.84, 0),
        new BoxGeometry(0.03, 0.05, 0.03).translate(0, 0.775, 0),
        new BoxGeometry(0.17, 0.34, 0.09).translate(0, 0.6, 0),
        new BoxGeometry(0.05, 0.44, 0.06).translate(-0.045, 0.22, 0),
        new BoxGeometry(0.05, 0.44, 0.06).translate(0.045, 0.22, 0),
        new BoxGeometry(0.035, 0.44, 0.045).translate(-0.115, 0.5, 0),
        new BoxGeometry(0.035, 0.44, 0.045).translate(0.115, 0.5, 0),
    ];
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    const mesh = new Mesh(merged, material);
    mesh.name = 'watcher';
    mesh.castShadow = true;
    return mesh;
}
