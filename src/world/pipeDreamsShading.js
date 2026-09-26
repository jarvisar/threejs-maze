import { ShaderChunk } from 'three';
import { VIEW_DISTANCE } from '../config.js';
import { FIRE_RANGE, FIRE_Y, LOOK_BLOCK, LOOK_BRICK, STEAM_SHIFT } from './pipeDreams.js';

/*
 * Level 2's shaders: the air, the fire, and its surfaces (see pipeDreams.js). These are pieces of GLSL that materials.js
 * puts into three.js' own shaders: PIPE_DREAMS_SHADING into everything drawn while Level 2 is showing (see
 * levelShading.js), and the rest into its own surfaces (PIPE_DREAMS_SURFACES). They share the ceiling lights, the panel
 * states and the haze with every level.
 *
 * The air is hot and wet: steam gathers under the ceiling, thickest right up by it and drifting, so the tops of the
 * walls and the pipes up there go soft, and every bulb glows in it (worked out like Level 1's, see levelOneShading.js).
 * How much steam there is follows where you are: more in the steam tunnels, most in the brick passages and over the
 * vents (the cells' first byte; see pipeDreams.js).
 *
 * The boilers' fires light what's in front of them, flickering, power or no power (LEVEL_DIRECT): each cell near one
 * knows where it is (the cells' second and third bytes), so one lookup finds it.
 *
 * The walls are painted concrete in the tunnels, old brick in the steam tunnels and painted block in the plant halls,
 * all of it streaked with rust, sooted near the ceiling and damp at the foot. The floor is dirty concrete (brick in the
 * steam tunnels, painted in the halls) with a drain along some tunnels, and water standing in its low spots, which
 * reflects the room like Level 1's puddles.
 */

/** How the steam hangs: its thickness up by the ceiling, and how far down it reaches. */
const STEAM_DENSITY = 0.3;
const STEAM_HEIGHT = 0.2;

/** The lamps' colours and the fires' flicker. Follows PANEL_LIGHT_GLSL. */
export const PIPE_DREAMS_LAMP_GLSL = /* glsl */ `
// The colour of the bulb in a light slot, from its fourth byte (see pipeDreams.js): a plain bulb, sodium, a cold
// fluorescent tube, or red.
vec3 pipeLamp( float code ) {
	float byte = floor( code * 255.0 + 0.5 );
	if ( byte > 254.5 ) return vec3( 1.0 );
	if ( byte > 253.5 ) return vec3( 1.25, 0.74, 0.34 );
	if ( byte > 252.5 ) return vec3( 0.7, 0.92, 1.25 );
	if ( byte > 251.5 ) return vec3( 1.8, 0.2, 0.12 );
	return vec3( 1.0 );
}

// A fire's flicker, 0.5 to 1.1: never out, never still. Every fire has its own (phase, 0..1).
float pipeFire( float phase ) {
	float t = lightTime * 1.7 + phase * 61.0;
	float slow = sin( t * 1.3 ) * sin( t * 0.47 + 1.9 );
	float quick = backroomsNoise( vec2( t * 4.1, phase * 97.0 ) ) - 0.5;
	return 0.8 + 0.14 * slow + 0.34 * quick;
}
`;

/** The lamps, the fires, and how steamy it is round a point. Follows PANEL_LIGHT_GLSL. */
export const PIPE_DREAMS_GLSL = /* glsl */ `
uniform float mistLevel;
uniform vec4 flashlightBeam;
uniform vec3 flashlightAim;
${PIPE_DREAMS_LAMP_GLSL}

// How steamy a cell is, 0..1 (the top two bits of its first byte).
float pipeSteamOf( vec2 cell ) {
	return floor( floor( cellState( cell ).r * 255.0 + 0.5 ) / ${1 << STEAM_SHIFT}.0 ) / 3.0;
}

// How steamy it is at a point, blended between the four nearest cells' middles.
float pipeSteam( vec2 xz ) {
	vec2 i = floor( xz );
	vec2 f = xz - i;
	return mix( mix( pipeSteamOf( i ), pipeSteamOf( i + vec2( 1.0, 0.0 ) ), f.x ), mix( pipeSteamOf( i + vec2( 0.0, 1.0 ) ), pipeSteamOf( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
`;

/** The glow of the bulbs in the air. After PIPE_DREAMS_GLSL, with the ceiling lights' uniforms. */
export const PIPE_DREAMS_GLOW_GLSL = /* glsl */ `
// The light the steam and haze scatter towards the eye along the line of sight (see levelOneGlow): the bulbs nearest
// the eye, which shine every way.
vec3 pipeGlow( vec3 eye, vec3 dir, float dist ) {
	if ( gridLightIntensity <= 0.0 ) return vec3( 0.0 );
	vec2 first = floor( ( eye.xz - 1.0 ) * 0.5 ) - 1.0;
	vec3 sum = vec3( 0.0 );
	for ( int ix = 0; ix < 4; ix ++ ) {
		for ( int iz = 0; iz < 4; iz ++ ) {
			vec2 panel = first + vec2( ix, iz );
			vec3 light = vec3( panel.x * 2.0 + 1.0, gridLightHeight, panel.y * 2.0 + 1.0 );
			vec3 toLight = light - eye;
			float window = 1.0 - smoothstep( 2.3, 3.2, max( abs( toLight.x ), abs( toLight.z ) ) );
			if ( window <= 0.0 ) continue;
			vec4 state = panelState( panel );
			float lit = state.r * panelFlicker( state.b ) * ( 1.0 - blackout ) * window;
			if ( lit <= 0.0 ) continue;
			float along = dot( toLight, dir );
			float h = sqrt( max( dot( toLight, toLight ) - along * along, 0.0 ) + 0.012 );
			float scattered = min( ( atan( ( dist - along ) / h ) - atan( - along / h ) ) / h, 6.0 );
			sum += pipeLamp( state.a ) * lit * scattered;
		}
	}
	return sum * gridLightColor * ( 0.005 * gridLightIntensity );
}
`;

/**
 * How much of the steam there is between the eye and p, dist away (0..1): gathered under the ceiling, exponential in
 * height the other way up from Level 1's mist, integrated along the line of sight, thicker and thinner where it drifts.
 * `steam` is how steamy it is where the eye is. After PIPE_DREAMS_GLSL.
 */
