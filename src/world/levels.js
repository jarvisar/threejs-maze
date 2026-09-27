import { Color } from 'three';
import { AbandonedOfficeAudio } from '../audio/AbandonedOffice.js';
import { LevelOneAudio } from '../audio/LevelOne.js';
import { PipeDreamsAudio } from '../audio/PipeDreams.js';
import { PILLAR_SIZE } from '../config.js';
import { WATCHER_BALANCE } from '../footage/Watcher.js';
import {
    PROP_BALL,
    PROP_BARREL,
    PROP_BIN,
    PROP_BOTTLES,
    PROP_BOXES,
    PROP_BUCKET,
    PROP_CHAIR,
    PROP_CONE,
    PROP_COOLER,
    PROP_CRATES,
    PROP_CART,
    PROP_CYLINDERS,
    PROP_FICUS,
    PROP_FILES,
    PROP_LIFEBUOY,
    PROP_MONITOR,
    PROP_PALLET,
    PROP_PALM,
    PROP_RACK,
    PROP_RING,
    PROP_SHELF,
    PROP_SIGN,
    PROP_SUITCASE,
    PROP_TOOLBOX,
    PROP_TROLLEY,
} from './decorations.js';
import { abandonedOfficeOptions, generateAbandonedOfficeChunk } from './abandonedOffice.js';
import { buildAbandonedOfficeGeometry } from './abandonedOfficeGeometry.js';
import { createAbandonedOfficeSurfaces } from './abandonedOfficeMaterials.js';
import { ABANDONED_OFFICE_SHADING, ABANDONED_OFFICE_SURFACES } from './abandonedOfficeShading.js';
import { generateChunk } from './generator.js';
import { LEVEL_ONE_PILLAR, generateLevelOneChunk, levelOneOptions } from './levelOne.js';
import { buildLevelOneGeometry } from './levelOneGeometry.js';
import { createLevelOneSurfaces } from './levelOneMaterials.js';
import { LEVEL_ONE_SHADING, LEVEL_ONE_SURFACES } from './levelOneShading.js';
import { LEVEL_ZERO_SHADING, LEVEL_ZERO_SURFACES } from './levelShading.js';
import { generatePipeDreamsChunk, pipeDreamsOptions } from './pipeDreams.js';
import { buildPipeDreamsGeometry } from './pipeDreamsGeometry.js';
import { createPipeDreamsSurfaces } from './pipeDreamsMaterials.js';
import { PIPE_DREAMS_SHADING, PIPE_DREAMS_SURFACES } from './pipeDreamsShading.js';
import { POOLROOMS_PILLAR, generatePoolroomsChunk, poolroomsOptions } from './poolrooms.js';
import { COLUMN_RADIUS, DOOR_SPRING, buildPoolroomsGeometry, buildPoolroomsOutside, headroomAt } from './poolroomsGeometry.js';
import { createPoolroomsSurfaces } from './poolroomsMaterials.js';
import { POOLROOMS_SHADING, POOLROOMS_SURFACES } from './poolroomsShading.js';
import { PoolroomsAudio } from '../audio/Poolrooms.js';
import { TerrorHotelAudio } from '../audio/TerrorHotel.js';
import { generateTerrorHotelChunk, terrorHotelOptions } from './terrorHotel.js';
import { buildTerrorHotelGeometry, buildTerrorHotelOutside } from './terrorHotelGeometry.js';
import { createTerrorHotelSurfaces } from './terrorHotelMaterials.js';
import { TERROR_HOTEL_SHADING, TERROR_HOTEL_SURFACES } from './terrorHotelShading.js';
import {
    ZONE_BALLROOM,
    ZONE_BATHS,
    ZONE_CHANNELS,
    ZONE_CORE,
    ZONE_CUBICLES,
    ZONE_DEEP,
    ZONE_FLOODED,
    ZONE_GUEST,
    ZONE_HALLS,
    ZONE_LOBBY,
    ZONE_MAZE,
    ZONE_OFFICES,
    ZONE_OPEN,
    ZONE_OPEN_PLAN,
    ZONE_PARKING,
    ZONE_PILLARS,
    ZONE_PLANT,
    ZONE_ROOMS,
    ZONE_SERVICE,
    ZONE_STAFF,
    ZONE_STEAM,
    ZONE_STORAGE,
    ZONE_TUNNELS,
} from './zones.js';

