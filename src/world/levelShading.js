import { CEILING_TILES_X, CEILING_TILES_Z, PANEL_HALF_X, PANEL_HALF_Z } from '../config.js';

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
 * (in main, with the material in scope), for lights of its own: Level 37's sun (see poolroomsShading.js), Level 2's
 * boilers' fires (see pipeDreamsShading.js), Level 4's windows and the lights things have of their own (see
 * abandonedOfficeShading.js), Level 5's sconces and lamps (see terrorHotelShading.js);
 * LEVEL_DEAD_LIGHT_SHADED, for a dead light that's only as light as the room round it (Level 1's bare tubes, which
 * would otherwise show up in the dark); and LEVEL_PANEL_SPREAD, an expression for how much of a ceiling light reaches a
 * fragment, which way it is from it (`panelLight.direction` and `geometryNormal` are in scope, in view space), where its
 * lights don't shine every way alike (Level 0's panels, which shine down).
 *
 * Its `surfaceShading` is what its own kinds of surface (the second argument to withBackroomsShading) do on top of
 * that: Level 0's wallpaper, carpet, ceiling tiles, baseboards and light panels below, Level 1's concrete
 * (LEVEL_ONE_SURFACES in levelOneShading.js), Level 2's walls and pipes (PIPE_DREAMS_SURFACES in pipeDreamsShading.js),
 * Level 4's carpet, ceiling tiles, concrete and furniture (ABANDONED_OFFICE_SURFACES in abandonedOfficeShading.js),
 * Level 5's wallpaper, carpets, woodwork and fittings (TERROR_HOTEL_SURFACES in terrorHotelShading.js), Level 37's tile
 * and water (POOLROOMS_SURFACES in poolroomsShading.js).
 */

/**
 * @typedef {(vertex: string, fragment: string) => { vertex: string, fragment: string }} SurfaceShading
 *     What one of a level's own kinds of surface does to three.js' shaders: given its vertex and fragment shaders,
 *     with the shading every level shares already in, the same with its own.
 */

/**
 * Level 0's: white light (Level Fun's gels are its own; see materials.js), shining down out of flat panels, and plain
 * haze.
 */
export const LEVEL_ZERO_SHADING = /* glsl */ `
vec3 levelLightTint( float code ) {
	return vec3( 1.0 );
}

vec3 levelAir( vec3 color, vec3 haze, float fogFactor, float area ) {
	return mix( color, haze, fogFactor );
}

// A dead panel: a dull diffuser.
const vec3 LEVEL_DEAD_LIGHT = vec3( 0.36, 0.36, 0.33 );

// A panel is a flat lens facing down: it lights what's under it more than what's level with it, so a wall beside one
// is washed with its light, fading up towards the ceiling, rather than lit in a round spot. The tiles round it (what
// faces down) catch some of it: the lens's glow on the ceiling.
float levelPanelSpread( vec3 toLight, vec3 normal ) {
	vec3 down = - viewMatrix[ 1 ].xyz;
	float below = max( - dot( toLight, down ), 0.0 );
	return mix( 0.4 + 0.6 * pow( below, 0.7 ), 0.5, clamp( dot( normal, down ), 0.0, 1.0 ) );
}
#define LEVEL_PANEL_SPREAD levelPanelSpread( panelLight.direction, geometryNormal )
`;

// Level 0's own surfaces (the materials every level starts from; see createMaterials in materials.js).

