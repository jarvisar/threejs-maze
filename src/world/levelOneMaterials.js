import { AdditiveBlending, Color, MeshBasicMaterial, MeshPhongMaterial, ShaderMaterial } from 'three';
import { FOG_DENSITY } from '../config.js';
import { LEVEL_ONE_GLSL } from './levelOneShading.js';
import { createLevelOneTextures } from './levelOneTextures.js';
import { DECAL_OPTIONS, withBackroomsShading, worldLighting } from './materials.js';
import { PANEL_LIGHT_GLSL } from './panelLights.js';

/**
 * Level 1's (see levelOne.js): its concrete walls, floor and slab, the fittings on the walls, and its own meshes
 * (levelOneGeometry.js): the columns and beams, the battens (lit like Level 0's panels), the pipes and cars (painted
 * like the props), the tubes on the columns, the paint (stencils and floor markings), and the glow round every light.
 * @param {object} shared The materials every level has.
 * @param {number} maxAnisotropy
 * @param {number} level Its number, which its surfaces are compiled for.
 * @returns {import('./materials.js').LevelSurfaces}
 */
export function createLevelOneSurfaces(shared, maxAnisotropy, level) {
    const textures = createLevelOneTextures(maxAnisotropy);
    return {
        wall: withBackroomsShading(new MeshPhongMaterial({ map: textures.walls, bumpMap: textures.walls, bumpScale: 0.004, specular: 0x0c0c0c, shininess: 6 }), 'l1wall', level),
        floor: withBackroomsShading(new MeshPhongMaterial({ color: 0x9a9a95, map: textures.floor, bumpMap: textures.floor, bumpScale: 0.006, specular: 0x404040, shininess: 30 }), 'l1floor', level),
        ceiling: withBackroomsShading(new MeshPhongMaterial({ color: 0xd2d2ce, map: textures.ceiling, specular: 0x000000, shininess: 0 }), 'l1ceiling', level),
        details: withBackroomsShading(new MeshPhongMaterial({ map: textures.details, shininess: 20 }), undefined, level),
        extras: {
            pillars: withBackroomsShading(new MeshPhongMaterial({ map: textures.walls, bumpMap: textures.walls, bumpScale: 0.003, specular: 0x101010, shininess: 8 }), 'l1column', level),
            fixtures: shared.fixture,
            services: shared.prop,
            tubes: withBackroomsShading(new MeshBasicMaterial({ vertexColors: true }), 'l1tube', level),
            paint: withBackroomsShading(new MeshPhongMaterial({ map: textures.glyphs, vertexColors: true, shininess: 4, ...DECAL_OPTIONS }), undefined, level),
            glows: createGlowMaterial(),
        },
        shadows: ['pillars', 'services'],
    };
}

/**
 * The glow round each light in Level 1's haze, as a soft spot facing the camera (see levelOneGeometry.js): so a
 * column with a tube on its far side stands dark against a halo. Each vertex says how big the spot is, whose flicker
 * it follows (its own pattern, or its light slot's), how bright it is, and how much taller than wide. Drawn added
 * on, behind whatever's in front of it.
 */
function createGlowMaterial() {
    const { panelStates, lightTime, blackout } = worldLighting;
    return new ShaderMaterial({
        uniforms: { panelStates, lightTime, blackout, fogDensity: { value: FOG_DENSITY }, glowColor: { value: new Color(0.62, 0.66, 0.7) } },
        vertexShader: /* glsl */ `
${PANEL_LIGHT_GLSL}
${LEVEL_ONE_GLSL}
attribute vec2 corner;
attribute vec4 glow;
varying vec2 vCorner;
varying float vStrength;
varying float vDepth;
varying vec3 vTint;
void main() {
	vec3 world = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	float strength = glow.z * ( 1.0 - blackout );
	vec3 tint = vec3( 1.0 );
	if ( glow.y < 0.0 ) {
		vec4 state = panelState( floor( ( world.xz - 1.0 ) * 0.5 + 0.5 ) );
		strength *= state.r * panelFlicker( state.b );
		tint = levelOneTube( state.a );
	} else {
		strength *= panelFlicker( glow.y );
	}
	vec4 view = viewMatrix * vec4( world, 1.0 );
	// Out, the spot has no size at all, so it costs nothing to draw.
	float size = strength > 0.002 ? glow.x : 0.0;
	view.xy += corner * vec2( size, size * glow.w );
	gl_Position = projectionMatrix * view;
	vCorner = corner;
	vStrength = strength;
	vDepth = - view.z;
	vTint = tint;
}
`,
        fragmentShader: /* glsl */ `
uniform vec3 glowColor;
uniform float fogDensity;
varying vec2 vCorner;
varying float vStrength;
varying float vDepth;
varying vec3 vTint;
void main() {
	float r = length( vCorner );
	float a = max( 1.0 - r, 0.0 );
	a = a * a * ( 0.35 + 0.65 * a );
	// Swallowed by the haze with distance, and gone right up close, where it would fill the picture.
	float haze = exp( - fogDensity * fogDensity * vDepth * vDepth * 0.7 );
	float near = smoothstep( 0.15, 0.6, vDepth );
	gl_FragColor = vec4( glowColor * vTint * ( a * vStrength * haze * near ), 1.0 );
}
`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
    });
}