/*
 * The levels, in one place. Everything that plays the same way on every level (walking, editing, and a tape's
 * notes, the thing that comes for you, the stamina and the way out; see footage/) is written once and reads what's
 * particular to a level from here: how its endless world is laid out, what a tape's walled-in piece of it is made of,
 * its light and haze, and where its way out leads.
 *
 * A level's id is its place in LEVELS, which is how it's saved and linked to, so a new one goes on the end; its
 * `number` is what it's called, which the menus go by.
 *
 * A tape goes through the levels in TAPE_LEVELS order; getting out of the last one is Level Fun, which isn't a level
 * of its own but whichever one you're in, dressed for a party (see party.js). Explore can be on any of them.
 *
 * To add a level: write its generator (like levelOne.js: chunks with the same walls, pillars, lights and props as
 * every level's, built from the same pieces in generator.js, from borderedLayout to Layout.cellData, plus anything of
 * its own), its surfaces (like levelOneMaterials.js), its shading (see levelShading.js) and its sound, if it has one
 * (see audio/LevelAudio.js), and give it an entry here. Its shape only says what's different from Level 0's (SHAPE).
 * Anything it builds that other levels don't comes from its `shape.extras`, as meshes named after the materials in its
 * surfaces that draw them. Nothing else should need to know which level is which.
 */

// Before r155, three.js multiplied every light's intensity by π ("legacy lights"); see lighting.js.
const LEGACY_SCALE = Math.PI;

/**
 * @typedef {object} Atmosphere How a level is lit (see Lighting.setLevel).
 * @property {number} haze The colour of the haze at full light (and of the far distance).
 * @property {Color} lightColor The ceiling lights' colour and intensity (legacy-scaled).
 * @property {number} lightRange How far they reach.
 * @property {number} lightHeight How high they hang.
 * @property {number} ambient The colour of the light filling in everywhere.
 * @property {number} ambientDim How much there is without the dynamic lights.
 * @property {number} ambientLit How much there is with them.
 * @property {number} overhead The colour of the light from straight above (it lights the floor).
 * @property {number} overheadIntensity
 * @property {number} powerCutRate How often the power goes, against Level 0 (see blackouts.js).
 * @property {number} [heat] How much the air in front of the camera shimmers, 0..1 (see VHSShader.js): Level 2's.
 * @property {boolean} [storm] Rain outside its windows, and lightning (see storm.js): Level 4's.
 */

/**
 * @typedef {object} Tape A tape on this level (see footage/): the same notes, the same thing after you, the same way
 * out; this is only what's particular to the level.
 * @property {number[]} zones What its sixteen chunks are made of, before they're shuffled (see arena.js).
 * @property {number} start The zone of the chunk it starts in.
 * @property {boolean} pillarNotes Whether notes can be pinned to pillars as well as walls (in a car park, most
 *     of what there is to pin one to is columns).
 * @property {number} exitColor The light through the way out. (Out of the last level it's the party on the other
 *     side, Level Fun's music and confetti coming through: see leadsToParty.)
 * @property {NoteText[]} notes Its eight notes, in the order they're found.
 * @property {import('../footage/Watcher.js').WatcherBalance} watcher How the thing after you plays here: Level 0's
 *     (WATCHER_BALANCE), but for what the level's shape calls for. Tuned so a tape gets no easier on the way down.
 */

/**
 * @typedef {object} NoteText What's written on one of a tape's notes (see noteTextures.js).
 * @property {string[]} lines
 * @property {string} drawing
 */

