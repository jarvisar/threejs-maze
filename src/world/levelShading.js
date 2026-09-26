/*
 * What a level puts into the shaders (see withBackroomsShading in materials.js). The shading every level shares,
 * the ceiling lights, the panel states, the haze, calls these, and each material is compiled for one level, so
 * nothing branches on which level it is: a level's own surfaces for their level, and what shows on every level (the
 * props, the fittings, a tape's notes) for the one that's showing.
 *
 * A level's `shading` (see levels.js) is GLSL that comes after the lighting uniforms and PANEL_LIGHT_GLSL, and has:
 *
 *   vec3 levelLightTint( float code )
 *       The colour of the light in a slot, from its fourth byte (see ChunkData.lights).
 *   vec3 levelAir( vec3 color, vec3 haze, float fogFactor, float area )
 *       The air over a fragment's colour: the haze (haze is its colour, fogFactor how much of it there is here,
 *       area how lit it is here), and anything else that hangs in it.
 *   const vec3 LEVEL_DEAD_LIGHT
 *       What a light looks like when it's out.
 *
 * and whatever else its own surfaces use. It can also define LEVEL_DIRECT, a macro run where three.js adds up its lights
 * (in main, with the material in scope), for lights of its own: Level 37's sun (see poolroomsShading.js); and
 * LEVEL_DEAD_LIGHT_SHADED, for a dead light that's only as light as the room round it (Level 1's bare tubes, which
 * would otherwise show up in the dark).
 *
 * Its `surfaceShading` is what its own kinds of surface (the second argument to withBackroomsShading) do on top of
 * that: Level 0's wallpaper, carpet and ceiling tiles below, Level 1's concrete (LEVEL_ONE_SURFACES in
 * levelOneShading.js), Level 37's tile and water (POOLROOMS_SURFACES in poolroomsShading.js).
 */

/**
 * @typedef {(vertex: string, fragment: string) => { vertex: string, fragment: string }} SurfaceShading
 *     What one of a level's own kinds of surface does to three.js' shaders: given its vertex and fragment shaders,
 *     with the shading every level shares already in, the same with its own.
 */

/** Level 0's: white light (Level Fun's gels are its own; see materials.js), and plain haze. */
export const LEVEL_ZERO_SHADING = /* glsl */ `
vec3 levelLightTint( float code ) {
	return vec3( 1.0 );
}

vec3 levelAir( vec3 color, vec3 haze, float fogFactor, float area ) {
	return mix( color, haze, fogFactor );
}

// A dead panel: a dull diffuser.
const vec3 LEVEL_DEAD_LIGHT = vec3( 0.36, 0.36, 0.33 );
`;

// Level 0's own surfaces (the materials every level starts from; see createMaterials in materials.js).

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

/**
 * What Level 0's own kinds of surface do to three.js' shaders (see SurfaceShading): the wallpaper, the carpet and the
 * ceiling tiles.
 * @type {Record<string, SurfaceShading>}
 */
export const LEVEL_ZERO_SURFACES = {
    wall: (vertex, fragment) => ({ vertex, fragment: fragment.replace('#include <map_fragment>', FRAGMENT_WALL) }),
    floor: (vertex, fragment) => ({ vertex, fragment: fragment.replace('#include <map_fragment>', FRAGMENT_FLOOR) }),
    ceiling: (vertex, fragment) => ({
        vertex,
        fragment: fragment.replace('#include <map_fragment>', FRAGMENT_CEILING).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAGMENT_CEILING_GLOW}`),
    }),
};
