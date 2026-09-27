import {
    AmbientLight,
    Box3,
    BoxGeometry,
    Color,
    DirectionalLight,
    Group,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    OrthographicCamera,
    Scene,
    Vector3,
    WebGLRenderTarget,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOOR_HEIGHT, DOOR_WIDTH, PILLAR_SIZE, WALL_THICKNESS } from '../config.js';
import { toolProp } from '../player/EditTool.js';
import { PROP_GUEST, isHungProp, isPartyProp, makeProp } from '../world/decorations.js';
import { OUTLET_HEIGHT, OUTLET_WIDTH, OUTLET_Y } from '../world/outlets.js';
import { GUEST_FACE, createFaceGeometry } from '../world/partyGeometry.js';
import { paint, propGlowTemplate, templateFor, uprightVariant } from '../world/props.js';

/*
 * Pictures of what edit mode builds and puts down, for its catalogue (see Catalogue.js): each drawn once, the first
 * time it's wanted (or ahead of time, a few a frame; see prepare), with the game's own renderer into a small target of
 * its own, and copied onto a canvas. Lit plainly, from the front and above, on nothing: they're pictures of what it is,
 * not of the Backrooms.
 */

/** How big each picture is drawn, in pixels (it's shown smaller, for smooth edges). */
const SIZE = 128;
// How much of a picture what's in it fills, and where it's seen from: in front, off to its right and above.
const FILL = 0.84;
const VIEW = new Vector3(0.75, 0.62, 1.45).normalize();
// Something that hangs on a wall is seen from in front.
const WALL_VIEW = new Vector3(0.28, 0.12, 1).normalize();
/**
 * The look each kind of prop is shown in, where the first one isn't the one to show (see a prop's variant): three
 * tyres, the barrier's lamp on, three lockers, both lamps of a work light, a stack of towels...
 */
const LOOKS = new Map([
    ['bottles', 0x6d], ['crates', 3], ['boxes', 0x13], ['pallet', 4], ['barrel', 1], ['cone', 5], ['rack', 0x1d4],
    ['ring', 1], ['toolbox', 5], ['bucket', 1], ['cylinders', 0x2a], ['suitcase', 0x82], ['trolley', 3], ['cart', 3],
    ['cooler', 0x18], ['plant', 0x44], ['bin', 0x28], ['files', 1], ['tyres', 5], ['lockers', 0x1b], ['work light', 2],
    ['tv', 8], ['towels', 0x16], ['noodles', 2], ['pool chair', 4], ['lounger', 4], ['cake', 1], ['presents', 2],
    ['balloons', 5],
]);