export const PIPE_DREAMS_STEAM_GLSL = /* glsl */ `
float pipeSteamAmount( vec3 eye, vec3 p, float dist, float steam ) {
	float k = 1.0 / ${STEAM_HEIGHT};
	float a = exp( ( min( eye.y, 1.0 ) - 1.0 ) * k );
	float b = exp( ( min( p.y, 1.0 ) - 1.0 ) * k );
	float dy = p.y - eye.y;
	float thickness = abs( dy ) > 1e-3 ? ( b - a ) / ( dy * k ) : a;
	vec2 wind = vec2( lightTime * 0.07, - lightTime * 0.03 );
	float drift = backroomsNoise( p.xz * 0.9 + wind ) * 0.6 + backroomsNoise( p.xz * 2.6 - wind * 1.7 + 5.0 ) * 0.4;
	return ( 1.0 - exp( - ${STEAM_DENSITY} * ( 0.4 + 1.6 * steam ) * dist * thickness * ( 0.25 + 1.5 * drift ) ) ) * mistLevel;
}

// The flashlight's beam, seen in the steam (and a little in the haze), along dir: brightest down its middle.
vec3 pipeBeam( vec3 dir, float amount, float fogFactor ) {
	float beam = flashlightBeam.w * smoothstep( 0.86, 0.97, dot( dir, flashlightAim ) );
	return vec3( 0.55, 0.53, 0.48 ) * beam * ( amount * 1.6 + fogFactor * 0.12 );
}
`;

/** The air: the steam under the ceiling, the haze, and the glow of the bulbs in them. */
const PIPE_DREAMS_AIR_GLSL = /* glsl */ `
${PIPE_DREAMS_GLOW_GLSL}
${PIPE_DREAMS_STEAM_GLSL}

vec3 pipeAir( vec3 color, vec3 haze, float fogFactor, float area ) {
	vec3 eye = cameraPosition;
	vec3 p = vBackroomsWorldPosition;
	vec3 ray = p - eye;
	float dist = max( length( ray ), 1e-4 );
	vec3 dir = ray / dist;
	float steam = pipeSteam( eye.xz );
	float amount = pipeSteamAmount( eye, p, dist, steam );
	vec3 steamColor = vec3( 0.5, 0.45, 0.38 ) * ( 0.02 + 0.8 * area );
	color = mix( color, steamColor, amount );
	// All haze by the far end of the view, so what's lit out there meets what's past it (the backdrop) without an edge:
	// down a long tunnel there's a bulb every other cell, and the haze alone leaves too much of them.
	float depth = - ( viewMatrix * vec4( p, 1.0 ) ).z;
	fogFactor = max( fogFactor, smoothstep( ${(VIEW_DISTANCE * 0.7).toFixed(2)}, ${(VIEW_DISTANCE - 0.2).toFixed(2)}, depth ) );
	color = mix( color, haze, fogFactor );
	color += pipeBeam( dir, amount, fogFactor );
	return color + pipeGlow( eye, dir, dist ) * ( 1.0 - 0.6 * fogFactor ) * ( 0.6 + 0.8 * steam );
}
`;

/**
 * What's seen past the far end of the view (see createBackdropMaterial in pipeDreamsMaterials.js): the air as it is
 * for a surface out at the far end, which is all haze, and what's in front of that: the steam in the flashlight's beam,
 * and the glow of the bulbs along the way. After PIPE_DREAMS_GLSL, PIPE_DREAMS_GLOW_GLSL and PIPE_DREAMS_STEAM_GLSL.
 */
export const PIPE_DREAMS_BACKDROP_GLSL = /* glsl */ `
vec3 pipeBackdrop( vec3 haze, vec3 dir ) {
	vec3 eye = cameraPosition;
	float steam = pipeSteam( eye.xz );
	float far = ${VIEW_DISTANCE.toFixed(1)};
	float amount = pipeSteamAmount( eye, eye + dir * far, far, steam );
	return haze + pipeBeam( dir, amount, 1.0 ) + pipeGlow( eye, dir, far ) * 0.4 * ( 0.6 + 0.8 * steam );
}
`;

/** Where the fire lighting a point is, and how much of it gets there (see LEVEL_DIRECT). */
const PIPE_DREAMS_FIRE_GLSL = /* glsl */ `
const vec3 FIRE_COLOR = vec3( 1.0, 0.42, 0.11 );

// A fire's own flicker (see firePhase in pipeDreams.js): from where it is, in sixteenths.
float pipeFirePhase( vec2 at ) {
	ivec2 q = ivec2( floor( at * 16.0 + 0.5 ) );
	return float( backroomsHash( uint( q.x ) * 73856093u ^ uint( q.y ) * 19349663u ) & 255u ) / 255.0;
}

// The light of the nearest boiler's fire at p, if one's near enough (the cell's second and third bytes: where the fire
// is from its middle, and which way its firebox faces); toFire is the way to it.
vec3 pipeFireLight( vec3 p, out vec3 toFire ) {
	toFire = vec3( 0.0, 1.0, 0.0 );
	vec2 cell = floor( p.xz + 0.5 );
	vec4 state = cellState( cell );
	float bx = floor( state.g * 255.0 + 0.5 );
	float bz = floor( state.b * 255.0 + 0.5 );
	if ( bx + bz < 0.5 ) return vec3( 0.0 );
	vec2 at = cell + vec2( mod( bx, 128.0 ) - 64.0, mod( bz, 128.0 ) - 64.0 ) / 16.0;
	vec2 facing = bx > 127.5 ? vec2( 0.0, bz > 127.5 ? 1.0 : -1.0 ) : vec2( bz > 127.5 ? 1.0 : -1.0, 0.0 );
	// (Its light comes from a little out of the door and up, so it's thrown on the floor in front.)
	vec3 d = vec3( at.x + facing.x * 0.2, ${FIRE_Y} + 0.06, at.y + facing.y * 0.2 ) - p;
	float distance = max( length( d ), 1e-3 );
	toFire = d / distance;
	// Only out of the front of the firebox (the rest is boiler), and none of it through the floor.
	float front = smoothstep( -0.12, 0.3, dot( - d.xz, facing ) );
	float reach = max( 1.0 - distance / ${FIRE_RANGE}, 0.0 );
	return FIRE_COLOR * ( 2.6 * reach * reach * front * pipeFire( pipeFirePhase( at ) ) );
}
`;

