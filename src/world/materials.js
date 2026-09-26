import {
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
    Vector4,
} from 'three';
import { SHADE_COLUMNS } from './chunkGeometry.js';
import { createDecalAtlas, createPropAtlas } from './decorationTextures.js';
import {
    FRAGMENT_L1_BOUNCE,
    FRAGMENT_L1_CEILING,
    FRAGMENT_L1_COLUMN,
    FRAGMENT_L1_FLOOR,
    FRAGMENT_L1_FLOOR_NORMAL,
    FRAGMENT_L1_FLOOR_REFLECTION,
    FRAGMENT_L1_FLOOR_SPECULAR,
    FRAGMENT_L1_TUBE,
    FRAGMENT_L1_TUBE_DECLARATIONS,
    FRAGMENT_L1_WALL,
    L1_FLOOR_DECLARATIONS,
    VERTEX_L1_TUBE,
    VERTEX_L1_TUBE_DECLARATIONS,
} from './levelOneShading.js';
import { LEVELS, levelById } from './levels.js';
import { PANEL_LIGHT_GLSL } from './panelLights.js';
import { GEL_CYCLING, GEL_HUES, GEL_WHITE, PARTY_PALETTE } from './party.js';
import { createPartyAtlas, createPartyWallpaper } from './partyTextures.js';

export const FIXTURE_PANEL_COLOR = 0xfeffe8;
export const FIXTURE_FRAME_COLOR = 0x8f8c82;
// The ceiling is darkened when the lights are off (it isn't lit by anything but ambient light then).
export const CEILING_COLOR_DIM = 0x777777;
export const CEILING_COLOR_LIT = 0xffffff;
/** How many of Level Fun's mirror balls throw their light at once (the nearest ones; see PartyLayer.js). */
export const DISCO_MAX = 4;

/**
 * Uniforms shared by every lit material: the ceiling lights ("dynamic lights") and the state of each panel.
 *
 * The original version added 25 real PointLights around the player's current chunk. Changing the number of
 * lights forces three.js to recompile every material, which froze the game for close to a second whenever
 * they were toggled, and 25 lights per pixel was slow on most GPUs. The panels sit on a perfectly regular
 * grid, though, so each fragment can simply evaluate the 4×4 panels around it in the shader: every panel in
 * the world is lit, toggling is a uniform change (no recompile), and the cost is constant.
 *
 * Panels can be dead, dim or flickering, and some areas have lost most of their lights (see panelLights.js).
 * Where a panel is fine, all of that multiplies by one and the scene looks exactly as it always has.
 */
export const worldLighting = {
    gridLightIntensity: { value: 0 },
    // Same colour/intensity as the original PointLight(0xf5f4cb, 1.1, 3.1), including the ×π that
    // three.js applied to light intensities before r155 ("legacy lights").
    gridLightColor: { value: new Color(0xf5f4cb).multiplyScalar(1.1 * Math.PI) },
    gridLightDistance: { value: 3.1 },
    gridLightDecay: { value: 2 },
    gridLightHeight: { value: 0.85 },
    panelStates: { value: null },
    lightTime: { value: 0 },
    blackout: { value: 0 },
    // Area light at the camera; the haze in front of distant surfaces takes on this brightness.
    cameraAreaLight: { value: 1 },
    // Level Fun (see party.js): whether it's on (the confetti in the carpet), and the mirror balls throwing
    // their light (where each is, and which way it's turned; how far its light reaches; how many there are).
    partyLevel: { value: 0 },
    discoBalls: { value: Array.from({ length: DISCO_MAX }, () => new Vector4()) },
    discoRanges: { value: new Array(DISCO_MAX).fill(0) },
    discoCount: { value: 0 },
    // Level 1 (see levelOneShading.js): the mist (left out of the reflection), and the reflection in the puddles
    // (see Reflection.js), if there is one.
    mistLevel: { value: 1 },
    reflectionMap: { value: null },
    reflectionMatrix: { value: new Matrix4() },
    reflectionOn: { value: 0 },
};

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vBackroomsWorldPosition;
`;

// (Instanced meshes place each copy with its own matrix, before the model's.)
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

// Level Fun's balloons, strings and hanging ribbons move on the air. Each vertex says where in the movement its
// thing starts (x), how much it drifts (y: a balloon all the way, its string less the nearer it's tied), and how
// much it swings (z: whatever hangs free, more the further down).
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

// The colour of the light in a slot, from its fourth byte: the level's own (see levelShading.js), or in Level Fun,
// the gel over it (see party.js): a warm white where it's left white, otherwise a strong colour (dimmer overall
// than white, the way gels are). The ones that change swing from sky blue through blue, purple, pink and red to
// orange and back, never through the greens.
const PANEL_TINT_GLSL = /* glsl */ `
// A colour from round the colour wheel, at full strength.
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

