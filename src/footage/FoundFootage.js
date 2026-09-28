import { AdditiveBlending, BackSide, BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group, MathUtils, Matrix4, Mesh, MeshBasicMaterial, MeshPhongMaterial, NearestFilter, PlaneGeometry, PointLight, Quaternion, RepeatWrapping, SRGBColorSpace, SphereGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VIEW_DISTANCE } from '../config.js';
import { raycastWorld } from '../player/raycast.js';
import { ChunkStore, chunkCoord } from '../world/ChunkStore.js';
import { EDGE_WALL } from '../world/grid.js';
import { TAPE_LEVELS, isFirstTapeLevel, leadsToParty, levelById } from '../world/levels.js';
import { withBackroomsShading } from '../world/materials.js';
import { BLACKOUT_DARKNESS } from '../world/panelLights.js';
import { createFaceGeometry, hat } from '../world/partyGeometry.js';
import { wallpaperOffset } from '../world/random.js';
import { NOTE_COUNT, NOTE_HEIGHT, NOTE_WIDTH, arenaOptions, inArena, openExit, placeNotes } from './arena.js';
import { createNoteAtlas } from './noteTextures.js';
import { formatTime, loadRecords, saveRecords } from './records.js';
import { ScreenGuard } from './screenGuard.js';
import { inSight } from './sighting.js';
import { Watcher } from './Watcher.js';

/*
 * Found Footage game mode. Same on every level, levels.js has the per-level parts.
 *
 * A tape goes down through TAPE_LEVELS. Each level is a walled arena with eight notes on the walls, each next to a
 * TV that glows and hisses so there's always one to head for. Take them all and the exit opens. The Watcher wakes on
 * the first note (or after a timeout) and gets more frequent and closer with each note (see Watcher.js). Nobody sees
 * it appear, move or vanish (see screenGuard.js and _inSight here). Looking at it or being near it ruins the tape
 * (static, failing lights, noise). At 1 the tape ends.
 *
 * Each note also makes the level darker and the tape worse, so the last stretch to the exit is the hardest. The exit
 * leads to the next tape level, and the last one leads to Level Fun (see Game).
 *
 * This file is the glue. It owns the arena ChunkStore, notes, TVs, Watcher mesh, exit and stamina, and turns the
 * Watcher state into visuals and sound.
 */

// Max distance and min facing to take a note.
const PICKUP_DISTANCE = 0.72;
const PICKUP_FACING = 0.35;
// It wakes anyway if the first note isn't taken by then (s).
const WAKE_SECONDS = 90;
// Hearing range for the nearest TV, and screen glow brightness.
const TV_RANGE = 16;
const TV_GLOW = 0.5;
const SCREEN_COLOR = new Color(0xd6dee8);
// Max distance (cells) for a TV to count as seen and go on the map until its note is taken (see Minimap).
// VIEW_DISTANCE is the fog limit. Lower makes it harder.
const TV_SIGHTING = VIEW_DISTANCE - 1;
// How far a TV's light shows past the edge of the screen and still counts as seen.
const TV_GLOW_REACH = 0.4;
const NO_MARKS = Object.freeze([]);
// Closer than this the picture starts breaking up whichever way you face, as a warning before exposure rises
// (compare WatcherBalance.near).
const NEAR_STATIC = 1.5;
// Seeing it plays a sting. Always when this close, otherwise at most once per STING_SECONDS.
const STING_CLOSE = 3.5;
const STING_SECONDS = 10;
// Visibility checks past walls: radius around the figure (a bit wider than its arms), sample heights, and how far
// ahead of the player to allow for movement.
const SIGHT_RADIUS = 0.18;
const SIGHT_HEIGHTS = [0.05, 0.45, 0.9];
const SIGHT_AHEAD = 0.35;
// VR view for the screen guard (vertical degrees, aspect). Bigger than any headset since we can't read the real one
// in time.
const VR_FOV = 110;
const VR_ASPECT = 1.2;
// Sprint duration (s), full recovery time (s), and stamina needed before you can sprint again.
const SPRINT_SECONDS = 7;
const RECOVER_SECONDS = 11;
const EXHAUSTED_UNTIL = 0.35;
// How long the last frame holds before the end screen (caught, and the fade out the exit).
const CAUGHT_SECONDS = 1.1;
const ESCAPE_SECONDS = 1.6;
const EXIT_LIGHT_INTENSITY = 1.4 * Math.PI;
const EXIT_LIGHT_RANGE = 3.4;
// How far past the wall counts as out.
const ESCAPE_DEPTH = 0.3;
// Exit of the last level, with the party behind it: music range, and how often confetti blows in while you're near.
const PARTY_RANGE = 40;
const PARTY_NEAR = 10;
const CONFETTI_EVERY = 0.35;
// Hearing range for the exit.
const BEACON_RANGE = 44;
// Eye height of the Watcher.
const WATCHER_EYE = 0.55;
// In water it stands on the bottom but no deeper than this, so it's waist deep in a pool.
const WATCHER_WADE = 0.35;
// Flashlight half angle (matches the SpotLight) and reach.
const FLASHLIGHT_CONE = Math.PI / 6;
const FLASHLIGHT_REACH = 9;

