import { ShaderChunk } from 'three';
import { VIEW_DISTANCE } from '../config.js';
import {
    BLIND_SHARE,
    BYTE_EMITTER,
    BYTE_WINDOW_X,
    BYTE_WINDOW_Z,
    EMIT_BIAS,
    EMIT_EXIT,
    EMIT_RANGE,
    EMIT_SCREEN,
    EMIT_STEPS,
    EMIT_VENDING,
    EMIT_Y,
    EMITTER_SHIFT,
    FACADE_BOTTOM,
    FACADE_TOP,
    GLASS_HALF,
    HEAD_Y,
    LOOK_CORE,
    LOOK_CORRIDOR,
    LOOK_CUBICLES,
    LOOK_KITCHEN,
    LOOK_MEETING,
    LOOK_OPEN,
    LOOK_ROOM,
    LOOK_WELL,
    SILL_Y,
    STOREY,
    TUBE_OLD,
    TUBE_WARM,
} from './abandonedOffice.js';

/*
 * Level 4's shaders: the light, the air, the storm and its surfaces (see abandonedOffice.js). These are pieces of GLSL
 * that materials.js puts into three.js' own shaders: ABANDONED_OFFICE_SHADING into everything drawn while Level 4 is
 * showing (see levelShading.js), and the rest into its own surfaces (ABANDONED_OFFICE_SURFACES) and its own materials
 * (the glass, the building across the wells, the rain, the sky; see abandonedOfficeMaterials.js).
 *
 * What makes the place:
 *
 * - The windows. Every cell near enough a light well knows which of its sides it's in front of, and how far (see
 *   cellBytes in abandonedOffice.js), so every point there works out where the light from outside came in to reach it:
 *   along the light, back to the glass, and whether that's glass or a pier, a mullion, the sill; so every window lays its
 *   shape across the carpet and up the walls, a cold blue, dappled by the drops standing on the glass.
 *   Lightning comes in the same way, from wherever it struck, so each strike throws the windows' shadows at another
 *   angle, far brighter, for a moment.
 * - The lights things have of their own: a vending machine's front, a computer left on, an EXIT sign, which stays lit on
 *   its battery when the power goes (the nearest one to each cell is in its bytes).
 * - Outside: a light well is open to the sky, and across it the building's other wings, floor over floor, most of their
 *   rooms dark, a few lit, blinds half down, all going up into the rain and down into the fog. Our glass is beaded with
 *   the water the wind throws at it (see officeDrops), and the rain itself only shows where something lights it: the
 *   light spilling out of our windows, the flashlight, the lightning. What's out there is its own air: the fog closes in
 *   fast.
 * - The surfaces: carpet tiles laid quarter-turned, with the dents in them where the furniture stood; the ceiling's
 *   tiles, two feet by four, stained, a few gone; painted walls, with the marks where pictures hung, and in the core bare
 *   concrete, board-marked, with its tie holes.
 */

const FLOAT = (value) => (Number.isInteger(value) ? `${value}.0` : String(value));

/** The colour of the night through the windows, of the lightning, and of the fog out there. */
const NIGHT = 'vec3( 0.2, 0.25, 0.36 )';
const FLASH = 'vec3( 0.86, 0.92, 1.1 )';
const OUTSIDE = 'vec3( 0.03, 0.037, 0.05 )';

/** What every Level 4 shader has (its own materials' too). Follows PANEL_LIGHT_GLSL. */
export const OFFICE_GLSL = /* glsl */ `
// The lightning (see storm.js): how bright it is now (x), which way across the sky it struck (y, z), how near (w); and
// the bolt it drew: which (0 for none), seconds since, how near.
uniform vec4 lightning;
uniform vec3 lightningBolt;

const float SILL_Y = ${FLOAT(SILL_Y)};
const float HEAD_Y = ${FLOAT(HEAD_Y)};
const float GLASS_HALF = ${FLOAT(GLASS_HALF)};
const float STOREY = ${FLOAT(STOREY)};
const float FACADE_TOP = ${FLOAT(FACADE_TOP)};
const float FACADE_BOTTOM = ${FLOAT(FACADE_BOTTOM)};
const vec3 NIGHT = ${NIGHT};
const vec3 FLASH = ${FLASH};
const vec3 OUTSIDE = ${OUTSIDE};

// The colour of the tubes in a slot, from its fourth byte (see abandonedOffice.js).
vec3 officeTube( float code ) {
	float byte = floor( code * 255.0 + 0.5 );
	if ( byte > 254.5 ) return vec3( 0.92, 0.98, 1.08 );
	if ( byte > ${TUBE_OLD}.0 - 0.5 ) return vec3( 0.94, 1.02, 0.84 );
	if ( byte > ${TUBE_WARM}.0 - 0.5 ) return vec3( 1.08, 0.98, 0.82 );
	return vec3( 1.0 );
}

// How bright a light slot is right now (its brightness, its flicker, the power), and its colour.
float officeSlotOn( vec2 xz, out vec3 tint ) {
	vec4 state = panelState( floor( ( xz - 1.0 ) * 0.5 + 0.5 ) );
	tint = officeTube( state.a );
	return state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
}

float officeHash( vec2 p ) {
	uvec2 q = uvec2( ivec2( floor( p ) ) );
	return float( backroomsHash( q.x * 2654435761u ^ q.y * 2246822519u ^ 7919u ) & 65535u ) / 65535.0;
}

// Water standing on a window's glass (none of it running: it's the wind that drives it on, not down), at q (along the
// glass, and up it, in units), where a pixel covers \`pixel\` of the glass. Drops of every size, most of them small, a
// few big ones gone heavy at the bottom; thicker where the wind throws more of it, and a clear patch here and there.
// Returns how much of the glass there a drop covers; and in \`slope\`, which way the drop's surface slopes there (its
// middle 0, its rim 1 out from it: the drop's own round), in \`rim\` how near its edge that is, 0 to 1, in \`big\`
// how many pixels across the drop is, and in \`film\` how much of the water there is too small to see (0 to about
// 0.2), which only mists the glass.
float officeDrops( vec2 q, float pixel, out vec2 slope, out float rim, out float big, out float film ) {
	float cover = 0.0;
	slope = vec2( 0.0 );
	rim = 0.0;
	big = 0.0;
	film = 0.0;
	float gust = backroomsNoise( q * vec2( 2.3, 1.6 ) + 41.0 ) * 0.7 + backroomsNoise( q * 7.0 ) * 0.3;
	float wet = smoothstep( 0.18, 0.62, gust );
	for ( int k = 0; k < 3; k ++ ) {
		// Small, middling, and a few big ones: the grid each is on, and how many of its cells have one.
		float size = k == 0 ? 0.0075 : k == 1 ? 0.016 : 0.034;
		float share = ( k == 0 ? 0.5 : k == 1 ? 0.4 : 0.2 ) * wet;
		// (Too small to see from here, it's film.)
		float seen = smoothstep( 0.6, 1.8, size * 0.24 / pixel );
		film += share * 0.19 * ( 1.0 - seen );
		if ( seen <= 0.0 ) continue;
		// (Its grid pulled about a little, so they don't stand in rows.)
		vec2 warp = vec2( backroomsNoise( q / ( size * 3.7 ) + float( k ) * 9.1 ), backroomsNoise( q / ( size * 3.7 ) + float( k ) * 4.3 + 17.0 ) ) - 0.5;
		vec2 g = q / size + warp * 0.6 + float( k ) * vec2( 17.3, 5.1 );
		vec2 id = floor( g );
		float salt = float( k ) * 57.0;
		if ( officeHash( id + salt + 1.0 ) >= share ) continue;
		float r = ( k == 2 ? 0.12 : 0.14 ) + 0.18 * officeHash( id + salt + 3.0 );
		// Where in its cell (all of it inside the cell, however it's shaped).
		vec2 centre = vec2( officeHash( id + salt + 7.0 ), officeHash( id + salt + 13.0 ) ) * ( 1.0 - 2.7 * r ) + 1.35 * r;
		vec2 d = fract( g ) - centre;
		// Heavier at the bottom: fuller below its middle than above, the big ones most; and not quite round.
		float sag = k == 2 ? 0.3 : 0.14;
		d.y *= d.y > 0.0 ? 1.0 + sag : 1.0 - sag * 0.6;
		float h = officeHash( id + salt + 19.0 );
		float a = atan( d.y, d.x );
		float round_ = r * ( 1.0 + 0.09 * sin( a * 3.0 + h * 40.0 ) + 0.05 * sin( a * 5.0 + h * 90.0 ) );
		float len = length( d ) / round_;
		float edge = 0.8 * pixel / ( size * round_ );
		float inside = ( 1.0 - smoothstep( 1.0 - edge, 1.0 + edge, len ) ) * seen;
		if ( inside <= 0.0 ) continue;
		// (The bigger over the smaller.)
		slope = mix( slope, d / round_, inside );
		rim = mix( rim, smoothstep( 0.35, 1.0, len ), inside );
		big = mix( big, 2.0 * size * round_ / pixel, inside );
		cover = max( cover, inside );
	}
	return cover;
}

// Whether the edge a point on a window's plane is on is a window: its cell's first byte (see cellBytes), for the cell
// that owns it (the one on its low side), and whether it's along x (a wall across x, the +x edge) or z.
float officeWindowEdge( vec2 owner, bool acrossX ) {
	float r = floor( cellState( owner ).r * 255.0 + 0.5 );
	return mod( floor( r / ( acrossX ? ${BYTE_WINDOW_X}.0 : ${BYTE_WINDOW_Z}.0 ) ), 2.0 );
}

// How far down the blind is in the window in the edge owned by \`owner\` (across x, or z): the height of its foot, or over
// the window's head where it's up. (As blindFoot in abandonedOffice.js works it out, for the blinds themselves.)
float officeBlind( vec2 owner, bool acrossX ) {
	vec2 id = owner * vec2( 1.0, 3.0 ) + ( acrossX ? vec2( 17.0, 5.0 ) : vec2( 41.0, 11.0 ) );
	if ( officeHash( id ) > ${FLOAT(BLIND_SHARE)} ) return HEAD_Y + 1.0;
	return HEAD_Y - ( 0.12 + 0.88 * officeHash( id + 29.0 ) ) * ( HEAD_Y - SILL_Y );
}

// How much light gets through a window at (u, y), u across its bay from the middle, y up it: through the glass, none
// through the piers, the mullion down the middle, the frame and the sill. soft: how far its edges are blurred (the sky
// isn't a point, and the further the light's come from the glass, the softer they get).
float officeGlazing( float u, float y, float soft ) {
	float open = ( 1.0 - smoothstep( GLASS_HALF - 0.012 - soft, GLASS_HALF - 0.012 + soft, abs( u ) ) )
		* smoothstep( SILL_Y + 0.012 - soft, SILL_Y + 0.012 + soft, y )
		* ( 1.0 - smoothstep( HEAD_Y - 0.012 - soft, HEAD_Y - 0.012 + soft, y ) );
	float mullion = smoothstep( 0.011 - soft, 0.011 + soft, abs( u ) );
	return open * mullion;
}
`;

/**
 * The light through the windows and the lights things have of their own (see LEVEL_DIRECT). After OFFICE_GLSL, in
 * the lit materials.
 */
