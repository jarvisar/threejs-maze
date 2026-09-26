import { Color } from 'three';
import { LevelOneAudio } from '../audio/LevelOne.js';
import { PILLAR_SIZE } from '../config.js';
import { generateChunk } from './generator.js';
import { LEVEL_ONE_PILLAR, generateLevelOneChunk, levelOneOptions } from './levelOne.js';
import { buildLevelOneGeometry } from './levelOneGeometry.js';
import { createLevelOneSurfaces } from './levelOneMaterials.js';
import { LEVEL_ONE_SHADING } from './levelOneShading.js';
import { LEVEL_ZERO_SHADING } from './levelShading.js';
import { ZONE_HALLS, ZONE_MAZE, ZONE_OPEN, ZONE_PARKING, ZONE_PILLARS, ZONE_ROOMS, ZONE_SERVICE, ZONE_STORAGE } from './zones.js';

/*
 * The levels, in one place. Everything that plays the same way on every level (walking, editing, and a tape's
 * notes, the thing that comes for you, the stamina and the way out; see footage/) is written once and reads what's
 * particular to a level from here: how its endless world is laid out, what a tape's walled-in piece of it is made of,
 * its light and haze, and where its way out leads.
 *
 * A tape goes through the levels in TAPE_LEVELS order; getting out of the last one is Level Fun, which isn't a level
 * of its own but whichever one you're in, dressed for a party (see party.js). Explore can be on any of them.
 *
 * To add a level: write its generator (like levelOne.js: chunks with the same walls, pillars, lights and props as
 * every level's, plus anything of its own) and its surfaces (like levelOneMaterials.js), and give it an entry here.
 * Anything it builds that other levels don't comes from its `shape.extras`, as meshes named after the materials in
 * its surfaces that draw them. Nothing else should need to know which level is which.
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
 * @property {boolean} panels A light panel in every slot, all alike (else its extras have its light fittings).
 * @property {((store: import('./ChunkStore.js').ChunkStore, chunk: import('./generator.js').ChunkData, builders: { pillars: import('./GeometryBuilder.js').GeometryBuilder, shade: import('./GeometryBuilder.js').GeometryBuilder }) => Record<string, import('three').BufferGeometry | null>) | null} extras
 *     Everything else it has, by the name of the material in its surfaces that draws it.
 */

/**
 * @typedef {object} LevelSound A level's own sound, on top of the ambience (see Game): Level 1's is its drips, its
 *     tubes and its concrete underfoot.
 * @property {(on: boolean) => void} setEnabled On while its level is showing.
 * @property {(x: number, z: number, areaLight: number, power: number) => void} follow Where you are, how lit it is
 *     there, and how much of the power's on; every frame.
 * @property {(dt: number) => void} update
 * @property {(weight: number, x: number, z: number) => void} step A footstep there, instead of the carpet's.
 */

/**
 * @typedef {object} Level
 * @property {number} id Its number: its place in LEVELS.
 * @property {string} name As the menus say it.
 * @property {string} title What the camcorder puts over the picture on the way in.
 * @property {string} about The line under Explore on the title screen.
 * @property {(seed: number, cx: number, cz: number, options: import('./generator.js').WorldOptions) => import('./generator.js').ChunkData} generate
 *     Its chunks.
 * @property {(seed: number) => import('./generator.js').WorldOptions} options How its endless world is generated.
 * @property {Shape} shape
 * @property {(shared: Record<string, any>, maxAnisotropy: number, level: number) => import('./materials.js').LevelSurfaces} surfaces
 *     Its materials (see materials.js), made once at the start: `shared` is the ones every level has, and `level`
 *     its own number, for withBackroomsShading.
 * @property {string} shading What it puts into the shaders: its light's colours, its air, and anything its
 *     surfaces need (see levelShading.js).
 * @property {((ambience: import('../audio/Ambience.js').Ambience) => LevelSound) | null} sound Its own sound, if it
 *     has one (with it, the ambience's hum is left out; the level has its own).
 * @property {boolean} reflections Whether its floor mirrors the room (Level 1's puddles; see fx/Reflection.js).
 *     That costs about what the dynamic lights do, so it goes with them.
 * @property {boolean} dressable Whether Level Fun can dress it for the party (see party.js, which is laid out for
 *     Level 0's rooms). From one that can't, the Konami code goes to one that can.
 * @property {Atmosphere} atmosphere
 * @property {Tape} tape
 */

/** @type {Level} */
const LEVEL_ZERO = {
    id: 0,
    name: 'Level 0',
    title: 'LEVEL 0',
    about: 'The endless level.',
    generate: generateChunk,
    options: () => ({}),
    shape: { pillarSize: PILLAR_SIZE, ownPillars: false, baseboards: true, wallpaper: true, panels: true, extras: null },
    // The wallpaper, carpet and tiles every level's made with.
    surfaces: ({ wall, floor, ceiling, details }) => ({ wall, floor, ceiling, details, extras: {}, shadows: [] }),
    shading: LEVEL_ZERO_SHADING,
    sound: null,
    reflections: false,
    dressable: true,
    atmosphere: {
        haze: 0xe8e4d1,
        // Same as the original PointLight(0xf5f4cb, 1.1, 3.1).
        lightColor: new Color(0xf5f4cb).multiplyScalar(1.1 * LEGACY_SCALE),
        lightRange: 3.1,
        lightHeight: 0.85,
        ambient: 0xe8e4ca,
        ambientDim: 0.7 * LEGACY_SCALE,
        ambientLit: 0.1 * LEGACY_SCALE,
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
    name: 'Level 1',
    title: 'LEVEL 1',
    about: 'Level 1. The car park under everything.',
    generate: generateLevelOneChunk,
    options: levelOneOptions,
    shape: { pillarSize: LEVEL_ONE_PILLAR, ownPillars: true, baseboards: false, wallpaper: false, panels: false, extras: buildLevelOneGeometry },
    surfaces: createLevelOneSurfaces,
    shading: LEVEL_ONE_SHADING,
    sound: (ambience) => new LevelOneAudio(ambience),
    reflections: true,
    dressable: false,
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
        exitColor: 0xffe2c4,
        notes: [
            { lines: ['IT CAME', 'DOWN', 'WITH ME'], drawing: 'behind' },
            { lines: ['WHEN THE', 'POWER', 'GOES', 'HIDE'], drawing: 'panel' },
            { lines: ['NOBODY', 'LEAVES', 'THE', 'CRATES'], drawing: 'scribble' },
            { lines: ['C7', 'C8', 'C9', 'C9 C9 C9'], drawing: 'arrows' },
            { lines: ['THE CARS', 'ARE', 'EMPTY'], drawing: 'eye' },
            { lines: ["DON'T", 'STAND', 'IN THE', 'WATER'], drawing: 'run' },
            { lines: ['I CAN', 'HEAR', 'MUSIC'], drawing: 'figure' },
            { lines: ['EIGHT', 'MORE', 'THEN THE', 'PARTY'], drawing: 'door' },
        ],
    },
};

/** Every level, by number. */
export const LEVELS = [LEVEL_ZERO, LEVEL_ONE];

/** The levels a tape goes through, in order: it starts on the first. Getting out of the last one is Level Fun. */
export const TAPE_LEVELS = [0, 1];

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
