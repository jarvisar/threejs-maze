/*
 * Level 1's shaders: the air, the water, and the concrete (see levelOne.js). These are pieces of GLSL that
 * materials.js puts into three.js' own shaders: LEVEL_ONE_SHADING into everything drawn while Level 1 is showing
 * (see levelShading.js), and the rest into its own surfaces. They share the ceiling lights, the panel states and
 * the haze with every level.
 *
 * The air is what makes the place: a haze that swallows the far end of every aisle, a mist lying on the floor that
 * drifts, and every light glowing in them. The glow is worked out, not faked with sprites: for each of the lights
 * nearest you, how much of its light the haze along the line of sight scatters back towards you, which has a
 * closed form for a point light (Sun et al., "A Practical Analytic Single Scattering Model", 2005, simplified).
 *
 * The floor is trowelled concrete with puddles lying in its low spots. The puddles are where the noise is highest
 * (the same noise as `levelOneWetness` in levelOneWater.js, so the sounds agree with the picture), rippled where
 * water drips into them, and they reflect: the scene itself where there's a reflection to use (see
 * Reflection.js), otherwise the lights overhead, worked out like the glow.
 */

/** How the mist lies: its thickness at the floor and how fast it thins with height. */
const MIST_DENSITY = 0.32;
const MIST_HEIGHT = 0.14;

/** The tubes' colours, and the mist's uniform. Follows PANEL_LIGHT_GLSL. */
export const LEVEL_ONE_GLSL = /* glsl */ `
// The mist is left out of the reflection in the puddles (the puddle's own view of it covers it).
uniform float mistLevel;

// The colour of the tube in a light slot, from its fourth byte (see levelOne.js): the usual cool white, an old one
// gone green, or a warm one.
vec3 levelOneTube( float code ) {
	float byte = floor( code * 255.0 + 0.5 );
	if ( byte > 254.5 ) return vec3( 1.0 );
	if ( byte > 253.5 ) return vec3( 0.9, 1.0, 0.9 );
	if ( byte > 252.5 ) return vec3( 1.3, 0.92, 0.6 );
	return vec3( 1.0 );
}
`;