const OFFICE_LIGHTS_GLSL = /* glsl */ `
// Whether what's being drawn is a light of its own (a vending machine's front, a screen, an EXIT sign): the nearest
// light of its own is its own, which doesn't light it (see FRAGMENT_LIGHT).
bool officeSelfLit = false;

// The light coming in through a window onto p, from outside along toLight (unit, out through the glass and up): the
// window's colour at p, from the cell's second byte (see cellBytes), 0 where the way back to the sky is a pier, the sill,
// a wall. fill is how open the cell is to the sky (0 to 1), and toWindow the way to the glass.
vec3 officeThroughWindow( vec3 p, vec3 lean, float strength, float rain, out vec3 toLight, out float fill, out vec3 toWindow ) {
	toLight = vec3( 0.0, 1.0, 0.0 );
	fill = 0.0;
	toWindow = vec3( 0.0, 1.0, 0.0 );
	vec2 cell = floor( p.xz + 0.5 );
	float g = floor( cellState( cell ).g * 255.0 + 0.5 );
	if ( g < 127.5 ) return vec3( 0.0 );
	g -= 128.0;
	float way = floor( g / 32.0 );
	float k = mod( floor( g / 8.0 ), 4.0 );
	fill = mod( g, 8.0 ) / 7.0;
	vec2 d = way < 0.5 ? vec2( 1.0, 0.0 ) : way < 1.5 ? vec2( -1.0, 0.0 ) : way < 2.5 ? vec2( 0.0, 1.0 ) : vec2( 0.0, -1.0 );
	toWindow = vec3( d.x, 0.0, d.y );
	bool acrossX = abs( d.x ) > 0.5;
	// Where the glass is, across its axis.
	float plane = ( acrossX ? cell.x : cell.y ) + ( acrossX ? d.x : d.y ) * ( k + 0.5 );
	// The light: out through the glass, up, and across by lean.x (the moon's, or where the lightning struck).
	vec2 side = vec2( -d.y, d.x );
	toLight = normalize( vec3( d.x + side.x * lean.x, lean.y, d.y + side.y * lean.x ) );
	float out_ = acrossX ? toLight.x : toLight.z;
	float t = ( plane - ( acrossX ? p.x : p.z ) ) / out_;
	if ( t < -0.05 ) return vec3( 0.0 );
	vec3 h = p + toLight * max( t, 0.0 );
	float s = acrossX ? h.z : h.x;
	float bay = floor( s + 0.5 );
	vec2 owner = acrossX ? vec2( plane - 0.5, bay ) : vec2( bay, plane - 0.5 );
	float window = officeWindowEdge( owner, acrossX );
	if ( window < 0.5 ) return vec3( 0.0 );
	float soft = 0.006 + max( t, 0.0 ) * 0.035;
	float through = officeGlazing( s - bay, h.y, soft );
	if ( through <= 0.0 ) return vec3( 0.0 );
	// Where its blind's down, only what gets between the slats.
	float foot = officeBlind( owner, acrossX );
	through *= 1.0 - 0.72 * smoothstep( foot - soft - 0.004, foot + soft + 0.004, h.y );
	// The drops on the glass, thrown across with it: each a lens, a bright point ringed by its shadow; blurred the further
	// it's come, till there's only the film, which dims it a little.
	if ( rain > 0.0 ) {
		vec2 slope;
		float rim;
		float big;
		float film;
		float drop = officeDrops( vec2( s, h.y ), 0.004 + t * 0.02, slope, rim, big, film );
		float lens = drop * ( 1.0 - smoothstep( 0.0, 0.55, length( slope ) ) );
		through *= 1.0 + rain * ( lens * 0.4 - drop * rim * 0.3 ) / ( 1.0 + t * 2.0 ) - rain * film * 0.6;
	}
	return vec3( through * strength );
}

// The light of the nearest thing with a light of its own at p (the cell's first and third bytes: its kind, and where it
// is), and the way to it.
vec3 officeEmitterLight( vec3 p, out vec3 toLight ) {
	toLight = vec3( 0.0, 1.0, 0.0 );
	vec2 cell = floor( p.xz + 0.5 );
	vec4 bytes = floor( cellState( cell ) * 255.0 + 0.5 );
	if ( bytes.r < ${BYTE_EMITTER}.0 - 0.5 ) return vec3( 0.0 );
	float kind = mod( floor( bytes.r / ${1 << EMITTER_SHIFT}.0 ), 4.0 );
	vec2 code = vec2( mod( bytes.b, 16.0 ), floor( bytes.b / 16.0 ) );
	vec2 at = cell + ( code - ${EMIT_BIAS}.0 ) / ${EMIT_STEPS}.0;
	float range = kind < 0.5 ? ${FLOAT(EMIT_RANGE[EMIT_VENDING])} : kind < 1.5 ? ${FLOAT(EMIT_RANGE[EMIT_SCREEN])} : ${FLOAT(EMIT_RANGE[EMIT_EXIT])};
	float height = kind < 0.5 ? ${FLOAT(EMIT_Y[EMIT_VENDING])} : kind < 1.5 ? ${FLOAT(EMIT_Y[EMIT_SCREEN])} : ${FLOAT(EMIT_Y[EMIT_EXIT])};
	vec3 d = vec3( at.x, height, at.y ) - p;
	float r = length( d );
	if ( r > range ) return vec3( 0.0 );
	toLight = d / max( r, 1e-4 );
	float fall = pow( 1.0 - r / range, 2.0 ) * ( 0.5 + 1.2 * exp( - r * 5.0 ) );
	vec3 color;
	if ( kind < 0.5 ) {
		// A vending machine: bright, cold, a little green; its tubes hum and waver.
		color = vec3( 0.82, 1.0, 1.04 ) * 0.8 * ( 0.96 + 0.04 * sin( lightTime * 7.3 + at.x * 3.0 ) ) * ( 1.0 - blackout );
	} else if ( kind < 1.5 ) {
		// A screen: blue, and never quite steady.
		color = vec3( 0.32, 0.46, 1.0 ) * 0.9 * ( 0.9 + 0.1 * sin( lightTime * 11.0 + at.y * 5.0 ) ) * ( 1.0 - blackout );
	} else {
		// An EXIT sign: red, on its battery through a power cut.
		color = vec3( 1.0, 0.1, 0.07 ) * 0.7;
	}
	return color * fall;
}
`;

/** The glow of the air: the haze, and outside, the fog and the rain. After OFFICE_GLSL. */
export const OFFICE_AIR_GLSL = /* glsl */ `
// The fog out in a light well, over a colour seen d away at p: it closes in fast, and deeper still below; lit by the
// lightning.
vec3 officeOutsideAir( vec3 color, vec3 p, float d ) {
	float fog = 1.0 - exp( - 0.16 * d );
	fog = max( fog, smoothstep( -1.5, FACADE_BOTTOM + 1.0, p.y ) );
	fog = max( fog, smoothstep( 2.0, FACADE_TOP + 1.5, p.y ) * 0.7 );
	vec3 air = OUTSIDE * ( 1.0 + 0.6 * smoothstep( 0.0, -6.0, p.y ) ) + FLASH * lightning.x * ( 0.16 + 0.12 * lightning.w );
	return mix( color, air, fog );
}
`;

/** Level 4's air: the haze, the lightning in it near the windows, and outside, its own. */
const OFFICE_AIR_INSIDE_GLSL = /* glsl */ `
// Whether p is out in a light well, and not against the walls round it (the building's face): where the floor and
// the ceiling every chunk has aren't (see FRAGMENT_FLOOR and FRAGMENT_CEILING), nor the soft shade along the walls.
bool officeOpenSky( vec3 p ) {
	vec2 cell = floor( p.xz + 0.5 );
	if ( mod( floor( cellState( cell ).r * 255.0 + 0.5 ), 8.0 ) < ${LOOK_WELL}.0 - 0.5 ) return false;
	vec2 o = p.xz - cell;
	bool wallX = abs( o.x ) > 0.4595 && mod( floor( cellState( cell + vec2( sign( o.x ), 0.0 ) ).r * 255.0 + 0.5 ), 8.0 ) < ${LOOK_WELL}.0 - 0.5;
	bool wallZ = abs( o.y ) > 0.4595 && mod( floor( cellState( cell + vec2( 0.0, sign( o.y ) ) ).r * 255.0 + 0.5 ), 8.0 ) < ${LOOK_WELL}.0 - 0.5;
	return !wallX && !wallZ;
}

vec3 officeAir( vec3 color, vec3 haze, float fogFactor, float area ) {
	vec3 p = vBackroomsWorldPosition;
	vec2 cell = floor( p.xz + 0.5 );
	vec4 bytes = floor( cellState( cell ) * 255.0 + 0.5 );
	float look = mod( bytes.r, 8.0 );
	vec3 result;
	if ( look > ${LOOK_WELL}.0 - 0.5 ) {
		// Out in a light well. (What's drawn on the floor and the ceiling there, which aren't: the soft shade along the
		// walls' feet and tops, gone.)
		if ( ( abs( p.y ) < 0.03 || abs( p.y - 1.0 ) < 0.03 ) && officeOpenSky( p ) ) gl_FragColor.a = 0.0;
		result = officeOutsideAir( color, p, length( p - cameraPosition ) );
	} else {
		// All haze by the far end of the view, so what's there meets the dark past it without an edge.
		float depth = - ( viewMatrix * vec4( p, 1.0 ) ).z;
		float fog = max( fogFactor, smoothstep( ${(VIEW_DISTANCE * 0.72).toFixed(2)}, ${(VIEW_DISTANCE - 0.2).toFixed(2)}, depth ) );
		// The lightning, lighting up the air by the windows.
		float open = bytes.g > 127.5 ? mod( bytes.g, 8.0 ) / 7.0 : 0.0;
		result = mix( color, haze, fog ) + FLASH * lightning.x * open * fog * 0.35;
	}
	return result;
}
`;

/** Level 4's part of every shader compiled for it (see levelShading.js). */
export const ABANDONED_OFFICE_SHADING = /* glsl */ `
${OFFICE_GLSL}
${OFFICE_LIGHTS_GLSL}
${OFFICE_AIR_GLSL}
${OFFICE_AIR_INSIDE_GLSL}

vec3 levelLightTint( float code ) {
	return officeTube( code );
}

vec3 levelAir( vec3 color, vec3 haze, float fogFactor, float area ) {
	return officeAir( color, haze, fogFactor, area );
}

// A dead tube: a grey louvre, only as light as the room round it.
const vec3 LEVEL_DEAD_LIGHT = vec3( 0.3, 0.31, 0.32 );
#define LEVEL_DEAD_LIGHT_SHADED

// The night through the windows (and the lightning), and the lights things have of their own. (A macro: it runs in main,
// where the material is. Colours are as they look, so they're scaled by PI for three.js' lights, which divide by it.)
#define LEVEL_DIRECT { \\
	IncidentLight officeLight; \\
	officeLight.visible = true; \\
	vec3 officeP = vBackroomsWorldPosition; \\
	vec3 officeTo; \\
	vec3 officeToWindow; \\
	float officeFill; \\
	vec3 officeNight = officeThroughWindow( officeP, vec3( 0.34, 0.66, 0.0 ), 1.0, 1.0, officeTo, officeFill, officeToWindow ); \\
	if ( officeFill > 0.0 ) { \\
		vec3 officeN = inverseTransformDirection( geometryNormal, viewMatrix ); \\
		float officeFacing = 0.55 + 0.45 * dot( officeN, officeToWindow ); \\
		reflectedLight.indirectDiffuse += material.diffuseColor * ( NIGHT * 0.32 + FLASH * lightning.x * 0.55 ) * officeFill * officeFacing; \\
		if ( officeNight.r > 0.0 ) { \\
			officeLight.direction = normalize( ( viewMatrix * vec4( officeTo, 0.0 ) ).xyz ); \\
			officeLight.color = NIGHT * officeNight * 1.5 * PI; \\
			RE_Direct( officeLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight ); \\
		} \\
		if ( lightning.x > 0.004 ) { \\
			float officeAcross = dot( lightning.yz, normalize( vec2( - officeToWindow.z, officeToWindow.x ) ) ); \\
			vec3 officeFlash = officeThroughWindow( officeP, vec3( officeAcross * 0.75, 0.3 + 0.55 * lightning.w, 0.0 ), 1.0, 0.6, officeTo, officeFill, officeToWindow ); \\
			if ( officeFlash.r > 0.0 ) { \\
				officeLight.direction = normalize( ( viewMatrix * vec4( officeTo, 0.0 ) ).xyz ); \\
				officeLight.color = FLASH * officeFlash * lightning.x * 3.2 * PI; \\
				RE_Direct( officeLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight ); \\
			} \\
		} \\
	} \\
	vec3 officeLit = officeEmitterLight( officeP, officeTo ); \\
	if ( !officeSelfLit && officeLit.r + officeLit.g + officeLit.b > 0.0 ) { \\
		officeLight.direction = normalize( ( viewMatrix * vec4( officeTo, 0.0 ) ).xyz ); \\
		officeLight.color = officeLit * PI; \\
		RE_Direct( officeLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight ); \\
		reflectedLight.indirectDiffuse += material.diffuseColor * officeLit * 0.1; \\
	} \\
}
`;

