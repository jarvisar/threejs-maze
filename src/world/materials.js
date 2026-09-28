import {
    AdditiveBlending,
    CanvasTexture,
    ClampToEdgeWrapping,
    Color,
    DataTexture,
    DoubleSide,
    LinearFilter,
    LineBasicMaterial,
    Matrix4,
    MeshBasicMaterial,
    MeshPhongMaterial,
    MeshStandardMaterial,
    NearestFilter,
    ShaderChunk,
    ShaderMaterial,
    Vector3,
    Vector4,
} from 'three';
import { FOG_DENSITY, PANEL_HALF_X, PANEL_HALF_Z, WALL_HEIGHT } from '../config.js';
import { SHADE_COLUMNS } from './chunkGeometry.js';
import { createDecalAtlas, createPropAtlas, drawEditPictures } from './decorationTextures.js';
import { levelById } from './levels.js';
import { PANEL_LIGHT_GLSL } from './panelLights.js';
import { GEL_CYCLING, GEL_HUES, GEL_WHITE, PARTY_PALETTE } from './party.js';
import { createPartyAtlas, createPartyWallpaper } from './partyTextures.js';

// Level 0 light panel colors for the lens, painted flange and flange edges (see createFixtureGeometry in
// chunkGeometry.js). levelShading.js finds the lens by its blue channel being 1 and draws its own color there.
export const PANEL_LENS_COLOR = 0xffffff;
export const PANEL_FLANGE_COLOR = 0xc4c0b2;
export const PANEL_EDGE_COLOR = 0x8a877c;
// Ceiling is darkened when the lights are off since only ambient light reaches it then.
export const CEILING_COLOR_DIM = 0x8a8a8a;
export const CEILING_COLOR_LIT = 0xffffff;
/** Max Level Fun mirror balls casting light at once, nearest first (see PartyLayer.js). */
export const DISCO_MAX = 4;

/**
 * Uniforms shared by every lit material, for the ceiling lights ("dynamic lights") and each panel's state.
 *
 * The original version used 25 real PointLights around the player's chunk. Changing the light count makes three.js
 * recompile every material, which froze the game for about a second on each toggle, and 25 lights per pixel was
 * slow on most GPUs. Panels sit on a regular grid, so each fragment evaluates the 4x4 panels around it in the
 * shader instead. Every panel is lit, toggling is just a uniform change, and the cost is constant.
 *
 * Panels can be dead, dim or flickering, and some areas have lost most of theirs (see panelLights.js). A working
 * panel multiplies by 1 so it looks the same as it always did.
 */
export const worldLighting = {
    gridLightIntensity: { value: 0 },
    // Same color and intensity as the original PointLight(0xf5f4cb, 1.1, 3.1), including the pre-r155 ×π on
    // light intensity ("legacy lights").
    gridLightColor: { value: new Color(0xf5f4cb).multiplyScalar(1.1 * Math.PI) },
    // Its falloff (decay 2) is written into the shader (see FRAGMENT_CEILING_LIGHTS).
    gridLightDistance: { value: 3.1 },
    gridLightHeight: { value: 0.85 },
    panelStates: { value: null },
    // Per-cell contents for level shaders (see PanelLightMap.cells).
    cellStates: { value: null },
    lightTime: { value: 0 },
    blackout: { value: 0 },
    // Area light at the camera. Distant haze takes its brightness from this.
    cameraAreaLight: { value: 1 },
    // Level Fun (see party.js). partyLevel turns on the carpet confetti. discoBalls is each mirror ball's position
    // and turn (w), discoRanges how far its light reaches.
    partyLevel: { value: 0 },
    discoBalls: { value: Array.from({ length: DISCO_MAX }, () => new Vector4()) },
    discoRanges: { value: new Array(DISCO_MAX).fill(0) },
    discoCount: { value: 0 },
    // Level 1 (see levelOneShading.js). Mist strength (the reflection is drawn without it) and the puddle
    // reflection, if any (see Reflection.js).
    mistLevel: { value: 1 },
    reflectionMap: { value: null },
    reflectionMatrix: { value: new Matrix4() },
    reflectionOn: { value: 0 },
    // Set while drawing the reflection (see Reflection.js). The camera is then mirrored under the water.
    mirrorView: { value: 0 },
    // Level 37 (see poolroomsShading.js). Ripples from footsteps and splashes as (x, z, start time, strength), set
    // by Game.
    poolRipples: { value: Array.from({ length: 8 }, () => new Vector4()) },
    // Flashlight position (w = on) and direction, for things its beam lights outside three.js' lights, like
    // Level 2's steam (see pipeDreamsShading.js).
    flashlightBeam: { value: new Vector4() },
    flashlightAim: { value: new Vector3(0, 0, -1) },
    // Level 4 (see abandonedOfficeShading.js). lightning is (brightness now, strike direction x and z, nearness).
    // lightningBolt is (which bolt or 0 for none, seconds since, nearness).
    lightning: { value: new Vector4() },
    lightningBolt: { value: new Vector3() },
    // Always 1. Loops multiply their count by this so Direct3D's shader compiler (Chrome and Edge on Windows)
    // can't unroll them. Unrolling took seconds per shader for Level 5's lights.
    loopScale: { value: 1 },
};

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vBackroomsWorldPosition;
`;

// Instanced meshes apply the instance matrix before the model matrix.
const VERTEX_WORLD_POSITION = /* glsl */ `
#include <project_vertex>
{
	vec4 backroomsPosition = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		backroomsPosition = instanceMatrix * backroomsPosition;
	#endif
	vBackroomsWorldPosition = ( modelMatrix * backroomsPosition ).xyz;
}
`;

// Level Fun's balloons, strings and ribbons sway. The sway attribute is (phase, drift, swing). Balloons drift fully
// and strings less toward where they're tied. Swing is for anything hanging free, more further down.
const VERTEX_SWAY_DECLARATIONS = /* glsl */ `
attribute vec3 sway;
uniform float lightTime;
`;

const VERTEX_SWAY = /* glsl */ `
#include <begin_vertex>
{
	float t = lightTime;
	float p = sway.x;
	vec3 drift = vec3( sin( t * 0.83 + p ) + 0.4 * sin( t * 2.1 + p * 1.7 ), 0.5 * sin( t * 1.31 + p * 2.3 ), cos( t * 0.71 + p * 1.3 ) + 0.4 * sin( t * 1.7 + p ) );
	vec3 swing = vec3( sin( t * 1.9 + p * 3.1 ), 0.0, cos( t * 1.5 + p * 2.1 ) );
	transformed += drift * ( 0.013 * sway.y ) + swing * ( 0.022 * sway.z );
}
`;

const PARTY_COLORS_GLSL = PARTY_PALETTE.map((hex) => {
    const c = new Color(hex);
    return `vec3( ${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)} )`;
}).join(', ');

// Light color for a slot from its fourth byte. Normally the level's own (see levelShading.js). In Level Fun it's the
// gel (see party.js), either warm white or a strong color that's dimmer overall like real gels. Cycling gels swing
// from sky blue through blue, purple, pink and red to orange and back, never through green.
const PANEL_TINT_GLSL = /* glsl */ `
// Fully saturated hue, 0 to 1.
vec3 backroomsHue( float hue ) {
	return clamp( abs( mod( hue * 6.0 + vec3( 0.0, 4.0, 2.0 ), 6.0 ) - 3.0 ) - 1.0, 0.0, 1.0 );
}

