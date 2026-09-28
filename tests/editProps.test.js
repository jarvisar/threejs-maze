import { describe, expect, it } from 'vitest';
import { WALL_HEIGHT, WALL_THICKNESS } from '../src/config.js';
import { EDIT_SECTIONS, EDIT_TOOLS, toolProp } from '../src/player/EditTool.js';
import { furnitureHalf as officeHalf } from '../src/world/abandonedOfficeFurniture.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import {
    PROP_BED,
    PROP_CAMCORDER,
    PROP_GUEST,
    PROP_LAMP,
    PROP_NAMES,
    PROP_TV,
    PROP_VENDING,
    isHungProp,
    isPartyProp,
    makeProp,
    solidHalfSize,
    usesEditPictures,
} from '../src/world/decorations.js';
import { EditLog } from '../src/world/edits.js';
import { STYLES, isFurnitureProp } from '../src/world/furnitureProps.js';
import { LEVELS } from '../src/world/levels.js';
import { PARTY_DECORATIONS } from '../src/world/party.js';
import { PROP_ATLAS, PROP_ATLAS_HEIGHT, PROP_ATLAS_WIDTH } from '../src/world/propAtlas.js';
import {
    buildPropGeometry,
    buildPropGlowGeometry,
    propBounds,
    propFootprint,
    propGlowTemplate,
    propShadowBox,
    propShadowRadius,
    propVertexCount,
    templateFor,
} from '../src/world/props.js';
import { furnitureHalf as hotelHalf } from '../src/world/terrorHotelFurniture.js';

// Props only edit mode places (see decorations.js). PROP_TV and up, except Level Fun's.
const EDIT_ONLY = PROP_NAMES.map((_, type) => type).filter((type) => type >= PROP_TV && !PARTY_DECORATIONS.includes(type));
// A spread of variants, with bits set all over the place.
const LOOKS = [0, 1, 2, 3, 5, 7, 12, 17, 26, 31, 42, 63, 0x5a5a5a5a, 0xffffffff];
// From the middle of a cell to the face of a wall, less what a prop keeps from it (see EditTool).
const WALL_REACH = 0.5 - WALL_THICKNESS / 2 - 0.015;

function withStorage(test) {
    return () => {
        const original = globalThis.localStorage;
        const data = new Map();
        globalThis.localStorage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key) };
        try {
            test();
        } finally {
            globalThis.localStorage = original;
        }
    };
}