// ---------------------------------------------------------------------------------------------- the surfaces

/**
 * The patterns the surfaces share, each fading its detail out as it gets smaller than a pixel (`pixel`, in the same
 * units), rather than shimmering.
 */
export const PATTERNS_GLSL = /* glsl */ `
float officeFill( float d, float pixel ) {
	return 1.0 - smoothstep( - pixel, pixel, d );
}

// Board-marked concrete, at (s along the wall, y up it): the boards' grain in bands, the joints between the form's
// panels, the tie holes in rows, and the stains of it being poured and weathered. Its colour, and its relief.
vec3 officeConcrete( vec2 q, float pixel, out float relief ) {
	float detail = 1.0 - smoothstep( 0.004, 0.014, pixel );
	float board = floor( q.y / 0.075 );
	float boardShade = officeHash( vec2( board, floor( q.x / 1.8 ) ) );
	float grain = backroomsNoise( vec2( q.x * 3.0, q.y * 90.0 + board * 7.0 ) ) * 0.6 + backroomsNoise( vec2( q.x * 14.0, q.y * 40.0 ) ) * 0.4;
	vec3 color = vec3( 0.47, 0.47, 0.455 ) * ( 0.9 + 0.1 * boardShade ) * ( 0.93 + 0.1 * grain );
	float edge = officeFill( abs( fract( q.y / 0.075 ) - 0.5 ) * 0.075 - 0.0356, pixel );
	color *= 1.0 - 0.1 * edge * detail;
	// The form's panels, 0.9 across and 0.45 up: a joint, and a tie hole a little in from each corner.
	vec2 panel = vec2( 0.9, 0.45 );
	vec2 f = fract( q / panel ) * panel;
	vec2 toJoint = min( f, panel - f );
	float joint = officeFill( min( toJoint.x, toJoint.y ) - 0.0025, pixel );
	vec2 hole = abs( mod( q + vec2( 0.225, 0.1125 ), vec2( 0.45, 0.225 ) ) - vec2( 0.225, 0.1125 ) );
	float tie = officeFill( length( hole ) - 0.0055, pixel );
	float rim = officeFill( abs( length( hole ) - 0.008 ) - 0.002, pixel );
	color *= 1.0 - 0.18 * joint * detail;
	color = mix( color, color * 0.5, tie * detail );
	color *= 1.0 + 0.05 * rim * detail;
	// Blotches where it cured unevenly, and darker lower down.
	float blotch = backroomsNoise( q * 1.7 + 9.0 ) * 0.6 + backroomsNoise( q * 5.3 ) * 0.4;
	color *= 0.86 + 0.2 * blotch;
	relief = ( 1.0 - joint * 0.8 - tie ) * detail;
	return color;
}

// The carpet: tiles 0.2 across, each laid a quarter-turn from the next, so the pile catches the light one way then the
// other; a fleck in it; and its colour. Returns its colour at p.
vec3 officeCarpet( vec2 p, vec3 dye, float pixel ) {
	vec2 tile = floor( p / 0.2 );
	float turned = mod( tile.x + tile.y, 2.0 );
	vec2 q = turned > 0.5 ? p.yx : p;
	float detail = 1.0 - smoothstep( 0.002, 0.008, pixel );
	float pile = backroomsNoise( vec2( q.x * 160.0, q.y * 30.0 ) ) * 0.55 + backroomsNoise( vec2( q.x * 60.0, q.y * 12.0 ) ) * 0.45;
	vec3 color = dye * ( 0.965 + 0.07 * turned ) * ( 0.975 + 0.05 * officeHash( tile + 3.0 ) );
	color *= mix( 1.0, 0.82 + 0.36 * pile, detail * 0.8 + 0.2 );
	// A fleck of another yarn here and there: a soft tuft, longer along the pile than across it, a shade lighter or
	// darker (none of it square: it's yarn, not pixels).
	vec2 fg = q * vec2( 110.0, 220.0 );
	vec2 fid = floor( fg );
	float fleck = officeHash( fid + 91.0 );
	vec2 fo = ( fract( fg ) - 0.5 - ( vec2( officeHash( fid + 17.0 ), officeHash( fid + 23.0 ) ) - 0.5 ) * 0.4 ) * vec2( 1.0, 2.2 );
	float tuft = 1.0 - smoothstep( 0.12, 0.42, length( fo ) );
	color = mix( color, color * ( fleck > 0.5 ? 1.4 : 0.64 ), step( 0.66, abs( fleck - 0.5 ) * 2.0 ) * tuft * detail * 0.75 );
	// The seams between the tiles.
	vec2 f = fract( p / 0.2 ) * 0.2;
	float seam = officeFill( min( min( f.x, 0.2 - f.x ), min( f.y, 0.2 - f.y ) ) - 0.0012, pixel );
	return color * ( 1.0 - 0.12 * seam * detail );
}
`;

/**
 * The walls, by the cell a face is in front of (found from its own normal): outside, the building's face; round the
 * windows, the glass cut out of them; in the core, bare concrete; elsewhere, paint, a rubber skirting, the marks where
 * pictures hung. Sets officeRelief, officeSheen and officeOutside (for the building's face, which is its own light).
 */
const FRAGMENT_WALL = /* glsl */ `
#include <map_fragment>
float officeRelief = 0.0;
float officeSheen = 0.0;
vec3 officeOutsideColor = vec3( 0.0 );
bool officeOutside = false;
{
	vec3 p = vBackroomsWorldPosition;
	vec3 faceNormal = normalize( cross( dFdx( p ), dFdy( p ) ) );
	if ( dot( faceNormal, cameraPosition - p ) < 0.0 ) faceNormal = - faceNormal;
	bool acrossX = abs( faceNormal.x ) > 0.5;
	vec2 cell = floor( p.xz + faceNormal.xz * 0.2 + 0.5 );
	vec4 bytes = floor( cellState( cell ) * 255.0 + 0.5 );
	float look = mod( bytes.r, 8.0 );
	float along = acrossX ? p.z : p.x;
	float y = p.y;
	float pixel = max( length( fwidth( p ) ), 1e-4 );
	float detail = 1.0 - smoothstep( 0.004, 0.012, pixel );
	float grain = diffuseColor.r;
	// The edge the face is on, and whether it's a window: its owner is the cell on its low side.
	float n = acrossX ? faceNormal.x : faceNormal.z;
	vec2 owner = n > 0.0 ? cell - ( acrossX ? vec2( 1.0, 0.0 ) : vec2( 0.0, 1.0 ) ) : cell;
	float bay = floor( along + 0.5 );
	vec2 ownerCell = acrossX ? vec2( owner.x, bay ) : vec2( bay, owner.y );
	// (Only a wall's face is on an edge; a column's is off in the middle of one.)
	float onEdge = step( abs( fract( acrossX ? p.x : p.z ) - 0.5 ), 0.06 );
	float window = onEdge > 0.5 ? officeWindowEdge( ownerCell, acrossX ) : 0.0;
	float u = along - bay;
	if ( window > 0.5 && abs( u ) < GLASS_HALF && y > SILL_Y && y < HEAD_Y ) discard;
	vec3 color;
	if ( look > ${LOOK_WELL}.0 - 0.5 ) {
		// The building's outside: concrete, streaked where the rain runs off the sills.
		float relief;
		vec3 concrete = officeConcrete( vec2( along * 0.8, y * 0.6 ), pixel, relief ) * 0.55;
		float streak = backroomsNoise( vec2( u * 38.0, y * 1.5 ) ) * ( 1.0 - smoothstep( SILL_Y - 0.6, SILL_Y, y ) ) + backroomsNoise( vec2( u * 45.0 + 3.0, ( y - 1.0 ) * 2.0 ) ) * step( HEAD_Y, y );
		concrete *= 1.0 - 0.45 * smoothstep( 0.45, 0.8, streak );
		officeOutsideColor = concrete;
		officeOutside = true;
		color = vec3( 0.0 );
	} else if ( look > ${LOOK_CORE}.0 - 0.5 && look < ${LOOK_CORE}.0 + 0.5 ) {
		float relief;
		color = officeConcrete( vec2( along, y ), pixel, relief );
		officeRelief = relief;
		officeSheen = 0.05;
	} else {
		// Paint: a warm grey; a meeting room's one wall in its colour. (A kitchen's tiles are its counters': see the
		// furnishings.)
		color = vec3( 0.66, 0.655, 0.63 ) * ( 0.95 + 0.08 * grain );
		float wallId = officeHash( vec2( acrossX ? owner.x * 7.0 : bay * 7.0, acrossX ? bay : owner.y ) + ( acrossX ? 0.5 : 0.0 ) );
		if ( look > ${LOOK_MEETING}.0 - 0.5 && look < ${LOOK_MEETING}.0 + 0.5 && officeHash( vec2( acrossX ? owner.x : owner.y, acrossX ? 1.0 : 2.0 ) ) < 0.5 ) {
			float which = officeHash( cell * 0.25 );
			color = which < 0.33 ? vec3( 0.2, 0.33, 0.34 ) : which < 0.66 ? vec3( 0.46, 0.26, 0.19 ) : vec3( 0.18, 0.22, 0.32 );
			color *= 0.95 + 0.08 * grain;
		}
		// The marks where a picture, a noticeboard, a clock hung, and the holes it hung on: a paler square.
		if ( wallId < 0.16 ) {
			vec2 at = vec2( ( officeHash( vec2( wallId * 100.0, 3.0 ) ) - 0.5 ) * 0.4, 0.5 + officeHash( vec2( wallId * 100.0, 4.0 ) ) * 0.12 );
			vec2 size = vec2( 0.12 + 0.12 * officeHash( vec2( wallId * 100.0, 5.0 ) ), 0.08 + 0.08 * officeHash( vec2( wallId * 100.0, 6.0 ) ) );
			vec2 d = abs( vec2( u, y ) - at ) - size;
			float ghost = officeFill( max( d.x, d.y ), pixel * 2.0 + 0.004 );
			color *= 1.0 + 0.07 * ghost;
			float holes = officeFill( length( vec2( abs( u - at.x ) - size.x * 0.6, y - at.y - size.y - 0.01 ) ) - 0.0025, pixel );
			color *= 1.0 - 0.6 * holes * detail;
		}
		// Scuffs low down, chairs knocked into it at the height of their arms.
		float scuffs = smoothstep( 0.55, 0.85, backroomsNoise( vec2( along * 7.0, y * 60.0 ) ) ) * ( 1.0 - smoothstep( 0.03, 0.14, y ) );
		scuffs += smoothstep( 0.65, 0.9, backroomsNoise( vec2( along * 5.0 + 11.0, y * 40.0 ) ) ) * smoothstep( 0.2, 0.24, y ) * ( 1.0 - smoothstep( 0.27, 0.31, y ) );
		color *= 1.0 - 0.18 * scuffs;
		// The rubber skirting.
		if ( y < 0.036 ) {
			color = vec3( 0.075, 0.078, 0.08 ) * ( 0.9 + 0.2 * grain );
			officeSheen = 0.3;
			officeRelief = smoothstep( 0.03, 0.036, y );
		}
		officeSheen = max( officeSheen, 0.06 );
	}
	// Damp: patches, and worse under the windows.
	float damp = backroomsNoise( vec2( along * 0.9, y * 1.3 + 4.0 ) ) * 0.6 + backroomsNoise( vec2( along * 3.3, y * 4.0 ) ) * 0.4;
	color *= 1.0 - 0.14 * smoothstep( 0.62, 0.84, damp );
	diffuseColor.rgb = color;
}
`;