export class Thumbnails {
    /**
     * @param {import('three').WebGLRenderer} renderer
     * @param {import('three').Texture} propAtlas The props' pictures (see PROP_ATLAS).
     * @param {import('three').Texture} partyAtlas Level Fun's (see partyTextures.js).
     */
    constructor(renderer, propAtlas, partyAtlas) {
        this.renderer = renderer;
        /** @type {Map<string, HTMLCanvasElement>} */
        this.drawn = new Map();
        this.target = new WebGLRenderTarget(SIZE, SIZE);
        this.pixels = new Uint8Array(SIZE * SIZE * 4);
        this.scene = new Scene();
        this.scene.add(new AmbientLight(0xffffff, 1.5));
        const light = new DirectionalLight(0xffffff, 2.3);
        light.position.set(-1.5, 3, 2.5);
        this.scene.add(light);
        this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
        this.materials = {
            prop: new MeshLambertMaterial({ map: propAtlas, vertexColors: true }),
            party: new MeshLambertMaterial({ map: partyAtlas, vertexColors: true }),
            // A guest's face, drawn on it.
            face: new MeshLambertMaterial({ map: partyAtlas, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
            glow: new MeshBasicMaterial({ map: propAtlas, vertexColors: true }),
            plain: new MeshLambertMaterial({ vertexColors: true }),
            lit: new MeshBasicMaterial({ vertexColors: true }),
        };
        this.model = new Group();
        this.scene.add(this.model);
        /** @type {import('three').BufferGeometry | null} */
        this._face = null;
        /** Whether the shaders the pictures are drawn with are ready (see warm). */
        this._warm = false;
        this._warming = false;
    }

    /**
     * Gets the shaders the pictures are drawn with ready, the first time, without holding anything up while they compile
     * (a shader compiled when it's first drawn with stops everything until it's done).
     * @returns {boolean} Whether they're ready yet.
     */
    warm() {
        if (this._warm || this._warming) return this._warm;
        this._warming = true;
        const box = new BoxGeometry(0.01, 0.01, 0.01);
        this.model.add(...Object.values(this.materials).map((material) => new Mesh(box, material)));
        const done = () => {
            this.model.clear();
            box.dispose();
            this._warm = true;
        };
        this.renderer.compileAsync(this.scene, this.camera).then(done, done);
        return false;
    }

    /**
     * The picture of a tool, drawn now if it hasn't been.
     * @param {string} tool
     * @returns {HTMLCanvasElement}
     */
    picture(tool) {
        let canvas = this.drawn.get(tool);
        if (!canvas) {
            canvas = this._draw(tool);
            this.drawn.set(tool, canvas);
        }
        return canvas;
    }

    /**
     * Draws the pictures of some tools that aren't drawn yet, for about `budget` milliseconds: a few a frame, so
     * they're ready by the time the catalogue's opened.
     * @param {readonly string[]} tools
     * @param {number} budget
     * @returns {boolean} Whether they're all drawn now.
     */
    prepare(tools, budget) {
        const start = performance.now();
        for (const tool of tools) {
            if (this.drawn.has(tool)) continue;
            if (performance.now() - start > budget) return false;
            this.picture(tool);
        }
        return true;
    }

    /** @returns {HTMLCanvasElement} */
    _draw(tool) {
        const renderer = this.renderer;
        const model = this.model;
        const type = toolProp(tool);
        const [solid, lit, party, wall] = this._model(tool);
        model.clear();
        model.add(new Mesh(solid, party ? this.materials.party : type === undefined ? this.materials.plain : this.materials.prop));
        if (lit) model.add(new Mesh(lit, type === undefined ? this.materials.lit : this.materials.glow));
        if (type === PROP_GUEST) {
            this._face ??= createFaceGeometry(GUEST_FACE.size);
            const face = new Mesh(this._face, this.materials.face);
            face.position.set(0, GUEST_FACE.y, GUEST_FACE.z);
            model.add(face);
        }
        // Framed round its box, from the front and above (or, on a wall, from in front).
        const box = new Box3().setFromObject(model);
        const middle = box.getCenter(new Vector3());
        const reach = box.getSize(new Vector3()).length() / 2;
        const camera = this.camera;
        camera.left = camera.bottom = -reach / FILL;
        camera.right = camera.top = reach / FILL;
        camera.position.copy(middle).addScaledVector(wall ? WALL_VIEW : VIEW, reach * 3);
        camera.near = reach * 0.5;
        camera.far = reach * 6;
        camera.lookAt(middle);
        camera.updateProjectionMatrix();

        const previousTarget = renderer.getRenderTarget();
        const previousClear = renderer.getClearColor(new Color());
        const previousAlpha = renderer.getClearAlpha();
        const previousXr = renderer.xr.enabled;
        renderer.xr.enabled = false;
        renderer.setRenderTarget(this.target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(this.scene, camera);
        renderer.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.pixels);
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(previousClear, previousAlpha);
        renderer.xr.enabled = previousXr;
        // (Props' templates are shared, but for Level Fun's things: only what was made here goes.)
        if (type === undefined || isPartyProp(type)) for (const mesh of model.children) /** @type {Mesh} */ (mesh).geometry.dispose();
        model.clear();

        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
        const image = g.createImageData(SIZE, SIZE);
        // (Read from the bottom row up.)
        for (let y = 0; y < SIZE; y++) image.data.set(this.pixels.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
        g.putImageData(image, 0, 0);
        canvas.className = 'catalogue-picture';
        return canvas;
    }

    /**
     * What a tool's picture shows: what it's made of, what of it is lit (or null), whether it's one of Level Fun's (with
     * pictures of its own), and whether it hangs on a wall. (A guest's face goes on it after.)
     * @returns {[import('three').BufferGeometry, import('three').BufferGeometry | null, boolean, boolean]}
     */
    _model(tool) {
        const type = toolProp(tool);
        if (type !== undefined) {
            const prop = makeProp(type, 0, 0, 0, uprightVariant(type, LOOKS.get(tool) ?? 0));
            return [templateFor(prop), propGlowTemplate(prop), isPartyProp(type) || type === PROP_GUEST, isHungProp(type)];
        }
        return [...buildingModel(tool), false, tool === 'outlet'];
    }

    dispose() {
        this.target.dispose();
        this._face?.dispose();
        for (const material of Object.values(this.materials)) material.dispose();
    }
}

// What the level's own are drawn as here: Level 0's wallpaper, a pillar, an outlet's plate, a panel's glass.
const WALLPAPER = 0xcfc486;
const BASEBOARD = 0xe6dcc0;
const PANEL_LIGHT = 0xfff6d8;

/**
 * The pictures of what builds the level itself: a piece of wall, a doorway, a pillar, an outlet on a wall, and a
 * light panel in its piece of ceiling, seen from under it.
 * @returns {[import('three').BufferGeometry, import('three').BufferGeometry | null]}
 */
function buildingModel(tool) {
    const t = WALL_THICKNESS;
    const board = (x, width) => paint(new BoxGeometry(width, 0.035, t + 0.01).translate(x, 0.0175, 0), BASEBOARD);
    if (tool === 'wall') return [merged([paint(new BoxGeometry(1, 1, t).translate(0, 0.5, 0), WALLPAPER), board(0, 1)]), null];
    if (tool === 'doorway') {
        const side = (1 - DOOR_WIDTH) / 2;
        const parts = [paint(new BoxGeometry(1, 1 - DOOR_HEIGHT, t).translate(0, (1 + DOOR_HEIGHT) / 2, 0), WALLPAPER)];
        for (const s of [-1, 1]) parts.push(paint(new BoxGeometry(side, DOOR_HEIGHT, t).translate(s * (DOOR_WIDTH + side) / 2, DOOR_HEIGHT / 2, 0), WALLPAPER), board(s * (DOOR_WIDTH + side) / 2, side));
        return [merged(parts), null];
    }
    if (tool === 'pillar') return [merged([paint(new BoxGeometry(PILLAR_SIZE, 1, PILLAR_SIZE).translate(0, 0.5, 0), WALLPAPER), paint(new BoxGeometry(PILLAR_SIZE + 0.01, 0.035, PILLAR_SIZE + 0.01).translate(0, 0.0175, 0), BASEBOARD)]), null];
    if (tool === 'outlet') {
        return [merged([
            paint(new BoxGeometry(0.24, 0.24, t / 2).translate(0, OUTLET_Y, -t / 4), WALLPAPER),
            paint(new BoxGeometry(OUTLET_WIDTH, OUTLET_HEIGHT, 0.006).translate(0, OUTLET_Y, 0.003), 0xe6e1cc),
            ...[-1, 1].map((s) => paint(new BoxGeometry(0.005, 0.009, 0.002).translate(s * 0.006, OUTLET_Y + 0.012, 0.0065), 0x3b382e)),
        ]), null];
    }
    // A light: its panel in a piece of ceiling, from below.
    return [
        paint(new BoxGeometry(0.5, 0.02, 0.5).translate(0, 1.01, 0), 0xd8d2c0),
        paint(new BoxGeometry(1 / 6, 0.004, 1 / 4).translate(0, 0.998, 0), PANEL_LIGHT),
    ];
}

function merged(parts) {
    const geometry = /** @type {import('three').BufferGeometry} */ (mergeGeometries(parts));
    for (const part of parts) part.dispose();
    return geometry;
}
