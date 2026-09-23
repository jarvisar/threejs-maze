import { AdditiveBlending, BackSide, BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group, MathUtils, Matrix4, Mesh, MeshBasicMaterial, MeshPhongMaterial, NearestFilter, PlaneGeometry, PointLight, Quaternion, RepeatWrapping, SRGBColorSpace, SphereGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { raycastWorld } from '../player/raycast.js';
import { ChunkStore, chunkCoord } from '../world/ChunkStore.js';
import { withBackroomsShading } from '../world/materials.js';
import { BLACKOUT_DARKNESS } from '../world/panelLights.js';
import { wallpaperOffset } from '../world/random.js';
import { NOTE_COUNT, NOTE_HEIGHT, NOTE_WIDTH, arenaOptions, inArena, openExit, placeNotes } from './arena.js';
import { createNoteAtlas } from './noteTextures.js';
import { formatTime, loadRecords, saveRecords } from './records.js';
import { ScreenGuard } from './screenGuard.js';
import { Watcher } from './Watcher.js';

/*
 * Found Footage: the game mode.
 *
 * A walled-in piece of the level with eight notes pinned to its walls, each next to a TV someone left on:
 * a glow down a corridor and a hiss through the walls, so there's always one to head for. Take them all and
 * the way out opens in the wall. Something is in there with you; it comes once you've taken the first note
 * (or if you take too long about it), and more often and closer with every note after that (see
 * Watcher.js). Nobody ever sees it arrive or go: it only does either out of shot (see screenGuard.js).
 * Look at it and the tape goes: static, the lights failing, the sound. Let it get to 1 and the tape ends.
 * When it's close the picture breaks up whichever way you're facing, which is the warning to keep moving.
 *
 * With every note the level also gets a little darker and the tape a little worse, so the run itself is
 * the progression: the last stretch, to the way out, is dark, loud and crowded.
 *
 * This is the glue: it owns the arena (its own ChunkStore), the notes, their TVs, the figure's mesh, the way
 * out, the stamina, and it turns the Watcher into the picture and the sound.
 */

// How near, and how squarely, you have to face a note to take it.
const PICKUP_DISTANCE = 0.72;
const PICKUP_FACING = 0.35;
// If the first note still hasn't been taken by then, it comes anyway.
const WAKE_SECONDS = 90;
// The TVs: from how far the nearest one can be heard, and how bright the light off the screen is.
const TV_RANGE = 16;
const TV_GLOW = 0.5;
const SCREEN_COLOR = new Color(0xd6dee8);
// Nearer than this and the picture starts to break up, whichever way you're facing.
const NEAR_STATIC = 4.5;
// Catching sight of it plays a sting: always when it's this close, otherwise no more often than this.
const STING_CLOSE = 3.5;
const STING_SECONDS = 10;
// In a headset, how much of the world the picture can take in (vertical degrees, and width over height):
// more than any headset shows, since it can't be read from the headset in time.
const VR_FOV = 110;
const VR_ASPECT = 1.2;
// Sprinting: seconds of it in a row, seconds to get it all back, and how much you need before you can again.
const SPRINT_SECONDS = 7;
const RECOVER_SECONDS = 11;
const EXHAUSTED_UNTIL = 0.35;
// The endings: how long the picture holds before the screen (the tape ending; the fade out of the door).
const CAUGHT_SECONDS = 1.1;
const ESCAPE_SECONDS = 1.6;
// The light from the way out: how bright, and how far it reaches.
const EXIT_LIGHT_INTENSITY = 1.4 * Math.PI;
const EXIT_LIGHT_RANGE = 3.4;
// How far past the wall you have to get to be out.
const ESCAPE_DEPTH = 0.3;
// From how far the way out can be heard.
const BEACON_RANGE = 44;
// Its eyes, and the flashlight's beam (half angle, matching the SpotLight).
const WATCHER_EYE = 0.55;
const FLASHLIGHT_CONE = Math.PI / 6;
const FLASHLIGHT_REACH = 9;

const _forward = new Vector3();
const _eye = new Vector3();
const _look = new Quaternion();

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
        const glowTexture = createGlowTexture();
        this.staticTexture = createStaticTexture();
        this.materials = {
            // Lit a little by the TV under it, so it can be read in the dark.
            note: withBackroomsShading(new MeshPhongMaterial({ map: this.noteAtlas.texture, emissive: 0x2a2e33, emissiveMap: this.noteAtlas.texture, shininess: 4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })),
            // Unlit, so it's a silhouette whatever the light; the haze takes less of it than it should.
            watcher: withBackroomsShading(new MeshBasicMaterial({ color: 0x07070a }), 'figure'),
            // A TV's screen, showing a dead channel, and the light off it on the wall and the carpet. Not
            // fogged, like the way out, so it shows through the haze.
            screen: new MeshBasicMaterial({ map: this.staticTexture, color: SCREEN_COLOR.clone(), fog: false }),
            tvGlow: new MeshBasicMaterial({ map: glowTexture, color: 0xb4c8e6, transparent: true, opacity: TV_GLOW, blending: AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
            // The way out: white past the wall, a glow around the gap, and its light on the floor. Not fogged,
            // so it shows through the haze from further off than anything else.
            exit: new MeshBasicMaterial({ color: 0xffffff, fog: false, side: BackSide }),
            exitGlow: new MeshBasicMaterial({ map: glowTexture, color: 0xfff4d6, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, fog: false }),
            exitSpill: new MeshBasicMaterial({ map: glowTexture, color: 0xfff4d6, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
        };
        this.textures = [this.noteAtlas.texture, glowTexture, this.staticTexture];
        this.tvGeometry = {
            screen: new PlaneGeometry(0.112, 0.094),
            wall: new PlaneGeometry(0.75, 0.6),
            floor: new PlaneGeometry(0.7, 0.7).rotateX(-Math.PI / 2),
        };

        this.group = new Group();
        this.group.name = 'found footage';
        game.scene.add(this.group);

        /** @type {import('./arena.js').Note[]} */
        this.notes = [];
        /** @type {Mesh[]} */
        this.noteMeshes = [];
        /** @type {Television[]} One per note. */
        this.tvs = [];
        /** @type {import('./arena.js').Exit | null} */
        this.exit = null;
        /** @type {Mesh | null} */
        this.exitMesh = null;
        // The way out's light on the walls and floor around it. In the scene from the start, off, so that
        // turning it on doesn't mean compiling every material again at the worst moment.
        this.exitLight = new PointLight(0xfff2d4, 0, EXIT_LIGHT_RANGE, 1);
        this.group.add(this.exitLight);
        this.watcherMesh = buildWatcherMesh(this.materials.watcher);
        this.watcherMesh.visible = false;
        this.group.add(this.watcherMesh);

        this.store = null;
        /** Where the picture is, and is about to be: it never arrives, moves or goes in there. */
        this.guard = new ScreenGuard();
        this.watcher = new Watcher({
            los: (ax, az, bx, bz) => this._clear(ax, az, bx, bz),
            free: (x, z) => inArena(x, z) && !this._blocked(x, z),
            lit: (x, z) => this._lit(x, z),
            onScreen: (x, z) => this.guard.covers(x, z),
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
        /** How close it's standing, 0 (not near) to 1 (on top of you): the picture breaking up. */
        this.nearness = 0;
        /** How much of the light is gone: the level darkening with the notes, and more when it's close. */
        this.gloom = 0;
        this._gloomAtEnd = 0;
        this._endTimer = 0;
        this._lastSting = -Infinity;
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
        game.textures.wallpaper.offset.set(...wallpaperOffset(seed));
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
            const tv = buildTelevision(note, this.materials, this.tvGeometry);
            this.group.add(tv.group);
            this.tvs.push(tv);
        }
        this.exit = null;
        this.watcher.reset();
        this.guard.reset();
        this.watcherMesh.visible = false;
        this.found = 0;
        this.time = 0;
        this._lastSting = -Infinity;
        this.exposure = 0;
        this.nearness = 0;
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
        game.hints.setMode('footage', 0);
        game.hud.setFootage(true);
        game.hud.setNotes(0, NOTE_COUNT);
        game.hud.setStamina(1, false);
        game.hud.setFade(false);
        game.hints.markUsed('edit');
        game.dread.start();
        game.toast.clear();
        game.toast.show('Find the eight notes. Listen for the TVs.', 4500);
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
        this.nearness = 0;
        this.game.hud.setFootage(false);
        this.game.hud.setFade(false);
        this.game.hints.setMode('explore', this.game.playTime);
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
        this._updateTelevisions(dt, viewer);
        this._followCamera(dt, view);

        const watcher = this.watcher;
        if (!watcher.active && this.time >= WAKE_SECONDS) watcher.activate();
        const caught = watcher.update(dt, viewer, this._onWatcherEvent);
        this._placeWatcher(viewer);
        this.exposure = watcher.exposure;
        const standing = watcher.state === 'standing';
        this.nearness = standing ? Math.max(0, 1 - watcher.distance / NEAR_STATIC) : 0;
        const progress = this.found / NOTE_COUNT;
        this.gloom = Math.min(0.92, 0.5 * progress + 0.45 * this.exposure);
        this._applyTape();

        const dread = game.dread;
        dread.setStatic(Math.max(this.exposure, 0.55 * this.nearness));
        if (standing) {
            const dx = watcher.x - viewer.x;
            const dz = watcher.z - viewer.z;
            const pan = (dx * -viewer.fz + dz * viewer.fx) / (watcher.distance || 1);
            dread.setPresence(MathUtils.clamp(1.1 - watcher.distance / 9, 0, 1), pan);
        } else {
            dread.setPresence(0, 0);
        }
        if (this.exit) {
            const dx = this.exit.x - viewer.x;
            const dz = this.exit.z - viewer.z;
            const distance = Math.hypot(dx, dz) || 1;
            // Right is (−fz, fx) for a forward of (fx, fz).
            dread.setBeacon(Math.max(0, 1 - distance / BEACON_RANGE) ** 1.5, (dx * -viewer.fz + dz * viewer.fx) / distance);
            // Out once you're in the light, a step past the wall.
            if ((viewer.x - this.exit.x) * this.exit.dx + (viewer.z - this.exit.z) * this.exit.dz > ESCAPE_DEPTH) this._end('escaped', viewer);
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
        // Its TV goes off.
        const tv = this.tvs[index];
        tv.offFor = 0;
        for (const glow of tv.glows) glow.visible = false;
        game.dread.tvOff();
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
        this.exitMesh = buildExit(this.exit, this.materials);
        this.group.add(this.exitMesh);
        // Just outside the gap, so it only reaches what faces it.
        const { x, z, dx, dz } = this.exit;
        this.exitLight.position.set(x + dx * 0.35, 0.55, z + dz * 0.35);
        this.exitLight.intensity = EXIT_LIGHT_INTENSITY;
        this.watcher.aggression = 1;
        game.toast.flash('The way out is open. Listen for it.', 4500);
    }

    /**
     * The TVs that are still on: the static crawling on their screens, the light off them flickering with
     * it, the nearest one heard from where it is, and the one whose note was just taken switching off.
     * @param {number} dt
     * @param {import('./Watcher.js').Viewer} viewer
     */
    _updateTelevisions(dt, viewer) {
        this.staticTexture.offset.set(Math.random(), Math.random());
        const flicker = 0.9 + 0.06 * Math.sin(this.time * 11.3) * Math.sin(this.time * 3.7) + 0.04 * Math.random();
        this.materials.screen.color.copy(SCREEN_COLOR).multiplyScalar(flicker);
        this.materials.tvGlow.opacity = TV_GLOW * flicker;

        let nearest = null;
        let nearestDistance = TV_RANGE;
        for (const tv of this.tvs) {
            if (tv.offFor >= 0) {
                if (tv.screen.visible) switchingOff(tv, dt);
                continue;
            }
            const distance = Math.hypot(tv.x - viewer.x, tv.z - viewer.z);
            if (distance < nearestDistance) {
                nearest = tv;
                nearestDistance = distance;
            }
        }
        if (!nearest) {
            this.game.dread.setTelevision(0, 0, false);
            return;
        }
        const d = nearestDistance || 1;
        const pan = ((nearest.x - viewer.x) * -viewer.fz + (nearest.z - viewer.z) * viewer.fx) / d;
        const clear = this._clear(viewer.x, viewer.z, nearest.x, nearest.z);
        this.game.dread.setTelevision((1 - nearestDistance / TV_RANGE) ** 2, pan, clear);
    }

    /**
     * Tells the guard where the picture is this frame: the camera as it's about to be drawn, through the
     * widest the lens goes, or in a headset, wider than any headset sees, and a snap turn either way.
     * @param {number} dt
     * @param {import('three').Object3D} view
     */
    _followCamera(dt, view) {
        const game = this.game;
        view.updateWorldMatrix(true, false);
        view.getWorldPosition(_eye);
        view.getWorldQuaternion(_look);
        if (game.vr.presenting) {
            const snap = game.settings.vr.snapTurn;
            this.guard.update(dt, _eye, _look, VR_FOV, VR_ASPECT, snap > 0 ? MathUtils.degToRad(snap) : 0);
        } else {
            const fov = Math.max(game.settings.gameplay.fieldOfView, game.camera.fov);
            this.guard.update(dt, _eye, _look, fov, game.camera.aspect);
        }
    }

    /** @param {import('./Watcher.js').WatcherEvent} event */
    _watcherEvent(event) {
        const game = this.game;
        if (event === 'appear') {
            // Something settling, just out of shot: enough to turn round for.
            const w = this.watcher;
            const v = this._viewer;
            const dx = w.x - v.x;
            const dz = w.z - v.z;
            const distance = Math.hypot(dx, dz) || 1;
            game.dread.arrival(MathUtils.clamp(1.2 - distance / 8, 0.2, 1), (dx * -v.fz + dz * v.fx) / distance);
        } else if (event === 'seen') {
            if (this.watcher.distance < STING_CLOSE || this.time - this._lastSting > STING_SECONDS) {
                this._lastSting = this.time;
                game.dread.sting();
            }
            game._glitch(0.6, 0.5);
        } else if (event === 'closer') {
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
        const n = this.nearness;
        u.staticAmount.value = e.static.amount + 0.06 * p + x * x * 0.9 + n * n * 0.3;
        u.badTVDistortion.value = e.badTV.distortion + 0.25 * p + x * 0.9;
        u.badTVDistortion2.value = e.badTV.distortion2 + 0.4 * p + x * 1.5 + n * 0.8;
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
        for (const tv of this.tvs) this.group.remove(tv.group);
        this.tvs.length = 0;
        this.notes = [];
        if (this.exitMesh) {
            this.group.remove(this.exitMesh);
            this.exitMesh.traverse((object) => /** @type {Mesh} */ (object).geometry?.dispose());
            this.exitMesh = null;
        }
        this.exit = null;
        this.exitLight.intensity = 0;
        this.watcherMesh.visible = false;
    }
}

/**
 * The way out: a white space beyond the gap in the wall (seen from inside it, so walking in fills the
 * picture with white), a glow over the wall around the gap, and its light spilling across the floor.
 * @param {import('./arena.js').Exit} exit
 */
function buildExit({ x, z, dx, dz }, materials) {
    const group = new Group();
    group.name = 'way out';
    group.position.set(x, 0, z);
    // Local −z points out of the arena, +z into it.
    group.rotation.y = Math.atan2(-dx, -dz);

    const DEPTH = 3;
    const space = new Mesh(new BoxGeometry(1.98, 0.99, DEPTH), materials.exit);
    space.position.set(0, 0.5, -DEPTH / 2 + 0.04);
    const glow = new Mesh(new PlaneGeometry(3.4, 1.7), materials.exitGlow);
    glow.position.set(0, 0.5, 0.07);
    const spill = new Mesh(new PlaneGeometry(2.8, 4.4), materials.exitSpill);
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(0, 0.002, 0);
    group.add(space, glow, spill);
    group.traverse((object) => {
        object.matrixAutoUpdate = false;
        object.updateMatrix();
    });
    group.updateMatrixWorld(true);
    return group;
}

/**
 * @typedef {object} Television
 * @property {Group} group
 * @property {Mesh} screen
 * @property {Mesh[]} glows Its light on the wall and the carpet.
 * @property {number} x Where the set is.
 * @property {number} z
 * @property {number} offFor Seconds since it was switched off, or -1 while it's on.
 */

/**
 * The TV left on beside a note: a lit screen over the monitor's dark one, a wash of its light on the wall
 * behind (under the note, which it lights), and a pool of it on the carpet in front.
 * @param {import('./arena.js').Note} note
 * @returns {Television}
 */
function buildTelevision(note, materials, geometry) {
    const { tv, nx, nz } = note;
    const group = new Group();
    group.name = 'tv';

    // In front of the monitor's face (see monitor() in props.js), which faces +z before it's turned.
    const screen = new Mesh(geometry.screen, materials.screen);
    screen.position.set(tv.x + Math.sin(tv.yaw) * 0.061, 0.102, tv.z + Math.cos(tv.yaw) * 0.061);
    screen.rotation.y = tv.yaw;

    // Along the wall from the note towards the set, so the light sits between them.
    const toTvX = tv.x - note.x;
    const toTvZ = tv.z - note.z;
    const out = toTvX * nx + toTvZ * nz;
    const alongX = toTvX - nx * out;
    const alongZ = toTvZ - nz * out;
    const wall = new Mesh(geometry.wall, materials.tvGlow);
    // Just behind the note, which floats a little further off the wall.
    wall.position.set(note.x - nx * 0.002 + alongX * 0.4, 0.3, note.z - nz * 0.002 + alongZ * 0.4);
    wall.rotation.y = Math.atan2(nx, nz);

    // Between the middle of the cell and the set.
    const floor = new Mesh(geometry.floor, materials.tvGlow);
    floor.position.set(MathUtils.lerp(note.cellX, tv.x, 0.45), 0.003, MathUtils.lerp(note.cellZ, tv.z, 0.45));

    group.add(screen, wall, floor);
    for (const object of group.children) {
        object.matrixAutoUpdate = false;
        object.updateMatrix();
    }
    return { group, screen, glows: [wall, floor], x: tv.x, z: tv.z, offFor: -1 };
}

/** A TV going off, the way they did: the picture folds to a bright line, the line to a dot, then nothing. */
function switchingOff(tv, dt) {
    tv.offFor += dt;
    const t = tv.offFor;
    const screen = tv.screen;
    if (t < 0.07) screen.scale.set(1, 1 - 0.96 * (t / 0.07), 1);
    else if (t < 0.22) screen.scale.set(1 - 0.94 * ((t - 0.07) / 0.15), 0.04, 1);
    else screen.visible = false;
    screen.updateMatrix();
}

/** Snow for the screens: random greys, sampled at a different place every frame. */
function createStaticTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const image = context.createImageData(64, 64);
    for (let i = 0; i < image.data.length; i += 4) {
        const v = 40 + Math.random() * 215;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
        image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(0.45, 0.3);
    return texture;
}

/** A soft white spot fading to nothing at its edge. */
function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
    gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.15)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

/** A sheet of paper, showing one note of the atlas. */
function noteGeometry({ u0, v0, u1, v1 }) {
    const geometry = new PlaneGeometry(NOTE_WIDTH, NOTE_HEIGHT);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    return geometry;
}

/**
 * Tall and thin, arms to its knees, no face; taller than a doorway. Tapered limbs and a head tipped to one
 * side, so even as a black shape at the end of a hall it doesn't read as a person.
 */
function buildWatcherMesh(material) {
    const parts = [
        // Legs, a little apart at the feet.
        limb([-0.048, 0, 0], [-0.036, 0.46, 0], 0.016, 0.026),
        limb([0.05, 0, 0.01], [0.036, 0.46, 0], 0.016, 0.026),
        // Hips to shoulders, narrow at the waist, stooped forward a touch.
        limb([0, 0.44, 0], [0, 0.745, 0.018], 0.05, 0.085, 0.5),
        // Arms, hanging past the knees; one slightly bent.
        limb([-0.085, 0.735, 0.015], [-0.108, 0.5, 0.02], 0.02, 0.016),
        limb([-0.108, 0.5, 0.02], [-0.116, 0.27, 0.035], 0.016, 0.011),
        limb([0.085, 0.735, 0.015], [0.11, 0.48, 0.005], 0.02, 0.016),
        limb([0.11, 0.48, 0.005], [0.112, 0.25, 0.01], 0.016, 0.011),
        // Long fingers.
        limb([-0.116, 0.27, 0.035], [-0.12, 0.2, 0.045], 0.011, 0.003),
        limb([0.112, 0.25, 0.01], [0.116, 0.18, 0.012], 0.011, 0.003),
        // Neck and head, tipped over.
        limb([0, 0.74, 0.018], [0.012, 0.8, 0.03], 0.016, 0.014),
        head(),
    ];
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    const mesh = new Mesh(merged, material);
    mesh.name = 'watcher';
    mesh.castShadow = true;
    return mesh;
}

const _up = new Vector3(0, 1, 0);
const _direction = new Vector3();
const _quaternion = new Quaternion();
const _matrix = new Matrix4();
const _position = new Vector3();
const _unit = new Vector3(1, 1, 1);

/**
 * A tapered cylinder from one point to another.
 * @param {number[]} from
 * @param {number[]} to
 * @param {number} r0 Radius at `from`.
 * @param {number} r1 Radius at `to`.
 * @param {number} [depth] How deep it is front to back, as a fraction of its width (a flat chest).
 */
function limb(from, to, r0, r1, depth = 1) {
    _direction.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const length = _direction.length();
    const geometry = new CylinderGeometry(r1, r0, length, 7, 1).scale(1, 1, depth).translate(0, length / 2, 0);
    _quaternion.setFromUnitVectors(_up, _direction.normalize());
    _matrix.compose(_position.set(from[0], from[1], from[2]), _quaternion, _unit);
    return geometry.applyMatrix4(_matrix);
}

function head() {
    return new SphereGeometry(1, 9, 7)
        .scale(0.042, 0.062, 0.046)
        .rotateZ(-0.38)
        .rotateX(0.15)
        .translate(0.03, 0.845, 0.04);
}