// Level Fun: confetti in the carpet, and the light off the mirror balls. Only in the levels it can dress (see
// levels.js), which have BACKROOMS_PARTY defined.
const PARTY_GLSL = /* glsl */ `
uniform float partyLevel;
uniform vec4 discoBalls[ ${DISCO_MAX} ];
uniform float discoRanges[ ${DISCO_MAX} ];
uniform int discoCount;

const vec3 PARTY_COLORS[ ${PARTY_PALETTE.length} ] = vec3[ ${PARTY_PALETTE.length} ]( ${PARTY_COLORS_GLSL} );

// The gels blended between the four nearest panels, like the area light: the colour a room is washed in.
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

// Confetti trodden into the carpet: strips and dots a few centimetres across, thicker on the ground in some
// places than others. Far off, where a piece would be smaller than a pixel, it's just a speckle of colour.
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

// The light a mirror ball throws: the spot, if any, that lands along ray (unit, out from the ball's middle) with
// the ball turned by turn (radians, about the upright), and pixelAngle how big a pixel is from there. The mirrors
// are in rows from bottom to top, as many to a row as fit round it, and only some catch the spotlight on it.
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
	// Crisp at the edge, and dimmer where it's smeared over more than it covers (smaller than a pixel, far off).
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
uniform float gridLightDecay;
uniform float gridLightHeight;
uniform float cameraAreaLight;
${PANEL_LIGHT_GLSL}
`;

const FRAGMENT_AFTER_LEVEL = /* glsl */ `
${PANEL_TINT_GLSL}
#ifdef BACKROOMS_PARTY
${PARTY_GLSL}
#endif
`;

// backroomsTint is the colour Level Fun's gels wash the room in (white everywhere else): only a little of it,
// since the colour is mostly in the pools of light under each panel. backroomsPixel is about how far a pixel
// spans here, for the mirror balls' light.
const FRAGMENT_MAIN = /* glsl */ `
void main() {
	float backroomsArea = backroomsAreaLight( vBackroomsWorldPosition.xz );
	vec3 backroomsTint = vec3( 1.0 );
	#ifdef BACKROOMS_PARTY
		if ( partyLevel > 0.0 ) backroomsTint = mix( vec3( 1.0 ), backroomsAreaTint( vBackroomsWorldPosition.xz ), 0.5 );
	#endif
	float backroomsPixel = length( fwidth( vBackroomsWorldPosition ) );
`;

// The flashlight is the only spot light. It stays in the scene while switched off (so toggling it never
// recompiles anything), just with zero intensity, and three.js would still work out its cone, falloff and
// shadow for every pixel, only to add nothing. That was around a quarter of the cost of drawing the scene.
// Skip all of it while it's off; the result is exactly the same. The shadow lookup gets a plain `if` too,
// so compilers that would evaluate both sides of the `?:` don't sample the shadow map outside the beam.
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
            '$1\n\t\t}$2',
        );
    return chunk.slice(0, start) + section + chunk.slice(end);
}