describe('what only edit mode puts down', () => {
    it('is on the tool strip, a level\'s own in its section, and nothing twice', () => {
        expect(new Set(PROP_NAMES).size).toBe(PROP_NAMES.length);
        for (const type of EDIT_ONLY) expect(EDIT_TOOLS, PROP_NAMES[type]).toContain(PROP_NAMES[type]);
        for (const level of LEVELS) {
            for (const type of level.decorations) {
                expect(toolProp(PROP_NAMES[type]), `${level.name} ${PROP_NAMES[type]}`).toBe(type);
                expect(isPartyProp(type)).toBe(false);
            }
        }
        // Each once, in one level's section.
        const all = LEVELS.flatMap((level) => level.decorations);
        expect(new Set(all).size).toBe(all.length);
        for (const type of EDIT_ONLY) expect(all, PROP_NAMES[type]).toContain(type);
    });

    it('is made of what every prop is, in every look', () => {
        for (const type of EDIT_ONLY) {
            for (const variant of LOOKS) {
                const prop = makeProp(type, 0, 0, 0, variant);
                for (const geometry of [templateFor(prop), propGlowTemplate(prop)]) {
                    if (!geometry) continue;
                    const where = `${PROP_NAMES[type]} ${variant}`;
                    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
                        expect(geometry.attributes[name]?.itemSize, `${where} ${name}`).toBe(size);
                    }
                    expect(geometry.attributes.position.array.every(Number.isFinite), where).toBe(true);
                    const uv = geometry.attributes.uv.array;
                    expect(uv.every((value) => value >= -1e-6 && value <= 1 + 1e-6), where).toBe(true);
                }
                expect(propBounds(prop).every(Number.isFinite)).toBe(true);
            }
        }
    });

    it('stands on the floor, or hangs on a wall with its back to it, under the ceiling', () => {
        for (const type of EDIT_ONLY) {
            for (const variant of LOOKS) {
                const [x0, y0, z0, x1, y1, z1] = propBounds(makeProp(type, 0, 0, 0, variant));
                const where = `${PROP_NAMES[type]} ${variant}`;
                expect(y1, where).toBeLessThanOrEqual(WALL_HEIGHT + 1e-6);
                if (isHungProp(type)) {
                    expect(z0, where).toBeGreaterThan(-1e-6);
                    // A fuse box with its door open stands out furthest.
                    expect(z1, where).toBeLessThan(0.15);
                    expect(y0, where).toBeGreaterThan(0.1);
                    // Narrow enough to go on a wall between the pillars at its ends.
                    expect(x1 - x0, where).toBeLessThan(0.66);
                } else {
                    expect(Math.abs(y0), where).toBeLessThan(0.004);
                }
            }
        }
    });

    it('fits in a cell, one way round or the other', () => {
        for (const type of EDIT_ONLY) {
            for (const variant of LOOKS) {
                const [x0, z0, x1, z1] = propFootprint(makeProp(type, 0, 0, 0, variant));
                const [a, b] = [x1 - x0, z1 - z0].sort((m, n) => m - n);
                expect(b, `${PROP_NAMES[type]} ${variant}`).toBeLessThanOrEqual(2 * WALL_REACH);
                expect(a, `${PROP_NAMES[type]} ${variant}`).toBeLessThanOrEqual(2 * WALL_REACH);
            }
        }
    });

    it('is solid no further out than it\'s drawn, and hangs on a wall without being in the way', () => {
        for (const type of EDIT_ONLY) {
            for (const variant of LOOKS) {
                const prop = makeProp(type, 0, 0, 0, variant);
                const where = `${PROP_NAMES[type]} ${variant}`;
                if (isHungProp(type)) {
                    expect(prop.box, where).toBeNull();
                    continue;
                }
                // A level's own furniture is as solid there as in the level, see the next test.
                if (!prop.box || isFurnitureProp(type)) continue;
                const [x0, , z0, x1, , z1] = propBounds(prop);
                expect(prop.box[0], where).toBeGreaterThanOrEqual(x0 - 0.012);
                expect(prop.box[1], where).toBeGreaterThanOrEqual(z0 - 0.012);
                expect(prop.box[2], where).toBeLessThanOrEqual(x1 + 0.012);
                expect(prop.box[3], where).toBeLessThanOrEqual(z1 + 0.012);
            }
        }
    });

    it('is as solid as it is on its own level, where it\'s that level\'s furniture', () => {
        const office = { desk: 1, 'vending machine': 3, cabinet: 5, copier: 8, sofa: 7, fridge: 15, chairs: 14, table: 10, binders: 6 };
        for (const [name, type] of Object.entries(office)) {
            const [a, d] = officeHalf({ type, variant: 0, yaw: 0 });
            expect(solidHalfSize(PROP_NAMES.indexOf(name), 0), name).toEqual([a, d]);
        }
        // A little in from what's drawn, as the level's own furniture is. See furnitureBox in terrorHotelFurniture.js.
        const hotel = { armchair: 3, chesterfield: 4, nightstand: 1, wardrobe: 2, piano: 10, clock: 9, 'side table': 5, 'writing desk': 14, bookcase: 15, fireplace: 16, console: 17, chalkboard: 20, flowers: 11 };
        for (const [name, type] of Object.entries(hotel)) {
            const [a, d] = hotelHalf({ type, variant: 0 });
            const [sa, sd] = /** @type {number[]} */ (solidHalfSize(PROP_NAMES.indexOf(name), 0));
            expect(sa, name).toBeCloseTo(a - 0.01, 6);
            expect(sd, name).toBeCloseTo(d - 0.01, 6);
        }
        for (const bed of [0, 1]) {
            const [a, d] = hotelHalf({ type: 0, variant: bed });
            const [sa, sd] = /** @type {number[]} */ (solidHalfSize(PROP_BED, bed));
            expect(sa).toBeCloseTo(a - 0.01, 6);
            expect(sd).toBeCloseTo(d - 0.01, 6);
        }
    });

    it('comes in a few looks of each piece of furniture, no more', () => {
        const keys = new Set();
        for (let variant = 0; variant < 64; variant++) keys.add(propBounds(makeProp(PROP_VENDING, 0, 0, 0, variant)).join());
        expect(keys.size).toBeLessThanOrEqual(STYLES);
        // A single bed and a double.
        const widths = new Set([0, 1, 2, 3].map((style) => Math.round((propBounds(makeProp(PROP_BED, 0, 0, 0, style))[3] - propBounds(makeProp(PROP_BED, 0, 0, 0, style))[0]) * 100)));
        expect(widths.size).toBe(2);
    });

    it('lights up where it has a light of its own, when that\'s on', () => {
        // A lamp: lit but for one look in four.
        expect(propGlowTemplate(makeProp(PROP_LAMP, 0, 0, 0, 0))).not.toBeNull();
        expect(propGlowTemplate(makeProp(PROP_LAMP, 0, 0, 0, 3))).toBeNull();
        // A camcorder's light, while it's recording.
        expect(propGlowTemplate(makeProp(PROP_CAMCORDER, 0, 0, 0, 0))).not.toBeNull();
        expect(propGlowTemplate(makeProp(PROP_CAMCORDER, 0, 0, 0, 1))).toBeNull();
        // A television off: only the video's clock.
        const off = propGlowTemplate(makeProp(PROP_TV, 0, 0, 0, 3));
        const on = propGlowTemplate(makeProp(PROP_TV, 0, 0, 0, 0));
        expect(off?.attributes.position.count).toBeLessThan(on?.attributes.position.count ?? 0);
        expect(propGlowTemplate(makeProp(PROP_VENDING, 0, 0, 0, 0))).not.toBeNull();
    });

    it('goes into its chunk\'s meshes: what\'s lit in a mesh of its own, only where there\'s any', () => {
        const lamp = makeProp(PROP_LAMP, 0.1, 0.2, 0.5, 0);
        const bed = makeProp(PROP_BED, 1, 0, 0, 1);
        expect(buildPropGlowGeometry([bed], 0, 0)).toBeNull();
        const glow = buildPropGlowGeometry([lamp, bed], 0, 0);
        expect(glow?.attributes.position.count).toBe(propGlowTemplate(lamp)?.attributes.position.count);
        const solid = buildPropGeometry([lamp, bed], 0, 0);
        expect(solid?.attributes.position.count).toBe(templateFor(lamp).attributes.position.count + templateFor(bed).attributes.position.count);
        expect(propVertexCount(lamp)).toBe(templateFor(lamp).attributes.position.count + (propGlowTemplate(lamp)?.attributes.position.count ?? 0));
    });

    it('has a shadow under it: none on a wall, round under what\'s round, square under the rest', () => {
        for (const type of EDIT_ONLY) {
            const prop = makeProp(type, 0, 0, 0, 0);
            const box = propShadowBox(prop);
            const radius = propShadowRadius(prop);
            if (isHungProp(type)) {
                expect(box, PROP_NAMES[type]).toBeNull();
                expect(radius, PROP_NAMES[type]).toBe(0);
            } else {
                expect(box !== null || radius > 0, PROP_NAMES[type]).toBe(true);
            }
        }
        // The level's own keep their round ones.
        expect(propShadowBox(makeProp(0, 0, 0, 0, 1))).toBeNull();
    });

    it('draws its pictures only once they\'re wanted, in the props texture\'s bottom half', () => {
        const rects = [];
        for (const [name, value] of Object.entries(PROP_ATLAS)) {
            for (const rect of Array.isArray(value[0]) ? value : [value]) rects.push([name, rect]);
        }
        for (const [name, [x0, y0, x1, y1]] of rects) {
            expect(x0, name).toBeGreaterThanOrEqual(0);
            expect(y0, name).toBeGreaterThanOrEqual(0);
            expect(x1, name).toBeLessThanOrEqual(PROP_ATLAS_WIDTH);
            expect(y1, name).toBeLessThanOrEqual(PROP_ATLAS_HEIGHT);
        }
        // No two overlap, including the plain white square.
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const [a, [ax0, ay0, ax1, ay1]] = rects[i];
                const [b, [bx0, by0, bx1, by1]] = rects[j];
                expect(ax1 <= bx0 || bx1 <= ax0 || ay1 <= by0 || by1 <= ay0, `${a} and ${b}`).toBe(true);
            }
        }
        // Everything drawn later lives in the atlas's later half.
        for (const name of ['snow', 'blueScreen', 'vending', 'whiteboard', 'clockFace', 'exitSign', 'danger', 'menu', 'stripes', 'gauge']) expect(PROP_ATLAS[name][1], name).toBeGreaterThanOrEqual(512);
        expect(usesEditPictures(PROP_TV)).toBe(true);
        expect(usesEditPictures(PROP_TV - 1)).toBe(false);
    });

    it('is saved with the world, and comes back just as it was put down', withStorage(() => {
        const store = new ChunkStore(31, new EditLog(31));
        const placed = EDIT_ONLY.filter((type) => !isHungProp(type)).slice(0, 12).map((type, k) => makeProp(type, (k % 4) * 1.02 - 1.5, Math.floor(k / 4) * 1.03 - 5.1, k * 0.4, 0x1234 + k));
        for (const prop of placed) store.addProp(prop);
        store.edits.save();
        const again = new ChunkStore(31, new EditLog(31));
        for (const prop of placed) {
            const [back] = again.propsAt(Math.round(prop.x), Math.round(prop.z)).filter((other) => other.index === undefined);
            expect(back, PROP_NAMES[prop.type]).toMatchObject({ type: prop.type, x: prop.x, z: prop.z, yaw: prop.yaw, variant: prop.variant });
        }
    }));
});