/**
 * @typedef {object} Shape How a level's chunks are built into meshes (see chunkGeometry.js).
 * @property {number} pillarSize How wide its pillars are.
 * @property {boolean} ownPillars Its pillars are a mesh of their own (the `pillars` extra), not part of the walls.
 * @property {boolean} baseboards
 * @property {boolean} wallpaper Wallpaper that peels, and water stains on the ceiling and carpet (see decals.js).
 * @property {boolean} panels A light panel in every slot, all alike (Level 0's; else its extras have its light fittings).
 * @property {((store: import('./ChunkStore.js').ChunkStore, chunk: import('./generator.js').ChunkData, builders: { pillars: import('./GeometryBuilder.js').GeometryBuilder, shade: import('./GeometryBuilder.js').GeometryBuilder, pillarShade: (x: number, z: number, half: number) => void }) => Record<string, import('three').BufferGeometry | null>) | null} extras
 *     Everything else it has, by the name of the material in its surfaces that draws it. (`pillarShade` puts the shade
 *     round the foot and the head of a pillar it builds itself, at (x, z) relative to the chunk.)
 * @property {boolean} floor Every chunk has the same flat floor; without it, its extras build its floor (Level 37's
 *     goes down into pools).
 * @property {boolean} ceiling The same for the ceiling (Level 37's has skylights let into it).
 * @property {boolean} outlets Outlets low on a few walls.
 * @property {boolean} pillarMesh Its pillars are meshed as boxes; without, its extras build them.
 * @property {number} wallBottom How far down its walls go: below the floor, where it drops away.
 * @property {boolean} floorShade The soft shade along the foot of every wall, and under the props (it would lie on
 *     Level 37's water).
 * @property {boolean} coves Its walls curve into the floor, the ceiling and each other (Level 37's, built with its
 *     extras: see poolroomsCoves.js), so there's no soft shade along the top of them or down their corners.
 * @property {((store: import('./ChunkStore.js').ChunkStore, chunk: import('./generator.js').ChunkData) => Record<string, import('three').BufferGeometry | null>) | null} outside
 *     What it builds in an empty chunk outside a tape's walls, where there's none of its extras: whatever finishes the
 *     faces of those walls that belong to that chunk but face into the tape (Level 37's coves along them).
 * @property {number} pillarFace How far a pillar's face is from its middle, for what's put on one (a tape's notes):
 *     half its size, but Level 37's columns are round, and wider than the square they stand in.
 * @property {((store: import('./ChunkStore.js').ChunkStore, x: number, z: number) => number) | null} headroom Where
 *     anything of its own comes down lower than the ceiling (Level 37's vaults and arches), how high the underside of
 *     it is over a point, else the ceiling's height (see ChunkStore.headroomAt).
 * @property {number | null} doorArch Where the arch in the top of every doorway springs from, if it has one (Level 37's,
 *     built with its extras): the walls are cut there, and over each doorway where its crown is, so the arch and the
 *     walls round it share their corners and no pinholes open along the joins.
 */

/** Level 0's shape: every level's starts from it, and changes what's different. */
const SHAPE = Object.freeze({
    pillarSize: PILLAR_SIZE,
    ownPillars: false,
    baseboards: true,
    wallpaper: true,
    panels: true,
    extras: null,
    floor: true,
    ceiling: true,
    outlets: true,
    pillarMesh: true,
    wallBottom: 0,
    floorShade: true,
    coves: false,
    outside: null,
    pillarFace: PILLAR_SIZE / 2,
    headroom: null,
    doorArch: null,
});

/**
 * @typedef {object} LevelSound A level's own sound, on top of the ambience (see Game): Level 1's is its drips, its
 *     tubes and its concrete underfoot; Level 37's, its water, its pump and its long echo; Level 2's, its boilers, its
 *     pipes and the steam.
 * @property {(on: boolean) => void} setEnabled On while its level is showing.
 * @property {(store: import('./ChunkStore.js').ChunkStore) => void} [setWorld] The world it's in (every time it
 *     changes), for a sound that listens for what's near (Level 2's steam).
 * @property {(x: number, z: number, areaLight: number, power: number, height: number) => void} follow Where you are
 *     (and how high your eyes are: under the water, in Level 37), how lit it is there, and how much of the power's on;
 *     every frame.
 * @property {(dt: number) => void} update
 * @property {(weight: number, x: number, z: number, depth: number) => void} step A footstep there, instead of the
 *     carpet's (in `depth` of water, where there's water to wade through).
 * @property {(weight: number) => void} [splash] Falling into the water.
 */

/**
 * @typedef {object} Level
 * @property {number} id Its place in LEVELS: how it's saved, and linked to.
 * @property {number} number Its number in the Backrooms, which the menus list them by.
 * @property {string} name As the menus say it.
 * @property {string} title What the camcorder puts over the picture on the way in.
 * @property {string} about The line under Explore on the title screen.
 * @property {(seed: number, cx: number, cz: number, options: import('./generator.js').WorldOptions) => import('./generator.js').ChunkData} generate
 *     Its chunks.
 * @property {(seed: number) => import('./generator.js').WorldOptions} options How its endless world is generated.
 * @property {Shape} shape
 * @property {(shared: Record<string, any>, maxAnisotropy: number, level: number) => import('./materials.js').LevelSurfaces} surfaces
 *     Its materials (see materials.js), made once, the first time the level's wanted: `shared` is the ones every
 *     level has, and `level` its own number, for withBackroomsShading.
 * @property {string} shading What it puts into the shaders: its light's colours, its air, and anything its
 *     surfaces need (see levelShading.js).
 * @property {Record<string, import('./levelShading.js').SurfaceShading>} surfaceShading What its own kinds of
 *     surface put into them, by the kind's name (see levelShading.js).
 * @property {((ambience: import('../audio/Ambience.js').Ambience) => LevelSound) | null} sound Its own sound, if it
 *     has one (with it, the ambience's office hum is left out; the level's own takes its place).
 * @property {import('../audio/Ambience.js').Room} room How it sounds: the echo that comes back off its walls, which is
 *     how anything far off is heard (see Ambience.setRoom).
 * @property {boolean} reflections Whether its floor mirrors the room (Level 1's puddles; see fx/Reflection.js).
 *     That costs about what the dynamic lights do, so it goes with them.
 * @property {boolean} water Whether it's under water, at y = 0: deep enough to wade through, and in the pools, to go
 *     under (Level 37; see Player's Terrain). Its floor has to go down below it for that (see Ground in ground.js).
 * @property {boolean} dressable Whether Level Fun can dress it for the party (see party.js, which is laid out for
 *     Level 0's rooms). From one that can't, the Konami code goes to one that can.
 * @property {number[]} decorations The things of its own that edit mode can put down (PROP_* types, see
 *     decorations.js), in their own section of the tools; they can be put down on any level.
 * @property {Atmosphere} atmosphere
 * @property {Tape} tape
 */