/** Level 2's part of every shader compiled for it (see levelShading.js). */
export const PIPE_DREAMS_SHADING = /* glsl */ `
${PIPE_DREAMS_GLSL}
${PIPE_DREAMS_AIR_GLSL}
${PIPE_DREAMS_FIRE_GLSL}

vec3 levelLightTint( float code ) {
	return pipeLamp( code );
}

vec3 levelAir( vec3 color, vec3 haze, float fogFactor, float area ) {
	return pipeAir( color, haze, fogFactor, area );
}

// A dead bulb: dark glass, only as light as the room round it.
const vec3 LEVEL_DEAD_LIGHT = vec3( 0.2, 0.19, 0.17 );
#define LEVEL_DEAD_LIGHT_SHADED

// The fires (see pipeFireLight): their light on everything in front of them, and a little of it thrown about.
#define LEVEL_DIRECT { \\
	vec3 levelToFire; \\
	vec3 levelFire = pipeFireLight( vBackroomsWorldPosition, levelToFire ); \\
	if ( levelFire.r > 0.0 ) { \\
		IncidentLight levelLight; \\
		levelLight.visible = true; \\
		levelLight.direction = normalize( ( viewMatrix * vec4( levelToFire, 0.0 ) ).xyz ); \\
		levelLight.color = levelFire * PI; \\
		RE_Direct( levelLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight ); \\
		reflectedLight.indirectDiffuse += material.diffuseColor * levelFire * 0.2; \\
	} \\
}
`;

// ---------------------------------------------------------------------------------------------- surfaces

/**
 * The look of the cell a face is in front of (its first byte's low bits: concrete, brick or block), found from the
 * face's own normal; the face's position along it and its height; and the grain texture's grey. Sets pipeRelief, the
 * brick's or block's relief, for the normal.
 */
const FRAGMENT_WALL = /* glsl */ `
#include <map_fragment>
float pipeRelief = 0.0;
{
	vec3 p = vBackroomsWorldPosition;
	vec3 faceNormal = normalize( cross( dFdx( p ), dFdy( p ) ) );
	if ( dot( faceNormal, cameraPosition - p ) < 0.0 ) faceNormal = - faceNormal;
	vec2 cell = floor( p.xz + faceNormal.xz * 0.2 + 0.5 );
	float byte = floor( cellState( cell ).r * 255.0 + 0.5 );
	// (What faces up is bare concrete, whatever the walls are: the tops of the ledges.)
	float level = abs( faceNormal.y );
	float look = level > 0.5 ? -1.0 : mod( byte, 4.0 );
	float along = abs( faceNormal.x ) > 0.5 ? p.z : p.x;
	float up = abs( faceNormal.y ) > 0.5 ? p.z + p.x * 0.37 : p.y;
	float grain = diffuseColor.r;
	float pixel = max( length( fwidth( p ) ), 1e-4 );
	vec3 color;
	// Streaks run down from the pipes' brackets; soot rises up from the bulbs; the damp comes up from the floor. (Their
	// noise only where they can be.)
	float streak = 0.0;
	if ( p.y > 0.02 && p.y < 0.95 ) {
		streak = smoothstep( 0.55, 0.92, backroomsNoise( vec2( along * 8.0, p.y * 0.8 + 3.0 ) ) ) * smoothstep( 0.02, 0.4, p.y ) * ( 1.0 - smoothstep( 0.86, 0.95, p.y ) );
		if ( streak > 0.0 ) streak *= 0.4 + 0.6 * backroomsNoise( vec2( along * 1.1, 7.0 ) );
	}
	float soot = 0.0;
	if ( p.y > 0.62 ) soot = smoothstep( 0.62, 1.0, p.y ) * ( 0.55 + 0.45 * backroomsNoise( vec2( along * 1.7, p.y * 2.0 ) ) );
	float tide = 0.08 + 0.14 * backroomsNoise( vec2( along * 1.6, 1.3 ) );
	float damp = 1.0 - smoothstep( tide - 0.04, tide, p.y );
	if ( look < 0.0 ) {
		color = vec3( 0.3, 0.28, 0.26 ) * ( 0.65 + 0.7 * grain ) * ( 0.8 + 0.4 * backroomsNoise( p.xz * 3.0 ) );
	} else if ( look < ${LOOK_BRICK}.0 - 0.5 ) {
		// Painted concrete: a dark green dado to about a metre, a red line along its top, cream above; in places
		// never painted, and everywhere the paint flaking off.
		float bare = smoothstep( 0.62, 0.7, backroomsNoise( p.xz * 0.045 + 11.0 ) );
		vec3 paint = p.y < 0.315 ? vec3( 0.16, 0.21, 0.18 ) : p.y < 0.33 ? vec3( 0.34, 0.09, 0.06 ) : vec3( 0.5, 0.46, 0.37 );
		// Flaking in patches, where the damp's got in.
		float peeling = smoothstep( 0.45, 0.75, backroomsNoise( vec2( along * 0.9, p.y * 1.6 + 17.0 ) ) ) + 0.5 * damp;
		float cracks = backroomsNoise( vec2( along * 11.0, p.y * 14.0 ) ) * 0.7 + backroomsNoise( vec2( along * 37.0, p.y * 41.0 ) ) * 0.3;
		float flake = smoothstep( 0.8, 0.83, cracks + 0.25 * peeling );
		vec3 concrete = vec3( 0.36, 0.34, 0.31 ) * ( 0.7 + 0.6 * grain );
		color = mix( paint * ( 0.85 + 0.3 * grain ), concrete, max( flake, bare ) );
		// The paint's broken edge catches the light.
		float edge = smoothstep( 0.76, 0.8, cracks + 0.25 * peeling ) - flake;
		color += vec3( 0.04 ) * edge * ( 1.0 - bare );
		// Years of dirt, unevenly.
		color *= 0.72 + 0.3 * backroomsNoise( vec2( along * 0.6, p.y * 0.9 + 3.0 ) ) + 0.1 * backroomsNoise( vec2( along * 3.0, p.y * 4.0 ) );
	} else if ( look < ${LOOK_BLOCK}.0 - 0.5 ) {
		// Brick, laid in stretcher bond: muddy browns and some gone black, the mortar pale and crumbling.
		vec2 size = vec2( 0.085, 0.032 );
		vec2 q = vec2( along, up ) / size;
		float row = floor( q.y );
		q.x += mod( row, 2.0 ) * 0.5;
		vec2 id = vec2( floor( q.x ), row );
		vec2 f = fract( q );
		vec2 toEdge = min( f, 1.0 - f ) * size;
		float detail = 1.0 - smoothstep( 0.004, 0.012, pixel );
		float mortar = ( 1.0 - smoothstep( 0.0028, 0.0045 + pixel * 0.5, min( toEdge.x, toEdge.y ) ) ) * detail;
		uint h = backroomsHash( uint( int( id.x ) ) * 2654435761u ^ uint( int( id.y ) ) * 2246822519u ^ 40503u );
		float shade = float( h & 255u ) / 255.0;
		vec3 brick = mix( vec3( 0.27, 0.16, 0.1 ), vec3( 0.15, 0.095, 0.065 ), shade );
		if ( ( ( h >> 8u ) % 6u ) == 0u ) brick = vec3( 0.09, 0.08, 0.07 );
		else if ( ( ( h >> 11u ) & 15u ) == 1u ) brick = vec3( 0.33, 0.19, 0.12 );
		brick = mix( vec3( 0.2, 0.13, 0.09 ), brick, detail );
		color = mix( brick, vec3( 0.26, 0.24, 0.21 ), mortar ) * ( 0.75 + 0.5 * grain );
		// White salts drying out of it low down, and a black crust higher up.
		float salts = smoothstep( 0.55, 0.8, backroomsNoise( vec2( along * 3.0, p.y * 5.0 ) ) ) * ( 1.0 - smoothstep( 0.05, 0.4, p.y ) );
		color = mix( color, vec3( 0.62, 0.6, 0.55 ), salts * 0.55 );
		color *= 1.0 - 0.6 * smoothstep( 0.42, 0.72, backroomsNoise( vec2( along * 0.8, p.y * 1.5 + 4.0 ) ) );
		pipeRelief = ( 1.0 - mortar ) * detail;
	} else {
		// Painted block: grey-green below, off-white above, a worn yellow line between.
		vec2 size = vec2( 0.148, 0.074 );
		vec2 q = vec2( along, up ) / size;
		float row = floor( q.y );
		q.x += mod( row, 2.0 ) * 0.5;
		vec2 toEdge = min( fract( q ), 1.0 - fract( q ) ) * size;
		float detail = 1.0 - smoothstep( 0.006, 0.016, pixel );
		float joint = ( 1.0 - smoothstep( 0.002, 0.004 + pixel * 0.5, min( toEdge.x, toEdge.y ) ) ) * detail;
		vec3 paint = p.y < 0.37 ? vec3( 0.26, 0.31, 0.28 ) : p.y < 0.39 ? vec3( 0.5, 0.38, 0.08 ) : vec3( 0.56, 0.54, 0.49 );
		color = paint * ( 0.85 + 0.3 * grain ) * ( 1.0 - 0.28 * joint );
		float flake = smoothstep( 0.8, 0.83, backroomsNoise( vec2( along * 13.0, p.y * 16.0 ) ) * 0.7 + backroomsNoise( vec2( along * 1.1, p.y * 1.4 + 9.0 ) ) * 0.3 + 0.2 * damp );
		color = mix( color, vec3( 0.5, 0.49, 0.46 ) * ( 0.7 + 0.6 * grain ), flake );
		pipeRelief = ( 1.0 - joint ) * 0.5 * detail;
	}
	color *= 1.0 - 0.38 * streak;
	color = mix( color, color * vec3( 0.75, 0.55, 0.4 ), streak * 0.6 );
	color *= 1.0 - 0.55 * soot;
	color *= 1.0 - 0.3 * damp;
	diffuseColor.rgb = color;
}
`;