// Exit glow and light are a bit warmer than the white behind it.
const EXIT_GLOW_TINT = new Color(0xfff4d6);
const EXIT_LIGHT_TINT = new Color(0xfff2d4);

const _forward = new Vector3();
// Points around the figure to check past walls: center and four corners.
const SIGHT_POINTS = [[0, 0], [-SIGHT_RADIUS, -SIGHT_RADIUS], [SIGHT_RADIUS, -SIGHT_RADIUS], [-SIGHT_RADIUS, SIGHT_RADIUS], [SIGHT_RADIUS, SIGHT_RADIUS]];
const _eye = new Vector3();
const _look = new Quaternion();

export class FoundFootage {
    /** @param {import('../Game.js').Game} game */
    constructor(game) {
        this.game = game;
        /** Arena built and notes placed (the title screen shows it). */
        this.prepared = false;
        this.active = false;
        /** @type {'caught' | 'escaped' | null} How the run ended, set while the last seconds play out. */
        this.ended = null;
        this.seed = 0;
        this.level = TAPE_LEVELS[0];
        this.records = loadRecords();

        this.noteAtlas = createNoteAtlas();
        const glowTexture = createGlowTexture();
        this.staticTexture = createStaticTexture();
        this.materials = {
            // Slightly emissive (the TV under it) so it can be read in the dark.
            note: withBackroomsShading(new MeshPhongMaterial({ map: this.noteAtlas.texture, emissive: 0x2a2e33, emissiveMap: this.noteAtlas.texture, shininess: 4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })),
            // Unlit so it's always a silhouette. The fog affects it less than normal.
            watcher: withBackroomsShading(new MeshBasicMaterial({ color: 0x07070a }), 'figure'),
            // TV screen static and its glow on the wall and floor. No fog so it shows through the haze.
            screen: new MeshBasicMaterial({ map: this.staticTexture, color: SCREEN_COLOR.clone(), fog: false, userData: { unoccluded: true } }),
            tvGlow: new MeshBasicMaterial({ map: glowTexture, color: 0xb4c8e6, transparent: true, opacity: TV_GLOW, blending: AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
            // Exit: white behind the wall, glow around the gap, light on the floor. No fog so it can be seen from
            // farther than anything else.
            exit: new MeshBasicMaterial({ color: 0xffffff, fog: false, side: BackSide, userData: { unoccluded: true } }),
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
        // Exit light. Added from the start at 0 intensity so turning it on later doesn't recompile every material
        // at the worst moment.
        this.exitLight = new PointLight(0xfff2d4, 0, EXIT_LIGHT_RANGE, 1);
        this.group.add(this.exitLight);
        this.watcherMesh = buildWatcherMesh(this.materials.watcher);
        this.watcherMesh.visible = false;
        this.group.add(this.watcherMesh);
        // Party hat and chalk face for Level Fun.
        this.costume = buildCostume(game.materials.party);
        this.costume.visible = false;
        this.watcherMesh.add(this.costume);

        this.store = null;
        /** Current and upcoming view. The Watcher never changes inside it. */
        this.guard = new ScreenGuard();
        /** Line of sight between two points (see _clear). */
        this._los = (ax, az, bx, bz) => this._clear(ax, az, bx, bz);
        this.watcher = new Watcher({
            los: this._los,
            free: (x, z) => inArena(x, z) && !this._blocked(x, z),
            lit: (x, z) => this._lit(x, z),
            open: (x, z, dx, dz) => this.store.edgeBetween(x, z, dx, dz) !== EDGE_WALL && inArena(x + dx, z + dz) && !this._blocked(x + dx, z + dz),
            inSight: (x, z) => this._inSight(x, z),
        });
        this._viewer = { x: 0, z: 0, fx: 0, fz: -1, halfFov: 1 };
        this._onWatcherEvent = (event) => this._watcherEvent(event);
        /**
         * Seen TVs whose notes haven't been taken, for the map (see Minimap.update). New array on every change.
         * @type {readonly { x: number, z: number }[]}
         */
        this.marks = NO_MARKS;

        this.found = 0;
        /** Seconds on this level, and on the whole tape. */
        this.time = 0;
        this.runTime = 0;
        this._stageStart = 0;
        this._confetti = 0;
        this.stamina = 1;
        this.exhausted = false;
        this._sprinting = false;
        /** Watcher exposure, 0..1. */
        this.exposure = 0;
        /** 0 (not near) to 1 (on top of you). Drives the picture breaking up. */
        this.nearness = 0;
        /** How much light is gone. Rises with notes and when it's close. */
        this.gloom = 0;
        this._gloomAtEnd = 0;
        this._endFloor = 0;
        this._endTimer = 0;
        this._lastSting = -Infinity;
    }

    /**
     * Builds the arena and places notes without starting the clock. The title screen shows it while the mode is
     * selected.
     * @param {number} seed
     * @param {number} [level] A tape starts on the first.
     */
    prepare(seed, level = TAPE_LEVELS[0]) {
        const game = this.game;
        this._clearMeshes();
        this.seed = seed;
        this.level = level;
        this.store = new ChunkStore(seed, null, arenaOptions(seed, level));
        game.store = this.store;
        game.textures.wallpaper.offset.set(...wallpaperOffset(seed));
        game.world.setStore(this.store);
        // Use the tape's level, not Explore's.
        game._applyLevel();
        this.notes = placeNotes(this.store, seed);
        this.watcher.balance = levelById(level).tape.watcher;
        // After the notes so the party avoids them and notes stay where they've always been for this tape.
        this.store.setParty(game.party);
        game.settle();
        game.lighting.update(0, this.store.areaLight(0, 0), true);
        game.player.reset();
        game.look.yaw = 0;
        game.look.pitch = 0;

        for (const note of this.notes) {
            const mesh = new Mesh(noteGeometry(this.noteAtlas.uv(this._noteImage(note))), this.materials.note);
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
        this.runTime = this._stageStart;
        this._lastSting = -Infinity;
        this.exposure = 0;
        this.nearness = 0;
        this.gloom = 0;
        this.prepared = true;
    }

    /**
     * Starts the run on the prepared level. Called from the title screen or after a run ends (new tape from the
     * first level, or retrying a later one).
     */
    begin() {
        const game = this.game;
        if (!this.prepared) this.prepare(this.seed, this.level);
        if (isFirstTapeLevel(this.level)) {
            this.records.runs++;
            saveRecords(this.records);
            this._stageStart = 0;
            this.runTime = 0;
        }
        game.playTime = this.runTime;
        game.hints.setMode('footage', 0);
        game.hints.markUsed('edit');
        game.toast.clear();
        if (isFirstTapeLevel(this.level)) {
            game.toast.show('Find the eight notes. Listen for the TVs.', 4500);
            game.toast.show('If you see it, look away.', 3500);
        } else {
            game.toast.show('Eight more notes.', 3500);
        }
        this._startLevel();
    }

    /**
     * Goes through the exit to the next level on the same tape. The clock keeps running.
     * @param {number} level
     */
    continueTo(level) {
        this._stageStart = this.runTime;
        this.prepare(this.seed, level);
        this._startLevel();
    }

    /** Per-level start: no notes, full stamina, Watcher asleep. */
    _startLevel() {
        const game = this.game;
        this.active = true;
        this.ended = null;
        this.stamina = 1;
        this.exhausted = false;
        this._sprinting = false;
        game.hud.setFootage(true);
        game.hud.setNotes(0, NOTE_COUNT);
        game.hud.setStamina(1, false);
        game.hud.setFade(false);
        game.dread.start();
        game.partyAudio.setBeacon(0, 0);
        game._applyEffects();
    }

    /** Leaves the mode (to the title or the other mode). The caller replaces the world. */
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
        this.game.partyAudio.setBeacon(0, 0);
        if (wasActive) this.game._applyEffects();
    }

    /**
     * @param {number} dt
     * @param {import('three').Object3D} view Camera or headset.
     */
    update(dt, view) {
        const game = this.game;
        if (!game.dread.built) game.dread.start();
        if (this.ended) {
            this._updateEnding(dt);
            return;
        }
        this.time += dt;
        this.runTime += dt;
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
        this._sightTelevisions(viewer);
        this._followCamera(dt, view);

        const watcher = this.watcher;
        if (!watcher.active && this.time >= WAKE_SECONDS) watcher.activate();
        const caught = watcher.update(dt, viewer, this._onWatcherEvent);
        this._placeWatcher(viewer);
        this.exposure = watcher.exposure;
        const standing = watcher.state === 'standing';
        this.nearness = standing ? Math.max(0, 1 - watcher.distance / (NEAR_STATIC * watcher.balance.near)) : 0;
        const progress = this.found / NOTE_COUNT;
        this.gloom = Math.min(0.92, 0.5 * progress + 0.45 * this.exposure + 0.25 * this.nearness);
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
            const pan = (dx * -viewer.fz + dz * viewer.fx) / distance;
            dread.setBeacon(Math.max(0, 1 - distance / BEACON_RANGE) ** 1.5, pan, (dx * viewer.fx + dz * viewer.fz) / distance);
            if (leadsToParty(this.level)) this._partyThrough(dt, distance, pan);
            // Escaped once you're a step past the wall.
            if ((viewer.x - this.exit.x) * this.exit.dx + (viewer.z - this.exit.z) * this.exit.dz > ESCAPE_DEPTH) this._end('escaped', viewer);
        }
        if (caught && !this.ended) this._end('caught', viewer);
    }

    /**
     * Blocks sprint when out of stamina, and all movement once the run has ended.
     * @param {import('../player/Player.js').MoveInput} input
     */
    filterInput(input) {
        if (this.ended) {
            input.forward = input.right = input.up = 0;
            input.sprint = input.jump = false;
            this._sprinting = false;
            return;
        }
        const wants = input.sprint && input.forward > 0.1;
        this._sprinting = wants && !this.exhausted;
        if (!this._sprinting) input.sprint = false;
    }

    /** Content for the end screen. */
    summary() {
        const lines = [levelById(this.level).name, `Notes ${this.found}/${NOTE_COUNT}`, `Time ${formatTime(this.runTime)}`];
        if (this.records.best > 0) lines.push(`Best ${formatTime(this.records.best)}`);
        return {
            escaped: this.ended === 'escaped',
            title: this.ended === 'escaped' ? 'YOU GOT OUT' : 'SIGNAL LOST',
            lines,
        };
    }

    /** Shows the party costume in Level Fun. */
    setParty(on) {
        this.costume.visible = on;
    }

    /** Text under the mode on the title screen. */
    describe() {
        const { runs, escapes, best, finishes, bestFinish } = this.records;
        const objective = 'Find the eight notes. Don\'t look at it.';
        if (finishes > 0) return `${objective}\nBest ${formatTime(best)} · escaped ${escapes}/${runs} · all the way ${finishes}, best ${formatTime(bestFinish)}`;
        if (best > 0) return `${objective}\nBest ${formatTime(best)} · escaped ${escapes}/${runs}`;
        return objective;
    }

    /** Index of a note's image in the atlas of all levels (see noteTextures.js). */
    _noteImage(note) {
        return this.level * NOTE_COUNT + note.index;
    }

    // ------------------------------------------------------------------ the run

    _updateStamina(dt) {
        this.stamina = MathUtils.clamp(this.stamina + (this._sprinting ? -dt / SPRINT_SECONDS : dt / RECOVER_SECONDS), 0, 1);
        if (this.stamina <= 0.01) this.exhausted = true;
        else if (this.exhausted && this.stamina >= EXHAUSTED_UNTIL) this.exhausted = false;
        this.game.hud.setStamina(this.stamina, this.exhausted);
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
            // Must be in front of it (not through the wall) and facing it.
            if (dx * note.nx + dz * note.nz > 0) continue;
            if (distance > 0.05 && (dx * viewer.fx + dz * viewer.fz) / distance < PICKUP_FACING) continue;
            this._take(i, viewer);
        }
    }

    _take(index, viewer) {
        const game = this.game;
        this.noteMeshes[index].visible = false;
        // Turn its TV off.
        const tv = this.tvs[index];
        tv.offFor = 0;
        for (const glow of tv.glows) glow.visible = false;
        this._markMap();
        game.dread.tvOff();
        this.found++;
        game.hud.setNotes(this.found, NOTE_COUNT);
        game.hud.showNote(this.noteAtlas.image(this._noteImage(this.notes[index])));
        game.dread.drum();
        game.dread.setLayers(this.found);
        game._glitch(0.35, 0.4);
        // Low after the first note, max after the last.
        this.watcher.aggression = Math.min(1, 0.1 + 0.9 * (this.found / NOTE_COUNT) ** 1.1);
        if (this.found === 1) this.watcher.activate();
        if (game.vr.presenting) {
            // The note image is on the page, which the headset can't see.
            game.toast.flash(`Note ${this.found} of ${NOTE_COUNT}.`, 2500);
            game.vr.pulse(0.5, 60);
        }
        if (this.found === NOTE_COUNT) this._openExit(viewer);
    }

    _openExit(viewer) {
        const game = this.game;
        this.exit = openExit(this.store, viewer.x, viewer.z);
        // Remove anything that hung on the removed wall.
        for (const [x, z] of this.exit.cells) this.store.redress(chunkCoord(x), chunkCoord(z));
        for (const [x, z] of this.exit.cells) game.world.refreshCell(x, z);
        // Exit color comes from the level (see levels.js).
        const color = levelById(this.level).tape.exitColor;
        this.materials.exit.color.set(color);
        this.materials.exitGlow.color.set(color).multiply(EXIT_GLOW_TINT);
        this.materials.exitSpill.color.set(color).multiply(EXIT_GLOW_TINT);
        this.exitLight.color.set(color).multiply(EXIT_LIGHT_TINT);
        this.exitMesh = buildExit(this.exit, this.materials);
        this.group.add(this.exitMesh);
        // Just outside the gap so it only lights what faces it.
        const { x, z, dx, dz } = this.exit;
        this.exitLight.position.set(x + dx * 0.35, 0.55, z + dz * 0.35);
        this.exitLight.intensity = EXIT_LIGHT_INTENSITY;
        this.watcher.aggression = 1;
        game.toast.flash('The way out is open. Listen for it.', 4500);
    }

    /**
     * Animates the static and glow flicker, positions the nearest TV's sound, and runs the switch-off of the TV whose
     * note was just taken.
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
        const front = ((nearest.x - viewer.x) * viewer.fx + (nearest.z - viewer.z) * viewer.fz) / d;
        const clear = this._clear(viewer.x, viewer.z, nearest.x, nearest.z);
        this.game.dread.setTelevision((1 - nearestDistance / TV_RANGE) ** 2, pan, clear, front);
    }

    /**
     * Adds newly seen TVs that are still on to the map (see TV_SIGHTING).
     * @param {import('./Watcher.js').Viewer} viewer
     */
    _sightTelevisions(viewer) {
        let seen = false;
        for (let i = 0; i < this.tvs.length; i++) {
            const tv = this.tvs[i];
            if (tv.sighted || tv.offFor >= 0 || !inSight(viewer, tv, this.notes[i], TV_SIGHTING, TV_GLOW_REACH, this._los)) continue;
            tv.sighted = true;
            seen = true;
        }
        if (seen) this._markMap();
    }

    /** Rebuilds the map marks from TVs that are seen and still on. */
    _markMap() {
        this.marks = this.tvs.filter((tv) => tv.sighted && tv.offFor < 0).map(({ x, z }) => ({ x, z }));
    }

    /**
     * Updates the screen guard with this frame's camera at its widest FOV. In VR it uses a view wider than any
     * headset plus a snap turn each way.
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
        if (event === 'seen') {
            if (this.watcher.distance < STING_CLOSE || this.time - this._lastSting > STING_SECONDS) {
                this._lastSting = this.time;
                game.dread.sting();
            }
            game._glitch(0.6, 0.5);
        } else if (event === 'closer') {
            // Tape glitch.
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
        mesh.position.set(w.x, this._floor(w.x, w.z), w.z);
        mesh.rotation.y = Math.atan2(viewer.x - w.x, viewer.z - w.z);
        // Drop the odd frame while it's in view, like the tape can't hold it.
        mesh.visible = !(w.seen && Math.random() < 0.06);
    }

    /** VHS settings plus extra damage per note and static from exposure. */
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
            // Put it right in front of you, filling the view.
            const mesh = this.watcherMesh;
            const x = viewer.x + viewer.fx * 0.42;
            const z = viewer.z + viewer.fz * 0.42;
            mesh.position.set(x, this._floor(x, z), z);
            this._endFloor = mesh.position.y;
            mesh.rotation.y = Math.atan2(-viewer.fx, -viewer.fz);
            mesh.visible = true;
            this.exposure = 1;
            // Fade the lights over the next second so for a beat it's a black shape against a lit room.
            this._gloomAtEnd = this.gloom;
            this._applyTape();
            game.dread.setStatic(1);
            game.dread.caught();
            game.vr.pulse(1, 500);
            game._glitch(1, 1.5);
        } else {
            // Records for escaping the first level and finishing the last.
            const records = this.records;
            if (isFirstTapeLevel(this.level)) {
                records.escapes++;
                if (records.best === 0 || this.time < records.best) records.best = this.time;
            }
            if (leadsToParty(this.level)) {
                records.finishes++;
                if (records.bestFinish === 0 || this.runTime < records.bestFinish) records.bestFinish = this.runTime;
            }
            saveRecords(records);
            game.dread.escaped();
            // Fade to white, then Game.leaveLevel.
            game.hud.setFade(true, 'white');
        }
    }

    _updateEnding(dt) {
        this._endTimer += dt;
        if (this.ended === 'caught') {
            // Hold on it for a beat, then static takes over.
            const t = Math.min(this._endTimer / CAUGHT_SECONDS, 1);
            const u = this.game.post.vhs;
            this.gloom = this._gloomAtEnd + (0.92 - this._gloomAtEnd) * t;
            u.staticAmount.value = 0.25 + 0.75 * t * t;
            u.badTVDistortion2.value = 1.5 + 3 * t;
            u.rgbShiftAmount.value = 0.006 + 0.01 * t;
            const mesh = this.watcherMesh;
            mesh.visible = Math.random() > 0.12;
            mesh.position.y = this._endFloor + (Math.random() - 0.5) * 0.02;
            if (this._endTimer >= CAUGHT_SECONDS) this.game.endFootage();
        } else if (this._endTimer >= ESCAPE_SECONDS) {
            this.game.leaveLevel();
        }
    }

    /**
     * Last level only. Party music comes through the exit gap and confetti blows in now and then while you're near.
     * @param {number} dt
     * @param {number} distance From the gap.
     * @param {number} pan
     */
    _partyThrough(dt, distance, pan) {
        const game = this.game;
        game.partyAudio.setBeacon(Math.max(0, 1 - distance / PARTY_RANGE) ** 2, pan);
        this._confetti -= dt;
        if (this._confetti > 0 || distance > PARTY_NEAR) return;
        this._confetti = CONFETTI_EVERY * (0.5 + Math.random());
        const { x, z, dx, dz } = /** @type {import('./arena.js').Exit} */ (this.exit);
        const along = (Math.random() - 0.5) * 1.6;
        game.confetti.burst(x - dx * 0.1 + (dz !== 0 ? along : 0), 0.7 + Math.random() * 0.25, z - dz * 0.1 + (dx !== 0 ? along : 0), 4 + Math.floor(Math.random() * 5), 0.5);
    }

    // ------------------------------------------------------------------ world callbacks for the Watcher

    /** True if nothing blocks the line between two points at its eye height. */
    _clear(ax, az, bx, bz) {
        const dx = bx - ax;
        const dz = bz - az;
        const distance = Math.hypot(dx, dz);
        if (distance < 1e-6) return true;
        const hit = raycastWorld(ax, WATCHER_EYE, az, dx / distance, 0, dz / distance, distance, this.store);
        return hit === null || hit.distance > distance - 0.35;
    }

    /**
     * True if any part of the figure at (x, z) is or could soon be seen. It has to be in the guarded view (see
     * screenGuard.js) and not fully behind walls from where you are or are about to be. A spot behind a wall stays
     * hidden however fast the camera turns.
     */
    _inSight(x, z) {
        const guard = this.guard;
        if (!guard.covers(x, z)) return false;
        const eye = guard.position;
        const velocity = guard.velocity;
        for (const ahead of [0, SIGHT_AHEAD]) {
            const ex = eye.x + velocity.x * ahead;
            const ey = eye.y;
            const ez = eye.z + velocity.z * ahead;
            for (const [ox, oz] of SIGHT_POINTS) {
                for (const y of SIGHT_HEIGHTS) {
                    const dx = x + ox - ex;
                    const dy = y - ey;
                    const dz = z + oz - ez;
                    const distance = Math.hypot(dx, dy, dz);
                    if (distance < 1e-6) return true;
                    const hit = raycastWorld(ex, ey, ez, dx / distance, dy / distance, dz / distance, distance, this.store);
                    if (hit === null || hit.distance > distance - 0.01) return true;
                }
            }
        }
        return false;
    }

    /** Floor height it stands at. 0 except on levels with water. */
    _floor(x, z) {
        return Math.max(this.store.groundAt(x, z), -WATCHER_WADE);
    }

    /** True if something solid is in the middle of the cell (chair, sign, a Level Fun table, a Level 1 car). */
    _blocked(x, z) {
        const chunk = this.store.getChunk(chunkCoord(x), chunkCoord(z));
        const inside = (box) => box[0] < x + 0.25 && box[2] > x - 0.25 && box[1] < z + 0.25 && box[3] > z - 0.25;
        for (const { box } of chunk.props) {
            if (box && inside(box)) return true;
        }
        return (chunk.party?.boxes.some(inside) ?? false) || (chunk.solids?.some(inside) ?? false);
    }

    /** Light at a spot to see a black shape against, from the panels or the flashlight. */
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
        this.marks = NO_MARKS;
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
 * Exit mesh. A white box behind the gap (back faces, so walking in fills the view with white), a glow on the wall
 * around the gap, and a light spill on the floor.
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
 * @property {Mesh[]} glows Glow on the wall and floor.
 * @property {number} x
 * @property {number} z
 * @property {number} offFor Seconds since it was switched off, -1 while on.
 * @property {boolean} sighted Seen, so it's on the map.
 */