/** @type {Level} */
const LEVEL_ZERO = {
    id: 0,
    number: 0,
    name: 'Level 0',
    title: 'LEVEL 0',
    about: 'The endless level.',
    generate: generateChunk,
    options: () => ({}),
    shape: SHAPE,
    // The wallpaper, carpet and tiles every level's made with.
    surfaces: ({ wall, floor, ceiling, details }) => ({ wall, floor, ceiling, details, extras: {}, shadows: [] }),
    shading: LEVEL_ZERO_SHADING,
    surfaceShading: LEVEL_ZERO_SURFACES,
    sound: null,
    // Offices: carpet and ceiling tiles soak it up. A dull room, not long.
    room: { seconds: 3, decay: 3, bright: 0.53, dark: 0.03, gap: 0.02, level: 3.5 },
    reflections: false,
    water: false,
    dressable: true,
    // (Not the fallen ceiling tile, which belongs under the hole it came from.)
    decorations: [PROP_CHAIR, PROP_MONITOR, PROP_BOTTLES, PROP_SIGN],
    atmosphere: {
        haze: 0xe4dab4,
        // The original PointLight(0xf5f4cb, 1.1, 3.1), a little brighter: the panels shine down (see levelShading.js),
        // and what they keep from the tops of the walls goes to the rest of the room.
        lightColor: new Color(0xf5f4cb).multiplyScalar(1.28 * LEGACY_SCALE),
        lightRange: 3.1,
        lightHeight: 0.85,
        ambient: 0xe8e4ca,
        ambientDim: 0.7 * LEGACY_SCALE,
        ambientLit: 0.15 * LEGACY_SCALE,
        overhead: 0xfeffd9,
        overheadIntensity: 0.9 * LEGACY_SCALE,
        powerCutRate: 1,
    },
    tape: {
        zones: [
            ...Array(5).fill(ZONE_ROOMS),
            ...Array(3).fill(ZONE_HALLS),
            ...Array(3).fill(ZONE_MAZE),
            ...Array(3).fill(ZONE_PILLARS),
            ...Array(2).fill(ZONE_OPEN),
        ],
        start: ZONE_ROOMS,
        pillarNotes: false,
        exitColor: 0xffffff,
        watcher: WATCHER_BALANCE,
        notes: [
            { lines: ["DON'T", 'LOOK', 'AT IT'], drawing: 'eye' },
            { lines: ["IT'S", 'ALWAYS', 'BEHIND', 'YOU'], drawing: 'behind' },
            { lines: ['KEEP', 'MOVING'], drawing: 'arrows' },
            { lines: ['THE LIGHTS', 'GO OUT', "WHEN IT'S", 'CLOSE'], drawing: 'panel' },
            { lines: ['NO NO NO', 'NO NO NO', 'NO NO NO', 'NO NO'], drawing: 'scribble' },
            { lines: ['EIGHT', 'NOTES', 'THEN THE', 'WAY OUT'], drawing: 'door' },
            { lines: ["CAN'T", 'RUN', 'FROM IT'], drawing: 'run' },
            { lines: ['IT', 'WAITS'], drawing: 'figure' },
        ],
    },
};

