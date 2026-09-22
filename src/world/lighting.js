import { AmbientLight, DirectionalLight, SpotLight, Vector3 } from 'three';
import { VIEW_DISTANCE } from '../config.js';
import { CEILING_COLOR_DIM, CEILING_COLOR_LIT, ceilingLights } from './materials.js';

// Before r155, three.js multiplied every light's intensity by π ("legacy lights"). The scene was tuned under
// that model, so intensities are scaled here to render the same.
const LEGACY_SCALE = Math.PI;

const AMBIENT_DIM = 0.7 * LEGACY_SCALE;
const AMBIENT_WITH_CEILING_LIGHTS = 0.1 * LEGACY_SCALE;
const FLASHLIGHT_INTENSITY = 0.7 * LEGACY_SCALE;

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
     */
    constructor(scene, ceilingMaterial) {
        this.ceilingMaterial = ceilingMaterial;

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
        this.flashlight.shadow.autoUpdate = false;

        scene.add(this.ambient, this.overhead, this.flashlight, this.flashlight.target);

        this.flashlightOn = false;
        this.ceilingLightsOn = false;
    }

    setFlashlight(on) {
        this.flashlightOn = on;
        this.flashlight.intensity = on ? FLASHLIGHT_INTENSITY : 0;
        // No point re-rendering the shadow map every frame while the light is off.
        this.flashlight.shadow.autoUpdate = on;
    }

    /** The "dynamic lights" mode: ceiling panels light the scene and the ambient light drops. */
    setCeilingLights(on) {
        this.ceilingLightsOn = on;
        ceilingLights.gridLightIntensity.value = on ? 1 : 0;
        this.ambient.intensity = on ? AMBIENT_WITH_CEILING_LIGHTS : AMBIENT_DIM;
        this.ceilingMaterial.color.setHex(on ? CEILING_COLOR_LIT : CEILING_COLOR_DIM);
    }

    /** Holds the flashlight a little below and to the right of the camera, pointing where you look. */
    updateFlashlight(camera) {
        camera.getWorldDirection(_forward);
        _right.set(-_forward.z, 0, _forward.x);
        if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
        _right.normalize();

        this.flashlight.position.copy(camera.position).addScaledVector(_right, 0.15);
        this.flashlight.position.y -= 0.12;
        this.flashlight.target.position.copy(camera.position).addScaledVector(_forward, 5);
        this.flashlight.target.updateMatrixWorld();
    }
}
