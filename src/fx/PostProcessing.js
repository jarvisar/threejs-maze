import { UnsignedByteType, Vector2, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AmbientOcclusionPass } from './AmbientOcclusion.js';
import { VHSShader } from './VHSShader.js';

// The effects were tuned at ~0.1 time units per frame at 60 fps; this keeps that speed at any frame rate.
const TIME_SCALE = 6;
// Wrapping keeps the noise functions inside float precision over long sessions. A multiple of 2π keeps the
// rolling scanlines continuous across the wrap (which happens about every 17 minutes).
const TIME_WRAP = 2000 * Math.PI;

/** Scene render (optionally with ambient occlusion) → (optional bloom) → VHS effects → screen. */
export class PostProcessing {
    /**
     * @param {import('three').WebGLRenderer} renderer
     * @param {import('three').Scene} scene
     * @param {import('three').Camera} camera
     */
    constructor(renderer, scene, camera) {
        this.renderer = renderer;

        // 8-bit targets: the image is low dynamic range (no tone mapping), this halves memory bandwidth
        // compared to the default half-float targets, and it's what the effects were tuned against.
        this.composer = new EffectComposer(renderer, new WebGLRenderTarget(1, 1, { type: UnsignedByteType }));

        this.renderPass = new RenderPass(scene, camera);
        // In the RenderPass's place while it's on (and loaded; see setAmbientOcclusion).
        this.occlusionPass = new AmbientOcclusionPass(scene, camera);
        this.bloomPass = new UnrealBloomPass(new Vector2(1, 1), 0.4, 0.5, 0.9);
        this.bloomPass.enabled = false;
        this.vhsPass = new ShaderPass(VHSShader);

        this.composer.addPass(this.occlusionPass);
        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(this.vhsPass);

        /** Uniforms of the VHS pass, for settings to write to. */
        this.vhs = this.vhsPass.uniforms;
        this.time = 0;
        this._glitchRate = 1;
        this._occlusion = false;
    }

    /**
     * Makes the tape lose tracking for a moment (only visible while the VHS effects are on).
     * @param {number} strength 0..1
     * @param {number} seconds How long it takes to settle.
     */
    glitch(strength, seconds) {
        this.vhs.glitch.value = Math.max(this.vhs.glitch.value, strength);
        this._glitchRate = this.vhs.glitch.value / seconds;
    }

    setSize(width, height, pixelRatio) {
        this.composer.setPixelRatio(pixelRatio);
        this.composer.setSize(width, height);
        this.renderer.getDrawingBufferSize(this.vhs.resolution.value);
    }

    /**
     * @param {boolean} vhs Whether the VHS pass runs at all (skipping it renders the scene straight to screen).
     * @param {boolean} bloom
     */
    setEnabled(vhs, bloom) {
        this.vhsPass.enabled = vhs;
        this.bloomPass.enabled = bloom;
    }

    /**
     * Ambient occlusion on or off. The first time it's switched on, it's loaded; until then the scene's drawn without.
     * @param {boolean} on
     * @returns {Promise<void>} Once it's in use (or off); rejected if it couldn't be loaded.
     */
    async setAmbientOcclusion(on) {
        this._occlusion = on;
        if (on && !this.occlusionPass.ready) await this.occlusionPass.load(this.renderer);
        const use = this._occlusion && this.occlusionPass.ready;
        this.occlusionPass.enabled = use;
        this.renderPass.enabled = !use;
    }

    /** @param {number} dt Seconds since the last frame. */
    render(dt) {
        this.time = (this.time + dt * TIME_SCALE) % TIME_WRAP;
        this.vhs.time.value = this.time;
        this.vhs.glitch.value = Math.max(this.vhs.glitch.value - dt * this._glitchRate, 0);
        this.composer.render(dt);
    }
}
