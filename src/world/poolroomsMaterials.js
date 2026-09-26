import { AdditiveBlending, Color, CustomBlending, DoubleSide, MeshBasicMaterial, MeshPhongMaterial, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial } from 'three';
import { FOG_DENSITY } from '../config.js';
import { DECAL_OPTIONS, withBackroomsShading, worldLighting } from './materials.js';
import { PANEL_LIGHT_GLSL } from './panelLights.js';
import { SLOT_SKY } from './poolrooms.js';

/**
 * Level 37's (see poolrooms.js): its tile, on the walls and on everything its own meshes build (poolroomsGeometry.js),
 * the water, the lights (the ceiling's round lights and skylights, drawn like Level 0's panels), the glow round every
 * light, the dark edges of the steps, the lamps in the pools, the chrome, and what's floating.
 * @param {object} shared The materials every level has.
 * @param {number} _maxAnisotropy
 * @param {number} level Its number, which its surfaces are compiled for.
 * @returns {import('./materials.js').LevelSurfaces}
 */
export function createPoolroomsSurfaces(shared, _maxAnisotropy, level) {
    // (Its texture coordinates are the tiles' layout: see poolroomsShading.js.)
    const tile = new MeshPhongMaterial({ color: 0xffffff, specular: 0x404242, shininess: 70 });
    tile.defines = { USE_UV: '' };
    withBackroomsShading(tile, 'l37tile', level);
    const water = new MeshPhongMaterial({ color: 0x000000, specular: 0xffffff, shininess: 900, transparent: true, depthWrite: false, side: DoubleSide });
    // What it reflects is added to what's under it, and lets through the rest (its alpha is already in its colour).
    water.blending = CustomBlending;
    water.blendSrc = OneFactor;
    water.blendDst = OneMinusSrcAlphaFactor;
    return {
        wall: tile,
        floor: tile,
        ceiling: tile,
        details: withBackroomsShading(new MeshPhongMaterial({ map: shared.details.map, shininess: 30 }), undefined, level),
        extras: {
            tiles: tile,
            water: withBackroomsShading(water, 'l37water', level),
            fixtures: shared.fixture,
            glows: createGlowMaterial(),
            trim: withBackroomsShading(new MeshPhongMaterial({ vertexColors: true, specular: 0x4a4a4a, shininess: 70, ...DECAL_OPTIONS }), undefined, level),
            lamps: withBackroomsShading(new MeshBasicMaterial({ vertexColors: true }), 'l37lamp', level),
            metal: withBackroomsShading(new MeshPhongMaterial({ vertexColors: true, specular: 0xffffff, shininess: 120 }), 'l37metal', level),
            floats: withBackroomsShading(new MeshPhongMaterial({ vertexColors: true, specular: 0x3a3a3a, shininess: 45 }), 'l37float', level),
        },
        shadows: ['tiles', 'metal', 'floats'],
    };
}

/**
 * The glow round each light in Level 37's warm damp air, as a soft spot facing the camera (see ColorBuilder.spot):
 * warm under the skylights, whiter round the ceiling's lights, turquoise round the lamps in the pools, and dimmed by
 * the water between it and the eye. Drawn added on, behind whatever's in front of it.
 */
function createGlowMaterial() {
    const { panelStates, lightTime, blackout } = worldLighting;
    return new ShaderMaterial({
        uniforms: { panelStates, lightTime, blackout, fogDensity: { value: FOG_DENSITY }, glowColor: { value: new Color(0.7, 0.7, 0.66) } },
        vertexShader: /* glsl */ `
${PANEL_LIGHT_GLSL}
attribute vec2 corner;
attribute vec4 glow;
varying vec2 vCorner;
varying float vStrength;
varying float vDepth;
varying vec3 vTint;
void main() {
	vec3 world = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	float strength = glow.z;
	vec3 tint = vec3( 1.0, 0.97, 0.9 );
	if ( glow.y < 0.0 ) {
		vec4 state = panelState( floor( ( world.xz - 1.0 ) * 0.5 + 0.5 ) );
		bool sky = abs( state.a * 255.0 - ${SLOT_SKY}.0 ) < 0.5;
		strength *= state.r * panelFlicker( state.b ) * ( 1.0 - ( sky ? 0.85 : 1.0 ) * blackout );
		if ( sky ) tint = vec3( 1.2, 1.1, 0.9 );
	} else {
		strength *= panelFlicker( glow.y ) * ( 1.0 - blackout );
	}
	if ( world.y < 0.0 ) {
		// Under the water: turquoise, and seen from above, through it.
		tint = vec3( 0.35, 1.0, 0.72 );
		if ( cameraPosition.y > 0.0 ) strength *= exp( - 1.2 * ( - world.y ) );
	}
	vec4 view = viewMatrix * vec4( world, 1.0 );
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
	a = a * a * ( 0.3 + 0.7 * a );
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