vec3 panelTint( float code ) {
	#ifdef BACKROOMS_PARTY
		float byte = floor( code * 255.0 + 0.5 );
		if ( byte < ${GEL_WHITE}.5 ) {
			if ( byte > ${GEL_WHITE - 1}.5 ) return vec3( 1.0, 0.94, 0.86 );
			float hue = byte / ${GEL_HUES}.0;
			if ( byte >= ${GEL_HUES}.0 ) {
				float swing = 0.5 - 0.5 * cos( 6.2831853 * ( ( byte - ${GEL_HUES}.0 ) / ${GEL_CYCLING}.0 + lightTime * 0.04 ) );
				hue = fract( 0.57 + 0.55 * swing );
			}
			return mix( vec3( 1.0 ), backroomsHue( hue ), 0.6 ) * 1.18;
		}
	#endif
	return levelLightTint( code );
}
`;

// Level Fun carpet confetti and mirror ball light. Only compiled for levels it can dress, which define
// BACKROOMS_PARTY (see levels.js).
const PARTY_GLSL = /* glsl */ `
uniform float partyLevel;
uniform vec4 discoBalls[ ${DISCO_MAX} ];
uniform float discoRanges[ ${DISCO_MAX} ];
uniform int discoCount;

const vec3 PARTY_COLORS[ ${PARTY_PALETTE.length} ] = vec3[ ${PARTY_PALETTE.length} ]( ${PARTY_COLORS_GLSL} );