describe('a partygoer put down in edit mode', () => {
    it('is one of Level Fun\'s things, drawn with the party\'s own guests rather than with the props', () => {
        expect(EDIT_SECTIONS.at(-1)).toMatchObject({ name: 'Level Fun', levelFun: true });
        expect(EDIT_SECTIONS.at(-1)?.tools).toContain('partygoer');
        expect(toolProp('partygoer')).toBe(PROP_GUEST);
        const guest = makeProp(PROP_GUEST, 0.2, 0.3, 1, 7);
        // Walked into, it pops. Nothing stops you.
        expect(guest.box).toBeNull();
        expect(buildPropGeometry([guest], 0, 0)).toBeNull();
        expect(buildPropGlowGeometry([guest], 0, 0)).toBeNull();
        expect(propShadowBox(guest)).toBeNull();
        expect(propShadowRadius(guest)).toBe(0);
        expect(usesEditPictures(PROP_GUEST)).toBe(false);
        expect(isPartyProp(PROP_GUEST)).toBe(false);
    });

    it('is aimed at, and kept clear of, as all of it whichever way it\'s turned', () => {
        const template = templateFor(makeProp(PROP_GUEST, 0, 0, 0, 0));
        for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) expect(template.attributes[name]?.itemSize, name).toBe(size);
        const [x0, y0, z0, x1, y1, z1] = propBounds(makeProp(PROP_GUEST, 0, 0, 0, 0));
        expect(Math.abs(y0)).toBeLessThan(0.004);
        expect(y1).toBeGreaterThan(0.6);
        expect(y1).toBeLessThan(WALL_HEIGHT);
        expect([x0, z0]).toEqual([-x1, -z1]);
        expect(x1).toBe(z1);
        const position = template.attributes.position;
        for (let i = 0; i < position.count; i++) expect(Math.hypot(position.getX(i), position.getZ(i))).toBeLessThanOrEqual(x1 + 1e-9);
        expect(x1).toBeLessThan(WALL_REACH);
    });
});