const NORMAL_WALL = ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd()', '( dHdxy_fwd() + vec2( dFdx( officeRelief ), dFdy( officeRelief ) ) * 0.003 )');

if (import.meta.env?.DEV && NORMAL_WALL === ShaderChunk.normal_fragment_maps) {
    console.warn('abandonedOfficeShading.js: the relief patch no longer applies to this three.js version.');
}

const SPECULAR_WALL = /* glsl */ `
#include <lights_phong_fragment>
material.specularShininess = mix( 8.0, 40.0, officeSheen );
material.specularStrength = officeOutside ? 0.0 : officeSheen * 0.3;
`;

/** The building's face, outside: its own light (the lights inside can't reach it), and the storm's. */
const EMISSIVE_WALL = /* glsl */ `
#include <emissivemap_fragment>
if ( officeOutside ) {
	vec3 p = vBackroomsWorldPosition;
	vec3 lit = OUTSIDE * 3.2 + NIGHT * 0.08 + FLASH * lightning.x * ( 0.5 + 0.4 * lightning.w );
	totalEmissiveRadiance += officeOutsideColor * lit;
}
`;

// ---------------------------------------------------------------------------------------------- floors

/**
 * The floor, by the look of its cell: the carpet tiles (their dye by the look: blue-grey on the floors, darker in the
 * corridors, a meeting room's, an office's), faded by the windows, and on a cleared floor, the dents where the desks and
 * chairs and cabinets stood; the core's vinyl tiles; the kitchens' check. Sets officeShine for the vinyl.
 */
const FRAGMENT_FLOOR = /* glsl */ `
if ( officeOpenSky( vBackroomsWorldPosition ) ) discard;
#include <map_fragment>
float officeShine = 0.0;
{
	vec2 p = vBackroomsWorldPosition.xz;
	vec2 cell = floor( p + 0.5 );
	vec4 bytes = floor( cellState( cell ) * 255.0 + 0.5 );
	float look = mod( bytes.r, 8.0 );
	float pixel = max( length( fwidth( p ) ), 1e-4 );
	float detail = 1.0 - smoothstep( 0.004, 0.016, pixel );
	float grain = diffuseColor.r;
	vec3 color;
	if ( look > ${LOOK_CORE}.0 - 0.5 && look < ${LOOK_KITCHEN}.0 + 0.5 ) {
		// Vinyl tiles, 0.3 across: speckled, each its own shade; in a kitchen, a check. Waxed, and scuffed black.
		vec2 q = p / 0.3;
		vec2 id = floor( q );
		bool check = look > ${LOOK_KITCHEN}.0 - 0.5;
		float alt = mod( id.x + id.y, 2.0 );
		vec3 base = check ? ( alt > 0.5 ? vec3( 0.62, 0.62, 0.6 ) : vec3( 0.24, 0.27, 0.3 ) ) : vec3( 0.55, 0.53, 0.48 ) * ( 0.94 + 0.1 * officeHash( id ) );
		float chips = officeHash( floor( p * 140.0 ) );
		base *= 1.0 + ( step( 0.95, chips ) * 0.14 - step( chips, 0.05 ) * 0.14 ) * detail;
		vec2 f = fract( q );
		float joint = officeFill( min( min( f.x, 1.0 - f.x ), min( f.y, 1.0 - f.y ) ) * 0.3 - 0.0015, pixel );
		color = base * ( 1.0 - 0.3 * joint * detail );
		float marks = smoothstep( 0.88, 0.97, backroomsNoise( vec2( p.x * 30.0 + p.y * 8.0, p.y * 30.0 - p.x * 5.0 ) ) ) * smoothstep( 0.4, 0.7, backroomsNoise( p * 2.0 + 5.0 ) );
		color *= 1.0 - 0.35 * marks * detail;
		float worn = smoothstep( 0.45, 0.8, backroomsNoise( p * 0.9 ) );
		officeShine = ( 1.0 - joint ) * ( 0.7 - 0.5 * worn );
	} else {
		vec3 dye = vec3( 0.19, 0.21, 0.24 );
		if ( look > ${LOOK_ROOM}.0 - 0.5 && look < ${LOOK_ROOM}.0 + 0.5 ) dye = vec3( 0.23, 0.215, 0.2 );
		else if ( look > ${LOOK_CORRIDOR}.0 - 0.5 && look < ${LOOK_CORRIDOR}.0 + 0.5 ) dye = vec3( 0.12, 0.13, 0.14 );
		else if ( look > ${LOOK_MEETING}.0 - 0.5 ) dye = vec3( 0.13, 0.18, 0.2 );
		else if ( look > ${LOOK_CUBICLES}.0 - 0.5 ) dye = vec3( 0.2, 0.2, 0.21 );
		color = officeCarpet( p, dye, pixel );
		// Faded, where it's by the windows.
		float open = bytes.g > 127.5 ? mod( bytes.g, 8.0 ) / 7.0 : 0.0;
		color = mix( color, color * vec3( 1.08, 1.1, 1.16 ) + 0.02, open * 0.6 );
		// Where people walked: flattened, lighter, down the middle of the ways through.
		float worn = backroomsNoise( p * 0.7 + 3.0 ) * 0.7 + backroomsNoise( p * 2.3 ) * 0.3;
		color *= 1.0 + 0.1 * smoothstep( 0.55, 0.85, worn );
		if ( look < ${LOOK_OPEN}.0 + 0.5 ) {
			// The dents, on a cleared floor, where the furniture stood for years: each cell had a desk (its two end panels,
			// or its four feet), a chair (its five castors), or a cabinet (the carpet under it less faded), all square to
			// the room, a row at a time.
			vec2 o = p - cell;
			float h = officeHash( cell + 71.0 );
			float row = officeHash( vec2( floor( cell.x / 2.0 ), 3.0 ) );
			bool turned = row > 0.5;
			vec2 q = turned ? o.yx : o;
			float dent = 0.0;
			float under = 0.0;
			float soft = pixel * 1.5 + 0.002;
			if ( h < 0.42 ) {
				// A desk: its end panels, or its feet.
				if ( h < 0.24 ) {
					vec2 d = vec2( abs( abs( q.x ) - 0.34 ), abs( q.y + 0.04 ) ) - vec2( 0.012, 0.16 );
					dent = officeFill( max( d.x, d.y ), soft );
				} else {
					vec2 d = abs( q - vec2( 0.0, -0.04 ) ) - vec2( 0.33, 0.14 );
					dent = officeFill( length( d ) - 0.012, soft );
				}
				vec2 inside = abs( q - vec2( 0.0, -0.04 ) ) - vec2( 0.34, 0.16 );
				under = officeFill( max( inside.x, inside.y ), 0.02 );
			} else if ( h < 0.66 ) {
				// A chair's castors, a star of five, and the ring they wore round it.
				vec2 c = q - vec2( ( officeHash( cell + 5.0 ) - 0.5 ) * 0.3, 0.2 );
				float a = atan( c.y, c.x ) + officeHash( cell + 9.0 ) * 6.28;
				float r = length( c );
				float spoke = abs( fract( a / 1.2566 + 0.5 ) - 0.5 ) * 1.2566 * r;
				dent = officeFill( length( vec2( spoke, r - 0.095 ) ) - 0.011, soft );
				under = officeFill( r - 0.12, 0.03 ) * 0.4;
			} else if ( h < 0.78 ) {
				// A cabinet, against where the wall of the next row was.
				vec2 d = abs( q - vec2( ( officeHash( cell + 2.0 ) - 0.5 ) * 0.4, 0.3 ) ) - vec2( 0.08, 0.11 );
				under = officeFill( max( d.x, d.y ), soft );
				dent = officeFill( abs( max( d.x, d.y ) ) - 0.006, soft );
			}
			// A cubicle's partition, along the line between two cells.
			if ( officeHash( vec2( floor( ( turned ? p.y : p.x ) + 0.5 ), floor( ( turned ? p.x : p.y ) / 3.0 ) * 11.0 ) ) < 0.12 ) {
				float line = abs( ( turned ? o.y : o.x ) - 0.5 * sign( turned ? o.y : o.x ) );
				dent = max( dent, officeFill( line - 0.016, soft ) );
			}
			color = mix( color, color * vec3( 0.88, 0.9, 0.95 ) * 0.9, under * 0.75 );
			color *= 1.0 - 0.34 * dent * ( 0.3 + 0.7 * detail );
		}
		// Stains: coffee, water from the windows.
		float stain = backroomsNoise( p * 1.1 + 19.0 ) * 0.7 + backroomsNoise( p * 4.0 ) * 0.3;
		color *= 1.0 - 0.22 * smoothstep( 0.7, 0.8, stain ) * ( 1.0 - smoothstep( 0.8, 0.86, stain ) * 0.5 );
	}
	color *= 0.92 + 0.16 * grain;
	diffuseColor.rgb = color;
}
`;

const SPECULAR_FLOOR = /* glsl */ `
#include <lights_phong_fragment>
material.specularShininess = mix( 4.0, 60.0, officeShine );
material.specularStrength = officeShine * 0.45;
`;

// ---------------------------------------------------------------------------------------------- ceilings

/**
 * The ceiling: tiles two feet by four in their grid, fissured, each its own shade, water-stained, a few come out of the
 * grid and gone black, a return grille here and there; in the core, the concrete slab.
 */