// Wallpaper: hung in strips a quarter of a unit wide, with a faint line at each join (faded out with
// distance, where it would only shimmer); yellowed unevenly, in streaks down from the ceiling where damp has run
// down it; soaked up from the bottom where the carpet's wet (see the floor's damp patches), darker under a ragged
// brown tide line; grubbier along the bottom, where feet and mops reach, and a little darker up by the ceiling.
const FRAGMENT_WALL = /* glsl */ `
#include <map_fragment>
{
	diffuseColor.rgb *= vec3( 1.05, 1.0, 0.87 );
	vec3 p = vBackroomsWorldPosition;
	float along = p.x + p.z;
	float yellowing = backroomsNoise( vec2( along * 1.7, p.y * 0.8 ) ) * 0.6 + backroomsNoise( vec2( along * 5.3 + 17.0, p.y * 1.6 ) ) * 0.4;
	yellowing *= 0.8 + 0.2 * smoothstep( 0.1, 1.0, p.y );
	diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.92, 0.86, 0.72 ), smoothstep( 0.5, 0.78, yellowing ) * 0.5 );
	float damp = backroomsNoise( p.xz * 0.45 ) * 0.65 + backroomsNoise( p.xz * 1.7 + 31.0 ) * 0.35;
	float soaked = smoothstep( 0.52, 0.75, damp );
	float tide = soaked * ( 0.05 + 0.035 * backroomsNoise( vec2( along * 3.0, 3.0 ) ) + 0.014 * backroomsNoise( vec2( along * 27.0, 7.0 ) ) );
	float under = 1.0 - smoothstep( tide - 0.006, tide, p.y );
	float mark = smoothstep( tide - 0.016, tide - 0.003, p.y ) * under;
	diffuseColor.rgb *= mix( vec3( 1.0 ), mix( vec3( 0.92, 0.88, 0.78 ), vec3( 0.78, 0.68, 0.5 ), mark ), under * soaked );
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

// Ceiling tiles are 1/6 × 1/4 of a unit (the texture's repeat), centred on the cells (so a light panel takes the place
// of one). They've yellowed with age, all but the odd one put in since. Give each a slightly different shade, and a few
// of them old water stains.
const FRAGMENT_CEILING = /* glsl */ `
#include <map_fragment>
{
	vec2 tileCoord = vBackroomsWorldPosition.xz * vec2( ${CEILING_TILES_X}.0, ${CEILING_TILES_Z}.0 ) + 0.5;
	uvec2 tile = uvec2( ivec2( floor( tileCoord ) ) );
	uint h = backroomsHash( tile.x * 2654435761u ^ tile.y * 2246822519u );
	diffuseColor.rgb *= ( backroomsHash( h ^ 0x9e3779b9u ) & 63u ) == 0u ? vec3( 1.0, 0.985, 0.91 ) : vec3( 1.0, 0.965, 0.84 );
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
	// The light off the carpet and the walls, back up onto the tiles, as lit as the room is (with the dynamic lights;
	// without them, the ambient light has it).
	totalEmissiveRadiance += diffuseColor.rgb * vec3( 1.0, 0.95, 0.78 ) * 0.08 * backroomsArea * backroomsTint * clamp( gridLightIntensity, 0.0, 1.0 );
}
`;

// A light panel (see createFixtureGeometry in chunkGeometry.js). The lens: two tubes behind it along its length,
// brighter where they are, and dimmer towards its ends; its prisms catching the light unevenly, close up. Lit, it
// follows the panel's state (and in Level Fun, shows its gel); out, it's a dull grey with the tubes dark behind it,
// only as light as the room round it. The flange round it is lit by the room, and a little by the lens.
const FRAGMENT_PANEL = /* glsl */ `
#include <color_fragment>
{
	vec2 slot = floor( ( vBackroomsWorldPosition.xz - 1.0 ) * 0.5 + 0.5 );
	vec2 local = vBackroomsWorldPosition.xz - ( slot * 2.0 + 1.0 );
	vec4 state = panelState( slot );
	float lit = state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
	if ( diffuseColor.b > 0.99 ) {
		float tubes = exp( - pow( ( abs( local.x ) - ${(PANEL_HALF_X * 0.4).toFixed(4)} ) / ${(PANEL_HALF_X * 0.22).toFixed(4)}, 2.0 ) );
		float ends = 1.0 - smoothstep( ${(PANEL_HALF_Z * 0.6).toFixed(4)}, ${PANEL_HALF_Z.toFixed(4)}, abs( local.y ) );
		vec2 prism = abs( fract( local * 160.0 ) - 0.5 );
		float sparkle = ( prism.x + prism.y - 0.5 ) * ( 1.0 - smoothstep( 0.2, 0.6, backroomsPixel * 160.0 ) );
		vec3 on = vec3( 1.0, 0.99, 0.92 ) * ( 0.8 + 0.2 * tubes ) * ( 0.86 + 0.14 * ends ) * ( 1.0 + 0.1 * sparkle ) * panelTint( state.a );
		vec3 off = LEVEL_DEAD_LIGHT * ( 1.0 - 0.3 * tubes ) * ( 1.0 + 0.06 * sparkle ) * ( 0.25 + 0.75 * backroomsArea );
		diffuseColor.rgb = mix( off, on, lit );
	} else {
		diffuseColor.rgb *= ( 0.2 + 0.8 * backroomsArea ) * backroomsTint * ( 0.8 + 0.3 * lit );
	}
}
`;

// The baseboards: the ledge along the top of one (see baseboard() in chunkGeometry.js), tipped up to catch the light, is
// thinner than a pixel a little way off, where it would break up into dashes; there it's lit like the board's front.
const FRAGMENT_BASEBOARD = /* glsl */ `
#include <normal_fragment_begin>
{
	vec3 up = viewMatrix[ 1 ].xyz;
	float ledge = dot( normal, up );
	if ( ledge > 0.05 ) normal = normalize( normal - up * ledge * smoothstep( 0.0015, 0.004, backroomsPixel ) );
}
`;

/**
 * What Level 0's own kinds of surface do to three.js' shaders (see SurfaceShading): the wallpaper, the carpet, the
 * ceiling tiles, the baseboards and the light panels.
 * @type {Record<string, SurfaceShading>}
 */
export const LEVEL_ZERO_SURFACES = {
    wall: (vertex, fragment) => ({ vertex, fragment: fragment.replace('#include <map_fragment>', FRAGMENT_WALL) }),
    floor: (vertex, fragment) => ({ vertex, fragment: fragment.replace('#include <map_fragment>', FRAGMENT_FLOOR) }),
    ceiling: (vertex, fragment) => ({
        vertex,
        fragment: fragment.replace('#include <map_fragment>', FRAGMENT_CEILING).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAGMENT_CEILING_GLOW}`),
    }),
    baseboard: (vertex, fragment) => ({ vertex, fragment: fragment.replace('#include <normal_fragment_begin>', FRAGMENT_BASEBOARD) }),
    panel: (vertex, fragment) => ({ vertex, fragment: fragment.replace('#include <color_fragment>', FRAGMENT_PANEL) }),
};
