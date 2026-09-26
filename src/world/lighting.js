import { AmbientLight, Color, DirectionalLight, SpotLight, Vector3 } from 'three';
import { CLEAR_COLOR, FOG_COLOR, VIEW_DISTANCE } from '../config.js';
import { CEILING_COLOR_DIM, CEILING_COLOR_LIT, worldLighting } from './materials.js';
import { BLACKOUT_DARKNESS } from './panelLights.js';

// Before r155, three.js multiplied every light's intensity by π ("legacy lights"). The scene was tuned under
// that model, so intensities are scaled here to render the same.
const LEGACY_SCALE = Math.PI;

const AMBIENT_DIM = 0.7 * LEGACY_SCALE;
const AMBIENT_WITH_CEILING_LIGHTS = 0.1 * LEGACY_SCALE;
const FLASHLIGHT_INTENSITY = 0.7 * LEGACY_SCALE;

// The shared light clock wraps so that float precision in the shaders never degrades.
const LIGHT_TIME_WRAP = 4096;
// How quickly the haze adjusts when walking into or out of a dark area (per second).
const AREA_LIGHT_RATE = 2.5;
// How far (squared) the flashlight or the point it aims at can move before its shadow map is redrawn.
const SHADOW_TOLERANCE_SQ = 1e-5 ** 2;
// Level Fun's haze: a little warmer and pinker, as if lit through the gels.
const PARTY_HAZE = 0xf0dcd2;

const _forward = new Vector3();
const _right = new Vector3();

/**
 * All lights in the scene. The set of lights never changes after startup; toggling the flashlight or the
 * ceiling lights only changes uniforms, so no shader ever needs to recompile mid-game.
 */
export class Lighting {
    /**
     * @param {import('three').Scene} scene
     * @param {import('three').MeshStandardMaterial} ceilingMaterial
     * @param {import('three').MeshPhongMaterial} [ceilingDecalMaterial] The stains on the ceiling, shaded
     *     along with it.
     */
    constructor(scene, ceilingMaterial, ceilingDecalMaterial) {
        this.scene = scene;
        this.ceilingMaterials = [ceilingMaterial, ceilingDecalMaterial].filter((material) => material);

        this.ambient = new AmbientLight(0xe8e4ca, AMBIENT_DIM);

        // Straight down, so it only lights the floor. (It used to cast shadows too, but a light pointing
        // straight down only shadows the floor underneath the walls, where nobody can see it.)
        this.overhead = new DirectionalLight(0xfeffd9, 0.9 * LEGACY_SCALE);
        this.overhead.position.set(0, 10, 0);

        // distance 0 + decay 0 == the legacy model's "no distance falloff" for this light.
        this.flashlight = new SpotLight(0xffffff, 0, 0, Math.PI / 6, 0.5, 0);
        this.flashlight.castShadow = true;
        this.flashlight.shadow.mapSize.set(1024, 1024);
        this.flashlight.shadow.camera.near = 0.05;
        this.flashlight.shadow.camera.far = VIEW_DISTANCE;
        this.flashlight.shadow.bias = -0.0004;
        this.flashlight.shadow.radius = 2;
        // Only redrawn when something it depends on changes (see updateFlashlight).
        this.flashlight.shadow.autoUpdate = false;
        this._shadowPosition = new Vector3(Infinity, 0, 0);
        this._shadowTarget = new Vector3();
        this._shadowWorldVersion = -1;

        scene.add(this.ambient, this.overhead, this.flashlight, this.flashlight.target);

        this.flashlightOn = false;
        this.ceilingLightsOn = false;
        /** How lit the area around the camera is (0..1), smoothed, before any power cut. */
        this.areaLight = 1;
        /** How much of the light a power cut is taking right now (0..1). */
        this.blackout = 0;
        this._clear = new Color(CLEAR_COLOR);
    }