const FRAGMENT_CEILING = /* glsl */ `
if ( officeOpenSky( vBackroomsWorldPosition ) ) discard;
#include <map_fragment>
float officeRelief = 0.0;
{
	vec2 p = vBackroomsWorldPosition.xz;
	vec2 cell = floor( p + 0.5 );
	vec4 bytes = floor( cellState( cell ) * 255.0 + 0.5 );
	float look = mod( bytes.r, 8.0 );
	float pixel = max( length( fwidth( p ) ), 1e-4 );
	float detail = 1.0 - smoothstep( 0.004, 0.016, pixel );
	float grain = diffuseColor.r;
	vec3 color;
	if ( look > ${LOOK_CORE}.0 - 0.5 && look < ${LOOK_CORE}.0 + 0.5 ) {
		float relief;
		color = officeConcrete( p * vec2( 1.0, 0.7 ), pixel, relief ) * 0.9;
		officeRelief = relief;
	} else {
		// The grid: tiles 0.25 across x and 0.5 along z, centred on the cells (a light slot's troffer takes one).
		vec2 q = ( p + vec2( 0.125, 0.25 ) ) / vec2( 0.25, 0.5 );
		vec2 id = floor( q );
		vec2 f = fract( q ) * vec2( 0.25, 0.5 );
		float toBar = min( min( f.x, 0.25 - f.x ), min( f.y, 0.5 - f.y ) );
		float bar = officeFill( toBar - 0.006, pixel );
		float h = officeHash( id + 41.0 );
		// Fissures and pinholes in the mineral fibre, and each tile a shade of its own.
		float worm = backroomsNoise( p * vec2( 130.0, 95.0 ) + id * 3.0 );
		float fissure = smoothstep( 0.64, 0.7, worm ) * ( 1.0 - smoothstep( 0.7, 0.76, worm ) );
		float pits = step( 0.88, officeHash( floor( p * 320.0 ) ) );
		float fine = 1.0 - smoothstep( 0.002, 0.007, pixel );
		vec3 tile = vec3( 0.64, 0.64, 0.62 ) * ( 0.93 + 0.1 * h ) * ( 1.0 - 0.14 * fissure * fine - 0.12 * pits * fine );
		// Sagging a little in the middle.
		vec2 c = ( f - vec2( 0.125, 0.25 ) ) / vec2( 0.125, 0.25 );
		tile *= 1.0 - 0.06 * ( 1.0 - dot( c, c ) * 0.5 );
		float kind = officeHash( id + 97.0 );
		if ( kind < 0.018 ) {
			// Gone: the dark above, and a duct in it.
			tile = vec3( 0.012, 0.012, 0.014 ) + vec3( 0.03 ) * smoothstep( 0.3, 0.32, abs( c.x ) ) * ( 1.0 - smoothstep( 0.6, 0.62, abs( c.x ) ) );
		} else if ( kind < 0.05 ) {
			// Pushed up out of the grid at one end, askew: in shadow along it.
			tile *= 0.55 + 0.35 * smoothstep( -1.0, 1.0, c.y );
		} else if ( kind < 0.08 ) {
			// A return grille: a grid of slots.
			vec2 g = abs( fract( f / 0.018 ) - 0.5 );
			float slot = officeFill( max( g.x, g.y ) - 0.3, pixel / 0.018 ) * officeFill( max( abs( c.x ), abs( c.y ) ) - 0.85, pixel * 4.0 );
			tile = mix( vec3( 0.7, 0.7, 0.69 ), vec3( 0.05 ), slot * detail );
		} else if ( kind < 0.16 ) {
			// A water stain, rings of brown.
			float r = length( c * vec2( 1.0, 1.4 ) + ( vec2( officeHash( id + 5.0 ), officeHash( id + 6.0 ) ) - 0.5 ) ) + ( backroomsNoise( p * 40.0 ) - 0.5 ) * 0.25;
			float stain = 1.0 - smoothstep( 0.4, 0.7, r );
			float ring = smoothstep( 0.55, 0.7, r ) * ( 1.0 - smoothstep( 0.7, 0.78, r ) );
			tile = mix( tile, tile * vec3( 0.82, 0.7, 0.52 ), stain * 0.4 + ring * 0.6 );
		}
		color = mix( tile, vec3( 0.74, 0.74, 0.72 ), bar * detail + 0.15 * ( 1.0 - detail ) );
		officeRelief = bar * detail * 0.25;
	}
	color *= 0.92 + 0.12 * grain;
	diffuseColor.rgb = color;
}
`;

const NORMAL_CEILING = ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd()', '( dHdxy_fwd() + vec2( dFdx( officeRelief ), dFdy( officeRelief ) ) * 0.002 )');

/** The ceiling catches the light off the floor under a lit troffer, so it's never black round one. */
const BOUNCE = /* glsl */ `
#include <emissivemap_fragment>
{
	vec3 tint;
	vec2 nearest = floor( ( vBackroomsWorldPosition.xz - 1.0 ) * 0.5 + 0.5 ) * 2.0 + 1.0;
	float on = officeSlotOn( nearest, tint );
	float halo = 1.0 - smoothstep( 0.1, 0.8, length( ( vBackroomsWorldPosition.xz - nearest ) * vec2( 1.0, 0.6 ) ) );
	totalEmissiveRadiance += diffuseColor.rgb * ( 0.05 * backroomsArea + 0.14 * on * halo * halo * tint );
}
`;

// ---------------------------------------------------------------------------------------------- furniture

/**
 * What most of Level 4's own meshes are made of (the furniture, the doors, the piers and the frames of the windows), by
 * their finish attribute (see F_* in abandonedOfficeGeometry.js): paint, the partitions' fabric, aluminium and steel,
 * wood-grain laminate, plastic, glass, vinyl, concrete, rubber.
 */
const VERTEX_FINISH_DECLARATIONS = /* glsl */ `
attribute vec2 finish;
varying vec2 vFinish;
`;

const VERTEX_FINISH = /* glsl */ `
#include <begin_vertex>
vFinish = finish;
`;

const FRAGMENT_FINISH_DECLARATIONS = /* glsl */ `
varying vec2 vFinish;
`;

const FRAGMENT_FINISH = /* glsl */ `
#include <color_fragment>
float officeShine = 0.08;
float officeSharp = 10.0;
{
	float kind = floor( vFinish.x + 0.5 );
	float wear = vFinish.y;
	vec3 p = vBackroomsWorldPosition;
	vec3 n = normalize( inverseTransformDirection( vNormal, viewMatrix ) );
	// Along the face: which way it's flat decides which two of x, y and z its pattern runs in.
	vec2 q = abs( n.y ) > 0.5 ? p.xz : abs( n.x ) > 0.5 ? vec2( p.z, p.y ) : vec2( p.x, p.y );
	vec3 base = diffuseColor.rgb;
	if ( kind > 0.5 && kind < 1.5 ) {
		// The partitions' fabric: a fine weave, fuzzy, never shining.
		float weave = backroomsNoise( q * 420.0 ) * 0.5 + backroomsNoise( q * vec2( 90.0, 30.0 ) ) * 0.5;
		base *= 0.86 + 0.24 * weave;
		officeShine = 0.0;
	} else if ( kind > 1.5 && kind < 2.5 ) {
		// Aluminium, steel: brushed, a soft sheen (not a mirror: seen square on, the flashlight would white out a whole
		// lift door; three.js makes a highlight brighter the tighter it is).
		base *= 0.88 + 0.16 * backroomsNoise( vec2( q.x * 4.0, q.y * 300.0 ) );
		officeShine = 0.14;
		officeSharp = 40.0;
	} else if ( kind > 2.5 && kind < 3.5 ) {
		// Wood-grain laminate: pale, its grain printed on.
		float g = backroomsNoise( vec2( q.x * 3.0, q.y * 60.0 ) + wear * 7.0 ) * 0.7 + backroomsNoise( vec2( q.x * 12.0, q.y * 200.0 ) ) * 0.3;
		base *= 0.88 + 0.2 * g;
		officeShine = 0.3;
		officeSharp = 30.0;
	} else if ( kind > 3.5 && kind < 4.5 ) {
		// Plastic, gone yellow.
		base *= mix( vec3( 1.0 ), vec3( 1.0, 0.96, 0.84 ), wear ) * ( 0.94 + 0.08 * backroomsNoise( q * 80.0 ) );
		officeShine = 0.18;
		officeSharp = 18.0;
	} else if ( kind > 4.5 && kind < 5.5 ) {
		// Glass: a dead screen, a door's light. Dark, and it shines: the reflection of a light in it is a point (the
		// flashlight's too, square on), not a sheen over it all, nor white all over a small pane.
		officeShine = 0.03;
		officeSharp = 2000.0;
	} else if ( kind > 5.5 && kind < 6.5 ) {
		// Vinyl, upholstery: a soft sheen.
		base *= 0.85 + 0.2 * backroomsNoise( q * 60.0 );
		officeShine = 0.1;
		officeSharp = 6.0;
	} else if ( kind > 6.5 && kind < 7.5 ) {
		// Concrete.
		float relief;
		base = officeConcrete( q * 0.9, max( length( fwidth( p ) ), 1e-4 ), relief ) * ( base.r + 0.001 ) / 0.47;
		officeShine = 0.03;
	} else if ( kind > 7.5 && kind < 8.5 ) {
		// Rubber, a wheel, a mat.
		officeShine = 0.05;
	} else if ( kind > 9.5 ) {
		// A blind's slats: each catching the light along its curve, a dark line where it overlaps the next.
		float pixel = max( length( fwidth( p ) ), 1e-4 );
		float detail = 1.0 - smoothstep( 0.0015, 0.005, pixel );
		float s = fract( p.y / 0.0085 );
		base *= mix( 0.86, 0.62 + 0.5 * smoothstep( 0.0, 0.7, s ) * ( 1.0 - smoothstep( 0.88, 1.0, s ) ), detail );
		officeShine = 0.12;
		officeSharp = 20.0;
	} else if ( kind > 8.5 ) {
		// Glazed tiles, a little off white each, in their grout: they shine.
		float pixel = max( length( fwidth( p ) ), 1e-4 );
		float detail = 1.0 - smoothstep( 0.004, 0.012, pixel );
		vec2 t = fract( q / 0.05 ) * 0.05;
		float grout = officeFill( min( min( t.x, 0.05 - t.x ), min( t.y, 0.05 - t.y ) ) - 0.0014, pixel );
		base *= 0.95 + 0.07 * officeHash( floor( q / 0.05 ) + 7.0 );
		base = mix( base, base * vec3( 0.6, 0.59, 0.56 ), grout * detail );
		officeShine = 0.55 * ( 1.0 - grout * detail );
		officeSharp = 60.0;
	} else {
		// Paint: a little worn, and uneven where it was rollered.
		base *= 0.955 + 0.05 * backroomsNoise( q * 70.0 ) + 0.04 * ( backroomsNoise( q * 8.0 ) - 0.5 );
		officeShine = 0.12;
		officeSharp = 14.0;
	}
	// Dust on what faces up, grime on what faces down.
	base *= 1.0 - 0.14 * smoothstep( 0.3, 0.9, - n.y );
	base = mix( base, vec3( 0.45, 0.44, 0.42 ), 0.12 * smoothstep( 0.5, 1.0, n.y ) * ( 1.0 - smoothstep( 4.5, 5.5, kind ) * step( kind, 5.5 ) ) );
	diffuseColor.rgb = base;
	float flatFace = 1.0 - smoothstep( 1e-4, 1e-3, length( fwidth( vNormal ) ) );
	officeShine *= 1.0 - 0.65 * flatFace;
}
`;

const SPECULAR_FINISH = /* glsl */ `
#include <lights_phong_fragment>
material.specularShininess = officeSharp;
material.specularStrength = officeShine;
`;

// ---------------------------------------------------------------------------------------------- what's lit

