import {
    AdditiveBlending,
    CustomBlending,
    DepthTexture,
    Group,
    Material,
    NoBlending,
    OneFactor,
    ShaderMaterial,
    SrcColorFactor,
    UnsignedByteType,
    UnsignedIntType,
    WebGLRenderTarget,
    ZeroFactor,
} from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';

/**
 * @typedef {object} Occlusion How a level's ambient occlusion looks (see levels.js).
 * @property {number} radius How far from a corner, or from under something, it reaches (world units: a cell is one).
 * @property {number} intensity How dark it gets there (N8AO's: the occlusion to this power).
 */

/** Every level's, but where one says otherwise (see Atmosphere.occlusion in levels.js). */
export const OCCLUSION = Object.freeze({ radius: 0.3, intensity: 4 });

// How far (as a part of the radius) what's in front of a surface can be before it stops counting: less than N8AO's
// usual, so the edge of a wall seen against the room behind it doesn't leave a dark smear on the ceiling beyond it.
const FALLOFF = 0.5;

// Put in place of an object's material to leave it out of a draw. (three.js skips what has an invisible material, but
// still goes on to its children, which hiding the object wouldn't.)
const HIDDEN = new Material();
HIDDEN.visible = false;

/**
 * Whether a material is drawn over the ambient occlusion rather than darkened by it: anything added on (the glows round
 * the lights, light spilling through a doorway), and anything marked `userData.unoccluded` (steam, the water's shine,
 * the edit mode's outlines). What's light or air rather than a surface.
 * @param {Material | Material[]} material
 */
function unoccluded(material) {
    return !Array.isArray(material) && (material.blending === AdditiveBlending || material.userData.unoccluded === true);
}

/**
 * Ambient occlusion: the soft shade in corners, where walls meet the floor and the ceiling, and under and around things,
 * where less of the light bouncing round the room gets in. Worked out in screen space by N8AO
 * (https://github.com/N8python/n8ao), which isn't loaded until it's first switched on (it's off unless picked in the
 * settings).
 *
 * It takes the RenderPass's place while it's on, and draws the scene in two parts: first everything solid, and what lies
 * on it (the decals), which the occlusion is worked out from and darkens; then what's light or air rather than surface
 * (see unoccluded), over that, so a glow by a wall doesn't go dark where the wall meets the ceiling. (N8AO's own way of
 * leaving transparent things out draws them all twice more, every frame, and takes the whole of a glow's square as
 * covered.) The occlusion fades out into the haze as the surfaces do (N8AO follows the scene's fog, which is every
 * level's: see materials.js).
 */
