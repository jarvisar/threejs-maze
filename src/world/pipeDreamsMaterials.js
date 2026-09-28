import { BackSide, Color, MeshBasicMaterial, MeshPhongMaterial, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
import { FOG_DENSITY, WALL_HEIGHT } from '../config.js';
import { DECAL_OPTIONS, createGlowMaterial, withBackroomsShading, worldLighting } from './materials.js';
import { PANEL_LIGHT_GLSL } from './panelLights.js';
import { PIPE_DREAMS_BACKDROP_GLSL, PIPE_DREAMS_GLOW_GLSL, PIPE_DREAMS_GLSL, PIPE_DREAMS_LAMP_GLSL, PIPE_DREAMS_STEAM_GLSL } from './pipeDreamsShading.js';
import { createPipeDreamsTextures } from './pipeDreamsTextures.js';

/**
 * Level 2 materials: walls, floor, ceiling, plus the extras for pipeDreamsGeometry.js meshes (metal, lamp glows,
 * paint, black goo, fires, gauges, steam) and the backdrop past the far end of the view.
 * @param {object} shared The materials every level has.
 * @param {number} maxAnisotropy
 * @param {number} level Level number the shaders are compiled for.
 * @returns {import('./materials.js').LevelSurfaces}
 */
export function createPipeDreamsSurfaces(shared, maxAnisotropy, level) {
    const textures = createPipeDreamsTextures(maxAnisotropy);
    const wall = withBackroomsShading(new MeshPhongMaterial({ map: textures.walls, bumpMap: textures.walls, bumpScale: 0.0035, specular: 0x101010, shininess: 8 }), 'l2wall', level);
    // UVs are distance along and around the pipe (see pipeDreamsShading.js).
    const pipes = new MeshPhongMaterial({ vertexColors: true, specular: 0xffffff, shininess: 30 });
    pipes.defines = { USE_UV: '' };
    const gauges = new MeshPhongMaterial({ vertexColors: true, specular: 0x8a8a8a, shininess: 80 });
    gauges.defines = { USE_UV: '' };
    const fire = new MeshBasicMaterial({ vertexColors: true, userData: { unoccluded: true } });
    fire.defines = { USE_UV: '' };
    return {
        wall,
        floor: withBackroomsShading(new MeshPhongMaterial({ map: textures.floor, bumpMap: textures.floor, bumpScale: 0.005, specular: 0xffffff, shininess: 30 }), 'l2floor', level),
        ceiling: withBackroomsShading(new MeshPhongMaterial({ map: textures.ceiling, specular: 0x000000, shininess: 0 }), 'l2ceiling', level),
        details: withBackroomsShading(new MeshPhongMaterial({ map: shared.details.map, shininess: 20 }), undefined, level),
        extras: {
            pipes: withBackroomsShading(pipes, 'l2pipe', level),
            fixtures: shared.fixture,
            glows: createGlowMaterial({ declarations: PIPE_DREAMS_LAMP_GLSL, light: GLOW_LIGHT, color: new Color(0.78, 0.62, 0.44), soft: 0.35, ceiling: WALL_HEIGHT, floor: 0 }),
            paint: withBackroomsShading(new MeshPhongMaterial({ map: textures.paint, vertexColors: true, shininess: 6, ...DECAL_OPTIONS }), undefined, level),
            // Black goo. Glossy so puddles pick up the bulbs overhead, like Level 0's wet carpet.
            goo: withBackroomsShading(new MeshPhongMaterial({ color: 0x0b0908, map: textures.paint, specular: 0x9a9a9a, shininess: 90, ...DECAL_OPTIONS }), 'decal', level),
            fire: withBackroomsShading(fire, 'l2fire', level),
            gauges: withBackroomsShading(gauges, 'l2gauge', level),
            steam: createSteamMaterial(),
        },
        shadows: ['pipes'],
        // too small to see in a puddle reflection, not worth drawing twice
        unreflected: ['gauges', 'goo'],
        backdrop: createBackdropMaterial(),
    };
}

/**
 * Glow strength and color per light (see createGlowMaterial in materials.js). Bulbs follow their light slot and
 * bulb color. Fires (source 2 and up) flicker orange whatever the power is doing.
 */
const GLOW_LIGHT = /* glsl */ `
	float strength = glow.z;
	vec3 tint = vec3( 1.0 );
	if ( glow.y >= 2.0 ) {
		strength *= pipeFire( glow.y - 2.0 );
		tint = vec3( 1.5, 0.62, 0.2 );
	} else if ( glow.y < 0.0 ) {
		vec4 state = panelState( floor( ( world.xz - 1.0 ) * 0.5 + 0.5 ) );
		strength *= state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
		tint = pipeLamp( state.a );
	} else {
		strength *= panelFlicker( glow.y ) * ( 1.0 - blackout );
	}
`;

/**
 * Backdrop past the far plane (see LevelSurfaces.backdrop in materials.js). Without it the end of a long tunnel
 * shows as a black box (see PIPE_DREAMS_BACKDROP_GLSL).
 */
function createBackdropMaterial() {
    const { panelStates, cellStates, lightTime, blackout, gridLightIntensity, gridLightColor, gridLightHeight, cameraAreaLight, mistLevel, flashlightBeam, flashlightAim } = worldLighting;
    return new ShaderMaterial({
        uniforms: {
            ...UniformsUtils.clone(UniformsLib.fog),
            panelStates,
            cellStates,
            lightTime,
            blackout,
            gridLightIntensity,
            gridLightColor,
            gridLightHeight,
            cameraAreaLight,
            mistLevel,
            flashlightBeam,
            flashlightAim,
        },
        vertexShader: /* glsl */ `
varying vec3 vDirection;
void main() {
	vDirection = position;
	// rotation only, pinned to the far plane behind everything
	gl_Position = ( projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 ) ).xyww;
}
`,
        fragmentShader: /* glsl */ `
uniform float gridLightIntensity;
uniform vec3 gridLightColor;
uniform float gridLightHeight;
uniform float cameraAreaLight;
uniform vec3 fogColor;
${PANEL_LIGHT_GLSL}
${PIPE_DREAMS_GLSL}
${PIPE_DREAMS_GLOW_GLSL}
${PIPE_DREAMS_STEAM_GLSL}
${PIPE_DREAMS_BACKDROP_GLSL}
varying vec3 vDirection;
void main() {
	gl_FragColor = vec4( pipeBackdrop( fogColor * cameraAreaLight, normalize( vDirection ) ), 1.0 );
}
`,
        fog: true,
        side: BackSide,
        depthWrite: false,
    });
}

/**
 * Steam puffs (see buildSteam in pipeDreamsGeometry.js). Camera-facing noisy blobs moved by the vertex shader
 * from their leak and lit by ambient light plus the nearest bulb.
 * Kinds: 0 jet (shoots out, slows, spreads and rises), 1 plume (rises), 2 safety valve (blows off now and then),
 * 3 goo drop (hangs under its pipe, swells, falls into its puddle).
 */
function createSteamMaterial() {
    const { panelStates, lightTime, blackout, gridLightIntensity, gridLightColor, flashlightBeam, flashlightAim } = worldLighting;
    return new ShaderMaterial({
        uniforms: { panelStates, lightTime, blackout, gridLightIntensity, gridLightColor, flashlightBeam, flashlightAim, fogDensity: { value: FOG_DENSITY } },
        vertexShader: /* glsl */ `
${PANEL_LIGHT_GLSL}
${PIPE_DREAMS_LAMP_GLSL}
uniform float gridLightIntensity;
uniform vec3 gridLightColor;
uniform float fogDensity;
uniform vec4 flashlightBeam;
uniform vec3 flashlightAim;
attribute vec2 corner;
attribute vec4 puff;
attribute vec4 shape;
varying vec2 vCorner;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
varying float vDrop;
void main() {
	vec3 origin = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	float size = shape.x;
	float life = shape.y;
	float kind = shape.z;
	float strength = shape.w;
	float age = fract( lightTime / life + puff.w );
	float t = age * life;
	vec3 at;
	float radius;
	float alpha;
	if ( kind < 0.5 ) {
		float speed = 0.7 + 0.6 * strength;
		at = origin + puff.xyz * speed * ( 1.0 - exp( - 3.0 * t ) ) / 3.0 + vec3( 0.0, 0.1 * t * t, 0.0 );
		radius = size * ( 0.3 + 3.0 * age );
		alpha = smoothstep( 0.0, 0.05, age ) * pow( 1.0 - age, 1.5 ) * ( 0.45 + 0.35 * strength );
	} else if ( kind < 1.5 ) {
		at = origin + vec3( 0.0, 0.3 * t, 0.0 );
		radius = size * ( 0.5 + 2.0 * age );
		alpha = smoothstep( 0.0, 0.15, age ) * pow( 1.0 - age, 1.3 ) * 0.4 * strength;
	} else if ( kind < 2.5 ) {
		// about 4 s on out of every 23, offset per valve by position
		float cycle = mod( lightTime + origin.x * 7.3 + origin.z * 3.1, 23.0 );
		float blowing = smoothstep( 0.0, 0.4, cycle ) * ( 1.0 - smoothstep( 3.5, 4.5, cycle ) );
		at = origin + vec3( 0.0, 0.9 * t, 0.0 );
		radius = size * ( 0.3 + 2.4 * age );
		alpha = smoothstep( 0.0, 0.1, age ) * pow( 1.0 - age, 1.4 ) * 0.5 * blowing;
	} else {
		// Drop hangs and swells for 85% of its life, then falls at g (units of 2.7 m).
		float falling = max( t - life * 0.85, 0.0 );
		float fall = 1.8 * falling * falling;
		at = origin - vec3( 0.0, fall, 0.0 );
		radius = size * mix( 0.4, 1.0, smoothstep( 0.0, 0.85, age ) );
		alpha = step( fall, origin.y );
	}
	vDrop = step( 2.5, kind );
	// Wobble as it drifts and stay under the ceiling. Drops don't wobble.
	float stir = puff.w * 53.0;
	float stirred = age * ( 1.0 - vDrop );
	at.x += ( backroomsNoise( vec2( t * 1.7 + stir, 1.3 ) ) - 0.5 ) * 0.14 * stirred;
	at.z += ( backroomsNoise( vec2( 4.1, t * 1.7 + stir ) ) - 0.5 ) * 0.14 * stirred;
	at.y = min( at.y, 0.99 - radius * 0.25 );
	// ambient light plus the nearest bulb
	vec2 panel = floor( ( at.xz - 1.0 ) * 0.5 + 0.5 );
	vec4 state = panelState( panel );
	vec3 bulb = vec3( panel.x * 2.0 + 1.0, 0.9, panel.y * 2.0 + 1.0 );
	float near = max( 1.0 - length( bulb - at ) / 2.2, 0.0 );
	float lit = state.r * panelFlicker( state.b ) * ( 1.0 - blackout ) * near * near * gridLightIntensity;
	vColor = vec3( 0.55, 0.5, 0.43 ) * ( 0.05 + 0.75 * backroomsAreaLight( at.xz ) ) + gridLightColor * pipeLamp( state.a ) * lit * 0.3;
	// plus the flashlight when in the beam
	vec3 fromTorch = at - flashlightBeam.xyz;
	float torch = length( fromTorch );
	vColor += vec3( 0.9, 0.88, 0.82 ) * flashlightBeam.w * smoothstep( 0.84, 0.95, dot( fromTorch / max( torch, 1e-3 ), flashlightAim ) ) / ( 1.0 + torch * torch * 0.25 );
	// Drops are black with a bit of the light, and get stretched as they fall.
	vColor = mix( vColor, vec3( 0.015, 0.012, 0.01 ) + vColor * 0.35, vDrop );
	vec4 view = viewMatrix * vec4( at, 1.0 );
	float depth = - view.z;
	// Fade out up close (it would fill the screen) and with fog distance.
	vAlpha = alpha * smoothstep( 0.08, 0.4, depth ) * exp( - fogDensity * fogDensity * depth * depth * 0.6 );
	// Invisible puffs (valve idle, puff finished, at the lens) collapse to zero size so they cost nothing.
	float spread = vAlpha > 0.002 ? radius : 0.0;
	view.xy += corner * spread * vec2( 1.0, 1.0 + vDrop * min( origin.y - at.y, 0.2 ) * 12.0 );
	gl_Position = projectionMatrix * view;
	vCorner = corner;
	vSeed = puff.w * 17.0 + origin.x * 3.1 + origin.z * 1.7;
}
`,
        fragmentShader: /* glsl */ `
${PANEL_LIGHT_GLSL}
varying vec2 vCorner;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
varying float vDrop;
void main() {
	float r = length( vCorner );
	if ( r > 1.0 ) discard;
	float n = backroomsNoise( vCorner * 2.2 + vec2( vSeed, lightTime * 0.5 ) ) * 0.6 + backroomsNoise( vCorner * 5.0 - vec2( lightTime * 0.4, vSeed ) ) * 0.4;
	float soft = 1.0 - smoothstep( 0.1, 1.0, r + ( n - 0.5 ) * 0.7 );
	// drops get a hard edge
	float a = mix( soft, 1.0 - smoothstep( 0.65, 1.0, r ), vDrop ) * vAlpha;
	gl_FragColor = vec4( vColor, a );
}
`,
        transparent: true,
        depthWrite: false,
        // Floats in the air, so AO shouldn't darken it by the corner behind.
        userData: { unoccluded: true },
    });
}