// The relief from FRAGMENT_WALL, on top of the grain's (see bumpmap_pars_fragment).
const NORMAL_WALL = ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd()', '( dHdxy_fwd() + vec2( dFdx( pipeRelief ), dFdy( pipeRelief ) ) * 0.004 )');

if (import.meta.env?.DEV && NORMAL_WALL === ShaderChunk.normal_fragment_maps) {
    console.warn('pipeDreamsShading.js: the relief patch no longer applies to this three.js version.');
}

/**
 * The floor: dirty concrete (brick pavers in the steam tunnels, worn paint in the plant halls), a drain along one side
 * of some tunnels under a steel grating, and water standing in its low spots. Sets pipeWater (0..1) and pipeTilt (the
 * water's ripples).
 */
const FRAGMENT_FLOOR = /* glsl */ `
#include <map_fragment>
float pipeWater = 0.0;
vec2 pipeTilt = vec2( 0.0 );
float pipeMetal = 0.0;
{
	vec2 p = vBackroomsWorldPosition.xz;
	vec2 cell = floor( p + 0.5 );
	float byte = floor( cellState( cell ).r * 255.0 + 0.5 );
	float look = mod( byte, 4.0 );
	float grain = diffuseColor.r;
	float pixel = max( length( fwidth( p ) ), 1e-4 );
	float mottle = backroomsNoise( p * 0.4 ) * 0.6 + backroomsNoise( p * 1.5 + 7.0 ) * 0.4;
	vec3 color = vec3( 0.25, 0.23, 0.21 ) * ( 0.65 + 0.7 * grain ) * ( 0.75 + 0.45 * mottle );
	if ( look > ${LOOK_BRICK}.0 - 0.5 && look < ${LOOK_BRICK}.0 + 0.5 ) {
		// Brick pavers, worn round.
		vec2 size = vec2( 0.2, 0.1 );
		vec2 q = p / size;
		q.x += mod( floor( q.y ), 2.0 ) * 0.5;
		vec2 toEdge = min( fract( q ), 1.0 - fract( q ) ) * size;
		float detail = 1.0 - smoothstep( 0.006, 0.02, pixel );
		float joint = ( 1.0 - smoothstep( 0.002, 0.006 + pixel, min( toEdge.x, toEdge.y ) ) ) * detail;
		uint h = backroomsHash( uint( int( floor( q.x ) ) ) * 2654435761u ^ uint( int( floor( q.y ) ) ) * 2246822519u );
		color = mix( vec3( 0.19, 0.12, 0.085 ), vec3( 0.11, 0.075, 0.055 ), float( h & 255u ) / 255.0 ) * ( 0.7 + 0.6 * grain ) * ( 0.75 + 0.45 * mottle );
		color *= 1.0 - 0.5 * joint;
	} else if ( look > ${LOOK_BLOCK}.0 - 0.5 ) {
		// Painted, and worn through where people walked.
		float worn = smoothstep( 0.45, 0.75, backroomsNoise( p * 0.9 + 3.0 ) * 0.7 + backroomsNoise( p * 6.0 ) * 0.3 );
		color = mix( vec3( 0.26, 0.31, 0.28 ) * ( 0.8 + 0.4 * grain ), color, worn );
	}
	// Oil and the black stuff trodden about.
	{
		uint h = backroomsHash( uint( int( cell.x ) ) * 374761393u ^ uint( int( cell.y ) ) * 668265263u );
		if ( ( h & 15u ) == 0u ) {
			vec2 centre = cell + ( vec2( float( ( h >> 4u ) & 15u ), float( ( h >> 8u ) & 15u ) ) / 15.0 - 0.5 ) * 0.5;
			float d = length( ( p - centre ) * vec2( 1.0, 1.3 ) ) + ( backroomsNoise( p * 16.0 ) - 0.5 ) * 0.07;
			color *= 1.0 - 0.6 * ( 1.0 - smoothstep( 0.05, 0.16 + 0.1 * float( ( h >> 12u ) & 7u ) / 7.0, d ) );
		}
	}
	// A drain along the tunnel, near one wall, under a grating: bars across it over the dark, water running below.
	float drainX = mod( floor( byte / 4.0 ), 2.0 );
	float drainZ = mod( floor( byte / 8.0 ), 2.0 );
	if ( drainX + drainZ > 0.5 ) {
		float side = mod( floor( byte / 16.0 ), 2.0 ) * 2.0 - 1.0;
		float across = drainX > 0.5 ? p.y - cell.y : p.x - cell.x;
		float run = drainX > 0.5 ? p.x : p.y;
		float centre = side * 0.33;
		float d = abs( across - centre );
		if ( d < 0.075 ) {
			float frame = smoothstep( 0.058, 0.062, d );
			float bars = 1.0 - smoothstep( 0.2, 0.2 + pixel * 40.0, abs( fract( run * 40.0 ) - 0.5 ) );
			float detail = 1.0 - smoothstep( 0.01, 0.03, pixel );
			float steel = max( frame, mix( 0.45, bars, detail ) );
			float rust = backroomsNoise( vec2( run * 9.0, across * 30.0 ) );
			vec3 metal = mix( vec3( 0.34, 0.33, 0.3 ), vec3( 0.34, 0.2, 0.1 ), smoothstep( 0.4, 0.8, rust ) );
			// Below the bars: dark, with the water in the bottom catching the light as it runs.
			float flow = backroomsNoise( vec2( run * 6.0 - lightTime * 1.3, across * 40.0 ) );
			vec3 below = vec3( 0.015, 0.014, 0.012 ) + vec3( 0.05, 0.045, 0.04 ) * smoothstep( 0.6, 0.9, flow ) * backroomsArea;
			color = mix( below, metal, steel );
			pipeMetal = steel;
		}
	}
	// Standing water in the low spots, wetter in the steam tunnels.
	float steam = floor( byte / ${1 << STEAM_SHIFT}.0 ) / 3.0;
	float n = backroomsNoise( p * 0.27 + vec2( 3.3, 8.1 ) ) * 0.6 + backroomsNoise( p * 0.8 + vec2( 9.4, 2.2 ) ) * 0.3 + backroomsNoise( p * 2.4 ) * 0.1;
	pipeWater = smoothstep( 0.6 - 0.1 * steam, 0.72 - 0.1 * steam, n ) * ( 1.0 - pipeMetal );
	color *= 1.0 - 0.4 * smoothstep( 0.0, 0.5, pipeWater ) - 0.2 * smoothstep( 0.6, 1.0, pipeWater );
	if ( pipeWater > 0.55 ) pipeTilt = levelTwoRipples( p ) * smoothstep( 0.55, 0.8, pipeWater );
	diffuseColor.rgb = color;
}
`;