// Ambient light and the overhead light stand in for the ceiling panels' general glow, so they fade where
// the panels have died (and in Level Fun, take on their gels' colours). (The flashlight is a spot light and
// isn't affected.)
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
	// Panels hang above every cell with odd (x, z). With a 3.1 unit range, only the 4 nearest per axis can
	// reach this fragment. Work in view space like three.js' own lights: transform the first panel once,
	// then step along the grid's view-space axes.
	vec2 firstPanel = floor( ( vBackroomsWorldPosition.xz - 1.0 ) * 0.5 ) - 1.0;
	vec3 panelOrigin = ( viewMatrix * vec4( firstPanel.x * 2.0 + 1.0, gridLightHeight, firstPanel.y * 2.0 + 1.0, 1.0 ) ).xyz;
	vec3 panelStepX = viewMatrix[ 0 ].xyz * 2.0;
	vec3 panelStepZ = viewMatrix[ 2 ].xyz * 2.0;
	IncidentLight panelLight;
	panelLight.visible = true;
	// Most of the 16 are out of range. Only visit the rows and columns of panels that can be within reach
	// horizontally at this height (with a little slack, so rounding never drops one that reaches), which is
	// usually 9 of them; the exact test below still decides.
	vec2 xz = vBackroomsWorldPosition.xz;
	float below = gridLightHeight - vBackroomsWorldPosition.y;
	float reach = sqrt( max( gridLightDistance * gridLightDistance - below * below, 0.0 ) ) + 0.01;
	ivec2 first = ivec2( max( ceil( ( xz - reach - 1.0 ) * 0.5 ) - firstPanel, 0.0 ) );
	ivec2 last = ivec2( min( floor( ( xz + reach - 1.0 ) * 0.5 ) - firstPanel, 3.0 ) );
	for ( int ix = first.x; ix <= last.x; ix ++ ) {
		for ( int iz = first.y; iz <= last.y; iz ++ ) {
			// Rule out the ones still out of range before reading the panel's state.
			vec3 lVector = panelOrigin + float( ix ) * panelStepX + float( iz ) * panelStepZ - geometryPosition;
			float lightDistance = length( lVector );
			if ( lightDistance >= gridLightDistance ) continue;
			vec4 state = panelState( firstPanel + vec2( ix, iz ) );
			float brightness = state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
			if ( brightness <= 0.0 ) continue;
			panelLight.direction = lVector / lightDistance;
			// Legacy (pre-r155) distance falloff, to keep the original look.
			panelLight.color = gridLightColor * gridLightIntensity * brightness * pow( 1.0 - lightDistance / gridLightDistance, gridLightDecay ) * panelTint( state.a );
			RE_Direct( panelLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		}
	}
}
// Level Fun's mirror balls: the spots of light off each of the nearest, turning slowly round the room. (Only
// where there's open floor all round, since nothing stops them at a wall.)
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
`;

// The haze is only as bright as the lights around it: near a surface it takes the light there, and it
// blends towards the light at the camera with distance, matching the background beyond the far plane. Then the
// level's air (see levelShading.js) lays it over the colour. `adjust` changes how much of it there is.
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

// The figure in Found Footage keeps more of itself in the haze than anything else does: it's darker than
// the distance should allow.
const FRAGMENT_FOG_FIGURE = fogFragment('fogFactor *= 0.6;');

// Wallpaper: hung in strips a quarter of a unit wide, with a faint line at each join (faded out with
// distance, where it would only shimmer); yellowed unevenly; grubbier along the bottom, where feet and mops
// reach, and a little darker up by the ceiling.
const FRAGMENT_WALL = /* glsl */ `
#include <map_fragment>
{
	vec3 p = vBackroomsWorldPosition;
	float along = p.x + p.z;
	float yellowing = backroomsNoise( vec2( along * 0.8, p.y * 1.4 ) ) * 0.65 + backroomsNoise( vec2( along * 2.9 + 17.0, p.y * 3.6 ) ) * 0.35;
	diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.9, 0.85, 0.72 ), smoothstep( 0.52, 0.82, yellowing ) * 0.7 );
	float low = 1.0 - smoothstep( 0.03, 0.2, p.y );
	float scuffs = 0.55 + 0.45 * backroomsNoise( vec2( along * 6.0, p.y * 30.0 ) );
	diffuseColor.rgb *= 1.0 - 0.16 * low * scuffs - 0.1 * smoothstep( 0.88, 1.0, p.y );
	#ifdef USE_MAP
		float strip = vMapUv.x * 4.0;
		float pixel = max( fwidth( strip ), 1e-4 );
		float join = 1.0 - smoothstep( 0.35, 1.4, abs( fract( strip + 0.5 ) - 0.5 ) / pixel );
		diffuseColor.rgb *= 1.0 - 0.14 * join * ( 1.0 - smoothstep( 0.025, 0.09, pixel ) );
	#endif
}
`;

// Standing water in the carpet (the decals on the floor, whose opacity is how wet they are): mostly it's
// just darker, but at a glancing angle it takes a faint sheen, and a lit panel overhead shows in it,
// blurred, where the view would bounce up to one.
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
	float reach = max( offset.x, offset.y );
	float glint = ( 1.0 - smoothstep( 0.05, 0.14, reach ) + 0.2 * ( 1.0 - smoothstep( 0.1, 0.55, reach ) ) ) * lit;
	outgoingLight += wet * fresnel * ( vec3( 0.9, 0.88, 0.74 ) * backroomsArea * backroomsTint * 0.08 + vec3( 1.0, 0.98, 0.88 ) * panelTint( state.a ) * glint * 1.6 );
}
#include <opaque_fragment>
`;

