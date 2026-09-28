import { AmbientLight, Color, DirectionalLight, SpotLight, Vector3 } from 'three';
import { CLEAR_COLOR, VIEW_DISTANCE } from '../config.js';
import { levelById } from './levels.js';
import { CEILING_COLOR_DIM, CEILING_COLOR_LIT, setShadingLevel, worldLighting } from './materials.js';
import { BLACKOUT_DARKNESS } from './panelLights.js';
import { storm } from './storm.js';

// Before r155, three.js multiplied every light's intensity by π ("legacy lights"). The scene was tuned under
// that model, so intensities are scaled here to render the same.
const LEGACY_SCALE = Math.PI;

const FLASHLIGHT_INTENSITY = 0.7 * LEGACY_SCALE;

// Light clock wraps so shader float precision doesn't degrade.
const LIGHT_TIME_WRAP = 4096;
// How fast the haze adjusts walking into or out of a dark area (per second).
const AREA_LIGHT_RATE = 2.5;
// How far (squared) the flashlight or its aim point can move before the shadow map is redrawn.
const SHADOW_TOLERANCE_SQ = 1e-5 ** 2;
// Level Fun haze on Level 0, a bit warmer and pinker as if lit through the gels. Other levels keep their own haze.
const PARTY_HAZE = 0xf0dcd2;

const _forward = new Vector3();
const _right = new Vector3();

/**
 * All lights in the scene. The set of lights never changes after startup. Toggling the flashlight or ceiling
 * lights only changes uniforms, so no shader recompiles mid-game.
 */
export class Lighting {
    /**
     * @param {import('three').Scene} scene
     * @param {import('three').MeshStandardMaterial} ceilingMaterial
     * @param {import('three').MeshPhongMaterial} [ceilingDecalMaterial] Ceiling stains, shaded along with it.
     */
    constructor(scene, ceilingMaterial, ceilingDecalMaterial) {
        this.scene = scene;
        this.ceilingMaterials = [ceilingMaterial, ceilingDecalMaterial].filter((material) => material);

        this.ambient = new AmbientLight(0xe8e4ca, 0);

        // Straight down so it only lights the floor. No shadows since pointing straight down it would only shadow
        // the floor under the walls, where nobody can see it.
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
        this.party = false;
        /** Current level id (see levels.js). */
        this.level = 0;
        /** @type {import('./levels.js').Atmosphere} */
        this.atmosphere = levelById(0).atmosphere;
        /** Smoothed area light around the camera (0..1), before any blackout. */
        this.areaLight = 1;
        /** Current blackout amount (0..1). */
        this.blackout = 0;
        this._clear = new Color(CLEAR_COLOR);
    }

    /** Level Fun haze and carpet confetti. The gels are part of the panel states (see party.js). */
    setParty(on) {
        this.party = on;
        worldLighting.partyLevel.value = on ? 1 : 0;
        this._applyHaze();
    }

    /**
     * Applies a level's atmosphere (see levels.js): haze, ceiling light color, range and height, fill light, and
     * its shaders (see levelShading.js).
     * @param {number} level
     */
    setLevel(level) {
        this.level = level;
        const atmosphere = levelById(level).atmosphere;
        this.atmosphere = atmosphere;
        setShadingLevel(level);
        worldLighting.gridLightColor.value.copy(atmosphere.lightColor);
        worldLighting.gridLightDistance.value = atmosphere.lightRange;
        worldLighting.gridLightHeight.value = atmosphere.lightHeight;
        this.ambient.color.set(atmosphere.ambient);
        this.overhead.color.set(atmosphere.overhead);
        this.overhead.intensity = atmosphere.overheadIntensity;
        this._applyHaze();
        this.setCeilingLights(this.ceilingLightsOn);
        // Storm outside, on levels that have one like Level 4 (see storm.js).
        const stormy = atmosphere.storm === true;
        if (stormy !== storm.on) storm.reset();
        storm.on = stormy;
    }

    _applyHaze() {
        // Party haze only on levels Level Fun can dress. From other levels the Konami code moves to one it can.
        const haze = this.party && levelById(this.level).dressable ? PARTY_HAZE : this.atmosphere.haze;
        this._clear.set(haze);
        this.scene.fog?.color.set(haze);
    }

    setFlashlight(on) {
        this.flashlightOn = on;
        this.flashlight.intensity = on ? FLASHLIGHT_INTENSITY : 0;
        // Shadow map isn't updated while the light is off.
        if (on) this.invalidateShadow();
    }

    /** Forces a shadow map redraw next frame (e.g. after the GPU lost it). */
    invalidateShadow() {
        this._shadowPosition.set(Infinity, 0, 0);
    }

    /** "Dynamic lights" mode. Ceiling panels light the scene and ambient light drops. */
    setCeilingLights(on) {
        this.ceilingLightsOn = on;
        worldLighting.gridLightIntensity.value = on ? 1 : 0;
        this.ambient.intensity = on ? this.atmosphere.ambientLit : this.atmosphere.ambientDim;
        for (const material of this.ceilingMaterials) material.color.setHex(on ? CEILING_COLOR_LIT : CEILING_COLOR_DIM);
    }

    /**
     * Blackout. Every panel goes out (and comes back) at once, taking most of the light with it. Instant, unlike
     * walking into a dark area, which the haze follows gradually.
     * @param {number} level 0 (normal) to 1 (all out).
     */
    setBlackout(level) {
        this.blackout = level;
        worldLighting.blackout.value = level;
    }

    /**
     * Advances flickering lights and follows the light level around the camera.
     * @param {number} dt Seconds since last frame.
     * @param {number} areaLight Current area light at the camera (see ChunkStore.areaLight).
     * @param {boolean} [snap] Jump straight to the new light level (e.g. after teleporting).
     */
    update(dt, areaLight, snap = false) {
        worldLighting.lightTime.value = (worldLighting.lightTime.value + dt) % LIGHT_TIME_WRAP;
        this.areaLight = snap ? areaLight : this.areaLight + (areaLight - this.areaLight) * Math.min(dt * AREA_LIGHT_RATE, 1);
        const lit = this.areaLight * (1 - BLACKOUT_DARKNESS * this.blackout);
        worldLighting.cameraAreaLight.value = lit;
        this.scene.background.copy(this._clear).multiplyScalar(lit);
        storm.update(dt);
        worldLighting.lightning.value.set(storm.flash, storm.bearing[0], storm.bearing[1], storm.near);
        worldLighting.lightningBolt.value.set(storm.bolt, Math.min(storm.since, 100), storm.near);
    }

    get time() {
        return worldLighting.lightTime.value;
    }

    /**
     * Holds the flashlight a little below and right of the camera, pointing where you look.
     * @param {import('three').Camera} camera
     * @param {number} worldVersion Changes whenever the walls do (see WorldView.version).
     * @param {boolean} [inHand] `camera` is a VR controller. Shine from exactly there, where it points.
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
        worldLighting.flashlightBeam.value.set(position.x, position.y, position.z, this.flashlightOn ? 1 : 0);
        worldLighting.flashlightAim.value.copy(target.position).sub(position).normalize();

        // Only redraw the shadow map when the beam or walls move, so standing still or paused the flashlight costs
        // no more than any other light. The tolerance is far below a shadow map texel and lets the end of the head
        // bob settle without a redraw.
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