/**
 * The TV next to a note: a lit screen over the monitor prop's dark one, a glow on the wall behind the note, and
 * one on the floor in front.
 * @param {import('./arena.js').Note} note
 * @returns {Television}
 */
function buildTelevision(note, materials, geometry) {
    const { tv, nx, nz } = note;
    const group = new Group();
    group.name = 'tv';

    // In front of the monitor's face (see monitor() in props.js), which faces +z before rotation.
    const screen = new Mesh(geometry.screen, materials.screen);
    screen.position.set(tv.x + Math.sin(tv.yaw) * 0.061, tv.y + 0.102, tv.z + Math.cos(tv.yaw) * 0.061);
    screen.rotation.y = tv.yaw;

    // Shift along the wall toward the set so the glow sits between the note and the TV.
    const toTvX = tv.x - note.x;
    const toTvZ = tv.z - note.z;
    const out = toTvX * nx + toTvZ * nz;
    const alongX = toTvX - nx * out;
    const alongZ = toTvZ - nz * out;
    const wall = new Mesh(geometry.wall, materials.tvGlow);
    // Just behind the note, which sits a bit farther off the wall.
    wall.position.set(note.x - nx * 0.002 + alongX * 0.4, tv.y + 0.3, note.z - nz * 0.002 + alongZ * 0.4);
    wall.rotation.y = Math.atan2(nx, nz);

    // Between the cell center and the set. Sits on the water surface if the TV is in water.
    const floor = new Mesh(geometry.floor, materials.tvGlow);
    floor.position.set(MathUtils.lerp(note.cellX, tv.x, 0.45), Math.max(tv.y, 0) + 0.003, MathUtils.lerp(note.cellZ, tv.z, 0.45));

    group.add(screen, wall, floor);
    for (const object of group.children) {
        object.matrixAutoUpdate = false;
        object.updateMatrix();
    }
    return { group, screen, glows: [wall, floor], x: tv.x, z: tv.z, offFor: -1, sighted: false };
}