/** @type {Level} */
const LEVEL_ONE = {
    id: 1,
    number: 1,
    name: 'Level 1',
    title: 'LEVEL 1',
    about: 'Level 1. The Habitable Zone.',
    generate: generateLevelOneChunk,
    options: levelOneOptions,
    shape: { ...SHAPE, pillarSize: LEVEL_ONE_PILLAR, pillarFace: LEVEL_ONE_PILLAR / 2, ownPillars: true, baseboards: false, wallpaper: false, panels: false, extras: buildLevelOneGeometry },
    surfaces: createLevelOneSurfaces,
    shading: LEVEL_ONE_SHADING,
    surfaceShading: LEVEL_ONE_SURFACES,
    sound: (ambience) => new LevelOneAudio(ambience),
    // Bare concrete, low and wide: a long, grey echo, with the nearest columns and walls coming back first.
    room: { seconds: 3, decay: 2.6, bright: 0.72, dark: 0.06, gap: 0.015, reflections: [6, 0.02, 0.12], level: 3.4 },
    reflections: true,
    water: false,
    dressable: false,
    decorations: [PROP_CRATES, PROP_BOXES, PROP_PALLET, PROP_BARREL, PROP_CONE, PROP_RACK],
    atmosphere: {
        // A cold grey haze; cool white tubes hanging a little below the slab and reaching a little further; much
        // less light filling in between them, so the gaps between the rows go dark.
        haze: 0x5c6264,
        lightColor: new Color(0xe6eef2).multiplyScalar(1.55 * LEGACY_SCALE),
        lightRange: 3.3,
        lightHeight: 0.86,
        ambient: 0xc4ced3,
        ambientDim: 0.55 * LEGACY_SCALE,
        ambientLit: 0.08 * LEGACY_SCALE,
        overhead: 0xe4ecef,
        overheadIntensity: 0.55 * LEGACY_SCALE,
        // The blackouts are what Level 1 is known for.
        powerCutRate: 2.2,
    },
    tape: {
        zones: [
            ...Array(8).fill(ZONE_PARKING),
            ...Array(4).fill(ZONE_STORAGE),
            ...Array(4).fill(ZONE_SERVICE),
        ],
        start: ZONE_PARKING,
        pillarNotes: true,
        // The warm light of the tunnels below.
        exitColor: 0xffc890,
        // A car park is open: it can't come round a corner at you, so being anywhere near it costs more.
        watcher: { ...WATCHER_BALANCE, near: 3.4 },
        notes: [
            { lines: ['IT CAME', 'DOWN', 'WITH ME'], drawing: 'behind' },
            { lines: ['WHEN THE', 'POWER', 'GOES', 'HIDE'], drawing: 'panel' },
            { lines: ['NOBODY', 'LEAVES', 'THE', 'CRATES'], drawing: 'scribble' },
            { lines: ['C7', 'C8', 'C9', 'C9 C9 C9'], drawing: 'arrows' },
            { lines: ['THE CARS', 'ARE', 'EMPTY'], drawing: 'eye' },
            { lines: ["DON'T", 'STAND', 'IN THE', 'WATER'], drawing: 'run' },
            { lines: ['IT GETS', 'HOTTER', 'FURTHER', 'DOWN'], drawing: 'figure' },
            { lines: ['EIGHT', 'MORE', 'THEN', 'DOWN'], drawing: 'door' },
        ],
    },
};

/** @type {Level} */
const LEVEL_THIRTY_SEVEN = {
    id: 2,
    number: 37,
    name: 'Level 37',
    title: 'LEVEL 37',
    about: 'Level 37. The Poolrooms.',
    generate: generatePoolroomsChunk,
    options: poolroomsOptions,
    shape: {
        ...SHAPE,
        pillarSize: POOLROOMS_PILLAR,
        baseboards: false,
        wallpaper: false,
        panels: false,
        extras: buildPoolroomsGeometry,
        floor: false,
        ceiling: false,
        outlets: false,
        pillarMesh: false,
        wallBottom: -1.9,
        floorShade: false,
        coves: true,
        outside: buildPoolroomsOutside,
        pillarFace: COLUMN_RADIUS,
        headroom: headroomAt,
        doorArch: DOOR_SPRING,
    },
    surfaces: createPoolroomsSurfaces,
    shading: POOLROOMS_SHADING,
    surfaceShading: POOLROOMS_SURFACES,
    sound: (ambience) => new PoolroomsAudio(ambience),
    // Halls of glazed tile: a very long, bright echo, the first of it off the nearest walls.
    room: { seconds: 5.5, decay: 2.6, bright: 0.9, dark: 0.15, gap: 0, reflections: [7, 0.012, 0.09], level: 2.2 },
    reflections: true,
    water: true,
    dressable: false,
    decorations: [PROP_LIFEBUOY, PROP_RING, PROP_BALL],
    atmosphere: {
        // A bright, warm, damp haze; lights set in the ceiling reaching a little further than Level 0's; plenty of
        // light filling in, off all that tile. Most of the light is the sun's (see poolroomsShading.js).
        haze: 0x29302b,
        lightColor: new Color(0xfff0da).multiplyScalar(0.6 * LEGACY_SCALE),
        lightRange: 3.4,
        lightHeight: 0.97,
        ambient: 0xcbd8c9,
        ambientDim: 0.22 * LEGACY_SCALE,
        ambientLit: 0.12 * LEGACY_SCALE,
        overhead: 0xe9eee4,
        overheadIntensity: 0.05 * LEGACY_SCALE,
        // The lights hardly ever go (and then it's the lamps, and clouds over the sun).
        powerCutRate: 0.3,
    },
    tape: {
        zones: [
            ...Array(7).fill(ZONE_BATHS),
            ...Array(4).fill(ZONE_FLOODED),
            ...Array(2).fill(ZONE_CHANNELS),
            ...Array(3).fill(ZONE_DEEP),
        ],
        start: ZONE_BATHS,
        pillarNotes: true,
        exitColor: 0xffe2c4,
        watcher: WATCHER_BALANCE,
        notes: [
            { lines: ['THE WATER', 'IS WARM'], drawing: 'eye' },
            { lines: ["DON'T", 'GO', 'UNDER'], drawing: 'behind' },
            { lines: ['IT CAN', 'SWIM'], drawing: 'figure' },
            { lines: ['NO', 'ECHO', 'HERE'], drawing: 'scribble' },
            { lines: ['KEEP TO', 'THE', 'EDGES'], drawing: 'arrows' },
            { lines: ['THE LAMPS', 'GO OUT', 'FIRST'], drawing: 'panel' },
            { lines: ['I CAN', 'HEAR', 'MUSIC'], drawing: 'run' },
            { lines: ['EIGHT', 'MORE', 'THEN THE', 'PARTY'], drawing: 'door' },
        ],
    },
};