/**
 * What glows (see the displays material in abandonedOfficeMaterials.js), by its light attribute (see ColorBuilder.light):
 * which light slot it goes with (x, y; none: it goes with the power), how bright it glows (z), and what it is (w), which
 * picks the pattern on it from its texture coordinates:
 *
 * 1. a troffer's louvre: a grid of bright parabolic cells, the tubes behind them;
 * 2. a bare tube;
 * 3. a vending machine's front: rows of cans and bottles behind its glass, its lights down the side (its z is which
 *    stock it has, a whole number);
 * 4. a computer screen left on: blue, a few lines of white on it;
 * 5. an EXIT sign's face: the word in red, on its battery through a power cut;
 * 6. a lift's floor indicator: a 4, in amber;
 * 7. a clock's face: its hands going round (not lit);
 * 8. a whiteboard: what was last written on it, half wiped off (not lit);
 * 9. a smoke detector's light, blinking red now and then, on its battery through a power cut.
 */
const VERTEX_LIGHT_DECLARATIONS = /* glsl */ `
attribute vec4 light;
varying vec4 vLight;
`;

const VERTEX_LIGHT = /* glsl */ `
#include <begin_vertex>
vLight = light;
`;

const FRAGMENT_LIGHT_DECLARATIONS = /* glsl */ `
varying vec4 vLight;

// A stroke from a to b, width w: how much of it covers p.
float officeStroke( vec2 p, vec2 a, vec2 b, float w, float pixel ) {
	vec2 pa = p - a;
	vec2 ba = b - a;
	float h = clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 );
	return 1.0 - smoothstep( w - pixel, w + pixel, length( pa - ba * h ) );
}

// The word EXIT, in a box 0..1 across and up.
float officeExit( vec2 q, float pixel ) {
	float w = 0.055;
	float s = 0.0;
	// E
	s = max( s, officeStroke( q, vec2( 0.08, 0.22 ), vec2( 0.08, 0.78 ), w, pixel ) );
	s = max( s, officeStroke( q, vec2( 0.08, 0.78 ), vec2( 0.25, 0.78 ), w, pixel ) );
	s = max( s, officeStroke( q, vec2( 0.08, 0.5 ), vec2( 0.22, 0.5 ), w, pixel ) );
	s = max( s, officeStroke( q, vec2( 0.08, 0.22 ), vec2( 0.25, 0.22 ), w, pixel ) );
	// X
	s = max( s, officeStroke( q, vec2( 0.33, 0.22 ), vec2( 0.52, 0.78 ), w, pixel ) );
	s = max( s, officeStroke( q, vec2( 0.33, 0.78 ), vec2( 0.52, 0.22 ), w, pixel ) );
	// I
	s = max( s, officeStroke( q, vec2( 0.62, 0.22 ), vec2( 0.62, 0.78 ), w, pixel ) );
	// T
	s = max( s, officeStroke( q, vec2( 0.72, 0.78 ), vec2( 0.94, 0.78 ), w, pixel ) );
	s = max( s, officeStroke( q, vec2( 0.83, 0.22 ), vec2( 0.83, 0.78 ), w, pixel ) );
	return s;
}
`;

const FRAGMENT_LIGHT = /* glsl */ `
#include <color_fragment>
float officeGlow = 0.0;
vec3 officeGlowColor = vec3( 0.0 );
// How glossy it is: what glows is its own light, and shows none of the others'.
float officeGloss = 0.0;
{
	float kind = floor( vLight.w + 0.5 );
	vec2 q = vUv;
	float pixel = max( length( fwidth( q ) ), 1e-4 );
	vec3 tint = vec3( 1.0 );
	float on = abs( vLight.x ) + abs( vLight.y ) < 0.5 ? 1.0 - blackout : officeSlotOn( vLight.xy, tint );
	// (The vending machines', the screens' and the EXIT signs' faces are those lights of their own.)
	officeSelfLit = kind > 2.5 && kind < 5.5;
	if ( kind > 0.5 && kind < 1.5 ) {
		// A troffer's louvre: three cells across, eight along, each a parabolic reflector, bright in its heart; the two
		// tubes behind, glimpsed.
		vec2 g = q * vec2( 3.0, 8.0 );
		vec2 f = fract( g ) - 0.5;
		float blade = smoothstep( 0.44 - pixel * 8.0, 0.47, max( abs( f.x ), abs( f.y ) ) );
		float bowl = 1.0 - smoothstep( 0.0, 0.5, length( f * vec2( 1.0, 1.6 ) ) );
		float tubes = ( 1.0 - smoothstep( 0.02, 0.08, abs( q.x - 0.33 ) ) ) + ( 1.0 - smoothstep( 0.02, 0.08, abs( q.x - 0.67 ) ) );
		vec3 silver = vec3( 0.62, 0.64, 0.66 );
		diffuseColor.rgb = mix( silver * ( 0.55 + 0.45 * bowl ), vec3( 0.85 ), blade );
		officeGlow = on * ( 0.35 + 0.75 * bowl * bowl + 0.4 * tubes + 0.3 * blade );
		officeGlowColor = tint;
	} else if ( kind > 1.5 && kind < 2.5 ) {
		// A bare tube.
		diffuseColor.rgb = vec3( 0.7, 0.72, 0.72 );
		officeGlow = on * 1.3;
		officeGlowColor = tint;
	} else if ( kind > 2.5 && kind < 3.5 ) {
		// A vending machine's front: shelves of bottles behind the glass, the coil springs, the tubes down its side.
		// Each machine's stock its own (a whole number: rounded, as interpolated it comes out a hair either side of it,
		// and floored, it would pick another bottle from pixel to pixel).
		vec2 r = vec2( q.x * 6.0, q.y * 6.0 );
		vec2 f = fract( r );
		float stock = floor( vLight.z + 0.5 );
		float item = officeHash( floor( r ) + vec2( stock * 7.0, stock * 3.0 ) );
		vec3 label = item < 0.3 ? vec3( 0.85, 0.82, 0.7 ) : item < 0.55 ? vec3( 0.6, 0.12, 0.1 ) : item < 0.75 ? vec3( 0.12, 0.3, 0.6 ) : vec3( 0.9, 0.6, 0.1 );
		float bottle = ( 1.0 - smoothstep( 0.18, 0.24, abs( f.x - 0.5 ) ) ) * step( 0.15, f.y ) * ( 1.0 - step( 0.85, f.y ) );
		float empty = step( 0.8, officeHash( floor( r ) + 11.0 + stock ) );
		vec3 back = vec3( 0.75, 0.8, 0.8 );
		vec3 front = mix( back, label, bottle * ( 1.0 - empty ) );
		float shelf = 1.0 - smoothstep( 0.02, 0.05, f.y );
		front = mix( front, vec3( 0.3 ), shelf );
		diffuseColor.rgb = front * 0.15;
		officeGlow = on * ( 0.5 + 0.12 * sin( lightTime * 9.0 + q.y * 3.0 ) * step( 0.99, officeHash( vec2( floor( lightTime * 3.0 ), 1.0 ) ) ) );
		officeGlowColor = front * vec3( 0.85, 1.0, 1.0 );
	} else if ( kind > 3.5 && kind < 4.5 ) {
		// A screen left on: blue, a title bar, and a few lines of text, and its scan lines.
		vec3 screen = vec3( 0.05, 0.12, 0.62 );
		float bar = step( 0.86, q.y );
		float lines = step( 0.3, fract( q.y * 14.0 ) ) * step( fract( q.y * 14.0 ), 0.55 ) * step( 0.1, q.x ) * step( q.x, 0.2 + 0.7 * officeHash( vec2( floor( q.y * 14.0 ), 3.0 ) ) ) * step( q.y, 0.78 );
		float cursor = step( 0.5, fract( lightTime * 1.3 ) ) * step( 0.1, q.x ) * step( q.x, 0.14 ) * step( 0.18, q.y ) * step( q.y, 0.22 );
		screen = mix( screen, vec3( 0.7, 0.72, 0.78 ), bar );
		screen = mix( screen, vec3( 0.85, 0.87, 0.95 ), max( lines, cursor ) );
		screen *= 0.9 + 0.1 * sin( q.y * 300.0 );
		diffuseColor.rgb = screen * 0.2;
		officeGlow = on * 1.1 * ( 0.94 + 0.06 * sin( lightTime * 50.0 ) );
		officeGlowColor = screen;
	} else if ( kind > 4.5 && kind < 5.5 ) {
		// EXIT, red on dark.
		float word = officeExit( q, pixel * 1.5 );
		diffuseColor.rgb = mix( vec3( 0.08, 0.02, 0.02 ), vec3( 0.9, 0.2, 0.15 ), word );
		officeGlow = 1.0;
		officeGlowColor = mix( vec3( 0.14, 0.01, 0.01 ), vec3( 1.6, 0.18, 0.1 ), word );
	} else if ( kind > 5.5 && kind < 6.5 ) {
		// A lift's indicator: 4.
		float s = 0.0;
		s = max( s, officeStroke( q, vec2( 0.62, 0.15 ), vec2( 0.62, 0.85 ), 0.07, pixel ) );
		s = max( s, officeStroke( q, vec2( 0.62, 0.85 ), vec2( 0.28, 0.4 ), 0.07, pixel ) );
		s = max( s, officeStroke( q, vec2( 0.28, 0.4 ), vec2( 0.78, 0.4 ), 0.07, pixel ) );
		diffuseColor.rgb = vec3( 0.05 );
		officeGlow = on;
		officeGlowColor = vec3( 1.4, 0.55, 0.1 ) * s;
	} else if ( kind > 6.5 && kind < 7.5 ) {
		// A clock: its marks and its hands, stopped at a time of its own, or still going, backwards.
		vec2 c = q * 2.0 - 1.0;
		float r = length( c );
		float angle = atan( c.x, c.y );
		vec3 face = vec3( 0.86, 0.86, 0.82 );
		float marks = step( 0.72, r ) * step( r, 0.86 ) * ( 1.0 - smoothstep( 0.06, 0.06 + pixel * 12.0, abs( fract( angle / 6.2832 * 12.0 + 0.5 ) - 0.5 ) ) );
		face = mix( face, vec3( 0.08 ), marks );
		float seed = vLight.z;
		float going = step( 0.5, fract( seed * 7.0 ) );
		float minutes = seed * 60.0 - going * lightTime * 0.1;
		for ( int k = 0; k < 2; k ++ ) {
			float a = k == 0 ? minutes : minutes / 12.0 + seed * 20.0;
			float len = k == 0 ? 0.7 : 0.45;
			vec2 along = vec2( sin( a ), cos( a ) );
			float side = abs( dot( c, vec2( along.y, - along.x ) ) );
			float hand = step( -0.08, dot( c, along ) ) * step( dot( c, along ), len ) * ( 1.0 - smoothstep( 0.03, 0.03 + pixel * 3.0, side ) );
			face = mix( face, vec3( 0.05 ), hand );
		}
		diffuseColor.rgb = face * ( 1.0 - smoothstep( 0.9, 1.0, r ) * 0.6 );
		officeGloss = 0.5;
	} else if ( kind > 7.5 && kind < 8.5 ) {
		// A whiteboard: grey ghosts of what was on it, and a little left: boxes and arrows, a list.
		vec3 board = vec3( 0.84, 0.85, 0.84 );
		float ghost = smoothstep( 0.55, 0.8, backroomsNoise( q * vec2( 12.0, 6.0 ) + vLight.z * 50.0 ) );
		board *= 1.0 - 0.1 * ghost;
		vec2 b = abs( q - vec2( 0.3, 0.6 ) ) - vec2( 0.12, 0.1 );
		float box = 1.0 - smoothstep( 0.004, 0.004 + pixel * 2.0, abs( max( b.x, b.y ) ) );
		float arrow = officeStroke( q, vec2( 0.43, 0.6 ), vec2( 0.62, 0.45 ), 0.006, pixel );
		float lines = step( 0.62, q.x ) * step( q.x, 0.62 + 0.25 * officeHash( vec2( floor( q.y * 10.0 ), vLight.z * 9.0 + 0.5 ) ) ) * step( 0.2, q.y ) * step( q.y, 0.4 ) * step( 0.55, fract( q.y * 10.0 ) ) * step( fract( q.y * 10.0 ), 0.7 );
		vec3 ink = fract( vLight.z * 13.0 ) < 0.5 ? vec3( 0.1, 0.15, 0.5 ) : vec3( 0.55, 0.1, 0.1 );
		board = mix( board, ink, max( max( box, arrow ), lines ) * 0.8 );
		diffuseColor.rgb = board;
		officeGloss = 0.3;
	} else if ( kind > 8.5 ) {
		// A smoke detector's light: a blink every few seconds, each its own.
		float blink = step( 0.94, fract( lightTime * 0.35 + vLight.z ) );
		diffuseColor.rgb = vec3( 0.2, 0.03, 0.03 );
		officeGlow = 0.15 + 0.85 * blink;
		officeGlowColor = vec3( 1.8, 0.12, 0.06 );
	}
}
`;