/** Ripples where drops land in the standing water (as Level 1's; see levelOneShading.js). */
const RIPPLES_GLSL = /* glsl */ `
vec2 levelTwoRipples( vec2 p ) {
	vec2 tilt = vec2( 0.0 );
	vec2 base = floor( p * 1.6 - 0.5 );
	for ( int i = 0; i < 2; i ++ ) {
		for ( int j = 0; j < 2; j ++ ) {
			vec2 cell = base + vec2( i, j );
			uint h = backroomsHash( uint( int( cell.x ) ) * 73856093u ^ uint( int( cell.y ) ) * 19349663u ^ 4271u );
			if ( ( h & 3u ) != 0u ) continue;
			vec2 centre = ( cell + vec2( float( ( h >> 2u ) & 255u ), float( ( h >> 10u ) & 255u ) ) / 255.0 ) / 1.6;
			float period = 1.2 + 2.4 * float( ( h >> 18u ) & 63u ) / 63.0;
			float t = fract( lightTime / period + float( ( h >> 24u ) & 255u ) / 255.0 ) * period;
			vec2 away = p - centre;
			float d = length( away );
			float front = d - t * 0.3;
			float ring = sin( front * 70.0 ) * exp( - abs( front ) * 30.0 ) * exp( - t * 1.6 );
			tilt += away / max( d, 1e-3 ) * ring;
		}
	}
	return tilt * 0.35;
}
`;

const FLOOR_DECLARATIONS = /* glsl */ `
uniform sampler2D reflectionMap;
uniform mat4 reflectionMatrix;
uniform float reflectionOn;
`;

/** Standing water is flat (the concrete's bumps don't show through it), and rippled. */
const NORMAL_FLOOR = /* glsl */ `
#include <normal_fragment_maps>
{
	float still = smoothstep( 0.6, 0.85, pipeWater );
	vec3 waterNormal = normalize( ( viewMatrix * vec4( - pipeTilt.x, 1.0, - pipeTilt.y, 0.0 ) ).xyz );
	normal = normalize( mix( normal, waterNormal, still ) );
}
`;