/** The air: haze, mist and the glow of the lights in them. After LEVEL_ONE_GLSL, with the lighting uniforms. */
export const LEVEL_ONE_AIR_GLSL = /* glsl */ `
// The light the haze scatters towards the eye along the line of sight from eye (direction dir, length dist): the
// lights nearest the eye, each only below its own height (the batten's reflector sends it down).
vec3 levelOneGlow( vec3 eye, vec3 dir, float dist ) {
	if ( gridLightIntensity <= 0.0 ) return vec3( 0.0 );
	vec2 first = floor( ( eye.xz - 1.0 ) * 0.5 ) - 1.0;
	vec3 sum = vec3( 0.0 );
	for ( int ix = 0; ix < 4; ix ++ ) {
		for ( int iz = 0; iz < 4; iz ++ ) {
			vec2 panel = first + vec2( ix, iz );
			vec3 light = vec3( panel.x * 2.0 + 1.0, gridLightHeight, panel.y * 2.0 + 1.0 );
			vec3 toLight = light - eye;
			// Fade each out before it leaves the 4 × 4 around the eye, so none of them pops.
			float window = 1.0 - smoothstep( 2.3, 3.2, max( abs( toLight.x ), abs( toLight.z ) ) );
			if ( window <= 0.0 ) continue;
			vec4 state = panelState( panel );
			float lit = state.r * panelFlicker( state.b ) * ( 1.0 - blackout ) * window;
			if ( lit <= 0.0 ) continue;
			// The part of the line below the light.
			float t0 = 0.0;
			float t1 = dist;
			if ( dir.y > 1e-4 ) t1 = min( t1, ( light.y - eye.y ) / dir.y );
			else if ( dir.y < -1e-4 && eye.y > light.y ) t0 = ( light.y - eye.y ) / dir.y;
			if ( t1 <= t0 ) continue;
			float along = dot( toLight, dir );
			float h = sqrt( max( dot( toLight, toLight ) - along * along, 0.0 ) + 0.015 );
			// (Capped: right by a light it would be as bright as the tube.)
			float scattered = min( ( atan( ( t1 - along ) / h ) - atan( ( t0 - along ) / h ) ) / h, 5.0 );
			sum += levelOneTube( state.a ) * lit * scattered;
		}
	}
	return sum * gridLightColor * ( 0.008 * gridLightIntensity );
}

// Level 1's air over a fragment's colour: the mist lying on the floor, the haze with distance (haze is its colour,
// fogFactor how much of it there is here), and the glow of the lights nearest the eye. area is how lit it is here.
vec3 levelOneAir( vec3 color, vec3 haze, float fogFactor, float area ) {
	vec3 eye = cameraPosition;
	vec3 p = vBackroomsWorldPosition;
	vec3 ray = p - eye;
	float dist = max( length( ray ), 1e-4 );
	vec3 dir = ray / dist;
	// Exponential height fog, integrated along the line of sight, thicker and thinner where it drifts.
	float k = 1.0 / ${MIST_HEIGHT};
	float a = exp( - max( eye.y, 0.0 ) * k );
	float b = exp( - max( p.y, 0.0 ) * k );
	float dy = p.y - eye.y;
	float thickness = abs( dy ) > 1e-3 ? ( a - b ) / ( dy * k ) : a;
	vec2 wind = vec2( lightTime * 0.045, lightTime * 0.018 );
	float drift = backroomsNoise( p.xz * 0.7 + wind ) * 0.65 + backroomsNoise( p.xz * 2.1 - wind * 1.7 + 9.0 ) * 0.35;
	float mist = ( 1.0 - exp( - ${MIST_DENSITY} * dist * thickness * ( 0.35 + 1.3 * drift ) ) ) * mistLevel;
	vec3 mistColor = vec3( 0.5, 0.53, 0.54 ) * ( 0.05 + 0.95 * area );
	color = mix( color, mistColor, mist );
	color = mix( color, haze, fogFactor );
	return color + levelOneGlow( eye, dir, dist ) * ( 1.0 - 0.6 * fogFactor );
}
`;

/**
 * The puddles and damp in the floor, and the ripples where drips land. Same as levelOneWetness() in
 * levelOneWater.js.
 */