// Damp patches in the carpet (and in Level Fun, confetti).
const FRAGMENT_FLOOR = /* glsl */ `
#include <map_fragment>
float damp = backroomsNoise( vBackroomsWorldPosition.xz * 0.45 ) * 0.65 + backroomsNoise( vBackroomsWorldPosition.xz * 1.7 + 31.0 ) * 0.35;
diffuseColor.rgb *= 1.0 - 0.3 * smoothstep( 0.6, 0.78, damp );
#ifdef BACKROOMS_PARTY
	if ( partyLevel > 0.0 ) diffuseColor.rgb = backroomsConfetti( vBackroomsWorldPosition.xz, diffuseColor.rgb );
#endif
`;

// Ceiling tiles are 1/6 × 1/4 of a unit (the texture's repeat). Give each a slightly different shade, and a
// few of them old water stains.
const FRAGMENT_CEILING = /* glsl */ `
#include <map_fragment>
{
	vec2 tileCoord = vBackroomsWorldPosition.xz * vec2( 6.0, 4.0 );
	uvec2 tile = uvec2( ivec2( floor( tileCoord ) ) );
	uint h = backroomsHash( tile.x * 2654435761u ^ tile.y * 2246822519u );
	diffuseColor.rgb *= 0.965 + 0.07 * float( h & 255u ) / 255.0;
	if ( ( ( h >> 8u ) & 1023u ) < 10u ) {
		vec2 q = fract( tileCoord ) - vec2( 0.3 + 0.4 * float( ( h >> 18u ) & 15u ) / 15.0, 0.3 + 0.4 * float( ( h >> 22u ) & 15u ) / 15.0 );
		// A ragged edge, so it reads as a water mark rather than a painted circle.
		float r = length( q * vec2( 1.0, 1.5 ) ) + ( backroomsNoise( tileCoord * 5.0 ) - 0.5 ) * 0.22;
		float radius = 0.28 + 0.2 * float( ( h >> 26u ) & 15u ) / 15.0;
		float inside = 1.0 - smoothstep( radius * 0.55, radius, r );
		float ring = smoothstep( radius * 0.7, radius, r ) * ( 1.0 - smoothstep( radius, radius * 1.12, r ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.84, 0.74, 0.55 ), inside * 0.45 + ring * 0.55 );
	}
}
`;

// The tiles right around a lit panel catch some of its light.
const FRAGMENT_CEILING_GLOW = /* glsl */ `
{
	vec2 nearest = floor( ( vBackroomsWorldPosition.xz - 1.0 ) * 0.5 + 0.5 );
	vec4 panel = panelState( nearest );
	float on = panel.r * panelFlicker( panel.b ) * ( 1.0 - blackout );
	float glow = 1.0 - smoothstep( 0.08, 0.6, length( vBackroomsWorldPosition.xz - ( nearest * 2.0 + 1.0 ) ) );
	// (With the dynamic lights on, the panels light the ceiling themselves.)
	totalEmissiveRadiance += vec3( 0.95, 0.93, 0.8 ) * panelTint( panel.a ) * on * glow * glow * 0.2 * ( 1.0 - 0.8 * clamp( gridLightIntensity, 0.0, 1.0 ) );
}
`;