/** Wet concrete shines a little, standing water sharply (its reflection does the rest), and the grating's steel. */
const SPECULAR_FLOOR = /* glsl */ `
#include <lights_phong_fragment>
material.specularShininess = mix( mix( 24.0, 60.0, pipeMetal ), 500.0, smoothstep( 0.4, 0.9, pipeWater ) );
material.specularStrength = mix( mix( 0.04, 0.3, pipeMetal ), reflectionOn > 0.5 ? 0.01 : 0.05, smoothstep( 0.5, 0.9, pipeWater ) );
`;

/** What the water shows: the room, if there's a reflection (see Reflection.js), else the bulbs overhead. */
const REFLECTION_FLOOR = /* glsl */ `
if ( pipeWater > 0.02 ) {
	vec3 toEye = normalize( cameraPosition - vBackroomsWorldPosition );
	float cosine = clamp( toEye.y, 0.0, 1.0 );
	float still = smoothstep( 0.55, 0.85, pipeWater );
	float fresnel = 0.04 + 0.96 * pow( 1.0 - cosine, 5.0 );
	vec3 mirrored = vec3( 0.0 );
	if ( reflectionOn > 0.5 ) {
		vec4 clip = reflectionMatrix * vec4( vBackroomsWorldPosition, 1.0 );
		vec2 uv = clip.xy / clip.w + pipeTilt * 0.04 * ( 0.4 + still );
		float blur = ( 1.0 - still ) * 0.012;
		mirrored = texture2D( reflectionMap, uv ).rgb * 0.5 + texture2D( reflectionMap, uv + vec2( 0.0, blur ) ).rgb * 0.25 + texture2D( reflectionMap, uv - vec2( 0.0, blur * 2.0 ) ).rgb * 0.25;
	} else {
		vec3 bounce = vec3( - toEye.x + pipeTilt.x * 0.5, toEye.y, - toEye.z + pipeTilt.y * 0.5 );
		vec2 hit = vBackroomsWorldPosition.xz + bounce.xz / max( bounce.y, 0.03 ) * ( gridLightHeight - vBackroomsWorldPosition.y );
		vec2 panel = floor( ( hit - 1.0 ) * 0.5 + 0.5 );
		vec4 state = panelState( panel );
		float lit = state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
		float d = length( hit - ( panel * 2.0 + 1.0 ) );
		float spread = 0.03 + ( 1.0 - still ) * 0.06 + 0.03 * ( 1.0 - cosine );
		float glint = exp( - d * d / ( spread * spread * 2.0 ) );
		mirrored = gridLightColor * pipeLamp( state.a ) * lit * glint * 0.45 + vec3( 0.2, 0.18, 0.15 ) * backroomsArea * 0.2;
	}
	float amount = fresnel * mix( 0.35, 1.0, still ) * smoothstep( 0.05, 0.4, pipeWater );
	outgoingLight = outgoingLight * ( 1.0 - amount * 0.8 ) + mirrored * amount * 1.4;
}
#include <opaque_fragment>
`;

/**
 * The slab: concrete (brick where the walls are), black with soot round every bulb, stained where water's come
 * through.
 */
const FRAGMENT_CEILING = /* glsl */ `
#include <map_fragment>
{
	vec2 p = vBackroomsWorldPosition.xz;
	vec2 cell = floor( p + 0.5 );
	float look = mod( floor( cellState( cell ).r * 255.0 + 0.5 ), 4.0 );
	float grain = diffuseColor.r;
	vec3 color = vec3( 0.32, 0.3, 0.27 ) * ( 0.7 + 0.6 * grain );
	if ( look > ${LOOK_BRICK}.0 - 0.5 && look < ${LOOK_BRICK}.0 + 0.5 ) {
		vec2 q = p / vec2( 0.085, 0.032 );
		q.x += mod( floor( q.y ), 2.0 ) * 0.5;
		vec2 toEdge = min( fract( q ), 1.0 - fract( q ) ) * vec2( 0.085, 0.032 );
		float pixel = max( length( fwidth( p ) ), 1e-4 );
		float detail = 1.0 - smoothstep( 0.004, 0.012, pixel );
		float mortar = ( 1.0 - smoothstep( 0.0028, 0.0045 + pixel * 0.5, min( toEdge.x, toEdge.y ) ) ) * detail;
		color = mix( vec3( 0.18, 0.11, 0.075 ), vec3( 0.22, 0.2, 0.18 ), mortar ) * ( 0.7 + 0.6 * grain );
	}
	vec2 bulb = floor( ( p - 1.0 ) * 0.5 + 0.5 ) * 2.0 + 1.0;
	float d = length( p - bulb ) + ( backroomsNoise( p * 7.0 ) - 0.5 ) * 0.08;
	color *= 1.0 - 0.75 * ( 1.0 - smoothstep( 0.04, 0.34, d ) );
	float stain = smoothstep( 0.66, 0.74, backroomsNoise( p * 0.4 + 13.0 ) );
	color = mix( color, color * vec3( 0.7, 0.55, 0.4 ), stain * 0.7 );
	color *= 0.78 + 0.3 * backroomsNoise( p * 1.3 );
	diffuseColor.rgb = color;
}
`;

/**
 * The ceiling catches the light coming back up off the floor and the walls, so it's never as black as the bulbs alone
 * would leave it; and so do the pipes up by it.
 */
const BOUNCE = /* glsl */ `
#include <emissivemap_fragment>
{
	vec2 nearest = floor( ( vBackroomsWorldPosition.xz - 1.0 ) * 0.5 + 0.5 );
	vec4 panel = panelState( nearest );
	float on = panel.r * panelFlicker( panel.b ) * ( 1.0 - blackout );
	float halo = 1.0 - smoothstep( 0.05, 1.1, length( vBackroomsWorldPosition.xz - ( nearest * 2.0 + 1.0 ) ) );
	float up = smoothstep( 0.72, 0.95, vBackroomsWorldPosition.y );
	totalEmissiveRadiance += diffuseColor.rgb * up * ( 0.16 * backroomsArea + 0.3 * on * halo * halo * pipeLamp( panel.a ) );
}
`;

