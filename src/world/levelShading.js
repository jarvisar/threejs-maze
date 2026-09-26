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