// Light panels: the bright diffuser follows the panel's state (and in Level Fun, shows its gel); the painted
// frame around it is only as light as the room.
const FRAGMENT_FIXTURE = /* glsl */ `
#include <color_fragment>
if ( diffuseColor.r > 0.8 ) {
	vec4 state = panelState( floor( ( vBackroomsWorldPosition.xz - 1.0 ) * 0.5 + 0.5 ) );
	diffuseColor.rgb = mix( LEVEL_DEAD_LIGHT, diffuseColor.rgb * panelTint( state.a ), state.r * panelFlicker( state.b ) * ( 1.0 - blackout ) );
} else {
	diffuseColor.rgb *= ( 0.2 + 0.8 * backroomsArea ) * backroomsTint;
}
`;

// Level Fun's balloons: thin coloured rubber, so light comes through them and they glow their own colour a
// little whichever side they're lit from.
const FRAGMENT_BALLOON = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * backroomsArea * backroomsTint * 0.24;
`;

// A mirror ball: grey glass tiles (flat-shaded, so each catches the light on its own as it turns), and now and
// then one flashes.
const FRAGMENT_DISCO = /* glsl */ `
#include <emissivemap_fragment>
{
	ivec3 tile = ivec3( floor( vBackroomsWorldPosition * 70.0 ) );
	uint h = backroomsHash( uint( tile.x ) * 73856093u ^ uint( tile.y ) * 19349663u ^ uint( tile.z ) * 83492791u ^ uint( lightTime * 7.0 ) * 2654435761u );
	float flash = ( h & 255u ) < 7u ? 1.8 : 0.0;
	totalEmissiveRadiance += ( vec3( flash ) + diffuseColor.rgb * 0.3 ) * backroomsArea * backroomsTint;
}
`;

// three r155+ normalizes the screen-space derivatives in bump mapping, which changes how strong a given
// bumpScale looks. The carpet and ceiling were tuned against the old formula, so restore it.
const LEGACY_BUMP_MAP = ShaderChunk.bumpmap_pars_fragment
    .replace('normalize( dFdx( surf_pos.xyz ) )', 'dFdx( surf_pos.xyz )')
    .replace('normalize( dFdy( surf_pos.xyz ) )', 'dFdy( surf_pos.xyz )');

if (import.meta.env?.DEV && LEGACY_BUMP_MAP === ShaderChunk.bumpmap_pars_fragment) {
    console.warn('materials.js: bump map patch no longer applies to this three.js version.');
}

/** The level the materials that show on every level are compiled for (see setShadingLevel). */
let showing = 0;
/** Those materials. */
const everyLevel = new Set();

/**
 * Adds the world lighting (ceiling lights, panel states, area light and fog) to a built-in material.
 * @template {MeshPhongMaterial | MeshStandardMaterial | MeshBasicMaterial} T
 * @param {T} material
 * @param {'wall' | 'floor' | 'ceiling' | 'fixture' | 'decal' | 'figure' | 'balloon' | 'disco' | 'l1wall' | 'l1column' | 'l1ceiling' | 'l1floor' | 'l1tube'} [surface]
 *     Extra detail for particular surfaces.
 * @param {number | null} [level] The level it's one of the surfaces of, if it is: it's compiled for that level's
 *     shading. Otherwise it shows on every level, and is compiled for the one that's showing.
 * @returns {T}
 */
export function withBackroomsShading(material, surface, level = null) {
    material.onBeforeCompile = (shader) => {
        // The level's shading (see levelShading.js), and the party's, where Level Fun can dress it.
        const { shading, dressable } = levelById(level ?? showing);
        Object.assign(shader.uniforms, worldLighting);
        let vertex = shader.vertexShader.replace('#include <project_vertex>', VERTEX_WORLD_POSITION);
        if (surface === 'balloon') vertex = VERTEX_SWAY_DECLARATIONS + vertex.replace('#include <begin_vertex>', VERTEX_SWAY);
        shader.vertexShader = VERTEX_DECLARATIONS + vertex;
        let fragment = shader.fragmentShader
            .replace('void main() {', FRAGMENT_MAIN)
            .replace('#include <bumpmap_pars_fragment>', LEGACY_BUMP_MAP)
            .replace('#include <lights_fragment_begin>', FRAGMENT_CEILING_LIGHTS)
            .replace('#include <fog_fragment>', surface === 'figure' ? FRAGMENT_FOG_FIGURE : FRAGMENT_FOG);
        if (surface === 'wall') fragment = fragment.replace('#include <map_fragment>', FRAGMENT_WALL);
        if (surface === 'floor') fragment = fragment.replace('#include <map_fragment>', FRAGMENT_FLOOR);
        if (surface === 'ceiling') fragment = fragment.replace('#include <map_fragment>', FRAGMENT_CEILING).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAGMENT_CEILING_GLOW}`);
        if (surface === 'fixture') fragment = fragment.replace('#include <color_fragment>', FRAGMENT_FIXTURE);
        if (surface === 'decal') fragment = fragment.replace('#include <opaque_fragment>', FRAGMENT_WET);
        if (surface === 'balloon') fragment = fragment.replace('#include <emissivemap_fragment>', FRAGMENT_BALLOON);
        if (surface === 'disco') fragment = fragment.replace('#include <emissivemap_fragment>', FRAGMENT_DISCO);
        // Level 1's (see levelOneShading.js).
        if (surface === 'l1wall') fragment = fragment.replace('#include <map_fragment>', FRAGMENT_L1_WALL);
        if (surface === 'l1column') fragment = fragment.replace('#include <map_fragment>', FRAGMENT_L1_COLUMN).replace('#include <emissivemap_fragment>', FRAGMENT_L1_BOUNCE);
        if (surface === 'l1ceiling') fragment = fragment.replace('#include <map_fragment>', FRAGMENT_L1_CEILING).replace('#include <emissivemap_fragment>', FRAGMENT_L1_BOUNCE);
        if (surface === 'l1floor') {
            fragment = L1_FLOOR_DECLARATIONS + fragment
                .replace('#include <map_fragment>', FRAGMENT_L1_FLOOR)
                .replace('#include <normal_fragment_maps>', FRAGMENT_L1_FLOOR_NORMAL)
                .replace('#include <lights_phong_fragment>', FRAGMENT_L1_FLOOR_SPECULAR)
                .replace('#include <opaque_fragment>', FRAGMENT_L1_FLOOR_REFLECTION);
        }
        if (surface === 'l1tube') {
            shader.vertexShader = VERTEX_L1_TUBE_DECLARATIONS + shader.vertexShader.replace('#include <begin_vertex>', VERTEX_L1_TUBE);
            fragment = FRAGMENT_L1_TUBE_DECLARATIONS + fragment.replace('#include <color_fragment>', FRAGMENT_L1_TUBE);
        }
        shader.fragmentShader = (dressable ? '#define BACKROOMS_PARTY\n' : '') + FRAGMENT_DECLARATIONS + shading + FRAGMENT_AFTER_LEVEL + fragment;
    };
    // Keep these programs separate from unpatched materials (and each other, and each level's).
    material.customProgramCacheKey = () => `backrooms-shading-v7-${surface ?? 'plain'}-${level ?? showing}`;
    if (level === null) everyLevel.add(material);
    return material;
}

