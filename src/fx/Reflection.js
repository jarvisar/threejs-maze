import { Matrix4, PerspectiveCamera, Plane, UnsignedByteType, Vector3, Vector4, WebGLRenderTarget } from 'three';
import { worldLighting } from '../world/materials.js';

// The reflection is drawn at a fraction of the screen's resolution: it's only ever seen rippled and dim, in water.
const RESOLUTION = 0.5;

const _position = new Vector3();
const _target = new Vector3();
const _up = new Vector3();
const _forward = new Vector3();
const _plane = new Plane();
const _clip = new Vector4();
const _q = new Vector4();
const WATER = new Plane(new Vector3(0, 1, 0), 0);
const BIAS = new Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1,
);

/**
 * The reflection in the water (Level 1's puddles, Level 37's pools): the scene drawn again from the camera's mirror
 * image under the floor, for the water's shader to look up (see levelOneShading.js and poolroomsShading.js). Nothing
 * under the water's surface is drawn into it: the mirror camera's near plane is the surface itself (an oblique
 * projection), which costs nothing in the shaders.
 *
 * It costs a second render of the scene (at half the resolution), so it's only drawn on a level with water, with
 * the dynamic lights on, and not in VR; without it, the water reflects the lights overhead instead.
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
        /** @type {import('three').Material[]} Left out of the reflection (the water itself). */
        this.hidden = [];
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
     * Draws the reflection as seen from `camera` this frame (call before drawing the frame itself). From under the
     * water there's nothing to draw: the surface is seen from below.
     * @param {import('three').Scene} scene
     * @param {import('three').PerspectiveCamera} camera
     */
    render(scene, camera) {
        if (!this.active) return;
        const mirror = this.camera;
        camera.updateMatrixWorld();
        camera.getWorldPosition(_position);
        if (_position.y <= 0.002) return;
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
        clipAtWater(mirror);

        const renderer = this.renderer;
        const previous = renderer.getRenderTarget();
        const shadows = renderer.shadowMap.autoUpdate;
        renderer.shadowMap.autoUpdate = false;
        // The mist is left out: the puddle's own view of it covers it. And the floor (which faces away, but is still
        // drawn) mustn't read the picture while it's being drawn into.
        worldLighting.mistLevel.value = 0;
        worldLighting.mirrorView.value = 1;
        worldLighting.reflectionOn.value = 0;
        worldLighting.reflectionMap.value = null;
        for (const material of this.hidden) material.visible = false;
        renderer.setRenderTarget(this.target);
        renderer.render(scene, mirror);
        renderer.setRenderTarget(previous);
        for (const material of this.hidden) material.visible = true;
        worldLighting.mistLevel.value = 1;
        worldLighting.mirrorView.value = 0;
        worldLighting.reflectionOn.value = 1;
        worldLighting.reflectionMap.value = this.target.texture;
        renderer.shadowMap.autoUpdate = shadows;
    }

    dispose() {
        this.target.dispose();
    }
}

/**
 * Makes the mirror camera's near plane the water's surface, so nothing under it is drawn (Eric Lengyel, "Oblique
 * View Frustum Depth Projection and Clipping", 2005; as three.js' Reflector does).
 * @param {PerspectiveCamera} mirror
 */
function clipAtWater(mirror) {
    _plane.copy(WATER).applyMatrix4(mirror.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const projection = mirror.projectionMatrix;
    const e = projection.elements;
    _q.x = (Math.sign(_clip.x) + e[8]) / e[0];
    _q.y = (Math.sign(_clip.y) + e[9]) / e[5];
    _q.z = -1;
    _q.w = (1 + e[10]) / e[14];
    _clip.multiplyScalar(2 / _clip.dot(_q));
    e[2] = _clip.x;
    e[6] = _clip.y;
    e[10] = _clip.z + 1;
    e[14] = _clip.w;
}