export class AmbientOcclusionPass extends Pass {
    /**
     * @param {import('three').Scene} scene
     * @param {import('three').Camera} camera
     */
    constructor(scene, camera) {
        super();
        this.scene = scene;
        this.camera = camera;
        // Like the RenderPass it stands in for: the picture goes to the read buffer, for the next pass to read.
        this.needsSwap = false;
        this.enabled = false;
        /** @type {import('n8ao').N8AOPass | null} Once loaded (see load). */
        this.n8ao = null;
        /** @type {Promise<void> | null} */
        this._loading = null;
        this._ready = false;
        /** @type {Occlusion} */
        this._occlusion = OCCLUSION;
        this._width = 1;
        this._height = 1;

        // The solid part of the scene, and its depth (8-bit, as the composer's targets are: see PostProcessing).
        this.sceneTarget = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, depthTexture: new DepthTexture(1, 1, UnsignedIntType) });
        this.sceneTarget.texture.name = 'occlusion.scene';
        // How much of the light gets in, at each pixel (1 where nothing's in the way).
        this.occlusionTarget = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: false });
        this.occlusionTarget.texture.name = 'occlusion';

        // The solid part of the scene times the occlusion, in place.
        this._darken = new FullScreenQuad(new ShaderMaterial({
            name: 'OcclusionDarken',
            uniforms: { tDiffuse: { value: this.occlusionTarget.texture } },
            vertexShader: CopyShader.vertexShader,
            fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
	gl_FragColor = vec4( texture2D( tDiffuse, vUv ).rgb, 1.0 );
}
`,
            blending: CustomBlending,
            blendSrc: ZeroFactor,
            blendDst: SrcColorFactor,
            blendSrcAlpha: ZeroFactor,
            blendDstAlpha: OneFactor,
            depthTest: false,
            depthWrite: false,
        }));
        this._copy = new FullScreenQuad(new ShaderMaterial({
            name: 'OcclusionCopy',
            uniforms: { tDiffuse: { value: this.sceneTarget.texture }, opacity: { value: 1 } },
            vertexShader: CopyShader.vertexShader,
            fragmentShader: CopyShader.fragmentShader,
            blending: NoBlending,
            depthTest: false,
            depthWrite: false,
        }));

        /** @type {import('three').Object3D[]} Drawn over the occlusion this frame (see unoccluded). */
        this._over = [];
        /** @type {import('three').Object3D[]} The rest. */
        this._solid = [];
        /** @type {(Material | Material[])[]} Materials put aside while part of the scene is drawn. */
        this._aside = [];
        this._sort = (object) => {
            const material = /** @type {any} */ (object).material;
            if (material) (unoccluded(material) ? this._over : this._solid).push(object);
        };
    }

    /** Whether N8AO has been loaded and its shaders compiled, so the pass can be switched on. */
    get ready() {
        return this._ready;
    }

    /**
     * Loads N8AO (once), sets it up, and compiles its shaders.
     * @param {import('three').WebGLRenderer} renderer
     * @returns {Promise<void>}
     */
    load(renderer) {
        this._loading ??= import('n8ao').then(async ({ N8AOPass }) => {
            const n8ao = new N8AOPass(this.scene, this.camera, this._width, this._height);
            // It's handed the solid part of the scene (see render), with nothing transparent in the way of the depth.
            n8ao.autoDetectTransparency = false;
            const config = n8ao.configuration;
            config.transparencyAware = false;
            config.autoRenderBeauty = false;
            n8ao.beautyRenderTarget.dispose();
            n8ao.beautyRenderTarget = this.sceneTarget;
            // Just the occlusion, as a shade of grey, to be multiplied in; and no colour conversion, as nowhere else
            // (see colorManagement.js).
            n8ao.setDisplayMode('AO');
            config.colorMultiply = false;
            config.gammaCorrection = false;
            n8ao.setSize(this._width, this._height);
            this.n8ao = n8ao;
            this._configure();
            // Its shaders compiled in the background (where the browser can) before it's first used: compiled as it's
            // switched on, they stopped the picture for a moment (a tenth of a second or more on Windows).
            const quads = new Group();
            for (const quad of [n8ao.effectShaderQuad, n8ao.poissonBlurQuad, n8ao.accumulationQuad, n8ao.effectCompositerQuad, this._darken, this._copy]) {
                if (quad?._mesh) quads.add(quad._mesh);
            }
            await renderer.compileAsync(quads, this.camera);
            quads.clear();
            this._ready = true;
        }).catch((error) => {
            // (Say it's offline: switching it on again tries again.)
            this._loading = null;
            throw error;
        });
        return this._loading;
    }

    /**
     * How it looks on the level that's showing (see levels.js).
     * @param {Occlusion} [occlusion] The level's own, if it has one.
     */
    setLevel(occlusion = OCCLUSION) {
        this._occlusion = occlusion;
        this._configure();
    }

    _configure() {
        if (!this.n8ao) return;
        const config = this.n8ao.configuration;
        config.aoRadius = this._occlusion.radius;
        config.intensity = this._occlusion.intensity;
        config.distanceFalloff = FALLOFF;
    }

    setSize(width, height) {
        this._width = width;
        this._height = height;
        this.sceneTarget.setSize(width, height);
        this.occlusionTarget.setSize(width, height);
        this.n8ao?.setSize(width, height);
    }

    /**
     * @param {import('three').WebGLRenderer} renderer
     * @param {WebGLRenderTarget} _writeBuffer
     * @param {WebGLRenderTarget} readBuffer
     */
    render(renderer, _writeBuffer, readBuffer) {
        const { scene, camera, n8ao } = this;
        if (!n8ao) return;
        const over = this._over;
        const solid = this._solid;
        over.length = solid.length = 0;
        scene.traverseVisible(this._sort);

        // The solid part.
        const autoClear = renderer.autoClear;
        renderer.autoClear = true;
        this._setAside(over);
        renderer.setRenderTarget(this.sceneTarget);
        renderer.render(scene, camera);
        this._putBack(over);

        // Its occlusion, and the picture darkened by it.
        n8ao.render(renderer, this.occlusionTarget, null, 0, false);
        renderer.autoClear = false;
        renderer.setRenderTarget(this.sceneTarget);
        this._darken.render(renderer);

        // What's drawn over it, into the same depth. (With no background, which would clear the lot, and the shadows as
        // they were drawn for the solid part.)
        if (over.length > 0) {
            const background = scene.background;
            const shadows = renderer.shadowMap.autoUpdate;
            scene.background = null;
            renderer.shadowMap.autoUpdate = false;
            this._setAside(solid);
            renderer.render(scene, camera);
            this._putBack(solid);
            scene.background = background;
            renderer.shadowMap.autoUpdate = shadows;
        }

        renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
        this._copy.render(renderer);
        renderer.autoClear = autoClear;
    }

    /** Leaves these out of what's drawn (their children aren't: a glow can hang off something solid). */
    _setAside(objects) {
        const aside = this._aside;
        for (const object of objects) {
            aside.push(object.material);
            object.material = HIDDEN;
        }
    }

    _putBack(objects) {
        const aside = this._aside;
        for (let i = 0; i < objects.length; i++) objects[i].material = aside[i];
        aside.length = 0;
    }

    dispose() {
        this.sceneTarget.dispose();
        this.occlusionTarget.dispose();
        this._darken.material.dispose();
        this._darken.dispose();
        this._copy.material.dispose();
        this._copy.dispose();
        this.n8ao?.dispose?.();
    }
}