export const LEVEL_ONE_WATER_GLSL = /* glsl */ `
float levelOneWetness( vec2 p ) {
	float n = backroomsNoise( p * 0.23 + vec2( 11.3, 5.7 ) ) * 0.6 + backroomsNoise( p * 0.71 + vec2( 3.1, 19.9 ) ) * 0.3 + backroomsNoise( p * 2.3 + vec2( 7.7, 1.3 ) ) * 0.1;
	return smoothstep( 0.5, 0.64, n );
}

// Rings spreading out where drops land, as a tilt of the surface (x and z): a drop every few seconds in one cell in
// four, each ring fading as it spreads.
vec2 levelOneRipples( vec2 p ) {
	vec2 tilt = vec2( 0.0 );
	// The four cells whose middles are nearest.
	vec2 base = floor( p * 1.6 - 0.5 );
	for ( int i = 0; i < 2; i ++ ) {
		for ( int j = 0; j < 2; j ++ ) {
			vec2 cell = base + vec2( i, j );
			uint h = backroomsHash( uint( int( cell.x ) ) * 73856093u ^ uint( int( cell.y ) ) * 19349663u );
			if ( ( h & 3u ) != 0u ) continue;
			vec2 centre = ( cell + vec2( float( ( h >> 2u ) & 255u ), float( ( h >> 10u ) & 255u ) ) / 255.0 ) / 1.6;
			float period = 1.4 + 2.6 * float( ( h >> 18u ) & 63u ) / 63.0;
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

// ---------------------------------------------------------------------------------------------- surfaces

/**
 * Cast concrete walls: most bare, some patches of the level painted a dirty off-white, water streaked down from
 * the slab, a damp tide line along the foot, and a dark kick band where things have been dragged along.
 */
export const FRAGMENT_L1_WALL = /* glsl */ `
#include <map_fragment>
{
	vec3 p = vBackroomsWorldPosition;
	float along = p.x + p.z;
	float painted = smoothstep( 0.55, 0.6, backroomsNoise( p.xz * 0.09 + 3.1 ) );
	diffuseColor.rgb *= mix( vec3( 0.6, 0.6, 0.585 ), vec3( 0.78, 0.78, 0.75 ), painted );
	// A painted band along the bottom in the painted parts: grey-green, with a worn yellow line on top.
	float band = step( p.y, 0.24 ) * painted;
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.42, 0.5, 0.47 ), band );
	float line = step( 0.24, p.y ) * step( p.y, 0.262 ) * painted;
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.58, 0.46, 0.12 ) * ( 0.7 + 0.3 * backroomsNoise( vec2( along * 20.0, 3.0 ) ) ), line );
	// Streaks where water has run down from the slab.
	float streak = smoothstep( 0.55, 0.9, backroomsNoise( vec2( along * 7.0, p.y * 0.7 + 4.0 ) ) );
	streak *= smoothstep( 0.1, 0.9, p.y ) * ( 0.5 + 0.5 * backroomsNoise( vec2( along * 1.3, 8.0 ) ) );
	diffuseColor.rgb *= 1.0 - 0.34 * streak;
	// Rising damp, with a pale salt line where it stopped.
	float tide = 0.07 + 0.13 * backroomsNoise( vec2( along * 1.9, 1.7 ) );
	float damp = 1.0 - smoothstep( tide - 0.03, tide, p.y );
	float salt = smoothstep( tide - 0.012, tide, p.y ) * ( 1.0 - smoothstep( tide, tide + 0.012, p.y ) );
	diffuseColor.rgb *= ( 1.0 - 0.22 * damp ) * ( 1.0 + 0.12 * salt );
	// Grubby along the top, where the dust settles on the pipes' side of things.
	diffuseColor.rgb *= 1.0 - 0.18 * smoothstep( 0.86, 1.0, p.y );
}
`;

/**
 * The columns (and the beams, which are the same concrete): stencilled, some painted white, some with hazard
 * stripes round the bottom and others with yellow guards on their corners, scraped at bumper height.
 */
export const FRAGMENT_L1_COLUMN = /* glsl */ `
#include <map_fragment>
{
	vec3 p = vBackroomsWorldPosition;
	vec2 id = floor( ( p.xz - 1.5 ) / 3.0 + 0.5 );
	vec2 local = p.xz - ( id * 3.0 + 1.5 );
	uint h = backroomsHash( uint( int( id.x ) ) * 2654435761u ^ uint( int( id.y ) ) * 2246822519u );
	float column = step( p.y, 0.86 );
	float painted = ( h & 3u ) < 2u ? 1.0 : 0.0;
	diffuseColor.rgb *= mix( vec3( 0.72, 0.72, 0.7 ), vec3( 0.93, 0.93, 0.9 ), painted * column );
	float along = local.x + local.y;
	uint style = ( h >> 2u ) & 3u;
	if ( column > 0.0 && style == 0u && p.y < 0.13 ) {
		// Hazard stripes, worn.
		float stripe = step( 0.5, fract( ( along + p.y ) * 7.0 ) );
		vec3 paint = mix( vec3( 0.07, 0.07, 0.06 ), vec3( 0.78, 0.6, 0.08 ), stripe );
		float worn = smoothstep( 0.35, 0.6, backroomsNoise( vec2( along * 30.0, p.y * 40.0 ) ) );
		diffuseColor.rgb = mix( paint * texture2D( map, vMapUv ).r * 1.6, diffuseColor.rgb, worn * 0.6 );
	} else if ( column > 0.0 && style == 1u && p.y < 0.37 && max( abs( local.x ), abs( local.y ) ) > 0.1 && min( abs( local.x ), abs( local.y ) ) > 0.085 ) {
		// Yellow guards on the corners.
		diffuseColor.rgb = vec3( 0.7, 0.54, 0.1 ) * ( 0.75 + 0.35 * texture2D( map, vMapUv ).r );
	}
	// Scraped by bumpers and trolleys.
	float scrape = smoothstep( 0.62, 0.8, backroomsNoise( vec2( along * 11.0, p.y * 60.0 ) ) ) * step( 0.13, p.y ) * step( p.y, 0.26 );
	diffuseColor.rgb *= 1.0 - 0.3 * scrape * column;
	// Damp and dirt at the foot, and a little grime under the beams.
	diffuseColor.rgb *= 1.0 - 0.25 * ( 1.0 - smoothstep( 0.0, 0.08, p.y ) );
	diffuseColor.rgb *= 1.0 - 0.15 * ( 1.0 - column );
}
`;

/**
 * The slab overhead: cast against sheets of plywood (their seams show in a staggered grid), blotchy, stained brown
 * in places where water has come through.
 */
export const FRAGMENT_L1_CEILING = /* glsl */ `
#include <map_fragment>
{
	vec2 p = vBackroomsWorldPosition.xz;
	vec2 sheet = vec2( 0.9, 0.45 );
	vec2 q = p / sheet;
	q.x += step( 1.0, mod( floor( q.y ), 2.0 ) ) * 0.5;
	vec2 f = abs( fract( q ) - 0.5 ) * sheet;
	float pixel = max( length( fwidth( p ) ), 1e-4 );
	float seam = 1.0 - smoothstep( 0.0, 0.004 + pixel, 0.5 * min( sheet.x, sheet.y ) - max( f.x / sheet.x * sheet.y, f.y ) );
	diffuseColor.rgb *= 1.0 - 0.12 * seam * ( 1.0 - smoothstep( 0.01, 0.04, pixel ) );
	float blotch = backroomsNoise( p * 0.6 ) * 0.6 + backroomsNoise( p * 2.2 + 5.0 ) * 0.4;
	diffuseColor.rgb *= 0.9 + 0.2 * blotch;
	float stain = smoothstep( 0.68, 0.74, backroomsNoise( p * 0.33 + 17.0 ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.78, 0.68, 0.52 ), stain * 0.7 );
}
`;

/**
 * The slab catches the light coming back up off the floor, so it's never as dark as the direct light alone would
 * leave it, and it's brightest round the battens.
 */
export const FRAGMENT_L1_BOUNCE = /* glsl */ `
#include <emissivemap_fragment>
{
	vec2 nearest = floor( ( vBackroomsWorldPosition.xz - 1.0 ) * 0.5 + 0.5 );
	vec4 panel = panelState( nearest );
	float on = panel.r * panelFlicker( panel.b ) * ( 1.0 - blackout );
	float halo = 1.0 - smoothstep( 0.05, 0.9, length( vBackroomsWorldPosition.xz - ( nearest * 2.0 + 1.0 ) ) );
	float up = smoothstep( 0.8, 0.95, vBackroomsWorldPosition.y );
	totalEmissiveRadiance += diffuseColor.rgb * up * ( 0.42 * backroomsArea + 0.5 * on * halo * halo * levelOneTube( panel.a ) );
}
`;

/**
 * The floor: dusty trowelled concrete, the saw cuts along the column lines, tyre tracks down some of the aisles,
 * oil where cars stood, and the water: damp patches, and puddles in the low spots. Sets levelOneWater (0..1).
 */
export const FRAGMENT_L1_FLOOR = /* glsl */ `
#include <map_fragment>
float levelOneWater = 0.0;
vec2 levelOneTilt = vec2( 0.0 );
{
	vec2 p = vBackroomsWorldPosition.xz;
	float pixel = max( length( fwidth( p ) ), 1e-4 );
	float mottle = backroomsNoise( p * 0.35 ) * 0.6 + backroomsNoise( p * 1.3 + 7.0 ) * 0.4;
	diffuseColor.rgb *= 0.8 + 0.34 * mottle;
	// Saw cuts along the column lines.
	vec2 toJoint = abs( fract( ( p - 1.5 ) / 3.0 + 0.5 ) - 0.5 ) * 3.0;
	float joint = 1.0 - smoothstep( 0.003, 0.006 + pixel, min( toJoint.x, toJoint.y ) );
	diffuseColor.rgb *= 1.0 - 0.45 * joint * ( 1.0 - smoothstep( 0.02, 0.06, pixel ) );
	// Tyre tracks down the middle of some rows of bays, one way and the other.
	for ( int axis = 0; axis < 2; axis ++ ) {
		float across = axis == 0 ? p.y : p.x;
		float run = axis == 0 ? p.x : p.y;
		float row = floor( across / 3.0 + 0.5 );
		uint h = backroomsHash( uint( int( row ) ) * 7919u + uint( axis ) * 104729u + 31u );
		if ( ( h & 3u ) != 0u ) continue;
		float offset = across - row * 3.0 + ( float( ( h >> 2u ) & 15u ) / 15.0 - 0.5 ) * 0.4;
		float wheels = min( abs( offset - 0.27 ), abs( offset + 0.27 ) );
		float track = ( 1.0 - smoothstep( 0.03, 0.09, wheels ) ) * smoothstep( 0.3, 0.7, backroomsNoise( vec2( run * 0.3, row * 7.0 ) ) );
		diffuseColor.rgb *= 1.0 - 0.32 * track;
	}
	// Oil where cars stood.
	{
		vec2 cell = floor( p );
		uint h = backroomsHash( uint( int( cell.x ) ) * 374761393u ^ uint( int( cell.y ) ) * 668265263u );
		if ( ( h & 31u ) == 0u ) {
			vec2 centre = cell + 0.5 + ( vec2( float( ( h >> 5u ) & 15u ), float( ( h >> 9u ) & 15u ) ) / 15.0 - 0.5 ) * 0.4;
			float r = 0.08 + 0.1 * float( ( h >> 13u ) & 7u ) / 7.0;
			float d = length( ( p - centre ) * vec2( 1.0, 1.4 ) ) + ( backroomsNoise( p * 18.0 ) - 0.5 ) * 0.06;
			diffuseColor.rgb *= 1.0 - 0.5 * ( 1.0 - smoothstep( r * 0.5, r, d ) );
		}
	}
	levelOneWater = levelOneWetness( p );
	// Wet concrete goes dark; standing water darker, the concrete under it seen through it.
	diffuseColor.rgb *= 1.0 - 0.42 * smoothstep( 0.0, 0.5, levelOneWater ) - 0.2 * smoothstep( 0.6, 1.0, levelOneWater );
	if ( levelOneWater > 0.55 ) levelOneTilt = levelOneRipples( p ) * smoothstep( 0.55, 0.8, levelOneWater );
}
`;

/** Flat water where it's standing (the concrete's bumps don't show through it), and rippled. */
export const FRAGMENT_L1_FLOOR_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
	float still = smoothstep( 0.6, 0.85, levelOneWater );
	vec3 waterNormal = normalize( ( viewMatrix * vec4( - levelOneTilt.x, 1.0, - levelOneTilt.y, 0.0 ) ).xyz );
	normal = normalize( mix( normal, waterNormal, still ) );
}
`;