/** @type {Level} */
const LEVEL_TWO = {
    id: 3,
    number: 2,
    name: 'Level 2',
    title: 'LEVEL 2',
    about: 'Level 2. Pipe Dreams.',
    generate: generatePipeDreamsChunk,
    options: pipeDreamsOptions,
    shape: { ...SHAPE, baseboards: false, wallpaper: false, panels: false, extras: buildPipeDreamsGeometry, outlets: false },
    surfaces: createPipeDreamsSurfaces,
    shading: PIPE_DREAMS_SHADING,
    surfaceShading: PIPE_DREAMS_SURFACES,
    sound: (ambience) => new PipeDreamsAudio(ambience),
    // Narrow tunnels, all pipe and brick: a shorter, harder echo, crowded with reflections off the walls close by.
    room: { seconds: 2.4, decay: 3.4, bright: 0.8, dark: 0.1, gap: 0.004, reflections: [12, 0.004, 0.04], level: 4 },
    reflections: true,
    water: false,
    dressable: false,
    decorations: [PROP_TOOLBOX, PROP_BUCKET, PROP_CYLINDERS, PROP_SHELF],
    atmosphere: {
        // A dark, warm haze; bare bulbs, yellower and dimmer than any tube, hanging close under the ceiling; very little
        // light filling in, so it's dark between them. The boilers' fires are their own (see pipeDreamsShading.js).
        haze: 0x211a14,
        lightColor: new Color(0xffc68c).multiplyScalar(1.2 * LEGACY_SCALE),
        lightRange: 2.7,
        lightHeight: 0.9,
        ambient: 0xd9b48a,
        ambientDim: 0.42 * LEGACY_SCALE,
        ambientLit: 0.035 * LEGACY_SCALE,
        overhead: 0xffd6a4,
        overheadIntensity: 0.12 * LEGACY_SCALE,
        // The wiring's old and bare.
        powerCutRate: 1.6,
        heat: 1,
    },
    tape: {
        zones: [
            ...Array(8).fill(ZONE_TUNNELS),
            ...Array(4).fill(ZONE_STEAM),
            ...Array(4).fill(ZONE_PLANT),
        ],
        start: ZONE_TUNNELS,
        pillarNotes: false,
        // The grey of the rain on the windows below.
        exitColor: 0xd8e2f0,
        // The passages are tight: it's often just the other side of a wall, which costs a little less.
        watcher: { ...WATCHER_BALANCE, near: 2.8 },
        notes: [
            { lines: ['IT', 'FOLLOWED', 'ME', 'DOWN'], drawing: 'behind' },
            { lines: ['SO', 'HOT'], drawing: 'scribble' },
            { lines: ['THE PIPES', 'KNOCK', 'BACK'], drawing: 'arrows' },
            { lines: ["DON'T", 'TOUCH', 'THE BLACK'], drawing: 'eye' },
            { lines: ['IT HIDES', 'IN THE', 'STEAM'], drawing: 'figure' },
            { lines: ['WHEN THE', 'LIGHTS GO', 'FIND THE', 'FIRES'], drawing: 'panel' },
            { lines: ['I CAN', 'HEAR', 'WATER'], drawing: 'run' },
            { lines: ['EIGHT', 'MORE', 'THEN', 'DOWN'], drawing: 'door' },
        ],
    },
};