// Gel colors blended between the 4 nearest panels, like the area light. This is the room's overall tint.
vec3 backroomsAreaTint( vec2 xz ) {
	vec2 p = ( xz - 1.0 ) * 0.5;
	vec2 i = floor( p );
	vec2 f = p - i;
	vec3 a = panelTint( panelState( i ).a );
	vec3 b = panelTint( panelState( i + vec2( 1.0, 0.0 ) ).a );
	vec3 c = panelTint( panelState( i + vec2( 0.0, 1.0 ) ).a );
	vec3 d = panelTint( panelState( i + vec2( 1.0, 1.0 ) ).a );
	return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

// Confetti in the carpet. Strips and dots a few cm across, denser in some spots. Far away, where a piece is under a
// pixel, it fades to a colored speckle.
vec3 backroomsConfetti( vec2 p, vec3 carpet ) {
	float pixel = max( length( fwidth( p ) ), 1e-5 );
	float sharp = 1.0 - smoothstep( 0.005, 0.02, pixel );
	float thick = smoothstep( 0.3, 0.8, backroomsNoise( p * 0.8 + 13.0 ) );
	float chance = 0.07 + 0.4 * thick;
	vec3 color = carpet;
	for ( int layer = 0; layer < 2; layer ++ ) {
		vec2 q = p * 26.0 + float( layer ) * vec2( 0.37, 0.71 );
		ivec2 cell = ivec2( floor( q ) );
		uint h = backroomsHash( uint( cell.x ) * 2654435761u ^ uint( cell.y ) * 2246822519u ^ uint( layer + 1 ) * 3266489917u );
		if ( float( h & 1023u ) > chance * 1023.0 ) continue;
		vec2 centre = ( vec2( float( ( h >> 10u ) & 15u ), float( ( h >> 14u ) & 15u ) ) / 15.0 - 0.5 ) * 0.36;
		float angle = float( ( h >> 18u ) & 63u ) * ( 3.14159 / 63.0 );
		vec2 d = fract( q ) - 0.5 - centre;
		vec2 r = vec2( cos( angle ) * d.x + sin( angle ) * d.y, cos( angle ) * d.y - sin( angle ) * d.x );
		float edge = ( ( h >> 24u ) & 3u ) == 0u ? length( r ) - 0.12 : max( abs( r.x ) - 0.2, abs( r.y ) - 0.08 );
		float soft = pixel * 26.0;
		float inside = 1.0 - smoothstep( -soft, soft, edge );
		vec3 paper = PARTY_COLORS[ int( ( h >> 26u ) % ${PARTY_PALETTE.length}u ) ] * ( ( ( h >> 29u ) & 1u ) == 0u ? 0.62 : 0.78 );
		color = mix( color, paper, inside * sharp );
	}
	return mix( color, carpet + vec3( 0.05, 0.035, 0.05 ) * chance, ( 1.0 - sharp ) * 0.6 );
}

// Mirror ball spot along ray (unit vector out from the ball's center), with the ball rotated by turn (radians,
// around Y). pixelAngle is a pixel's angular size from the ball. Mirrors are in rows bottom to top, as many per row
// as fit, and only some catch the spotlight.
vec3 discoSpeck( vec3 ray, float turn, float pixelAngle ) {
	float c = cos( turn );
	float s = sin( turn );
	vec3 r = vec3( c * ray.x - s * ray.z, ray.y, s * ray.x + c * ray.z );
	float latitude = asin( clamp( r.y, -1.0, 1.0 ) );
	float row = floor( ( latitude / 3.14159265 + 0.5 ) * 24.0 );
	float rowLatitude = ( ( row + 0.5 ) / 24.0 - 0.5 ) * 3.14159265;
	float columns = max( floor( 48.0 * cos( rowLatitude ) ), 3.0 );
	float longitude = atan( r.z, r.x );
	float column = floor( ( longitude / 6.2831853 + 0.5 ) * columns );
	uint h = backroomsHash( uint( row ) * 7919u + uint( column ) * 104729u + 12345u );
	if ( ( h & 7u ) < 3u ) return vec3( 0.0 );
	float centre = ( ( column + 0.5 ) / columns - 0.5 ) * 6.2831853;
	vec2 away = vec2( ( longitude - centre ) * cos( latitude ), latitude - rowLatitude );
	float size = 0.011 + 0.009 * float( ( h >> 3u ) & 7u ) / 7.0;
	// Sharp edge. Dimmer when blurred wider than its size (sub-pixel, far away).
	float blur = max( pixelAngle * 0.7, size * 0.18 );
	float spot = ( 1.0 - smoothstep( size - blur, size + blur, length( away ) ) ) * clamp( size / blur, 0.25, 1.0 );
	vec3 color = ( ( h >> 6u ) & 3u ) == 0u ? mix( vec3( 1.0 ), backroomsHue( float( ( h >> 8u ) & 255u ) / 255.0 ), 0.65 ) : vec3( 1.0, 0.97, 0.9 );
	return color * spot;
}
`;

// Every fragment shader starts with these, then the level's shading (see levelShading.js), then the rest.
const FRAGMENT_DECLARATIONS = /* glsl */ `
varying vec3 vBackroomsWorldPosition;
uniform float gridLightIntensity;
uniform vec3 gridLightColor;
uniform float gridLightDistance;
uniform float gridLightHeight;
uniform float cameraAreaLight;
uniform int loopScale;
${PANEL_LIGHT_GLSL}
`;

const FRAGMENT_AFTER_LEVEL = /* glsl */ `
${PANEL_TINT_GLSL}
#ifdef BACKROOMS_PARTY
${PARTY_GLSL}
#endif
`;

// backroomsTint is the room tint from Level Fun's gels (white elsewhere). Only half strength since most of the
// color is in the light pools under each panel. backroomsPixel is roughly a pixel's size here, for mirror ball spots.
const FRAGMENT_MAIN = /* glsl */ `
void main() {
	float backroomsArea = backroomsAreaLight( vBackroomsWorldPosition.xz );
	vec3 backroomsTint = vec3( 1.0 );
	#ifdef BACKROOMS_PARTY
		if ( partyLevel > 0.0 ) backroomsTint = mix( vec3( 1.0 ), backroomsAreaTint( vBackroomsWorldPosition.xz ), 0.5 );
	#endif
	float backroomsPixel = length( fwidth( vBackroomsWorldPosition ) );
`;

// The flashlight is the only spot light. It stays in the scene with zero intensity when off so toggling never
// recompiles, but three.js still computes its cone, falloff and shadow per pixel. That was about a quarter of the
// scene's draw cost, so skip it all while it's off. The shadow lookup gets a plain `if` too, so compilers that
// evaluate both sides of `?:` don't sample the shadow map outside the beam, and so does the lighting itself, which
// outside the beam only ever added nothing.
const SPOT_SECTION_START = '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )';
const SPOT_SECTION_END = '#pragma unroll_loop_end';

function skipDarkSpotLights(chunk) {
    const start = chunk.indexOf(SPOT_SECTION_START);
    const end = chunk.indexOf(SPOT_SECTION_END, start);
    if (start < 0 || end < 0) return chunk;
    const section = chunk.slice(start, end)
        .replace(
            'getSpotLightInfo( spotLight, geometryPosition, directLight );',
            'if ( spotLight.color != vec3( 0.0 ) ) {\n\t\tgetSpotLightInfo( spotLight, geometryPosition, directLight );',
        )
        .replace(
            /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? (getShadow\( spotShadowMap\[ i \][^;]*\)) : 1\.0;/,
            'if ( directLight.visible && receiveShadow ) directLight.color *= $1;',
        )
        .replace(
            /(RE_Direct\( directLight, [^;]*\);)(\s*\}\s*)$/,
            'if ( directLight.visible ) $1\n\t\t}$2',
        );
    return chunk.slice(0, start) + section + chunk.slice(end);
}

// Ambient and directional light stand in for the panels' general glow, so they fade where panels are dead and take
// the gel tint in Level Fun. The flashlight is a spot light so it isn't affected.
const LIGHTS_BEGIN = skipDarkSpotLights(ShaderChunk.lights_fragment_begin)
    .replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= backroomsArea * backroomsTint;',
    )
    .replace(
        'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );',
        'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * backroomsArea * backroomsTint;',
    );

if (import.meta.env?.DEV && (LIGHTS_BEGIN.match(/backroomsArea/g)?.length ?? 0) < 2) {
    console.warn('materials.js: lights_fragment_begin patch no longer applies to this three.js version.');
}
if (import.meta.env?.DEV && !/if \( spotLight\.color != vec3\( 0\.0 \) \) \{[\s\S]*if \( directLight\.visible && receiveShadow \) directLight\.color \*= getShadow\( spotShadowMap[\s\S]*RE_Direct\([^;]*\);\s*\}\s*\}\s*#pragma unroll_loop_end/.test(LIGHTS_BEGIN)) {
    console.warn('materials.js: spot light patch no longer applies to this three.js version.');
}

const FRAGMENT_CEILING_LIGHTS = /* glsl */ `
${LIGHTS_BEGIN}
if ( gridLightIntensity > 0.0 ) {
	// Panels are over every cell with odd (x, z). With a 3.1 range only the 4 nearest per axis can reach.
	// Work in view space like three.js lights. Transform the first panel once, then step along the grid's
	// view-space axes.
	vec2 firstPanel = floor( ( vBackroomsWorldPosition.xz - 1.0 ) * 0.5 ) - 1.0;
	vec3 panelOrigin = ( viewMatrix * vec4( firstPanel.x * 2.0 + 1.0, gridLightHeight, firstPanel.y * 2.0 + 1.0, 1.0 ) ).xyz;
	vec3 panelStepX = viewMatrix[ 0 ].xyz * 2.0;
	vec3 panelStepZ = viewMatrix[ 2 ].xyz * 2.0;
	IncidentLight panelLight;
	panelLight.visible = true;
	// Most of the 16 are out of range. Only visit rows and columns that can reach horizontally at this height
	// (usually 9 panels). The slack keeps rounding from dropping one, and the exact test below decides.
	vec2 xz = vBackroomsWorldPosition.xz;
	float below = gridLightHeight - vBackroomsWorldPosition.y;
	float reach = sqrt( max( gridLightDistance * gridLightDistance - below * below, 0.0 ) ) + 0.01;
	ivec2 first = ivec2( max( ceil( ( xz - reach - 1.0 ) * 0.5 ) - firstPanel, 0.0 ) );
	ivec2 last = ivec2( min( floor( ( xz + reach - 1.0 ) * 0.5 ) - firstPanel, 3.0 ) );
	for ( int ix = first.x; ix <= last.x; ix ++ ) {
		for ( int iz = first.y; iz <= last.y; iz ++ ) {
			// Distance check before reading panel state.
			vec3 lVector = panelOrigin + float( ix ) * panelStepX + float( iz ) * panelStepZ - geometryPosition;
			float lightDistance = length( lVector );
			if ( lightDistance >= gridLightDistance ) continue;
			vec4 state = panelState( firstPanel + vec2( ix, iz ) );
			float brightness = state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
			if ( brightness <= 0.0 ) continue;
			panelLight.direction = lVector / lightDistance;
			// Legacy (pre-r155) distance falloff with decay 2, to keep the original look. Squared by hand: pow() is two
			// slow instructions on most GPUs, for every panel of every pixel.
			float falloff = 1.0 - lightDistance / gridLightDistance;
			panelLight.color = gridLightColor * gridLightIntensity * brightness * falloff * falloff * panelTint( state.a );
			// Which way the level's lights shine most (see levelShading.js).
			#ifdef LEVEL_PANEL_SPREAD
				panelLight.color *= LEVEL_PANEL_SPREAD;
			#endif
			RE_Direct( panelLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		}
	}
}
// Level Fun mirror ball spots from the nearest balls, slowly turning. Only where there's open floor all around,
// since nothing stops them at a wall.
#ifdef BACKROOMS_PARTY
if ( discoCount > 0 ) {
	IncidentLight speckLight;
	speckLight.visible = true;
	for ( int k = 0; k < ${DISCO_MAX}; k ++ ) {
		if ( k >= discoCount ) break;
		vec3 toBall = discoBalls[ k ].xyz - vBackroomsWorldPosition;
		float ballDistance = length( toBall );
		float range = discoRanges[ k ];
		if ( ballDistance >= range || ballDistance < 0.09 ) continue;
		vec3 speck = discoSpeck( -toBall / ballDistance, discoBalls[ k ].w, backroomsPixel / ballDistance );
		if ( speck.r + speck.g + speck.b <= 0.0 ) continue;
		speckLight.direction = normalize( ( viewMatrix * vec4( toBall, 0.0 ) ).xyz );
		speckLight.color = speck * 3.2 * ( 1.0 - smoothstep( range * 0.45, range, ballDistance ) ) * ( 1.0 - blackout );
		RE_Direct( speckLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
}
#endif
// The level's own lights, like Level 37's sun (see levelShading.js).
#ifdef LEVEL_DIRECT
LEVEL_DIRECT
#endif
`;

// Haze is only as bright as the light around it. Near a surface it uses the light there, and with distance it
// blends toward the light at the camera to match the background past the far plane. levelAir (see
// levelShading.js) then applies it. `adjust` scales the amount.
const fogFragment = (adjust = '') => /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	${adjust}
	gl_FragColor.rgb = levelAir( gl_FragColor.rgb, fogColor * mix( backroomsArea * backroomsTint, vec3( cameraAreaLight ), fogFactor ), fogFactor, backroomsArea );
#endif
`;

const FRAGMENT_FOG = fogFragment();

// The Found Footage figure gets less haze than anything else, so it stays darker than its distance would allow.
const FRAGMENT_FOG_FIGURE = fogFragment('fogFactor *= 0.6;');

// Wet carpet from floor decals, where opacity is how wet. Mostly just darker, but at glancing angles it gets a
// faint sheen and a blurred reflection of any lit panel the view bounces up to.
const FRAGMENT_WET = /* glsl */ `
if ( vBackroomsWorldPosition.y < 0.02 ) {
	vec3 toEye = normalize( cameraPosition - vBackroomsWorldPosition );
	float wet = smoothstep( 0.22, 0.6, diffuseColor.a );
	float fresnel = 0.04 + 0.96 * pow( 1.0 - clamp( toEye.y, 0.0, 1.0 ), 4.0 );
	vec3 bounce = vec3( - toEye.x, toEye.y, - toEye.z );
	vec2 hit = vBackroomsWorldPosition.xz + bounce.xz / max( bounce.y, 0.04 ) * ( gridLightHeight + 0.15 - vBackroomsWorldPosition.y );
	vec2 panel = floor( ( hit - 1.0 ) * 0.5 + 0.5 );
	vec2 offset = abs( hit - ( panel * 2.0 + 1.0 ) );
	vec4 state = panelState( panel );
	float lit = state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
	// Distance from the panel's center, scaled to its shape.
	float reach = max( offset.x * ${(0.075 / PANEL_HALF_X).toFixed(4)}, offset.y * ${(0.075 / PANEL_HALF_Z).toFixed(4)} );
	float glint = ( 1.0 - smoothstep( 0.05, 0.14, reach ) + 0.2 * ( 1.0 - smoothstep( 0.1, 0.55, reach ) ) ) * lit;
	outgoingLight += wet * fresnel * ( vec3( 0.9, 0.88, 0.74 ) * backroomsArea * backroomsTint * 0.08 + vec3( 1.0, 0.98, 0.88 ) * panelTint( state.a ) * glint * 1.6 );
}
#include <opaque_fragment>
`;

// Light fittings. The diffuser follows the panel's state and shows its gel in Level Fun. The painted frame is only
// as bright as the room, and so is a dead diffuser on levels that define LEVEL_DEAD_LIGHT_SHADED.
const FRAGMENT_FIXTURE = /* glsl */ `
#include <color_fragment>
if ( diffuseColor.r > 0.8 ) {
	vec4 state = panelState( floor( ( vBackroomsWorldPosition.xz - 1.0 ) * 0.5 + 0.5 ) );
	vec3 dead = LEVEL_DEAD_LIGHT;
	#ifdef LEVEL_DEAD_LIGHT_SHADED
		dead *= 0.15 + 0.85 * backroomsArea;
	#endif
	diffuseColor.rgb = mix( dead, diffuseColor.rgb * panelTint( state.a ), state.r * panelFlicker( state.b ) * ( 1.0 - blackout ) );
} else {
	diffuseColor.rgb *= ( 0.2 + 0.8 * backroomsArea ) * backroomsTint;
}
`;

// Level Fun balloons are thin rubber, so they glow a little in their own color from whichever side they're lit.
const FRAGMENT_BALLOON = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * backroomsArea * backroomsTint * 0.24;
`;

// Mirror ball. Flat shaded gray tiles so each catches the light on its own as it turns. Random tiles flash.
const FRAGMENT_DISCO = /* glsl */ `
#include <emissivemap_fragment>
{
	ivec3 tile = ivec3( floor( vBackroomsWorldPosition * 70.0 ) );
	uint h = backroomsHash( uint( tile.x ) * 73856093u ^ uint( tile.y ) * 19349663u ^ uint( tile.z ) * 83492791u ^ uint( lightTime * 7.0 ) * 2654435761u );
	float flash = ( h & 255u ) < 7u ? 1.8 : 0.0;
	totalEmissiveRadiance += ( vec3( flash ) + diffuseColor.rgb * 0.3 ) * backroomsArea * backroomsTint;
}
`;

// Powered glowing parts like a prop's screen or lamp (see buildPropGlowGeometry in props.js). They drop to a faint
// glimmer in a blackout.
const FRAGMENT_POWERED = /* glsl */ `
#include <color_fragment>
diffuseColor.rgb *= 1.0 - 0.94 * blackout;
`;

// three r155+ normalizes the screen-space derivatives in bump mapping, which changes how strong a given
// bumpScale looks. The carpet and ceiling were tuned against the old formula, so restore it.
const LEGACY_BUMP_MAP = ShaderChunk.bumpmap_pars_fragment
    .replace('normalize( dFdx( surf_pos.xyz ) )', 'dFdx( surf_pos.xyz )')
    .replace('normalize( dFdy( surf_pos.xyz ) )', 'dFdy( surf_pos.xyz )');

if (import.meta.env?.DEV && LEGACY_BUMP_MAP === ShaderChunk.bumpmap_pars_fragment) {
    console.warn('materials.js: bump map patch no longer applies to this three.js version.');
}

/** Level the shared (every-level) materials are compiled for (see setShadingLevel). */
let showing = 0;
/** The shared materials. */
const everyLevel = new Set();

/**
 * Adds the world lighting (ceiling lights, panel states, area light and fog) to a built-in material.
 * @template {MeshPhongMaterial | MeshStandardMaterial | MeshBasicMaterial} T
 * @param {T} material
 * @param {string} [surface] Extra shading for some surfaces. 'fixture', 'decal', 'figure', 'balloon', 'disco' and
 *     'powered' work on every level. Anything else is one of the level's own (`surfaceShading`, see levelShading.js).
 * @param {number | null} [level] Compile for this level's shading only. null means it shows on every level and is
 *     compiled for the current one.
 * @returns {T}
 */
export function withBackroomsShading(material, surface, level = null) {
    material.onBeforeCompile = (shader) => {
        // Level shading (see levelShading.js), plus party shading where Level Fun can dress it.
        const { shading, surfaceShading, dressable } = levelById(level ?? showing);
        Object.assign(shader.uniforms, worldLighting);
        let vertex = shader.vertexShader.replace('#include <project_vertex>', VERTEX_WORLD_POSITION);
        if (surface === 'balloon') vertex = VERTEX_SWAY_DECLARATIONS + vertex.replace('#include <begin_vertex>', VERTEX_SWAY);
        shader.vertexShader = VERTEX_DECLARATIONS + vertex;
        let fragment = shader.fragmentShader
            .replace('void main() {', FRAGMENT_MAIN)
            .replace('#include <bumpmap_pars_fragment>', LEGACY_BUMP_MAP)
            .replace('#include <lights_fragment_begin>', FRAGMENT_CEILING_LIGHTS)
            .replace('#include <fog_fragment>', surface === 'figure' ? FRAGMENT_FOG_FIGURE : FRAGMENT_FOG);
        if (surface === 'fixture') fragment = fragment.replace('#include <color_fragment>', FRAGMENT_FIXTURE);
        if (surface === 'decal') fragment = fragment.replace('#include <opaque_fragment>', FRAGMENT_WET);
        if (surface === 'balloon') fragment = fragment.replace('#include <emissivemap_fragment>', FRAGMENT_BALLOON);
        if (surface === 'disco') fragment = fragment.replace('#include <emissivemap_fragment>', FRAGMENT_DISCO);
        if (surface === 'powered') fragment = fragment.replace('#include <color_fragment>', FRAGMENT_POWERED);
        // Level-specific surface.
        const own = surfaceShading[surface];
        if (own) {
            const patched = own(shader.vertexShader, fragment);
            shader.vertexShader = patched.vertex;
            fragment = patched.fragment;
        }
        shader.fragmentShader = (dressable ? '#define BACKROOMS_PARTY\n' : '') + FRAGMENT_DECLARATIONS + shading + FRAGMENT_AFTER_LEVEL + fragment;
    };
    // Separate program cache per surface and level, apart from unpatched materials.
    material.customProgramCacheKey = () => `backrooms-shading-v7-${surface ?? 'plain'}-${level ?? showing}`;
    if (level === null) everyLevel.add(material);
    return material;
}

/**
 * Switches the shared materials to this level's shading. They recompile the next time they're drawn. three.js keeps
 * a program while anything uses it, so switching back is quicker. Level-specific surfaces compile once and are left
 * alone.
 * @param {number} level
 */
export function setShadingLevel(level) {
    if (level === showing) return;
    showing = level;
    for (const material of everyLevel) material.needsUpdate = true;
}

/**
 * Starts compiling everything in the scene (visible or not), plus `also`, as it will be drawn on a level. Returns
 * the three.js programs for whenCompiled. Materials keep every program they've had until disposed, so going back to
 * a level that's been through this doesn't wait on shaders.
 *
 * This only submits them. With KHR_parallel_shader_compile they compile in the background, and drawing with one
 * before it's ready waits for it then. Submitting every level at once kept Windows busy for 10+ seconds with
 * nothing drawn. Even submitting is slow (2 s for one level on a phone), so it's done in slices of a few ms,
 * awaiting `between` with the programs submitted since the last call.
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Scene} scene
 * @param {import('three').Camera} camera
 * @param {number} level
 * @param {object} [options]
 * @param {import('three').Object3D[]} [options.also] Things not in the scene yet, compiled as if they were.
 * @param {(programs: object[]) => Promise<void>} [options.between]
 * @param {() => boolean} [options.cancelled] Stops early, e.g. when another world takes over.
 * @returns {Promise<object[]>}
 */
export async function compileForLevel(renderer, scene, camera, level, { also = [], between = nextFrame, cancelled = () => false } = {}) {
    // One object per material, object type and geometry attributes, since programs depend on those too.
    const things = new Map();
    for (const root of [scene, ...also]) {
        root.traverse((object) => {
            if (!(object.isMesh || object.isPoints || object.isLine || object.isSprite) || !object.material) return;
            const key = `${object.type} ${Object.keys(object.geometry?.attributes ?? {}).join()}`;
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
                things.set(`${material.id} ${key}`, object);
            }
        });
    }
    const programs = new Set();
    const queue = [...things.values()];
    while (queue.length > 0 && !cancelled()) {
        const start = performance.now();
        const was = showing;
        setShadingLevel(level);
        const slice = new Set();
        while (queue.length > 0 && performance.now() - start < 8) {
            for (const material of renderer.compile(queue.pop(), camera, scene)) {
                const program = renderer.properties.get(material).currentProgram;
                if (program) slice.add(program);
            }
        }
        setShadingLevel(was);
        for (const program of slice) programs.add(program);
        if (queue.length > 0) await between([...slice]);
    }
    return [...programs];
}

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Waits until programs from compileForLevel are ready without blocking the page. With parallel compile it just
 * polls. Otherwise it finishes a few at a time, awaiting `between` in between. Each one still blocks while it
 * compiles, but only for its own time.
 * @param {import('three').WebGLRenderer} renderer
 * @param {object[]} programs
 * @param {object} [options]
 * @param {() => boolean} [options.cancelled] Stops waiting, e.g. when another world takes over.
 * @param {() => Promise<void>} [options.between]
 */
export async function whenCompiled(renderer, programs, { cancelled = () => false, between = nextFrame } = {}) {
    const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
    // Programs that are gone (material disposed or driver reset) count as done. They recompile when needed.
    const done = (program) => program.program === undefined || !renderer.info.programs.includes(program) || (parallel && program.isReady());
    const waiting = programs.filter((program) => !done(program));
    while (waiting.length > 0 && !cancelled()) {
        await between();
        for (let i = waiting.length - 1; i >= 0; i--) if (done(waiting[i])) waiting.splice(i, 1);
        if (parallel) continue;
        // Reading uniforms forces the compile to finish. Do as many as fit in a few ms.
        const start = performance.now();
        while (waiting.length > 0 && performance.now() - start < 12) waiting.pop().getUniforms();
    }
}

// Decals sit slightly in front of their surface. Polygon offset keeps them in front in the depth buffer at any
// distance.
export const DECAL_OPTIONS = {
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
};

/**
 * Glow around a level's lights in the air, as a soft camera-facing spot (see ColorBuilder.spot). Fades into the
 * haze with distance, disappears up close, and is drawn additively behind whatever's in front. The level sets each
 * spot's brightness and color. Level 1's follow its tubes, Level 37's its skylights, lamps and water.
 * @param {object} glow
 * @param {string} glow.light GLSL in the vertex main that sets `float strength` and `vec3 tint` from `world`
 *     (position) and the `glow` attribute (size, whose flicker it follows, brightness, how tall).
 * @param {string} [glow.declarations] GLSL that `light` needs, after PANEL_LIGHT_GLSL.
 * @param {Color} glow.color
 * @param {number} glow.soft How much of the light spreads out to the edge instead of staying in the center.
 * @param {number | null} [glow.ceiling] Height of a flat ceiling. Spots below it fade out toward it so they don't
 *     get cut off in a hard line. Spots above it (up in a skylight) are left alone.
 * @param {number | null} [glow.floor] Same for a flat floor. Spots above it fade out toward it.
 */
export function createGlowMaterial({ light, declarations = '', color, soft, ceiling = null, floor = null }) {
    const { panelStates, lightTime, blackout } = worldLighting;
    const defines = {};
    if (ceiling !== null) defines.GLOW_CEILING = ceiling.toFixed(4);
    if (floor !== null) defines.GLOW_FLOOR = floor.toFixed(4);
    return new ShaderMaterial({
        defines,
        uniforms: { panelStates, lightTime, blackout, fogDensity: { value: FOG_DENSITY }, glowColor: { value: color } },
        vertexShader: /* glsl */ `
${PANEL_LIGHT_GLSL}
${declarations}
attribute vec2 corner;
attribute vec4 glow;
varying vec2 vCorner;
varying float vStrength;
varying float vDepth;
varying vec3 vTint;
varying vec4 vClear;
void main() {
	vec3 world = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
${light}
	vec4 view = viewMatrix * vec4( world, 1.0 );
	// Zero size when it's out, so it costs nothing to draw.
	float size = strength > 0.002 ? glow.x : 0.0;
	vec2 spread = corner * vec2( size, size * glow.w );
	view.xy += spread;
	gl_Position = projectionMatrix * view;
	// This corner's distance to a flat ceiling and floor (view offset turned back into world space), and the fade
	// length. The fade is never longer than the center's distance, so the center keeps its light.
	vClear = vec4( 1.0 );
	float up = ( transpose( mat3( viewMatrix ) ) * vec3( spread, 0.0 ) ).y;
	#ifdef GLOW_CEILING
		if ( world.y < GLOW_CEILING ) vClear.xy = vec2( GLOW_CEILING - world.y - up, clamp( GLOW_CEILING - world.y, 0.02, 0.09 ) );
	#endif
	#ifdef GLOW_FLOOR
		if ( world.y > GLOW_FLOOR ) vClear.zw = vec2( world.y + up - GLOW_FLOOR, clamp( world.y - GLOW_FLOOR, 0.02, 0.09 ) );
	#endif
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
varying vec4 vClear;
void main() {
	float r = length( vCorner );
	float a = max( 1.0 - r, 0.0 );
	a = a * a * ( ${soft} + ${1 - soft} * a );
	#if defined( GLOW_CEILING ) || defined( GLOW_FLOOR )
		a *= smoothstep( 0.0, vClear.y, vClear.x ) * smoothstep( 0.0, vClear.w, vClear.z );
	#endif
	// Fades into the haze with distance, and out up close where it would fill the screen.
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

// Glow around Level 0's light panels (see createPanelGlowGeometry in chunkGeometry.js). It flickers and fails with
// its panel, and takes the gel color in Level Fun.
const PANEL_GLOW_DECLARATIONS = /* glsl */ `
#define BACKROOMS_PARTY
vec3 levelLightTint( float code ) {
	return vec3( 1.0 );
}
${PANEL_TINT_GLSL}
`;

const PANEL_GLOW_LIGHT = /* glsl */ `
	vec4 state = panelState( floor( ( world.xz - 1.0 ) * 0.5 + 0.5 ) );
	float strength = glow.z * state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
	vec3 tint = panelTint( state.a );
`;

/**
 * @param {ReturnType<import('./textures.js').loadTextures>} textures
 * @param {import('three').Texture} panelStates
 * @param {number} [maxAnisotropy]
 * @param {import('three').Texture | null} [cellStates] Per-cell contents (see PanelLightMap.cells).
 */
export function createMaterials(textures, panelStates, maxAnisotropy = 1, cellStates = null) {
    worldLighting.panelStates.value = panelStates;
    worldLighting.cellStates.value = cellStates;
    const decalAtlas = createDecalAtlas(maxAnisotropy);
    const partyAtlas = createPartyAtlas(maxAnisotropy);
    const propAtlas = createPropAtlas(maxAnisotropy);
    const materials = {
        // Level 0's own surfaces, compiled for Level 0 only (see levels.js).
        wall: withBackroomsShading(new MeshPhongMaterial({ map: textures.wallpaper }), 'wall', 0),
        baseboard: withBackroomsShading(new MeshPhongMaterial({ color: 0xf2e6cc, map: textures.baseboard, shininess: 0 }), 'baseboard', 0),
        details: withBackroomsShading(new MeshPhongMaterial({ map: createDetailsTexture(), shininess: 8 }), undefined, 0),
        floor: withBackroomsShading(new MeshPhongMaterial({
            color: 0x5d584c,
            map: textures.carpet,
            bumpMap: textures.carpetBump,
            bumpScale: 0.005,
            shininess: 0,
        }), 'floor', 0),
        ceiling: withBackroomsShading(new MeshStandardMaterial({
            color: CEILING_COLOR_DIM,
            map: textures.ceiling,
            bumpMap: textures.ceilingBump,
            bumpScale: 0.0015,
            roughness: 1,
            metalness: 0,
        }), 'ceiling', 0),
        // Other levels' light fittings (see FRAGMENT_FIXTURE). Things that give off light skip AO shading (see
        // fx/AmbientOcclusion.js).
        fixture: withBackroomsShading(new MeshBasicMaterial({ vertexColors: true, userData: { unoccluded: true } }), 'fixture'),
        // Level 0's light panels (see createFixtureGeometry in chunkGeometry.js) and their glow.
        panel: withBackroomsShading(new MeshBasicMaterial({ vertexColors: true, userData: { unoccluded: true } }), 'panel', 0),
        panelGlow: createGlowMaterial({ light: PANEL_GLOW_LIGHT, declarations: PANEL_GLOW_DECLARATIONS, color: new Color(1, 0.95, 0.76), soft: 0.4, ceiling: WALL_HEIGHT, floor: 0 }),
        // Soft dark edge where walls meet the floor, ceiling and each other (chunkGeometry.js).
        shade: withBackroomsShading(new MeshBasicMaterial({ color: 0x0e0b06, alphaMap: createShadeTexture(), ...DECAL_OPTIONS })),
        // Wet carpet (decals.js) and peeling wallpaper (peels.js). A bit of shine so wet carpet glistens in the
        // flashlight.
        decal: withBackroomsShading(new MeshPhongMaterial({ map: decalAtlas, specular: 0x2a2a2a, shininess: 40, ...DECAL_OPTIONS }), 'decal'),
        // Ceiling stains match the ceiling's shade (see Lighting.setCeilingLights).
        ceilingDecal: withBackroomsShading(new MeshPhongMaterial({ color: CEILING_COLOR_DIM, map: decalAtlas, shininess: 0, ...DECAL_OPTIONS })),
        // Floor props (props.js). Vertex colors, plus atlas pictures where needed.
        prop: withBackroomsShading(new MeshPhongMaterial({ map: propAtlas, vertexColors: true, shininess: 18 })),
        // Glowing prop parts like screens and lamp shades. Full brightness whatever the room light, until a
        // blackout (see FRAGMENT_POWERED).
        propGlow: withBackroomsShading(new MeshBasicMaterial({ map: propAtlas, vertexColors: true, userData: { unoccluded: true } }), 'powered'),
        // Edit mode outlines for what would be built and what's already there. Not shaded by AO.
        highlight: new LineBasicMaterial({ color: 0xfff3a8, transparent: true, opacity: 0.9, userData: { unoccluded: true } }),
        selection: new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, userData: { unoccluded: true } }),
        party: createPartyMaterials(textures, partyAtlas, maxAnisotropy),
    };
    /** @type {LevelSurfaces[]} */
    const levels = [];
    return {
        ...materials,
        /**
         * A level's surfaces by number (see levels.js). Built on first use since drawing a level's textures takes a
         * while (a second or more on a phone), and usually only a level or two gets seen.
         * @param {number} id
         * @returns {LevelSurfaces}
         */
        level(id) {
            const level = levelById(id);
            return (levels[level.id] ??= level.surfaces(materials, maxAnisotropy, level.id));
        },
        /** True once a level's surfaces are built. @param {number} id */
        hasLevel: (id) => levels[levelById(id).id] !== undefined,
        /** Draws pictures for edit-mode-only props into the prop atlas, if not done yet (see drawEditPictures). */
        editPictures: () => drawEditPictures(propAtlas),
    };
}

/**
 * @typedef {object} LevelSurfaces
 * @property {import('three').Material} wall
 * @property {import('three').Material} floor
 * @property {import('three').Material} ceiling
 * @property {import('three').Material} details
 * @property {Record<string, import('three').Material>} extras
 * @property {string[]} shadows The extras that cast shadows.
 * @property {string[]} [unreflected] Extras left out of the water reflection besides the water itself (see
 *     fx/Reflection.js).
 * @property {import('three').Material} [backdrop] What's past the far plane when it's more than the haze color
 *     (see WorldView). Drawn on a box around the camera, behind everything.
 */

/**
 * Level Fun materials (see party.js). The wallpaper is swapped onto the walls while it's on. `chalk` is the face
 * the tape's figure wears to the party.
 * @param {ReturnType<import('./textures.js').loadTextures>} textures
 * @param {import('three').Texture} atlas
 * @param {number} maxAnisotropy
 */
function createPartyMaterials(textures, atlas, maxAnisotropy) {
    return {
        wallpaper: createPartyWallpaper(textures.wallpaper, maxAnisotropy),
        atlas,
        things: withBackroomsShading(new MeshPhongMaterial({ map: atlas, vertexColors: true, specular: 0x262626, shininess: 26 })),
        decal: withBackroomsShading(new MeshPhongMaterial({ map: atlas, vertexColors: true, shininess: 0, ...DECAL_OPTIONS })),
        balloon: withBackroomsShading(new MeshPhongMaterial({ map: atlas, vertexColors: true, specular: 0x6e6e6e, shininess: 70 }), 'balloon'),
        flame: withBackroomsShading(new MeshBasicMaterial({ vertexColors: true, userData: { unoccluded: true } })),
        disco: withBackroomsShading(new MeshPhongMaterial({ color: 0x9d9ea6, specular: 0xffffff, shininess: 120, flatShading: true }), 'disco'),
        confetti: withBackroomsShading(new MeshPhongMaterial({ side: DoubleSide, specular: 0x404040, shininess: 40 })),
        chalk: withBackroomsShading(new MeshBasicMaterial({ map: atlas, color: 0xe6e6e0, transparent: true, depthWrite: false }), 'figure'),
    };
}

/**
 * Shade strip darkness from the join (v = 0) fading to nothing (v = 1), one column per kind of strip. Used as an
 * alpha map, which reads the green channel.
 */
function createShadeTexture() {
    // Foot of a wall, top of a wall, inside corner, under a prop.
    const strengths = [0.42, 0.34, 0.24, 0.55];
    const falloffs = [2.2, 2.2, 2.2, 1.6];
    const height = 32;
    const data = new Uint8Array(SHADE_COLUMNS * height * 4);
    for (let row = 0; row < height; row++) {
        for (let column = 0; column < SHADE_COLUMNS; column++) {
            const i = (row * SHADE_COLUMNS + column) * 4;
            const value = Math.round(255 * strengths[column] * (1 - row / (height - 1)) ** falloffs[column]);
            data[i] = data[i + 1] = data[i + 2] = value;
            data[i + 3] = 255;
        }
    }
    const texture = new DataTexture(data, SHADE_COLUMNS, height);
    texture.magFilter = texture.minFilter = LinearFilter;
    texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
}

/**
 * Wall outlet (left half) and ceiling vent (right half), drawn in code. Colors match the wallpaper and ceiling
 * textures so they blend in.
 */
function createDetailsTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

    // Outlet: off-white plate, two sockets with two slots each.
    g.fillStyle = '#d9d4bd';
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#c4bea5';
    g.fillRect(0, 0, 32, 2);
    g.fillRect(0, 30, 32, 2);
    g.fillRect(0, 0, 2, 32);
    g.fillRect(30, 0, 2, 32);
    g.fillStyle = '#3b382e';
    for (const y of [7, 19]) {
        g.fillRect(11, y, 2, 5);
        g.fillRect(19, y, 2, 5);
        g.fillRect(15, y + 6, 2, 2);
    }
    g.fillRect(15, 15, 2, 2); // screw

    // Vent: slats in a frame.
    g.fillStyle = '#bdbab0';
    g.fillRect(32, 0, 32, 32);
    g.fillStyle = '#5f5d55';
    for (let y = 4; y < 28; y += 3) g.fillRect(35, y, 26, 2);
    g.fillStyle = '#d6d3c8';
    g.fillRect(32, 0, 32, 2);
    g.fillRect(32, 30, 32, 2);
    g.fillRect(32, 0, 2, 32);
    g.fillRect(62, 0, 2, 32);

    const texture = new CanvasTexture(canvas);
    texture.magFilter = NearestFilter;
    return texture;
}