const SPECULAR_LIGHT = /* glsl */ `
#include <lights_phong_fragment>
material.specularStrength = officeGloss;
`;

const EMISSIVE_LIGHT = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += officeGlowColor * officeGlow;
`;

/**
 * What Level 4's own kinds of surface do to three.js' shaders (see SurfaceShading in levelShading.js).
 * @type {Record<string, import('./levelShading.js').SurfaceShading>}
 */
export const ABANDONED_OFFICE_SURFACES = {
    l4wall: (vertex, fragment) => ({
        vertex,
        fragment: PATTERNS_GLSL + fragment
            .replace('#include <map_fragment>', FRAGMENT_WALL)
            .replace('#include <normal_fragment_maps>', NORMAL_WALL)
            .replace('#include <lights_phong_fragment>', SPECULAR_WALL)
            .replace('#include <emissivemap_fragment>', EMISSIVE_WALL),
    }),
    l4floor: (vertex, fragment) => ({
        vertex,
        fragment: PATTERNS_GLSL + fragment.replace('#include <map_fragment>', FRAGMENT_FLOOR).replace('#include <lights_phong_fragment>', SPECULAR_FLOOR),
    }),
    l4ceiling: (vertex, fragment) => ({
        vertex,
        fragment: PATTERNS_GLSL + fragment
            .replace('#include <map_fragment>', FRAGMENT_CEILING)
            .replace('#include <normal_fragment_maps>', NORMAL_CEILING)
            .replace('#include <emissivemap_fragment>', BOUNCE),
    }),
    l4finish: (vertex, fragment) => ({
        vertex: VERTEX_FINISH_DECLARATIONS + vertex.replace('#include <begin_vertex>', VERTEX_FINISH),
        fragment: FRAGMENT_FINISH_DECLARATIONS + PATTERNS_GLSL + fragment
            .replace('#include <color_fragment>', FRAGMENT_FINISH)
            .replace('#include <lights_phong_fragment>', SPECULAR_FINISH),
    }),
    l4light: (vertex, fragment) => ({
        vertex: VERTEX_LIGHT_DECLARATIONS + vertex.replace('#include <begin_vertex>', VERTEX_LIGHT),
        fragment: FRAGMENT_LIGHT_DECLARATIONS + fragment
            .replace('#include <color_fragment>', FRAGMENT_LIGHT)
            .replace('#include <lights_phong_fragment>', SPECULAR_LIGHT)
            .replace('#include <emissivemap_fragment>', EMISSIVE_LIGHT),
    }),
};

// ---------------------------------------------------------------------------------------------- outside

/**
 * The building across a light well (its other floors, above and below ours; see the facade material in
 * abandonedOfficeMaterials.js): its concrete, streaked by the rain; its windows, each looking into a room behind it
 * (worked out along the line of sight: its floor, its ceiling and its lights, its back wall, the partitions in it), a
 * few lit, most dark, blinds down in some; the glass, misted with rain, and the storm in it.
 */
export const FACADE_GLSL = /* glsl */ `
// The room behind a window of the building across the well: at p on the glass (its face's normal n, out of the
// building), seen along dir. storey is which floor (0 ours), bay which window along.
vec3 officeRoomBehind( vec3 p, vec3 n, vec3 dir, float storey, float bay, bool acrossX, float lit ) {
	// Into the room: depth b, across a, up c.
	vec3 into = - n;
	vec3 side = acrossX ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
	float a0 = dot( p, side );
	float c0 = p.y - storey * STOREY;
	float db = dot( dir, into );
	float da = dot( dir, side );
	float dc = dir.y;
	// The room: three bays wide, its middle bay this one's group's; 2.4 deep; floor to ceiling.
	float group = floor( ( bay + 1.0 ) / 3.0 );
	float roomA0 = group * 3.0 - 1.5;
	float roomA1 = roomA0 + 3.0;
	float depth = 2.4;
	float tBack = depth / max( db, 1e-3 );
	float tSide = da > 0.0 ? ( roomA1 - a0 ) / da : da < 0.0 ? ( roomA0 - a0 ) / da : 1e3;
	float tUp = dc > 0.0 ? ( 1.0 - c0 ) / dc : dc < 0.0 ? ( 0.0 - c0 ) / dc : 1e3;
	float t = min( tBack, min( tSide, tUp ) );
	vec3 h = vec3( a0 + da * t, c0 + dc * t, db * t );
	vec3 color;
	float h1 = officeHash( vec2( group * 3.1 + storey * 17.0, storey ) );
	float light = lit;
	if ( t == tUp && dc > 0.0 ) {
		// The ceiling: its tiles, and a troffer every so often, lit or not.
		vec2 g = vec2( h.x, h.z );
		vec2 f = abs( fract( g / vec2( 1.0, 1.0 ) ) - 0.5 );
		float troffer = step( f.x, 0.13 ) * step( f.y, 0.26 );
		color = vec3( 0.5 ) * ( 0.25 + 0.75 * light ) * ( 1.0 - 0.3 * step( 0.47, max( f.x, f.y ) ) );
		color = mix( color, vec3( 1.5, 1.6, 1.7 ) * light + vec3( 0.25 ) * ( 1.0 - light ) * 0.2, troffer );
	} else if ( t == tUp ) {
		// The floor: carpet, lit in pools.
		vec2 f = abs( fract( vec2( h.x, h.z ) ) - 0.5 );
		color = vec3( 0.2, 0.22, 0.25 ) * ( 0.2 + 0.8 * light * ( 0.6 + 0.4 * ( 1.0 - length( f ) ) ) );
	} else if ( t == tBack ) {
		color = vec3( 0.5, 0.5, 0.48 ) * ( 0.15 + 0.7 * light ) * ( 0.8 + 0.2 * smoothstep( 0.0, 1.0, h.y ) );
		// A door at the back, and an EXIT sign over it, in some.
		float door = step( abs( h.x - ( group * 3.0 + ( h1 - 0.5 ) * 1.6 ) ), 0.2 ) * step( h.y, 0.72 );
		color = mix( color, vec3( 0.25, 0.24, 0.22 ) * ( 0.2 + 0.6 * light ), door * step( 0.5, h1 ) );
		float sign_ = step( abs( h.x - ( group * 3.0 + ( h1 - 0.5 ) * 1.6 ) ), 0.07 ) * step( abs( h.y - 0.8 ), 0.025 ) * step( 0.5, h1 );
		color += vec3( 1.2, 0.1, 0.05 ) * sign_;
	} else {
		color = vec3( 0.46, 0.46, 0.45 ) * ( 0.15 + 0.6 * light );
	}
	// The partitions of a cubicle farm, part way in, cutting across the view low down.
	if ( h1 > 0.3 ) {
		float tp = 0.9 / max( db, 1e-3 );
		if ( tp < t && c0 + dc * tp < 0.46 ) {
			float ap = a0 + da * tp;
			float row = step( 0.12, abs( fract( ap * 1.0 ) - 0.5 ) );
			color = vec3( 0.3, 0.32, 0.36 ) * ( 0.12 + 0.55 * light ) * ( 0.8 + 0.2 * row );
		}
	}
	// Someone, very now and then, standing at a lit window, a little way back from the glass, looking out. Never where
	// anything else of theirs is: nobody else is here.
	if ( light > 0.5 && officeHash( vec2( bay * 7.0 + 3.0, storey * 13.0 + ( acrossX ? 5.0 : 0.0 ) ) ) < 0.025 ) {
		float tf = 0.45 / max( db, 1e-3 );
		if ( tf < t ) {
			vec2 f = vec2( a0 + da * tf - bay, c0 + dc * tf );
			float body = length( vec2( f.x / 0.06, max( abs( f.y - 0.32 ) - 0.26, 0.0 ) / 0.06 ) ) - 1.0;
			float shoulders = length( vec2( f.x / 0.095, ( f.y - 0.54 ) / 0.05 ) ) - 1.0;
			float head = length( ( f - vec2( 0.0, 0.66 ) ) / vec2( 0.042, 0.052 ) ) - 1.0;
			if ( min( body, min( shoulders, head ) ) < 0.0 ) color = vec3( 0.012, 0.012, 0.014 );
		}
	}
	// A computer left on in the dark, now and then; and the lightning through the windows.
	color += vec3( 0.2, 0.3, 0.9 ) * 0.4 * step( 0.93, h1 ) * ( 1.0 - light ) * ( 1.0 - smoothstep( 0.0, 0.25, length( vec2( h.x - group * 3.0, h.y - 0.35 ) ) ) );
	color += FLASH * lightning.x * 0.35 * ( 1.0 - smoothstep( 0.0, 2.4, h.z ) );
	return color;
}