/** Wet concrete shines, and standing water shines sharply. */
export const FRAGMENT_L1_FLOOR_SPECULAR = /* glsl */ `
#include <lights_phong_fragment>
material.specularShininess = mix( 30.0, 500.0, smoothstep( 0.4, 0.9, levelOneWater ) );
// (Standing water only: damp concrete smeared bright under every light otherwise.)
material.specularStrength = 0.05 + ( reflectionOn > 0.5 ? 0.35 : 1.4 ) * smoothstep( 0.5, 0.9, levelOneWater );
`;

/**
 * What the water reflects: the scene itself, if there's a reflection (Reflection.js), otherwise the lights overhead
 * (their tubes' mirror image, stretched out towards you the way lights are in wet ground). Fresnel decides how much.
 */
export const FRAGMENT_L1_FLOOR_REFLECTION = /* glsl */ `
if ( levelOneWater > 0.02 ) {
	vec3 toEye = normalize( cameraPosition - vBackroomsWorldPosition );
	float cosine = clamp( toEye.y, 0.0, 1.0 );
	float still = smoothstep( 0.55, 0.85, levelOneWater );
	float fresnel = 0.04 + 0.96 * pow( 1.0 - cosine, 5.0 );
	vec3 mirrored = vec3( 0.0 );
	if ( reflectionOn > 0.5 ) {
		vec4 clip = reflectionMatrix * vec4( vBackroomsWorldPosition, 1.0 );
		vec2 uv = clip.xy / clip.w + levelOneTilt * 0.04 * ( 0.4 + still );
		// Rougher where it's only damp: smeared.
		float blur = ( 1.0 - still ) * 0.012;
		mirrored = texture2D( reflectionMap, uv ).rgb * 0.5 + texture2D( reflectionMap, uv + vec2( 0.0, blur ) ).rgb * 0.25 + texture2D( reflectionMap, uv - vec2( 0.0, blur * 2.0 ) ).rgb * 0.25;
	} else {
		// Up from the floor to the lights' height, then the nearest slot's tube.
		vec3 bounce = vec3( - toEye.x + levelOneTilt.x * 0.5, toEye.y, - toEye.z + levelOneTilt.y * 0.5 );
		vec2 hit = vBackroomsWorldPosition.xz + bounce.xz / max( bounce.y, 0.03 ) * ( gridLightHeight - vBackroomsWorldPosition.y );
		vec2 panel = floor( ( hit - 1.0 ) * 0.5 + 0.5 );
		vec2 offset = hit - ( panel * 2.0 + 1.0 );
		vec4 state = panelState( panel );
		float lit = state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
		// The tube runs along x; stretched towards the eye by the rough surface.
		vec2 view = normalize( toEye.xz + 1e-4 );
		float spread = 0.025 + ( 1.0 - still ) * 0.06 + 0.03 * ( 1.0 - cosine );
		vec2 d = vec2( max( abs( offset.x ) - 0.16, 0.0 ), offset.y );
		float along = dot( d, view );
		float side = dot( d, vec2( - view.y, view.x ) );
		float glint = exp( - ( side * side ) / ( spread * spread * 1.5 ) - ( along * along ) / ( spread * spread * 30.0 ) );
		mirrored = gridLightColor * levelOneTube( state.a ) * lit * glint * 0.45 + vec3( 0.2, 0.22, 0.23 ) * backroomsArea * 0.25;
	}
	float amount = fresnel * mix( 0.35, 1.0, still ) * smoothstep( 0.05, 0.4, levelOneWater );
	outgoingLight = outgoingLight * ( 1.0 - amount * 0.8 ) + mirrored * amount * 1.4;
}
#include <opaque_fragment>
`;