/**
 * Compiles the materials that show on every level for this one, the one that's showing: they're recompiled the
 * next time they're drawn (three.js keeps a program while anything's using it, so going back is quicker). A level's
 * own surfaces are compiled for it once, and left alone.
 * @param {number} level
 */
export function setShadingLevel(level) {
    if (level === showing) return;
    showing = level;
    for (const material of everyLevel) material.needsUpdate = true;
}

/**
 * Compiles what's in the scene for every level, behind the loading screen: a material keeps each program it's had
 * (three.js drops them only when it's disposed), so after this, changing level never waits for a shader.
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Scene} scene
 * @param {import('three').Camera} camera
 */
export async function compileForEveryLevel(renderer, scene, camera) {
    const was = showing;
    for (const { id } of LEVELS) {
        setShadingLevel(id);
        await renderer.compileAsync(scene, camera);
    }
    setShadingLevel(was);
}

// Decals float a hair in front of the surface they're on; the polygon offset keeps them in front of it in
// the depth buffer at any distance.
export const DECAL_OPTIONS = {
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
};

/**
 * @param {ReturnType<import('./textures.js').loadTextures>} textures
 * @param {import('three').Texture} panelStates
 * @param {number} [maxAnisotropy]
 */
export function createMaterials(textures, panelStates, maxAnisotropy = 1) {
    worldLighting.panelStates.value = panelStates;
    const decalAtlas = createDecalAtlas(maxAnisotropy);
    const partyAtlas = createPartyAtlas(maxAnisotropy);
    const materials = {
        // Level 0's own (see levels.js): its wallpaper, carpet and tiles, compiled for it alone.
        wall: withBackroomsShading(new MeshPhongMaterial({ map: textures.wallpaper }), 'wall', 0),
        baseboard: withBackroomsShading(new MeshPhongMaterial({ map: textures.baseboard, shininess: 0 }), undefined, 0),
        details: withBackroomsShading(new MeshPhongMaterial({ map: createDetailsTexture(), shininess: 8 }), undefined, 0),
        floor: withBackroomsShading(new MeshPhongMaterial({
            color: 0x4a4a4a,
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
        fixture: withBackroomsShading(new MeshBasicMaterial({ vertexColors: true }), 'fixture'),
        // Where the walls meet the floor, the ceiling and each other (chunkGeometry.js): a soft dark edge.
        shade: withBackroomsShading(new MeshBasicMaterial({ color: 0x0e0b06, alphaMap: createShadeTexture(), ...DECAL_OPTIONS })),
        // Wet carpet (decals.js) and peeling wallpaper (peels.js). A little shine, so the wet carpet glistens
        // in the flashlight too.
        decal: withBackroomsShading(new MeshPhongMaterial({ map: decalAtlas, specular: 0x2a2a2a, shininess: 40, ...DECAL_OPTIONS }), 'decal'),
        // Stains on the ceiling take the ceiling's own shade (see Lighting.setCeilingLights).
        ceilingDecal: withBackroomsShading(new MeshPhongMaterial({ color: CEILING_COLOR_DIM, map: decalAtlas, shininess: 0, ...DECAL_OPTIONS })),
        // Objects left on the floor (props.js): coloured by their vertices, with pictures where needed.
        prop: withBackroomsShading(new MeshPhongMaterial({ map: createPropAtlas(maxAnisotropy), vertexColors: true, shininess: 18 })),
        // Edit mode outlines: something that would be built, and something that's already there.
        highlight: new LineBasicMaterial({ color: 0xfff3a8, transparent: true, opacity: 0.9 }),
        selection: new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }),
        party: createPartyMaterials(textures, partyAtlas, maxAnisotropy),
    };
    return {
        ...materials,
        /**
         * Each level's surfaces, by its number (see levels.js): the walls, floor, ceiling and fittings, and the
         * materials of its own meshes (its `extras`, by name), and which of those cast shadows.
         * @type {LevelSurfaces[]}
         */
        levels: LEVELS.map((level) => level.surfaces(materials, maxAnisotropy, level.id)),
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
 */

/**
 * Level Fun's (see party.js): its wallpaper (swapped onto the walls while it's on), what it builds and puts
 * down, what's drawn on the walls, the balloons, candle flames, the mirror balls, the confetti in the air, and
 * the chalk face the thing on a tape wears to the party.
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
        flame: withBackroomsShading(new MeshBasicMaterial({ vertexColors: true })),
        disco: withBackroomsShading(new MeshPhongMaterial({ color: 0x9d9ea6, specular: 0xffffff, shininess: 120, flatShading: true }), 'disco'),
        confetti: withBackroomsShading(new MeshPhongMaterial({ side: DoubleSide, specular: 0x404040, shininess: 40 })),
        chalk: withBackroomsShading(new MeshBasicMaterial({ map: atlas, color: 0xe6e6e0, transparent: true, depthWrite: false }), 'figure'),
    };
}

/**
 * How dark the shade strips are, from the join (v = 0) out to nothing (v = 1): one column each for the foot
 * of a wall, the top of a wall, an inside corner and the shadow under a prop. Read as an alpha map (its
 * green channel).
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
 * Small details, drawn rather than loaded: a wall outlet (left half) and a ceiling vent grille (right half).
 * Colours are in the same range as the wallpaper and ceiling textures so they sit in the scene.
 */
function createDetailsTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

    // Outlet: an off-white plate with two sockets, each two slots.
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

    // Vent: a grille of slats in a frame.
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