// The building's face at p (normal n, out of it), seen from the eye along dir, pixel how much of it a pixel covers.
vec3 officeFacade( vec3 p, vec3 n, vec3 dir, float pixel ) {
	bool acrossX = abs( n.x ) > 0.5;
	float along = acrossX ? p.z : p.x;
	float bay = floor( along + 0.5 );
	float u = along - bay;
	float storey = floor( p.y / STOREY );
	float y = p.y - storey * STOREY;
	float relief;
	vec3 concrete = officeConcrete( vec2( along * 0.8, p.y * 0.6 ), pixel, relief ) * 0.55;
	// Streaks under every sill, where the rain runs off.
	float streak = backroomsNoise( vec2( u * 38.0 + storey * 3.0, y * 1.5 ) ) * step( y, SILL_Y ) + backroomsNoise( vec2( u * 45.0 + storey * 7.0, ( y - 1.0 ) * 2.0 ) ) * step( HEAD_Y, y );
	concrete *= 1.0 - 0.45 * smoothstep( 0.45, 0.8, streak );
	vec3 lit = OUTSIDE * 3.2 + NIGHT * 0.08 + FLASH * lightning.x * ( 0.5 + 0.4 * lightning.w );
	vec3 color = concrete * lit;
	// A slab edge, a line between the floors.
	color *= 1.0 - 0.3 * ( 1.0 - smoothstep( 0.0, 0.02, abs( y - 1.08 ) ) );
	// Its piers stand a little proud: lighter, and their edges catch.
	float pier = smoothstep( GLASS_HALF - 0.004, GLASS_HALF + 0.004, abs( u ) );
	color *= 1.0 + 0.12 * pier;
	bool glass = abs( u ) < GLASS_HALF && y > SILL_Y && y < HEAD_Y && p.y < FACADE_TOP - 0.3;
	if ( glass ) {
		// Which rooms are lit: whole runs of a floor, now and then.
		float group = floor( ( bay + 1.0 ) / 3.0 );
		float h = officeHash( vec2( group + ( acrossX ? 311.0 : 0.0 ), storey + 50.0 ) );
		float lit_ = step( 0.8, h ) * ( 0.7 + 0.3 * officeHash( vec2( bay, storey ) ) );
		// One that flickers.
		lit_ *= h > 0.97 ? step( 0.25, fract( sin( lightTime * 13.0 + bay ) * 43.0 ) ) : 1.0;
		vec3 room = officeRoomBehind( p, n, dir, storey, bay, acrossX, lit_ );
		// Blinds, down some way in some windows: their slats, light between them where the room is.
		float blinds = officeHash( vec2( bay * 1.7, storey * 3.3 ) + 5.0 );
		if ( blinds < 0.4 ) {
			float down = HEAD_Y - ( 0.1 + blinds * 1.6 ) * ( HEAD_Y - SILL_Y );
			if ( y > down ) {
				float slat = fract( y / 0.012 );
				float gap = smoothstep( 0.7, 0.9, slat );
				// (Crooked, one or two.)
				float crooked = officeHash( vec2( bay, storey ) + 9.0 ) < 0.2 ? step( 0.0, u - ( y - down ) * 2.0 ) : 1.0;
				room = mix( vec3( 0.36, 0.36, 0.34 ) * ( lit * 0.9 + lit_ * 0.9 ) + room * 0.1, room, gap * 0.6 * crooked );
			}
		}
		// The glass: the sky in it, fresnel, and the water on it (from here, mostly too small to see: a mist on it).
		float facing = abs( dot( dir, n ) );
		float fresnel = 0.05 + 0.6 * pow( 1.0 - facing, 4.0 );
		vec3 sky = OUTSIDE * 1.4 + FLASH * lightning.x * 0.5;
		vec2 slope;
		float rim;
		float big;
		float film;
		float drop = officeDrops( vec2( along, p.y ), pixel, slope, rim, big, film );
		color = mix( room, sky, fresnel );
		color = mix( color, color * 0.8 + sky * 0.6, film * 1.5 );
		color = color * ( 1.0 - 0.45 * drop * rim ) + ( sky * 1.2 + room * 0.2 ) * drop * ( 1.0 - rim ) * 0.3;
		// The frame round it.
		float frame = step( GLASS_HALF - 0.01, abs( u ) ) + step( abs( u ), 0.008 ) + step( y, SILL_Y + 0.01 ) + step( HEAD_Y - 0.01, y );
		color = mix( color, vec3( 0.2, 0.21, 0.22 ) * lit * 1.4, min( frame, 1.0 ) * 0.8 );
	}
	if ( p.y > FACADE_TOP - 0.3 ) {
		// The parapet, and its coping.
		color = concrete * lit * ( p.y > FACADE_TOP - 0.04 ? 1.3 : 0.9 );
	}
	return color;
}
`;

/**
 * A window of our floor (see the glass material in abandonedOfficeMaterials.js), at p, its normal n facing into the
 * room, seen from the eye: the room faint in it; the water standing on it outside, each drop a little lens, its rim dark,
 * a point of the room's light in it, and in the flashlight's beam, a glint (see officeDrops); the flashlight's own glare
 * in it, square on (at night, the glass is a dark mirror); grime in its corners. Its colour and how much of what's
 * behind it that covers (premultiplied: what it only adds, a glint, covers nothing).
 */
export const GLASS_GLSL = /* glsl */ `
uniform vec4 flashlightBeam;
uniform vec3 flashlightAim;

vec4 officeGlass( vec3 p, vec3 n, vec3 eye, float area ) {
	vec3 toEye = eye - p;
	float dist = length( toEye );
	vec3 v = toEye / dist;
	bool inside = dot( v, n ) > 0.0;
	bool acrossX = abs( n.x ) > 0.5;
	float along = acrossX ? p.z : p.x;
	float pixel = max( length( fwidth( p ) ), 1e-5 );
	float facing = abs( dot( v, n ) );
	float fresnel = 0.03 + 0.5 * pow( 1.0 - facing, 5.0 );
	// What's seen in it: from in the room, the room, faintly; from out in the well, the sky.
	vec3 reflection = inside ? vec3( 0.16, 0.17, 0.18 ) * area : OUTSIDE * 1.6;
	reflection += FLASH * lightning.x * ( inside ? 0.2 : 0.5 );
	vec3 color = reflection * fresnel * fresnel;
	float alpha = fresnel;
	// The flashlight: how much of its beam falls here, and its glare in the glass where the glass faces it.
	vec3 fromLamp = p - flashlightBeam.xyz;
	float lampDist = length( fromLamp );
	vec3 toLamp = - fromLamp / max( lampDist, 1e-4 );
	float beam = inside ? flashlightBeam.w * smoothstep( 0.84, 0.96, dot( - toLamp, flashlightAim ) ) / ( 1.0 + lampDist * lampDist * 0.5 ) : 0.0;
	float mirror = max( dot( reflect( - toLamp, n ), v ), 0.0 );
	color += vec3( 1.0, 0.97, 0.9 ) * beam * ( pow( mirror, 12000.0 ) * 1.6 + pow( mirror, 900.0 ) * 0.18 + pow( mirror, 40.0 ) * 0.02 );
	// The water on it. The drops' surfaces, in the glass's own terms (along it and up it): the eye, the lamp and the
	// lights overhead each show in a drop where its surface faces them.
	vec2 slope;
	float rim;
	float big;
	float film;
	float drop = officeDrops( vec2( along, p.y ), pixel, slope, rim, big, film );
	// (A point of light in a drop too small to see as one would only be a speck.)
	float shows = smoothstep( 4.0, 9.0, big );
	vec2 eyeIn = vec2( acrossX ? v.z : v.x, v.y );
	vec2 lampIn = vec2( acrossX ? toLamp.z : toLamp.x, toLamp.y );
	vec2 glintAt = ( eyeIn + lampIn ) * 0.28;
	vec2 roomAt = vec2( eyeIn.x * 0.3, 0.5 + eyeIn.y * 0.25 );
	float glint = exp( - dot( slope - glintAt, slope - glintAt ) * 90.0 ) * drop * shows;
	float spot = exp( - dot( slope - roomAt, slope - roomAt ) * 40.0 ) * drop * shows;
	float body = drop * ( 1.0 - rim );
	float edge = drop * rim;
	// The film: a mist, faintly lit.
	vec3 catchLight = vec3( 0.2, 0.22, 0.26 ) * ( 0.2 + area ) + NIGHT * 0.25 + FLASH * lightning.x;
	color += catchLight * film * 0.35 + vec3( 0.9, 0.92, 0.95 ) * beam * film * 0.5;
	alpha += film * 0.35;
	// Each drop: its rim dark (the light's bent away from the eye there), its middle only a little lighter than the
	// night through it (it gathers the light from all round); the lights in it; and when the lightning's behind it, its
	// middle bright with the sky, its rim still dark.
	alpha += edge * 0.55 + body * 0.08;
	color = color * ( 1.0 - edge * 0.55 );
	color += NIGHT * body * 0.06 + vec3( 0.95, 0.96, 1.0 ) * spot * ( 0.08 + 0.4 * area );
	color += vec3( 1.0, 0.97, 0.9 ) * glint * beam * 1.6 + body * beam * 0.08;
	color += FLASH * lightning.x * body * 0.3;
	// Grime in the corners, a film all over it.
	float u = along - floor( along + 0.5 );
	float corner = min( ${GLASS_HALF.toFixed(3)} - abs( u ), min( p.y - SILL_Y, HEAD_Y - p.y ) );
	float grime = ( 1.0 - smoothstep( 0.0, 0.06, corner ) ) * 0.5 + smoothstep( 0.5, 0.9, backroomsNoise( vec2( along, p.y ) * 9.0 ) ) * 0.12;
	color = color * ( 1.0 - grime * 0.5 ) + vec3( 0.03, 0.03, 0.025 ) * ( 0.3 + area ) * grime;
	alpha += grime * 0.3 + 0.04;
	if ( !inside ) {
		color = officeOutsideAir( color, p, dist );
	}
	return vec4( color, clamp( alpha, 0.0, 0.85 ) );
}
`;

/**
 * The sky past the far end of the view (see the backdrop in abandonedOfficeMaterials.js): level with the eye, the haze,
 * as bright as the light where you are (the far end of an office); below, the fog down the wells; above, the storm:
 * cloud, lit from under by a city somewhere, and lit through by the lightning, and now and then, near, the bolt itself.
 */
export const SKY_GLSL = /* glsl */ `
vec3 officeSky( vec3 haze, vec3 dir ) {
	float up = dir.y;
	vec3 fog = OUTSIDE * 1.2 + FLASH * lightning.x * ( 0.16 + 0.12 * lightning.w );
	// The clouds, on a ceiling of them overhead, drifting.
	vec2 at = dir.xz / max( up + 0.15, 0.05 ) * 1.4 + vec2( lightTime * 0.02, lightTime * 0.013 );
	float cloud = backroomsNoise( at ) * 0.5 + backroomsNoise( at * 2.3 + 7.0 ) * 0.3 + backroomsNoise( at * 5.1 ) * 0.2;
	vec3 sky = mix( vec3( 0.018, 0.022, 0.032 ), vec3( 0.07, 0.07, 0.08 ), smoothstep( 0.3, 0.75, cloud ) );
	// A glow from under, from the city.
	sky += vec3( 0.09, 0.06, 0.04 ) * ( 1.0 - smoothstep( 0.0, 0.5, up ) ) * 0.6;
	// The lightning, brightest the way it struck, lighting the clouds through.
	vec2 bearing = lightning.yz;
	float toward = 0.5 + 0.5 * dot( normalize( dir.xz + 1e-5 ), bearing );
	sky += FLASH * lightning.x * ( 0.25 + 0.9 * toward * toward ) * ( 0.4 + 0.8 * cloud );
	// The bolt, a jagged line from the clouds down, the way it struck, only for a moment.
	if ( lightningBolt.x > 0.5 && lightningBolt.y < 0.45 ) {
		float azimuth = atan( dir.z, dir.x ) - atan( bearing.y, bearing.x ) + ( fract( lightningBolt.x * 0.137 ) - 0.5 ) * 0.9;
		azimuth = mod( azimuth + 3.14159, 6.28318 ) - 3.14159;
		float x = azimuth;
		float wander = 0.0;
		for ( int k = 0; k < 4; k ++ ) {
			float f = exp2( float( k ) ) * 6.0;
			wander += ( officeHash( vec2( floor( up * f ), lightningBolt.x + float( k ) * 13.0 ) ) - 0.5 ) * 0.09 / exp2( float( k ) );
		}
		float line = abs( x - wander ) * ( 1.0 + 3.0 * up );
		float core = 1.0 - smoothstep( 0.0, 0.006, line );
		float halo = exp( - line * 60.0 );
		float fade = exp( - lightningBolt.y * 9.0 ) * step( 0.05, up ) * ( 1.0 - smoothstep( 0.85, 0.95, up ) );
		sky += vec3( 1.2, 1.25, 1.4 ) * ( core * 2.5 + halo * 0.6 ) * fade * ( 0.5 + lightningBolt.z );
	}
	// Level with the eye, the haze; below, the fog.
	vec3 color = up > 0.0 ? mix( haze, sky, smoothstep( 0.12, 0.3, up ) ) : mix( haze, fog, smoothstep( 0.12, 0.3, - up ) );
	return color;
}
`;