/** Old CRT switch-off: picture collapses to a line, then a dot, then gone. */
function switchingOff(tv, dt) {
    tv.offFor += dt;
    const t = tv.offFor;
    const screen = tv.screen;
    if (t < 0.07) screen.scale.set(1, 1 - 0.96 * (t / 0.07), 1);
    else if (t < 0.22) screen.scale.set(1 - 0.94 * ((t - 0.07) / 0.15), 0.04, 1);
    else screen.visible = false;
    screen.updateMatrix();
}

/** Screen static. Random grays, offset every frame. */
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

/** Soft white radial falloff. */
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

/** Note plane with UVs for one atlas slot. */
function noteGeometry({ u0, v0, u1, v1 }) {
    const geometry = new PlaneGeometry(NOTE_WIDTH, NOTE_HEIGHT);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    return geometry;
}

/**
 * Tall and thin, arms to its knees, no face, taller than a doorway. Tapered limbs and a tilted head so even as a
 * black shape down a hall it doesn't read as a person.
 */
function buildWatcherMesh(material) {
    const parts = [
        // Legs, a bit apart at the feet.
        limb([-0.048, 0, 0], [-0.036, 0.46, 0], 0.016, 0.026),
        limb([0.05, 0, 0.01], [0.036, 0.46, 0], 0.016, 0.026),
        // Torso, narrow waist, slight stoop.
        limb([0, 0.44, 0], [0, 0.745, 0.018], 0.05, 0.085, 0.5),
        // Arms hanging past the knees, one slightly bent.
        limb([-0.085, 0.735, 0.015], [-0.108, 0.5, 0.02], 0.02, 0.016),
        limb([-0.108, 0.5, 0.02], [-0.116, 0.27, 0.035], 0.016, 0.011),
        limb([0.085, 0.735, 0.015], [0.11, 0.48, 0.005], 0.02, 0.016),
        limb([0.11, 0.48, 0.005], [0.112, 0.25, 0.01], 0.016, 0.011),
        // Long fingers.
        limb([-0.116, 0.27, 0.035], [-0.12, 0.2, 0.045], 0.011, 0.003),
        limb([0.112, 0.25, 0.01], [0.116, 0.18, 0.012], 0.011, 0.003),
        // Neck and tilted head.
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
 * Tapered cylinder between two points.
 * @param {number[]} from
 * @param {number[]} to
 * @param {number} r0 Radius at `from`.
 * @param {number} r1 Radius at `to`.
 * @param {number} [depth] Front-to-back depth as a fraction of width (for a flat chest).
 */
function limb(from, to, r0, r1, depth = 1) {
    _direction.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const length = _direction.length();
    const geometry = new CylinderGeometry(r1, r0, length, 7, 1).scale(1, 1, depth).translate(0, length / 2, 0);
    _quaternion.setFromUnitVectors(_up, _direction.normalize());
    _matrix.compose(_position.set(from[0], from[1], from[2]), _quaternion, _unit);
    return geometry.applyMatrix4(_matrix);
}

// Head tilt, center and radii (see head()).
const HEAD_TIP_Z = -0.38;
const HEAD_TIP_X = 0.15;
const HEAD_CENTRE = new Vector3(0.03, 0.845, 0.04);
const HEAD_SIZE = new Vector3(0.042, 0.062, 0.046);

function head() {
    return new SphereGeometry(1, 9, 7)
        .scale(HEAD_SIZE.x, HEAD_SIZE.y, HEAD_SIZE.z)
        .rotateZ(HEAD_TIP_Z)
        .rotateX(HEAD_TIP_X)
        .translate(HEAD_CENTRE.x, HEAD_CENTRE.y, HEAD_CENTRE.z);
}

/**
 * Level Fun costume: party hat and a chalk =) face. Unlit like the body so it shows in any light.
 * @param {ReturnType<import('../world/materials.js').createMaterials>['party']} materials
 */
function buildCostume(materials) {
    const tip = (vector) => vector.applyAxisAngle(new Vector3(0, 0, 1), HEAD_TIP_Z).applyAxisAngle(new Vector3(1, 0, 0), HEAD_TIP_X);
    const up = tip(new Vector3(0, 1, 0));
    const front = tip(new Vector3(0, 0, 1));
    const top = HEAD_CENTRE.clone().addScaledVector(up, HEAD_SIZE.y - 0.012);
    const face = HEAD_CENTRE.clone().addScaledVector(front, HEAD_SIZE.z + 0.002);
    const group = new Group();
    group.name = 'costume';
    const hatMesh = new Mesh(hat(0.027, 0.07, 0).rotateZ(HEAD_TIP_Z).rotateX(HEAD_TIP_X).translate(top.x, top.y, top.z), materials.things);
    const faceMesh = new Mesh(createFaceGeometry(0.058, 0xffffff).rotateZ(HEAD_TIP_Z).rotateX(HEAD_TIP_X).translate(face.x, face.y, face.z), materials.chalk);
    group.add(hatMesh, faceMesh);
    return group;
}