/**
 * The pipes (and everything else metal): what they're finished in (their finish attribute: see FINISH_* in
 * pipeDreams.js), each worn by its own amount, over the colour they were painted; dust on their tops and dirt
 * underneath. Lagging is canvas over the insulation, strapped every third of a unit (its texture coordinates are how
 * far along the pipe, and round it).
 */
const VERTEX_PIPE_DECLARATIONS = /* glsl */ `
attribute vec2 finish;
varying vec2 vFinish;
`;

const VERTEX_PIPE = /* glsl */ `
#include <begin_vertex>
vFinish = finish;
`;

const FRAGMENT_PIPE_DECLARATIONS = /* glsl */ `
varying vec2 vFinish;
`;

const FRAGMENT_PIPE = /* glsl */ `
#include <color_fragment>
float pipeShine = 0.2;
float pipeSharp = 30.0;
{
	float kind = floor( vFinish.x + 0.5 );
	float wear = vFinish.y;
	vec3 p = vBackroomsWorldPosition;
	vec3 n = normalize( inverseTransformDirection( vNormal, viewMatrix ) );
	vec3 base = diffuseColor.rgb;
	// (Only the finishes that rust work out their rust: paint, rust, galvanised and iron.)
	float rustNoise = 0.0;
	vec3 rust = vec3( 0.0 );
	if ( kind < 1.5 || ( kind > 3.5 && kind < 5.5 ) ) {
		rustNoise = backroomsNoise( vec2( p.x + p.z, p.y ) * 31.0 + wear * 40.0 ) * 0.45 + backroomsNoise( vec2( p.x - p.z, p.y ) * 97.0 ) * 0.3 + backroomsNoise( vec2( p.x + p.z, p.y * 1.7 ) * 260.0 ) * 0.25;
		rust = mix( vec3( 0.2, 0.09, 0.045 ), vec3( 0.46, 0.24, 0.1 ), rustNoise );
	}
	if ( kind < 0.5 ) {
		// Paint, chipped, the rust showing through.
		float chips = smoothstep( 0.74 - wear * 0.14, 0.77 - wear * 0.14, backroomsNoise( vec2( p.x + p.z, p.y ) * 70.0 + wear * 17.0 ) * 0.75 + backroomsNoise( vec2( p.x + p.z, p.y ) * 9.0 ) * 0.25 );
		// (Chipped through to dark primer, rusting at the edges.)
		base = mix( base, mix( vec3( 0.13, 0.11, 0.09 ), rust, 0.35 ), chips );
		pipeShine = mix( 0.28, 0.03, chips );
		pipeSharp = 40.0;
	} else if ( kind < 1.5 ) {
		// Rusted through: scaly, darker in patches.
		base = rust * ( 0.5 + 0.55 * backroomsNoise( vec2( p.x + p.z, p.y ) * 11.0 ) ) * ( 0.8 + 0.4 * backroomsNoise( vec2( p.x - p.z, p.y ) * 170.0 ) );
		pipeShine = 0.03;
		pipeSharp = 8.0;
	} else if ( kind < 2.5 ) {
		// Lagging: canvas, its weave, the straps round it, and years of stains.
		float along = vUv.x;
		float strap = 1.0 - smoothstep( 0.006, 0.009 + fwidth( along ), abs( fract( along / 0.33 ) - 0.5 ) * 0.33 );
		float weave = backroomsNoise( vec2( along * 180.0, vUv.y * 90.0 ) );
		float stain = smoothstep( 0.5, 0.85, backroomsNoise( vec2( along * 2.5, vUv.y * 3.0 + wear * 9.0 ) ) );
		base *= 0.9 + 0.12 * weave;
		base = mix( base, base * vec3( 0.8, 0.7, 0.55 ), stain * ( 0.25 + 0.4 * wear ) );
		base = mix( base, vec3( 0.62, 0.62, 0.6 ), strap );
		pipeShine = mix( 0.02, 0.4, strap );
		pipeSharp = mix( 4.0, 50.0, strap );
	} else if ( kind < 3.5 ) {
		// Copper, going brown, with green where it's wet.
		float patina = smoothstep( 0.6, 0.8, backroomsNoise( vec2( p.x + p.z, p.y ) * 23.0 + 3.0 ) );
		base = mix( base * 0.85, vec3( 0.28, 0.46, 0.36 ), patina * 0.8 );
		pipeShine = mix( 0.55, 0.05, patina );
		pipeSharp = 45.0;
	} else if ( kind < 4.5 ) {
		// Galvanised steel, its spangle, and white rust.
		base *= 0.85 + 0.25 * backroomsNoise( vec2( p.x + p.z, p.y ) * 70.0 );
		base = mix( base, rust, smoothstep( 0.75, 0.85, rustNoise ) * wear );
		pipeShine = 0.35;
		pipeSharp = 26.0;
	} else if ( kind < 5.5 ) {
		// Cast iron: black, rust coming through.
		base = mix( base, rust * 0.7, smoothstep( 0.55, 0.8, rustNoise ) * ( 0.4 + 0.6 * wear ) );
		pipeShine = 0.06;
		pipeSharp = 16.0;
	} else if ( kind < 6.5 ) {
		// Brass, dull.
		base *= 0.8 + 0.3 * backroomsNoise( vec2( p.x + p.z, p.y ) * 40.0 );
		pipeShine = 0.7;
		pipeSharp = 60.0;
	} else {
		// Aluminium cladding over lagging: dented sheets, dull.
		float along = vUv.x;
		float seam = 1.0 - smoothstep( 0.004, 0.007 + fwidth( along ), abs( fract( along / 0.5 ) - 0.5 ) * 0.5 );
		base *= ( 0.85 + 0.2 * backroomsNoise( vec2( along * 9.0, vUv.y * 5.0 ) ) ) * ( 1.0 - 0.3 * seam );
		pipeShine = 0.45;
		pipeSharp = 22.0;
	}
	// Dust settled on top, grime underneath, and the whole lot dirtier near the floor.
	float dust = smoothstep( 0.35, 0.9, n.y ) * ( 0.4 + 0.6 * backroomsNoise( p.xz * 9.0 ) );
	base = mix( base, vec3( 0.38, 0.34, 0.28 ), dust * 0.55 );
	base *= 1.0 - 0.3 * smoothstep( 0.2, 0.9, - n.y );
	pipeShine *= 1.0 - dust;
	// A flat face (a frame, a channel, a plinth) is duller and its shine broader than a pipe's: the shine that's a line
	// down a pipe would cover all of a face turned to the light, and turned to the flashlight, which is at the eye, it
	// would glare white. (Only a flat face has the same normal from pixel to pixel.)
	float flatFace = 1.0 - smoothstep( 1e-4, 1e-3, length( fwidth( vNormal ) ) );
	pipeShine *= 1.0 - 0.75 * flatFace;
	pipeSharp = mix( pipeSharp, min( pipeSharp, 12.0 ), flatFace );
	diffuseColor.rgb = base;
}
`;

