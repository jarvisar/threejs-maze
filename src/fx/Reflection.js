import { Matrix4, PerspectiveCamera, UnsignedByteType, Vector3, WebGLRenderTarget } from 'three';
import { worldLighting } from '../world/materials.js';

// The reflection is drawn at a fraction of the screen's resolution: it's only ever seen rippled and dim, in water.
const RESOLUTION = 0.5;

const _position = new Vector3();
const _target = new Vector3();
const _up = new Vector3();
const _forward = new Vector3();
const BIAS = new Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1,
);

/**
 * The reflection in Level 1's puddles: the scene drawn again from the camera's mirror image under the floor, for
 * the floor's shader to look up where there's standing water (see levelOneShading.js). Everything that stands on
 * the floor is above it, and the floor faces away from a camera underneath it, so nothing needs clipping.
 *
 * It costs a second render of the scene (at half the resolution), so it's only drawn in Level 1, with the dynamic
 * lights on, and not in VR; without it, the water reflects the lights overhead instead.
 */
export class Reflection {
    /** @param {import('three').WebGLRenderer} renderer */
    constructor(renderer) {
        this.renderer = renderer;
        this.target = new WebGLRenderTarget(1, 1, { type: UnsignedByteType });
        this.target.texture.name = 'reflection';
        this.camera = new PerspectiveCamera();
        this.camera.matrixAutoUpdate = true;
        worldLighting.reflectionMap.value = this.target.texture;
        this.active = false;
    }

    setSize(width, height, pixelRatio) {
        this.target.setSize(Math.max(1, Math.round(width * pixelRatio * RESOLUTION)), Math.max(1, Math.round(height * pixelRatio * RESOLUTION)));
    }

    /**
     * Whether it's drawn. Off, the water goes back to reflecting just the lights.
     * @param {boolean} on
     */
    setActive(on) {
        this.active = on;
        worldLighting.reflectionOn.value = on ? 1 : 0;
    }

    /**
     * Draws the reflection as seen from `camera` this frame (call before drawing the frame itself).
     * @param {import('three').Scene} scene
     * @param {import('three').PerspectiveCamera} camera
     */
    render(scene, camera) {
        if (!this.active) return;
        const mirror = this.camera;
        camera.updateMatrixWorld();
        camera.getWorldPosition(_position);
        camera.getWorldDirection(_forward);
        _target.copy(_position).add(_forward);
        _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
        // Everything turned upside down about the floor.
        _position.y = -_position.y;
        _target.y = -_target.y;
        _up.y = -_up.y;
        mirror.position.copy(_position);
        mirror.up.copy(_up);
        mirror.lookAt(_target);
        mirror.fov = camera.fov;
        mirror.aspect = camera.aspect;
        mirror.near = camera.near;
        mirror.far = camera.far;
        mirror.updateProjectionMatrix();
        mirror.updateMatrixWorld();
        worldLighting.reflectionMatrix.value.copy(BIAS).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

        const renderer = this.renderer;
        const previous = renderer.getRenderTarget();
        const shadows = renderer.shadowMap.autoUpdate;
        renderer.shadowMap.autoUpdate = false;
        // The mist is left out: the puddle's own view of it covers it. And the floor (which faces away, but is still
        // drawn) mustn't read the picture while it's being drawn into.
        worldLighting.mistLevel.value = 0;
        worldLighting.reflectionOn.value = 0;
        worldLighting.reflectionMap.value = null;
        renderer.setRenderTarget(this.target);
        renderer.render(scene, mirror);
        renderer.setRenderTarget(previous);
        worldLighting.mistLevel.value = 1;
        worldLighting.reflectionOn.value = 1;
        worldLighting.reflectionMap.value = this.target.texture;
        renderer.shadowMap.autoUpdate = shadows;
    }

    dispose() {
        this.target.dispose();
    }
}