/** How wide Level 5's columns are (the lobbies' red marble ones; see terrorHotelGeometry.js). */
const HOTEL_COLUMN = 0.26;

/** @type {Level} */
const LEVEL_FIVE = {
    id: 4,
    number: 5,
    name: 'Level 5',
    title: 'LEVEL 5',
    about: 'Level 5. The Terror Hotel.',
    generate: generateTerrorHotelChunk,
    options: terrorHotelOptions,
    shape: {
        ...SHAPE,
        pillarSize: HOTEL_COLUMN,
        pillarFace: HOTEL_COLUMN / 2,
        baseboards: false,
        wallpaper: false,
        panels: false,
        extras: buildTerrorHotelGeometry,
        outlets: false,
        pillarMesh: false,
        // The mouldings along the faces of a tape's walls that belong to the nothing outside it.
        outside: buildTerrorHotelOutside,
    },
    surfaces: createTerrorHotelSurfaces,
    shading: TERROR_HOTEL_SHADING,
    surfaceShading: TERROR_HOTEL_SURFACES,
    sound: (ambience) => new TerrorHotelAudio(ambience),
    // Carpet, plaster and upholstery: a soft room, but a big one, the far end of a corridor coming back late.
    room: { seconds: 3.4, decay: 3.1, bright: 0.48, dark: 0.05, gap: 0.02, reflections: [5, 0.014, 0.08], level: 3.3 },
    reflections: false,
    water: false,
    dressable: false,
    decorations: [PROP_SUITCASE, PROP_TROLLEY, PROP_CART, PROP_PALM],
    atmosphere: {
        // A dark haze the colour of old varnish; warm light from the fittings and sconces, in pools, and very little
        // filling in between them.
        haze: 0x1b120b,
        lightColor: new Color(0xffc890).multiplyScalar(1.15 * LEGACY_SCALE),
        lightRange: 2.9,
        lightHeight: 0.9,
        ambient: 0xd8b48a,
        ambientDim: 0.4 * LEGACY_SCALE,
        ambientLit: 0.055 * LEGACY_SCALE,
        overhead: 0xffd6a0,
        overheadIntensity: 0.08 * LEGACY_SCALE,
        // The wiring's old, but it's kept up.
        powerCutRate: 0.9,
    },
    tape: {
        zones: [
            ...Array(8).fill(ZONE_GUEST),
            ...Array(3).fill(ZONE_LOBBY),
            ...Array(2).fill(ZONE_BALLROOM),
            ...Array(3).fill(ZONE_STAFF),
        ],
        start: ZONE_GUEST,
        pillarNotes: false,
        // The light off the water below.
        exitColor: 0xdff2ec,
        watcher: WATCHER_BALANCE,
        notes: [
            { lines: ['THE DOORS', "DON'T", 'OPEN'], drawing: 'door' },
            { lines: ['THE BAND', 'NEVER', 'STOPS'], drawing: 'run' },
            { lines: ["DON'T", 'TRUST THE', 'PORTRAITS'], drawing: 'eye' },
            { lines: ['THE', 'WALLPAPER', 'HAS', 'FACES'], drawing: 'scribble' },
            { lines: ['NOT THE', 'LIFTS'], drawing: 'panel' },
            { lines: ['IT', 'CHECKED', 'IN TOO'], drawing: 'figure' },
            { lines: ['KEEP', 'OUT OF', 'THE', 'BALLROOM'], drawing: 'behind' },
            { lines: ['EIGHT', 'MORE', 'THEN', 'DOWN'], drawing: 'arrows' },
        ],
    },
};

/** How wide Level 4's columns are (the open floors' concrete ones). */
const OFFICE_COLUMN = 0.22;