const SPECULAR_PIPE = /* glsl */ `
#include <lights_phong_fragment>
material.specularShininess = pipeSharp;
material.specularStrength = pipeShine;
`;

/**
 * A gauge's face (see dial in pipeDreamsGeometry.js), from its texture coordinates: white, its scale round from the
 * bottom left to the bottom right with the last of it red, and the needle, resting where its colour's red says and
 * trembling as much as its green says, in its own time (its blue).
 */
const FRAGMENT_GAUGE = /* glsl */ `
{
	vec3 needle = vColor.rgb;
	vec2 q = vUv * 2.0 - 1.0;
	float r = length( q );
	// From straight up, clockwise.
	float angle = atan( q.x, q.y );
	float pixel = max( fwidth( r ), 1e-3 );
	vec3 face = vec3( 0.86, 0.83, 0.74 );
	float scale = step( abs( angle ), 2.36 );
	float ticks = step( 0.72, r ) * step( r, 0.86 ) * scale * ( 1.0 - smoothstep( 0.1, 0.1 + pixel * 20.0, abs( fract( angle * 3.2 ) - 0.5 ) ) );
	face = mix( face, vec3( 0.1 ), ticks );
	float red = step( 1.4, angle ) * step( angle, 2.36 ) * step( 0.62, r ) * step( r, 0.72 );
	face = mix( face, vec3( 0.7, 0.1, 0.07 ), red );
	float t = lightTime + needle.b * 40.0;
	float value = needle.r + needle.g * ( 0.03 * sin( t * 13.0 ) * sin( t * 3.1 ) + 0.02 * sin( t * 29.0 ) );
	float a = ( value * 2.0 - 1.0 ) * 2.36;
	vec2 along = vec2( sin( a ), cos( a ) );
	float side = abs( dot( q, vec2( along.y, - along.x ) ) );
	float onNeedle = step( -0.12, dot( q, along ) ) * step( dot( q, along ), 0.78 ) * ( 1.0 - smoothstep( 0.03, 0.03 + pixel * 2.0, side ) );
	face = mix( face, vec3( 0.12, 0.05, 0.04 ), onNeedle );
	face = mix( face, vec3( 0.1 ), step( r, 0.09 ) );
	// The rim, dark.
	face *= 1.0 - smoothstep( 0.9, 0.97, r ) * 0.8;
	diffuseColor.rgb = face;
}
`;

/** Fire through a slot in a firebox door: embers stirring, brighter in the middle, its own flicker (its colour's blue). */
const FRAGMENT_FIRE = /* glsl */ `
{
	float phase = vColor.b;
	float flicker = pipeFire( phase );
	vec2 q = vUv;
	float t = lightTime * 1.3 + phase * 20.0;
	float embers = backroomsNoise( vec2( q.x * 9.0 + phase * 30.0, q.y * 3.0 - t * 1.6 ) ) * 0.6 + backroomsNoise( vec2( q.x * 23.0, q.y * 7.0 - t * 3.0 ) ) * 0.4;
	float middle = 1.0 - abs( q.x * 2.0 - 1.0 );
	float heat = clamp( embers * 1.1 + middle * 0.35, 0.0, 1.0 ) * flicker;
	diffuseColor.rgb = mix( vec3( 0.45, 0.06, 0.01 ), mix( vec3( 1.0, 0.42, 0.08 ), vec3( 1.0, 0.85, 0.45 ), smoothstep( 0.7, 1.0, heat ) ), smoothstep( 0.2, 0.7, heat ) ) * ( 0.6 + 0.8 * heat );
}
`;

/**
 * What Level 2's own kinds of surface do to three.js' shaders (see SurfaceShading in levelShading.js): the walls (and
 * ledges), the floor, the ceiling, the pipes and everything metal, the gauges' faces and the fires.
 * @type {Record<string, import('./levelShading.js').SurfaceShading>}
 */
export const PIPE_DREAMS_SURFACES = {
    l2wall: (vertex, fragment) => ({
        vertex,
        fragment: fragment.replace('#include <map_fragment>', FRAGMENT_WALL).replace('#include <normal_fragment_maps>', NORMAL_WALL),
    }),
    l2floor: (vertex, fragment) => ({
        vertex,
        fragment: FLOOR_DECLARATIONS + RIPPLES_GLSL + fragment
            .replace('#include <map_fragment>', FRAGMENT_FLOOR)
            .replace('#include <normal_fragment_maps>', NORMAL_FLOOR)
            .replace('#include <lights_phong_fragment>', SPECULAR_FLOOR)
            .replace('#include <opaque_fragment>', REFLECTION_FLOOR),
    }),
    l2ceiling: (vertex, fragment) => ({
        vertex,
        fragment: fragment.replace('#include <map_fragment>', FRAGMENT_CEILING).replace('#include <emissivemap_fragment>', BOUNCE),
    }),
    l2pipe: (vertex, fragment) => ({
        vertex: VERTEX_PIPE_DECLARATIONS + vertex.replace('#include <begin_vertex>', VERTEX_PIPE),
        fragment: FRAGMENT_PIPE_DECLARATIONS + fragment
            .replace('#include <color_fragment>', FRAGMENT_PIPE)
            .replace('#include <lights_phong_fragment>', SPECULAR_PIPE)
            .replace('#include <emissivemap_fragment>', BOUNCE),
    }),
    l2gauge: (vertex, fragment) => ({ vertex, fragment: fragment.replace('#include <color_fragment>', FRAGMENT_GAUGE) }),
    l2fire: (vertex, fragment) => ({ vertex, fragment: fragment.replace('#include <color_fragment>', FRAGMENT_FIRE) }),
};