/** The reflection's uniforms, for the floor. */
export const L1_FLOOR_DECLARATIONS = /* glsl */ `
uniform sampler2D reflectionMap;
uniform mat4 reflectionMatrix;
uniform float reflectionOn;
`;

/**
 * The tubes on the columns: each flickers in its own pattern (its lamp attribute: the pattern byte, and how bright
 * it is), and goes out in a power cut.
 */
export const VERTEX_L1_TUBE_DECLARATIONS = /* glsl */ `
attribute vec2 lamp;
varying vec2 vLamp;
`;

export const VERTEX_L1_TUBE = /* glsl */ `
#include <begin_vertex>
vLamp = lamp;
`;

export const FRAGMENT_L1_TUBE = /* glsl */ `
#include <color_fragment>
{
	float on = vLamp.y * panelFlicker( vLamp.x ) * ( 1.0 - blackout );
	diffuseColor.rgb = mix( vec3( 0.28, 0.29, 0.3 ), diffuseColor.rgb, on );
}
`;

export const FRAGMENT_L1_TUBE_DECLARATIONS = /* glsl */ `
varying vec2 vLamp;
`;

/**
 * Level 1's part of every shader compiled for it (see levelShading.js): the tubes, the air, and the water.
 */
export const LEVEL_ONE_SHADING = /* glsl */ `
${LEVEL_ONE_GLSL}
${LEVEL_ONE_AIR_GLSL}
${LEVEL_ONE_WATER_GLSL}

vec3 levelLightTint( float code ) {
	return levelOneTube( code );
}

vec3 levelAir( vec3 color, vec3 haze, float fogFactor, float area ) {
	return levelOneAir( color, haze, fogFactor, area );
}

// A dead tube: grey glass.
const vec3 LEVEL_DEAD_LIGHT = vec3( 0.26, 0.27, 0.28 );
`;