    /** Level Fun: its haze, and the confetti in the carpet (the gels are the panels' own; see party.js). */
    setParty(on) {
        this._clear.set(on ? PARTY_HAZE : CLEAR_COLOR);
        this.scene.fog?.color.set(on ? PARTY_HAZE : FOG_COLOR);
        worldLighting.partyLevel.value = on ? 1 : 0;
    }

    setFlashlight(on) {
        this.flashlightOn = on;
        this.flashlight.intensity = on ? FLASHLIGHT_INTENSITY : 0;
        // The shadow map isn't kept up to date while the light is off.
        if (on) this.invalidateShadow();
    }

    /** Makes the flashlight redraw its shadow map on the next frame (e.g. after the GPU lost it). */
    invalidateShadow() {
        this._shadowPosition.set(Infinity, 0, 0);
    }

    /** The "dynamic lights" mode: ceiling panels light the scene and the ambient light drops. */
    setCeilingLights(on) {
        this.ceilingLightsOn = on;
        worldLighting.gridLightIntensity.value = on ? 1 : 0;
        this.ambient.intensity = on ? AMBIENT_WITH_CEILING_LIGHTS : AMBIENT_DIM;
        for (const material of this.ceilingMaterials) material.color.setHex(on ? CEILING_COLOR_LIT : CEILING_COLOR_DIM);
    }

    /**
     * A power cut: every panel goes out at once (and comes back the same way), and with them most of the
     * light. Instant, unlike walking into a dark area, which the haze follows gradually.
     * @param {number} level 0 (lights as normal) to 1 (all out).
     */
    setBlackout(level) {
        this.blackout = level;
        worldLighting.blackout.value = level;
    }

    /**
     * Advances flickering lights and follows the light level around the camera.
     * @param {number} dt Seconds since the last frame.
     * @param {number} areaLight Area light at the camera right now (see ChunkStore.areaLight).
     * @param {boolean} [snap] Jump straight to the new light level (e.g. after teleporting).
     */
    update(dt, areaLight, snap = false) {
        worldLighting.lightTime.value = (worldLighting.lightTime.value + dt) % LIGHT_TIME_WRAP;
        this.areaLight = snap ? areaLight : this.areaLight + (areaLight - this.areaLight) * Math.min(dt * AREA_LIGHT_RATE, 1);
        const lit = this.areaLight * (1 - BLACKOUT_DARKNESS * this.blackout);
        worldLighting.cameraAreaLight.value = lit;
        this.scene.background.copy(this._clear).multiplyScalar(lit);
    }

    get time() {
        return worldLighting.lightTime.value;
    }

    /**
     * Holds the flashlight a little below and to the right of the camera, pointing where you look.
     * @param {import('three').Camera} camera
     * @param {number} worldVersion Changes whenever the level's walls do (see WorldView.version).
     * @param {boolean} [inHand] `camera` is a VR controller: shine from exactly there, where it points.
     */
    updateFlashlight(camera, worldVersion, inHand = false) {
        camera.getWorldDirection(_forward);
        const { position, target, shadow } = this.flashlight;
        position.copy(camera.position);
        if (!inHand) {
            _right.set(-_forward.z, 0, _forward.x);
            if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
            _right.normalize();
            position.addScaledVector(_right, 0.15);
            position.y -= 0.12;
        }
        target.position.copy(camera.position).addScaledVector(_forward, 5);
        target.updateMatrixWorld();

        // Redraw the shadow map only when the beam or the walls have moved, not every frame: standing still,
        // or on the pause menu, the flashlight then costs no more than any other light. (The tolerance is far
        // below a shadow-map texel, and lets the last of the head bob settle without redrawing.)
        if (!this.flashlightOn) return;
        if (worldVersion !== this._shadowWorldVersion
            || position.distanceToSquared(this._shadowPosition) > SHADOW_TOLERANCE_SQ
            || target.position.distanceToSquared(this._shadowTarget) > SHADOW_TOLERANCE_SQ) {
            shadow.needsUpdate = true;
            this._shadowPosition.copy(position);
            this._shadowTarget.copy(target.position);
            this._shadowWorldVersion = worldVersion;
        }
    }
}