/** @type {Level} */
const LEVEL_FOUR = {
    id: 5,
    number: 4,
    name: 'Level 4',
    title: 'LEVEL 4',
    about: 'Level 4. The Abandoned Office.',
    generate: generateAbandonedOfficeChunk,
    options: abandonedOfficeOptions,
    shape: {
        ...SHAPE,
        pillarSize: OFFICE_COLUMN,
        pillarFace: OFFICE_COLUMN / 2,
        baseboards: false,
        wallpaper: false,
        panels: false,
        extras: buildAbandonedOfficeGeometry,
        outlets: false,
        // (Its columns are its extras', cased and skirted: see abandonedOfficeGeometry.js.)
        pillarMesh: false,
    },
    surfaces: createAbandonedOfficeSurfaces,
    shading: ABANDONED_OFFICE_SHADING,
    surfaceShading: ABANDONED_OFFICE_SURFACES,
    sound: (ambience) => new AbandonedOfficeAudio(ambience),
    // Carpet and ceiling tiles soak it up, but the floors are wide and bare: a soft echo, the far walls coming back late.
    room: { seconds: 3.2, decay: 2.9, bright: 0.5, dark: 0.05, gap: 0.02, reflections: [5, 0.016, 0.1], level: 3.3 },
    reflections: false,
    water: false,
    dressable: false,
    decorations: [PROP_COOLER, PROP_FICUS, PROP_BIN, PROP_FILES],
    atmosphere: {
        // A cold grey haze; cool tubes, in the ceiling; very little light filling in between them, so it's dark where
        // they've died. The night through the windows and the lightning are its own (see abandonedOfficeShading.js).
        haze: 0x4a535c,
        lightColor: new Color(0xeef4ff).multiplyScalar(1.3 * LEGACY_SCALE),
        lightRange: 3.2,
        lightHeight: 0.93,
        ambient: 0xc4ceda,
        ambientDim: 0.4 * LEGACY_SCALE,
        ambientLit: 0.065 * LEGACY_SCALE,
        overhead: 0xdce6f0,
        overheadIntensity: 0.1 * LEGACY_SCALE,
        powerCutRate: 1.3,
        storm: true,
    },
    tape: {
        zones: [
            ...Array(7).fill(ZONE_OPEN_PLAN),
            ...Array(4).fill(ZONE_CUBICLES),
            ...Array(3).fill(ZONE_OFFICES),
            ...Array(2).fill(ZONE_CORE),
        ],
        start: ZONE_OPEN_PLAN,
        pillarNotes: true,
        // The hotel's lamplight below, warm.
        exitColor: 0xffd8a0,
        // The floors are as open as the car park (most of the partitions can be seen over): it can't come round a
        // corner at you, so being anywhere near it costs more.
        watcher: { ...WATCHER_BALANCE, near: 3.4 },
        notes: [
            { lines: ['IT NEVER', 'STOPS', 'RAINING'], drawing: 'scribble' },
            { lines: ['THE STAIRS', 'COME BACK', 'HERE'], drawing: 'door' },
            { lines: ["DON'T", 'WATCH THE', 'WINDOWS'], drawing: 'eye' },
            { lines: ['IT MOVES', 'IN THE', 'LIGHTNING'], drawing: 'figure' },
            { lines: ['THE PHONE', 'IS FOR', 'YOU'], drawing: 'panel' },
            { lines: ['WHERE DID', 'EVERYONE', 'GO'], drawing: 'behind' },
            { lines: ['NOT', 'SAFE', 'HERE'], drawing: 'run' },
            { lines: ['EIGHT', 'MORE', 'THEN', 'DOWN'], drawing: 'arrows' },
        ],
    },
};

/** Every level, by id (see Level: the order they were added in). */
export const LEVELS = [LEVEL_ZERO, LEVEL_ONE, LEVEL_THIRTY_SEVEN, LEVEL_TWO, LEVEL_FIVE, LEVEL_FOUR];

/** The levels as the menus list them: by their numbers. */
export const LEVELS_IN_ORDER = [...LEVELS].sort((a, b) => a.number - b.number);

/**
 * The levels a tape goes through, by id, in the order of their numbers (0, 1, 2, 4, 5, 37): it starts on the first.
 * Getting out of the last one is Level Fun.
 */
export const TAPE_LEVELS = [0, 1, 3, 5, 4, 2];

/**
 * A level by number (anything unknown is Level 0).
 * @param {number} id
 * @returns {Level}
 */
export function levelById(id) {
    return LEVELS[id] ?? LEVEL_ZERO;
}

/** Whether a tape's way out of this level is the way into Level Fun (it's the last level a tape goes through). */
export function leadsToParty(id) {
    return TAPE_LEVELS[TAPE_LEVELS.length - 1] === id;
}

/**
 * The level a tape goes on to from this one, or null after the last (the way out to Level Fun).
 * @param {number} id
 * @returns {number | null}
 */
export function nextTapeLevel(id) {
    const index = TAPE_LEVELS.indexOf(id);
    return index >= 0 && index < TAPE_LEVELS.length - 1 ? TAPE_LEVELS[index + 1] : null;
}

/** Whether this is the level a tape starts on. */
export function isFirstTapeLevel(id) {
    return id === TAPE_LEVELS[0];
}

/** The level Level Fun takes you to from one it can't dress (see `dressable`): the first one it can. */
export function partyLevel() {
    return LEVELS.findIndex((level) => level.dressable);
}
