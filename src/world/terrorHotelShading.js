import { ShaderChunk } from 'three';
import { VIEW_DISTANCE } from '../config.js';
import {
    FLOOR_MARBLE,
    FLOOR_PARQUET,
    FLOOR_SHIFT,
    LAMP_RANGE,
    LAMP_Y,
    LOOK_BALLROOM,
    LOOK_CORRIDOR,
    LOOK_LOBBY,
    LOOK_ROOM,
    LOOK_STAFF,
    PALETTE_SHIFT,
    SCONCE_OUT,
    SCONCE_RANGE,
    SCONCE_Y,
} from './terrorHotel.js';

/*
 * Level 5's shaders: the light, the air, and its surfaces (see terrorHotel.js). These are pieces of GLSL that
 * materials.js puts into three.js' own shaders: TERROR_HOTEL_SHADING into everything drawn while Level 5 is showing (see
 * levelShading.js), and the rest into its own surfaces (TERROR_HOTEL_SURFACES). They share the ceiling lights, the panel
 * states and the haze with every level.
 *
 * The light is incandescent and warm, and there's never much of it: pools under the fittings, dark between. The sconces
 * are lights of their own (LEVEL_DIRECT): each cell knows which of its walls has one (its first byte's top bits), so a
 * point looks at the sconces of its own cell and the four round it. Their tulip shades are open at the top, so most of
 * their light goes up the wall in a fan, and a little down: the scallops of light up every wall of a corridor. Each goes
 * on and off with its light slot. The lamps left on in the lounges and the bedrooms are lights too: a cell near enough
 * to one knows where it is (its second and third bytes), and its light pools on the table, the floor and whatever's
 * close, and glows through its shade. They only go off when the power does.
 *
 * The surfaces are the hotel's: the corridors' walnut dado under cream plaster, red damask panels between the doors in
 * gilt frames and a painted frieze; wallpaper in the guest rooms, each room its own colours; the lobbies' dado of red
 * scagliola, gold-on-red damask between fluted pilasters, and their painted frieze; the ballroom's cream panelling; the
 * staff passages' two coats of paint. Underfoot, the corridors' red and gold carpet with a Greek key round its border,
 * the lobbies' red and gold lattice carpet (or marble), the ballroom's dark damask and its dance floors' parquet, the
 * rooms' own carpets, the staff passages' linoleum. Overhead, plaster, with a rose round every fitting, painted between
 * the lobbies' beams, and coffered in the ballroom.
 */

/** How strong a sconce's light is, and a lamp's, against the ceiling lights'. */
const SCONCE_STRENGTH = 0.3;
const LAMP_STRENGTH = 1.25;

/** The lights' colours, and what every Level 5 shader has. Follows PANEL_LIGHT_GLSL. */
export const TERROR_HOTEL_LIGHT_GLSL = /* glsl */ `
// The colour of the light in a slot, from its fourth byte (see terrorHotel.js): an ordinary bulb, candle bulbs,
// alabaster, crystal, or a bare bulb.
vec3 hotelLamp( float code ) {
	float byte = floor( code * 255.0 + 0.5 );
	if ( byte > 254.5 ) return vec3( 1.0 );
	if ( byte > 253.5 ) return vec3( 1.12, 0.82, 0.56 );
	if ( byte > 252.5 ) return vec3( 1.04, 0.94, 0.8 );
	if ( byte > 251.5 ) return vec3( 1.18, 1.0, 0.74 );
	if ( byte > 250.5 ) return vec3( 1.08, 0.86, 0.58 );
	return vec3( 1.0 );
}

// A cell's four bytes, as 0..255.
vec4 hotelCell( vec2 cell ) {
	return floor( cellState( cell ) * 255.0 + 0.5 );
}

// How bright a light slot is right now (its brightness, its flicker, the power), and its colour.
float hotelSlotOn( vec2 xz, out vec3 tint ) {
	vec4 state = panelState( floor( ( xz - 1.0 ) * 0.5 + 0.5 ) );
	tint = hotelLamp( state.a );
	return state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
}
`;

/** The sconces' and the lamps' light (see LEVEL_DIRECT). After TERROR_HOTEL_LIGHT_GLSL. */
const TERROR_HOTEL_LAMPS_GLSL = /* glsl */ `
const vec2 HOTEL_NEAR[ 5 ] = vec2[ 5 ]( vec2( 0.0 ), vec2( 1.0, 0.0 ), vec2( -1.0, 0.0 ), vec2( 0.0, 1.0 ), vec2( 0.0, -1.0 ) );
// A cell's sconces, by the way to their walls, and their bits (see SCONCE_WALLS in terrorHotel.js).
const vec2 HOTEL_WALL[ 4 ] = vec2[ 4 ]( vec2( -1.0, 0.0 ), vec2( 1.0, 0.0 ), vec2( 0.0, -1.0 ), vec2( 0.0, 1.0 ) );
const float HOTEL_FACE = ${(0.5 - 0.04).toFixed(3)};

// The light of the sconce on the wall of \`cell\` the way \`wall\` goes, at p; toLight is the way to it. Nothing behind its
// wall. Its shades are open at the top: most of its light fans up the wall, some goes down, and a little comes through
// the glass every way.
vec3 hotelSconceLight( vec3 p, vec2 cell, vec2 wall, out vec3 toLight ) {
	toLight = vec3( 0.0, 1.0, 0.0 );
	float front = dot( p.xz - ( cell + wall * HOTEL_FACE ), - wall );
	if ( front < -0.002 ) return vec3( 0.0 );
	vec3 at = vec3( cell.x + wall.x * ( HOTEL_FACE - ${SCONCE_OUT} ), ${SCONCE_Y}, cell.y + wall.y * ( HOTEL_FACE - ${SCONCE_OUT} ) );
	vec3 d = at - p;
	float r = length( d );
	if ( r > ${SCONCE_RANGE} ) return vec3( 0.0 );
	vec3 tint;
	// (It goes on and off with the slot the way it faces: see sconceSlot in terrorHotel.js.)
	float on = hotelSlotOn( at.xz - wall * 0.6, tint );
	if ( on <= 0.0 ) return vec3( 0.0 );
	toLight = d / max( r, 1e-4 );
	float out_ = - toLight.y;
	float shape = 0.12 + 1.4 * smoothstep( 0.2, 0.8, out_ ) + 0.3 * smoothstep( 0.4, 0.95, - out_ );
	float fall = pow( 1.0 - r / ${SCONCE_RANGE}, 2.0 ) * ( 0.6 + 0.8 * exp( - max( r - 0.06, 0.0 ) * 7.0 ) );
	return gridLightColor * tint * vec3( 1.0, 0.86, 0.66 ) * ( on * fall * shape * ${SCONCE_STRENGTH} );
}

// The light of the nearest lamp at p (the cell's second and third bytes: where it is, in eighths, plus 32), toLight the
// way to it. Under its shade it pools; above, less; through the shade, a little, and warmer.
vec3 hotelLampLight( vec3 p, out vec3 toLight ) {
	toLight = vec3( 0.0, 1.0, 0.0 );
	vec4 bytes = hotelCell( floor( p.xz + 0.5 ) );
	vec2 code = vec2( mod( bytes.g, 64.0 ), mod( bytes.b, 64.0 ) );
	if ( code.x + code.y < 0.5 ) return vec3( 0.0 );
	vec2 at = floor( p.xz + 0.5 ) + ( code - 32.0 ) / 8.0;
	vec3 d = vec3( at.x, ${LAMP_Y}, at.y ) - p;
	float r = length( d );
	if ( r > ${LAMP_RANGE} ) return vec3( 0.0 );
	toLight = d / max( r, 1e-4 );
	float down = toLight.y;
	float shape = 0.28 + 1.1 * smoothstep( 0.3, 0.75, down ) + 0.55 * smoothstep( 0.35, 0.8, - down );
	float fall = pow( 1.0 - r / ${LAMP_RANGE}, 2.0 ) * ( 0.45 + 1.3 * exp( - r * 6.0 ) );
	vec3 color = mix( vec3( 1.0, 0.64, 0.34 ), vec3( 1.0, 0.8, 0.56 ), smoothstep( 0.3, 0.75, abs( down ) ) );
	return color * ( ${LAMP_STRENGTH} * fall * shape * ( 1.0 - blackout ) );
}
`;

/** The glow of the lights in the air. After TERROR_HOTEL_LIGHT_GLSL, with the ceiling lights' uniforms. */
export const TERROR_HOTEL_GLOW_GLSL = /* glsl */ `
// The light the haze scatters towards the eye along the line of sight (as Level 2's; see pipeGlow): the fittings nearest
// the eye, which shine every way.
vec3 hotelGlow( vec3 eye, vec3 dir, float dist ) {
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
			float h = sqrt( max( dot( toLight, toLight ) - along * along, 0.0 ) + 0.02 );
			float scattered = min( ( atan( ( dist - along ) / h ) - atan( - along / h ) ) / h, 5.0 );
			sum += hotelLamp( state.a ) * lit * scattered;
		}
	}
	return sum * gridLightColor * ( 0.0045 * gridLightIntensity );
}
`;

/** The air: the haze, and the glow of the lights in it. */
const TERROR_HOTEL_AIR_GLSL = /* glsl */ `
${TERROR_HOTEL_GLOW_GLSL}

vec3 hotelAir( vec3 color, vec3 haze, float fogFactor, float area ) {
	vec3 eye = cameraPosition;
	vec3 p = vBackroomsWorldPosition;
	vec3 ray = p - eye;
	float dist = max( length( ray ), 1e-4 );
	vec3 dir = ray / dist;
	// All haze by the far end of the view, so what's lit out there meets the dark past it without an edge.
	float depth = - ( viewMatrix * vec4( p, 1.0 ) ).z;
	fogFactor = max( fogFactor, smoothstep( ${(VIEW_DISTANCE * 0.72).toFixed(2)}, ${(VIEW_DISTANCE - 0.2).toFixed(2)}, depth ) );
	color = mix( color, haze, fogFactor );
	return color + hotelGlow( eye, dir, dist ) * ( 1.0 - 0.6 * fogFactor );
}
`;

/** Level 5's part of every shader compiled for it (see levelShading.js). */
export const TERROR_HOTEL_SHADING = /* glsl */ `
${TERROR_HOTEL_LIGHT_GLSL}
${TERROR_HOTEL_LAMPS_GLSL}
${TERROR_HOTEL_AIR_GLSL}

vec3 levelLightTint( float code ) {
	return hotelLamp( code );
}

vec3 levelAir( vec3 color, vec3 haze, float fogFactor, float area ) {
	return hotelAir( color, haze, fogFactor, area );
}

// A dead fitting: dull glass, only as light as the room round it.
const vec3 LEVEL_DEAD_LIGHT = vec3( 0.3, 0.27, 0.22 );
#define LEVEL_DEAD_LIGHT_SHADED

// The sconces of a point's own cell and the four round it, and the nearest lamp. (The loops' ends are scaled by
// loopScale, which is 1, so that they stay loops; see materials.js.)
#define LEVEL_DIRECT { \\
	IncidentLight hotelLight; \\
	hotelLight.visible = true; \\
	vec2 hotelHome = floor( vBackroomsWorldPosition.xz + 0.5 ); \\
	for ( int hotelK = 0; hotelK < 5 * loopScale; hotelK ++ ) { \\
		vec2 hotelAt = hotelHome + HOTEL_NEAR[ hotelK ]; \\
		float hotelBits = floor( hotelCell( hotelAt ).r / 16.0 ); \\
		if ( hotelBits < 0.5 ) continue; \\
		for ( int hotelW = 0; hotelW < 4 * loopScale; hotelW ++ ) { \\
			if ( mod( floor( hotelBits / exp2( float( hotelW ) ) ), 2.0 ) < 0.5 ) continue; \\
			vec3 hotelTo; \\
			vec3 hotelColor = hotelSconceLight( vBackroomsWorldPosition, hotelAt, HOTEL_WALL[ hotelW ], hotelTo ); \\
			if ( hotelColor.r <= 0.0 ) continue; \\
			hotelLight.direction = normalize( ( viewMatrix * vec4( hotelTo, 0.0 ) ).xyz ); \\
			hotelLight.color = hotelColor * PI; \\
			RE_Direct( hotelLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight ); \\
		} \\
	} \\
	vec3 hotelTo; \\
	vec3 hotelLamped = hotelLampLight( vBackroomsWorldPosition, hotelTo ); \\
	if ( hotelLamped.r > 0.0 ) { \\
		hotelLight.direction = normalize( ( viewMatrix * vec4( hotelTo, 0.0 ) ).xyz ); \\
		hotelLight.color = hotelLamped * PI; \\
		RE_Direct( hotelLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight ); \\
		reflectedLight.indirectDiffuse += material.diffuseColor * hotelLamped * 0.12; \\
	} \\
}
`;

// ---------------------------------------------------------------------------------------------- patterns

/**
 * The patterns the surfaces share, each from a point in its own units: the damask, the Greek key, wood, and a few more.
 * Each fades its detail out as it gets smaller than a pixel (`pixel`, in the same units), rather than shimmering.
 */
const PATTERNS_GLSL = /* glsl */ `
// Coverage of the inside of a distance field (negative inside), soft over a pixel.
float hotelFill( float d, float pixel ) {
	return 1.0 - smoothstep( - pixel, pixel, d );
}

// The damask: a symmetrical flower-and-leaf motif, on a half-drop repeat (every other column half a repeat down), in
// cells w × h; how much of the motif covers the point (0..1), and how much of its outline (the raised edge, in
// \`edge\`). Its top reads, from far enough off, as a face: two dark hollows and a mouth.
float hotelDamask( vec2 p, vec2 size, float pixel, out float edge, out float face ) {
	vec2 q = p / size;
	float column = floor( q.x );
	q.y += mod( column, 2.0 ) * 0.5;
	vec2 f = fract( q ) * 2.0 - 1.0;
	f.x = abs( f.x );
	float px = pixel / min( size.x, size.y ) * 2.0;
	// The body: a tall pointed oval (a flame), with a smaller one inside.
	vec2 b = f - vec2( 0.0, 0.02 );
	float body = length( b / vec2( 0.42, 0.62 ) ) - 1.0;
	body = max( body, - ( 0.95 - b.y ) * 0.6 );
	float tip = length( ( f - vec2( 0.0, 0.62 ) ) / vec2( 0.1, 0.24 ) ) - 1.0;
	body = min( body, tip );
	float inner = length( ( b - vec2( 0.0, -0.05 ) ) / vec2( 0.22, 0.36 ) ) - 1.0;
	// Leaves curling out at the sides, and small ones at the corners of the repeat.
	float leaf = length( ( f - vec2( 0.62, -0.28 ) ) / vec2( 0.3, 0.16 ) ) - 1.0;
	leaf = min( leaf, length( ( f - vec2( 0.55, 0.3 ) ) / vec2( 0.2, 0.12 ) ) - 1.0 );
	float corner = length( ( f - vec2( 1.0, 1.0 ) ) / vec2( 0.26, 0.2 ) ) - 1.0;
	corner = min( corner, length( ( f - vec2( 1.0, -1.0 ) ) / vec2( 0.26, 0.2 ) ) - 1.0 );
	float stem = max( abs( f.x - 0.28 ) - 0.03, abs( f.y + 0.55 ) - 0.3 );
	float motif = min( min( body, leaf ), min( corner, stem ) );
	// The ground cut back out of it in places: a ring round the inner oval, veins down the leaves.
	float ring = abs( inner * 0.2 ) - 0.02;
	float veins = abs( f.y + 0.28 - ( f.x - 0.62 ) * 0.35 ) - 0.012;
	veins = max( veins, length( ( f - vec2( 0.62, -0.28 ) ) / vec2( 0.26, 0.12 ) ) - 1.0 );
	float cover = hotelFill( motif * 0.3, px ) * ( 1.0 - hotelFill( ring, px ) * 0.8 ) * ( 1.0 - hotelFill( veins, px ) * 0.7 );
	// A lozenge in the middle of the oval, and seeds up the flame.
	float lozenge = abs( f.x ) / 0.07 + abs( f.y + 0.05 ) / 0.13 - 1.0;
	float seeds = length( vec2( f.x, fract( ( f.y - 0.3 ) * 7.0 ) - 0.5 ) / vec2( 0.05, 0.2 ) ) - 1.0;
	seeds = max( seeds, abs( f.y - 0.42 ) - 0.16 );
	cover = max( cover, hotelFill( min( lozenge * 0.06, seeds * 0.04 ), px ) );
	// Its outlines: the edge of it all, and round the inner oval.
	float lines = min( abs( motif * 0.3 ) - 0.018, abs( inner * 0.2 ) - 0.008 );
	edge = hotelFill( lines, px ) * ( 1.0 - smoothstep( 0.05, 0.12, px ) );
	// The face, in the top of the flame: two hollows, and a mouth.
	float eyes = length( ( f - vec2( 0.12, 0.25 ) ) / vec2( 0.06, 0.04 ) ) - 1.0;
	float mouth = length( ( f - vec2( 0.0, 0.07 ) ) / vec2( 0.07, 0.022 ) ) - 1.0;
	face = hotelFill( min( eyes, mouth ) * 0.06, px ) * hotelFill( body * 0.3, px );
	return cover;
}

// The Greek key running along a band (\`s\` along it, \`t\` across, 0 to 1): 1 on the key's line, 0 between.
// (\`depth\` deep: a spiral on a grid of 6 × 6 squares, each joined to the next along the line at its foot.)
float hotelKey( float s, float t, float depth, float pixel ) {
	float unit = depth / 6.0;
	vec2 cell = floor( vec2( fract( s / ( unit * 6.0 ) ) * 6.0, t * 6.0 ) );
	int row = int( clamp( cell.y, 0.0, 5.0 ) );
	int col = int( clamp( cell.x, 0.0, 5.0 ) );
	// Each row's squares, from the left (bit 0), from the foot up.
	int masks[ 6 ] = int[ 6 ]( 63, 1, 29, 21, 17, 31 );
	float on = float( ( masks[ row ] >> col ) & 1 );
	return mix( on, 0.45, smoothstep( 0.4, 0.9, pixel / unit ) );
}

// Wood: long grain along x, the figure wandering through it, and fine fibres; 0..1.
float hotelGrain( vec2 p ) {
	float warp = backroomsNoise( vec2( p.x * 1.4, p.y * 5.0 ) );
	float figure = fract( ( p.y + warp * 0.06 ) * 13.0 + backroomsNoise( vec2( p.x * 0.5, p.y * 2.0 ) ) * 1.6 );
	float fibres = backroomsNoise( vec2( p.x * 3.0, p.y * 110.0 ) ) * 0.6 + backroomsNoise( vec2( p.x * 0.8, p.y * 30.0 ) ) * 0.4;
	return clamp( 0.3 * smoothstep( 0.4, 1.0, figure ) + 0.7 * fibres, 0.0, 1.0 );
}

// Marble: a ground with veins wandering through it; the veins' strength, 0..1.
float hotelVeins( vec2 p ) {
	float n = backroomsNoise( p * 2.1 ) * 0.5 + backroomsNoise( p * 4.3 + 7.0 ) * 0.3 + backroomsNoise( p * 9.7 + 3.0 ) * 0.2;
	float v = abs( sin( ( p.x * 1.3 + p.y * 0.7 + n * 3.4 ) * 3.1 ) );
	return pow( 1.0 - v, 9.0 );
}
`;

// ---------------------------------------------------------------------------------------------- walls

/**
 * The walls, by the look of the cell a face is in front of (found from the face's own normal; see Level 2's): its
 * dado, its upper wall, its frieze. Sets hotelRelief (the panels' and the stone's relief, for the normal) and
 * hotelSheen (how much the surface shines: the damask's satin, the dado's varnish).
 */
const FRAGMENT_WALL = /* glsl */ `
#include <map_fragment>
float hotelRelief = 0.0;
float hotelSheen = 0.0;
{
	vec3 p = vBackroomsWorldPosition;
	vec3 faceNormal = normalize( cross( dFdx( p ), dFdy( p ) ) );
	if ( dot( faceNormal, cameraPosition - p ) < 0.0 ) faceNormal = - faceNormal;
	vec2 cell = floor( p.xz + faceNormal.xz * 0.2 + 0.5 );
	vec4 bytes = hotelCell( cell );
	float look = mod( bytes.r, 8.0 );
	bool acrossX = abs( faceNormal.x ) > 0.5;
	float along = acrossX ? p.z : p.x;
	float cellAlong = acrossX ? cell.y : cell.x;
	// Across the cell, from its middle: −0.5 to 0.5.
	float a = along - cellAlong;
	// (A corridor's panels are down its sides, between the doors: not across its end.)
	bool runsAlongX = mod( floor( bytes.r / 8.0 ), 2.0 ) > 0.5;
	float odd = look < 0.5 && runsAlongX == acrossX ? 0.0 : mod( cellAlong, 2.0 );
	float y = p.y;
	float grain = diffuseColor.r;
	float pixel = max( length( fwidth( p ) ), 1e-4 );
	float detail = 1.0 - smoothstep( 0.004, 0.012, pixel );
	vec3 color;
	float dadoTop = 0.33;
	float friezeFrom = 0.86;
	// Stains: tide marks rising from the floor, and fading at the top.
	float age = backroomsNoise( vec2( along * 0.7, y * 1.1 + 5.0 ) ) * 0.6 + backroomsNoise( vec2( along * 3.1, y * 4.0 ) ) * 0.4;
	if ( look > ${LOOK_LOBBY}.5 && look < ${LOOK_BALLROOM}.5 ) {
		// The ballroom: cream panelling all the way up, gilt picked out round the panels.
		vec3 cream = vec3( 0.62, 0.56, 0.44 ) * ( 0.92 + 0.12 * grain );
		color = cream;
		float frame = 1.0;
		if ( y < dadoTop ) {
			float u = fract( a * 2.0 + 0.5 ) - 0.5;
			frame = min( 0.25 - abs( u ) * 0.5 - 0.03, min( y - 0.07, dadoTop - 0.035 - y ) );
		} else if ( y < friezeFrom && odd > 0.5 ) {
			frame = min( 0.4 - abs( a ), min( y - 0.4, 0.82 - y ) );
		}
		if ( frame < 1.0 ) {
			float line = hotelFill( abs( frame ) - 0.004, pixel );
			float raised = smoothstep( -0.002, 0.012, frame );
			color = mix( color, color * 1.06, raised );
			color = mix( color, vec3( 0.62, 0.46, 0.2 ), line * detail );
			hotelRelief = raised * detail * 0.7;
			hotelSheen = line * 0.6;
		}
	} else if ( look > ${LOOK_CORRIDOR}.5 && look < ${LOOK_ROOM}.5 || look < 0.5 ) {
		if ( y < dadoTop ) {
			// A walnut dado, four raised panels to a cell's length.
			float u = fract( a * 4.0 + 0.5 ) - 0.5;
			float frame = min( 0.125 - abs( u ) * 0.25 - 0.022, min( y - 0.075, dadoTop - 0.035 - y ) );
			vec2 w = vec2( frame > 0.0 ? y : along, frame > 0.0 ? along * 3.0 : y * 3.0 );
			float wood = hotelGrain( vec2( w.x * 4.0, w.y ) );
			vec3 walnut = mix( vec3( 0.2, 0.1, 0.055 ), vec3( 0.33, 0.18, 0.1 ), wood ) * ( 0.85 + 0.3 * grain );
			float raised = smoothstep( -0.004, 0.006, frame );
			float bevel = smoothstep( 0.0, 0.012, frame ) - raised * 0.0;
			color = walnut * ( 0.82 + 0.25 * raised );
			color *= 1.0 - 0.35 * ( 1.0 - smoothstep( 0.0, 0.004, abs( frame ) ) ) * detail;
			hotelRelief = bevel * detail;
			hotelSheen = 0.35;
		} else if ( look > 0.5 ) {
			// A guest room's wallpaper: the damask, in the room's colours.
			float palette = floor( bytes.g / ${1 << PALETTE_SHIFT}.0 );
			vec3 ground = palette < 0.5 ? vec3( 0.2, 0.26, 0.18 ) : palette < 1.5 ? vec3( 0.46, 0.34, 0.15 ) : palette < 2.5 ? vec3( 0.19, 0.23, 0.3 ) : vec3( 0.42, 0.19, 0.18 );
			vec3 figure = palette < 0.5 ? vec3( 0.36, 0.4, 0.28 ) : palette < 1.5 ? vec3( 0.62, 0.5, 0.26 ) : palette < 2.5 ? vec3( 0.34, 0.38, 0.44 ) : vec3( 0.58, 0.34, 0.3 );
			float edge;
			float face;
			float cover = hotelDamask( vec2( along, y ), vec2( 0.13, 0.19 ), pixel, edge, face );
			color = mix( ground, figure, cover * 0.75 ) * ( 0.9 + 0.2 * grain );
			color = mix( color, figure * 1.25, edge * 0.5 );
			color *= 1.0 - face * 0.14;
			hotelSheen = cover * 0.25;
		} else {
			// The corridors: cream plaster, and between the doors (on the cells a light's over) a panel of red damask in
			// a gilt frame.
			vec3 plaster = vec3( 0.66, 0.58, 0.44 ) * ( 0.9 + 0.18 * grain );
			color = plaster;
			if ( odd > 0.5 && y < friezeFrom ) {
				float frame = min( 0.39 - abs( a ), min( y - 0.4, 0.82 - y ) );
				if ( frame > -0.02 ) {
					float edge;
					float face;
					float cover = hotelDamask( vec2( a + 0.065, y - 0.41 ), vec2( 0.13, 0.19 ), pixel, edge, face );
					vec3 red = mix( vec3( 0.25, 0.055, 0.045 ), vec3( 0.36, 0.1, 0.075 ), cover ) * ( 0.88 + 0.2 * grain );
					red = mix( red, vec3( 0.5, 0.33, 0.14 ), edge * 0.4 );
					red *= 1.0 - face * 0.12;
					float inside = hotelFill( - ( frame - 0.018 ), pixel );
					color = mix( plaster, red, inside );
					// The gilt frame: a bead round the panel, with a shadow on its inner side.
					float gilt = hotelFill( abs( frame - 0.009 ) - 0.006, pixel );
					float shadow = hotelFill( abs( frame - 0.021 ) - 0.003, pixel ) * 0.5;
					color *= 1.0 - shadow * detail;
					color = mix( color, vec3( 0.66, 0.5, 0.22 ) * ( 0.8 + 0.3 * grain ), gilt );
					hotelRelief = gilt * detail;
					hotelSheen = gilt * 0.8 + inside * cover * 0.35;
				}
			}
		}
	} else if ( look < ${LOOK_LOBBY}.5 ) {
		vec3 gold = vec3( 0.62, 0.46, 0.2 ) * ( 0.85 + 0.3 * grain );
		if ( y < dadoTop ) {
			// The lobbies: a dado of red scagliola, veined, in panels picked out in gilt.
			vec2 q = vec2( along + y * 0.3, y * 1.3 );
			float veins = hotelVeins( q * 2.2 + 3.0 );
			float cloud = backroomsNoise( q * 3.0 ) * 0.6 + backroomsNoise( q * 11.0 ) * 0.4;
			vec3 marble = mix( vec3( 0.3, 0.05, 0.04 ), vec3( 0.44, 0.1, 0.07 ), cloud );
			marble = mix( marble, vec3( 0.62, 0.44, 0.2 ), veins * 0.7 );
			marble = mix( marble, vec3( 0.14, 0.02, 0.02 ), hotelVeins( q * 5.0 + 1.0 ) * 0.5 );
			float u = fract( a * 2.0 + 0.5 ) - 0.5;
			float frame = min( 0.25 - abs( u ) * 0.5 - 0.03, min( y - 0.13, dadoTop - 0.04 - y ) );
			float line = hotelFill( abs( frame ) - 0.003, pixel );
			color = mix( marble, gold, line * detail );
			hotelRelief = smoothstep( -0.002, 0.01, frame ) * detail * 0.5;
			hotelSheen = 0.7;
		} else if ( y < friezeFrom ) {
			// Over it, at each end of a cell, a fluted pilaster of cream plaster, a gilt capital under the frieze; between
			// them silk damask, gold on deep red, framed in gilt.
			vec3 cream = vec3( 0.64, 0.57, 0.44 ) * ( 0.9 + 0.16 * grain );
			float end = 0.5 - abs( a );
			if ( end < 0.07 ) {
				float t = fract( ( a + 0.57 ) / 0.028 );
				float flute = 0.5 - 0.5 * cos( t * 6.2832 );
				color = cream * mix( 1.0, 0.72, flute * detail );
				hotelRelief = ( 1.0 - flute ) * detail * 0.6;
				hotelSheen = 0.1;
				float capital = smoothstep( friezeFrom - 0.05, friezeFrom - 0.045, y );
				float base = 1.0 - smoothstep( dadoTop + 0.035, dadoTop + 0.04, y );
				color = mix( color, gold, max( capital, base ) );
				hotelSheen = max( hotelSheen, max( capital, base ) * 0.7 );
				color *= 1.0 - 0.3 * hotelFill( abs( end - 0.07 ) - 0.003, pixel ) * detail;
			} else {
				float frame = min( 0.41 - abs( a ), min( y - dadoTop - 0.04, friezeFrom - 0.06 - y ) );
				color = cream;
				if ( frame > -0.02 ) {
					float edge;
					float face;
					float cover = hotelDamask( vec2( along, y ), vec2( 0.15, 0.22 ), pixel, edge, face );
					vec3 silk = mix( vec3( 0.28, 0.045, 0.04 ), vec3( 0.56, 0.38, 0.14 ), cover * 0.85 ) * ( 0.88 + 0.2 * grain );
					silk = mix( silk, vec3( 0.66, 0.5, 0.22 ), edge * 0.45 );
					silk *= 1.0 - face * 0.14;
					float inside = hotelFill( - ( frame - 0.016 ), pixel );
					color = mix( cream, silk, inside );
					float gilt = hotelFill( abs( frame - 0.008 ) - 0.006, pixel );
					float shadow = hotelFill( abs( frame - 0.019 ) - 0.003, pixel ) * 0.5;
					color *= 1.0 - shadow * detail;
					color = mix( color, gold, gilt );
					hotelRelief = gilt * detail;
					hotelSheen = gilt * 0.8 + inside * cover * 0.4;
				}
			}
		}
	} else {
		// The staff passages: dark green gloss below, cream above, a black line between; scuffed, and flaking.
		bool low = y < 0.38;
		vec3 paint = low ? vec3( 0.19, 0.22, 0.16 ) : y < 0.39 ? vec3( 0.06, 0.05, 0.04 ) : vec3( 0.6, 0.55, 0.43 );
		float flake = smoothstep( 0.8, 0.82, backroomsNoise( vec2( along * 31.0, y * 37.0 ) ) * 0.65 + backroomsNoise( vec2( along * 2.3, y * 2.6 + 9.0 ) ) * 0.35 );
		color = mix( paint * ( 0.85 + 0.3 * grain ), vec3( 0.46, 0.43, 0.38 ) * ( 0.7 + 0.5 * grain ), flake );
		float scuffs = smoothstep( 0.5, 0.9, backroomsNoise( vec2( along * 5.0, y * 40.0 ) ) ) * ( 1.0 - smoothstep( 0.05, 0.25, y ) );
		color *= 1.0 - 0.3 * scuffs;
		hotelSheen = low ? 0.4 * ( 1.0 - flake ) : 0.05;
		dadoTop = 0.0;
		friezeFrom = 2.0;
	}
	// The frieze under the cornice: a band of red with gilt rosettes between two gilt lines (in a lobby, wider, and
	// black and gold too).
	if ( y > friezeFrom ) {
		float t = ( y - friezeFrom ) / ( 0.905 - friezeFrom );
		float s = along / 0.09;
		vec2 r = vec2( fract( s ) - 0.5, t - 0.5 );
		float rosette = hotelFill( length( r * vec2( 1.0, 1.6 ) ) - 0.28, pixel / 0.045 );
		float lines = hotelFill( min( abs( t - 0.08 ), abs( t - 0.92 ) ) - 0.05, pixel / 0.045 );
		vec3 band = vec3( 0.34, 0.06, 0.05 );
		vec3 gold = vec3( 0.62, 0.46, 0.2 ) * ( 0.85 + 0.3 * grain );
		vec3 frieze = mix( band * ( 0.85 + 0.3 * grain ), gold, max( rosette * 0.85, lines ) * detail + 0.25 * ( 1.0 - detail ) );
		if ( look > ${LOOK_ROOM}.5 && look < ${LOOK_LOBBY}.5 ) {
			// The lobby's: a painted scroll, red, gold and black.
			float scroll = sin( s * 3.14159 * 2.0 + sin( t * 6.2831 ) * 1.4 );
			frieze = mix( vec3( 0.3, 0.05, 0.04 ), vec3( 0.6, 0.44, 0.18 ), smoothstep( 0.3, 0.6, scroll ) * detail );
			frieze = mix( frieze, vec3( 0.05, 0.04, 0.03 ), lines * detail );
			frieze *= 0.85 + 0.3 * grain;
		}
		color = frieze;
		hotelSheen = 0.2;
		hotelRelief = 0.0;
	}
	// Age: a little darker low down, and in patches where the damp got in.
	color *= 1.0 - 0.12 * ( 1.0 - smoothstep( 0.0, 0.15, y ) ) - 0.18 * smoothstep( 0.62, 0.85, age );
	diffuseColor.rgb = color;
}
`;

// The relief from FRAGMENT_WALL, on top of the grain's (see bumpmap_pars_fragment).
const NORMAL_WALL = ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd()', '( dHdxy_fwd() + vec2( dFdx( hotelRelief ), dFdy( hotelRelief ) ) * 0.004 )');

if (import.meta.env?.DEV && NORMAL_WALL === ShaderChunk.normal_fragment_maps) {
    console.warn('terrorHotelShading.js: the relief patch no longer applies to this three.js version.');
}

/** The damask's satin, the dado's varnish, the gilt. */
const SPECULAR_WALL = /* glsl */ `
#include <lights_phong_fragment>
material.specularShininess = mix( 10.0, 40.0, hotelSheen );
material.specularStrength = hotelSheen * 0.35;
`;

// ---------------------------------------------------------------------------------------------- floors

/**
 * The floor, by the look of its cell: the corridors' carpet (red, with gold scrolls in an ogee lattice and a rosette in
 * each, a Greek key round the border along the walls), the rooms' (a small figure in the room's colours), the lobbies'
 * (a green and gold lattice with a red border) or their marble, the ballroom's dark damask, the staff passages'
 * linoleum. Sets hotelShine for the hard floors.
 */
const FRAGMENT_FLOOR = /* glsl */ `
#include <map_fragment>
float hotelShine = 0.0;
{
	vec2 p = vBackroomsWorldPosition.xz;
	vec2 cell = floor( p + 0.5 );
	vec4 bytes = hotelCell( cell );
	float look = mod( bytes.r, 8.0 );
	bool alongX = mod( floor( bytes.r / 8.0 ), 2.0 ) > 0.5;
	float grain = diffuseColor.r;
	float pixel = max( length( fwidth( p ) ), 1e-4 );
	float detail = 1.0 - smoothstep( 0.006, 0.02, pixel );
	// How far to the nearest wall of the cell (a doorway counts: the border runs on across it), and which way.
	float walls = bytes.a;
	float wallsLowX = hotelCell( cell - vec2( 1.0, 0.0 ) ).a;
	float wallsLowZ = hotelCell( cell - vec2( 0.0, 1.0 ) ).a;
	vec2 o = p - cell;
	float toWall = 9.0;
	float runs = 0.0;
	if ( mod( walls, 2.0 ) > 0.5 ) { toWall = min( toWall, 0.46 - o.x ); }
	if ( mod( wallsLowX, 2.0 ) > 0.5 ) { toWall = min( toWall, 0.46 + o.x ); }
	if ( mod( floor( walls / 2.0 ), 2.0 ) > 0.5 && 0.46 - o.y < toWall ) { toWall = 0.46 - o.y; runs = 1.0; }
	if ( mod( floor( wallsLowZ / 2.0 ), 2.0 ) > 0.5 && 0.46 + o.y < toWall ) { toWall = 0.46 + o.y; runs = 1.0; }
	float along = runs > 0.5 ? p.x : p.y;
	vec3 color;
	if ( look < 0.5 ) {
		// The corridors' carpet: on deep red, a medallion of gold scrolls in each repeat (every other row half a repeat
		// over), fine vines curling between them, and little gold flowers where the vines cross.
		vec2 q = ( alongX ? p.yx : p ) / 0.19;
		float row = floor( q.y );
		q.x += mod( row, 2.0 ) * 0.5;
		vec2 c = fract( q ) - 0.5;
		float px = pixel / 0.19;
		float r = length( c );
		float a = atan( c.y, c.x );
		// The medallion: a rosette of eight petals, each with a dark vein, round a ring and a dark heart.
		float petals = r - 0.21 - 0.06 * cos( a * 8.0 );
		float medallion = hotelFill( petals, px );
		float vein = hotelFill( abs( fract( a * 8.0 / 6.2832 + 0.5 ) - 0.5 ) * r * 6.0 - 0.05, px ) * smoothstep( 0.1, 0.14, r ) * medallion;
		float heart = hotelFill( r - 0.07, px ) * ( 1.0 - hotelFill( r - 0.035, px ) * 0.6 );
		medallion *= 1.0 - hotelFill( abs( r - 0.11 ) - 0.012, px ) * 0.75;
		// Vines: a scroll from each medallion to the next along the row.
		float vine = abs( c.y - 0.09 * sin( c.x * 6.2832 ) );
		float vines = hotelFill( vine - 0.012, px ) * smoothstep( 0.22, 0.28, abs( c.x ) );
		// A flower at each corner of the repeat.
		vec2 k = abs( c ) - 0.5;
		float flower = hotelFill( length( k ) - 0.07 - 0.025 * cos( atan( k.y, k.x ) * 5.0 ), px );
		vec3 field = vec3( 0.27, 0.035, 0.03 );
		vec3 gold = vec3( 0.5, 0.35, 0.13 );
		vec3 dark = vec3( 0.07, 0.02, 0.015 );
		color = field;
		// (Everything gold with a dark edge, as woven.)
		float outline = hotelFill( abs( petals ) - 0.04, px ) * ( 1.0 - hotelFill( abs( petals ) - 0.025, px ) );
		color = mix( color, dark, outline * detail * 0.7 );
		color = mix( color, gold, medallion * detail );
		color = mix( color, dark, vein * detail * 0.6 );
		color = mix( color, gold * 0.8, vines * detail );
		color = mix( color, vec3( 0.56, 0.44, 0.24 ), flower * detail );
		color = mix( color, dark, heart * detail );
		color = mix( color, mix( field, gold, 0.18 ), 1.0 - detail );
		// The border: a black line, the key in gold on red, another line.
		if ( toWall < 0.15 ) {
			float t = ( toWall - 0.025 ) / 0.1;
			float band = step( 0.0, t ) * step( t, 1.0 );
			float key = hotelKey( along, clamp( t, 0.0, 0.999 ), 0.1, pixel );
			vec3 border = mix( vec3( 0.26, 0.035, 0.03 ), gold, key * band );
			float edges = hotelFill( min( abs( toWall - 0.018 ), abs( toWall - 0.135 ) ) - 0.006, pixel );
			border = mix( border, vec3( 0.05, 0.03, 0.02 ), edges );
			color = toWall < 0.012 ? vec3( 0.26, 0.035, 0.03 ) : border;
		}
		// Worn down the middle, where everyone walked.
		float middle = toWall < 9.0 ? smoothstep( 0.22, 0.46, toWall ) : 0.0;
		color *= 1.0 - 0.14 * middle * backroomsNoise( p * 3.0 );
	} else if ( look < 1.5 ) {
		// A guest room: a small figure in its colours, and a plain border.
		float palette = floor( bytes.g / ${1 << PALETTE_SHIFT}.0 );
		vec3 ground = palette < 0.5 ? vec3( 0.14, 0.2, 0.13 ) : palette < 1.5 ? vec3( 0.3, 0.1, 0.08 ) : palette < 2.5 ? vec3( 0.11, 0.14, 0.22 ) : vec3( 0.28, 0.12, 0.12 );
		vec2 q = fract( p / 0.08 ) - 0.5;
		float dot_ = hotelFill( length( q ) - 0.12, pixel / 0.08 );
		color = mix( ground, ground * 1.8 + 0.05, dot_ * detail * 0.6 );
		if ( toWall < 0.09 ) color = mix( ground * 0.6, color, smoothstep( 0.05, 0.06, toWall ) );
	} else if ( look < 2.5 ) {
		float floorKind = floor( bytes.b / ${1 << FLOOR_SHIFT}.0 );
		if ( floorKind > ${FLOOR_MARBLE}.0 - 0.5 ) {
			// Marble: black and white on the diagonal, veined.
			vec2 q = vec2( p.x + p.y, p.x - p.y ) / 0.42;
			vec2 id = floor( q );
			float black = mod( id.x + id.y, 2.0 );
			float veins = hotelVeins( p * 3.0 + id * 1.7 );
			vec3 stone = black > 0.5 ? vec3( 0.07, 0.065, 0.06 ) + veins * vec3( 0.25 ) : vec3( 0.72, 0.68, 0.6 ) - veins * vec3( 0.3, 0.3, 0.26 );
			vec2 e = min( fract( q ), 1.0 - fract( q ) );
			float joint = hotelFill( min( e.x, e.y ) - 0.01, pixel / 0.42 ) * detail;
			color = mix( stone, stone * 0.5, joint );
			hotelShine = 1.0 - joint;
		} else {
			// Lattice carpet: a deep red ground, a trellis of gold over it on the diagonal, dark-edged, a green and
			// gold flower in each diamond of it; and a border of dark green along the walls, gold lozenges down it.
			vec2 q = vec2( p.x + p.y, p.x - p.y ) / 0.17;
			vec2 f = fract( q ) - 0.5;
			float px = pixel / 0.17;
			float trellis = hotelFill( min( abs( f.x ), abs( f.y ) ) - 0.026, px );
			float edge = hotelFill( min( abs( f.x ), abs( f.y ) ) - 0.05, px ) - trellis;
			float r = length( f );
			float a = atan( f.y, f.x );
			float flower = hotelFill( r - 0.14 - 0.05 * cos( a * 4.0 ), px );
			float ring = hotelFill( abs( r - 0.1 ) - 0.012, px );
			float heart = hotelFill( r - 0.045, px );
			vec3 red = vec3( 0.3, 0.05, 0.04 );
			vec3 gold = vec3( 0.46, 0.33, 0.13 );
			color = red;
			color = mix( color, vec3( 0.08, 0.03, 0.02 ), edge * detail );
			color = mix( color, gold, trellis * detail );
			color = mix( color, vec3( 0.1, 0.18, 0.11 ), flower * detail );
			color = mix( color, gold * 0.9, ring * flower * detail );
			color = mix( color, gold, heart * detail );
			color = mix( color, mix( red, gold, 0.2 ), 1.0 - detail );
			if ( toWall < 0.22 ) {
				float t = toWall / 0.22;
				vec3 border = vec3( 0.08, 0.14, 0.09 );
				float s = fract( along / 0.14 ) - 0.5;
				border = mix( border, gold, hotelFill( abs( s ) + abs( t - 0.5 ) * 0.6 - 0.18, pixel / 0.14 ) * detail * 0.8 );
				border = mix( border, gold, hotelFill( min( abs( t - 0.12 ), abs( t - 0.9 ) ) - 0.03, pixel / 0.22 ) );
				color = border;
			}
		}
	} else if ( look < 3.5 ) {
		float floorKind = floor( bytes.b / ${1 << FLOOR_SHIFT}.0 );
		if ( floorKind > ${FLOOR_PARQUET}.0 - 0.5 && floorKind < ${FLOOR_PARQUET}.0 + 0.5 ) {
			// A dance floor: parquet in a basket weave, three blocks a square, each turned across the last; round
			// its edge a band of dark walnut with a line of brass in it.
			vec2 q = p / 0.18;
			vec2 c = floor( q );
			vec2 f = fract( q );
			float turn = mod( c.x + c.y, 2.0 );
			float t = turn > 0.5 ? f.x : f.y;
			float s = turn > 0.5 ? q.y : q.x;
			float strip = floor( t * 3.0 );
			float toStrip = min( fract( t * 3.0 ), 1.0 - fract( t * 3.0 ) ) * 0.06;
			float toSquare = min( min( f.x, 1.0 - f.x ), min( f.y, 1.0 - f.y ) ) * 0.18;
			float joint = hotelFill( min( toStrip, toSquare ) - 0.0012, pixel ) * detail;
			uint h = backroomsHash( uint( int( c.x ) + 4096 ) * 2654435761u ^ uint( int( c.y ) + 4096 ) * 2246822519u ^ uint( strip ) * 3266489917u );
			float tone = float( h & 255u ) / 255.0;
			float wood = hotelGrain( vec2( s * 0.18 * 2.0, t * 0.18 * 7.0 + tone * 5.0 ) );
			vec3 block = mix( vec3( 0.3, 0.16, 0.07 ), vec3( 0.46, 0.27, 0.12 ), tone ) * ( 0.78 + 0.36 * wood );
			color = mix( block, block * 0.4, joint );
			hotelShine = 0.85 * ( 1.0 - joint );
			// Its edge: where the next cell isn't dance floor.
			float edgeOf = 9.0;
			for ( int k = 0; k < 4; k ++ ) {
				vec2 d = k == 0 ? vec2( 1.0, 0.0 ) : k == 1 ? vec2( -1.0, 0.0 ) : k == 2 ? vec2( 0.0, 1.0 ) : vec2( 0.0, -1.0 );
				float next = floor( hotelCell( cell + d ).b / ${1 << FLOOR_SHIFT}.0 );
				if ( abs( next - ${FLOOR_PARQUET}.0 ) > 0.5 ) edgeOf = min( edgeOf, 0.5 - dot( o, d ) );
			}
			if ( edgeOf < 0.075 ) {
				float g = hotelGrain( vec2( ( abs( o.x ) > abs( o.y ) ? p.y : p.x ) * 2.0, edgeOf * 20.0 ) );
				color = vec3( 0.14, 0.07, 0.035 ) * ( 0.8 + 0.4 * g );
				color = mix( color, vec3( 0.62, 0.48, 0.22 ), hotelFill( abs( edgeOf - 0.045 ) - 0.004, pixel ) );
				color *= 1.0 - 0.5 * hotelFill( abs( edgeOf - 0.075 ) - 0.0015, pixel ) * detail;
				hotelShine = 0.8;
			}
		} else {
			// The ballroom: a great dark damask, burgundy on burgundy.
			float edge;
			float face;
			float cover = hotelDamask( p, vec2( 0.42, 0.6 ), pixel, edge, face );
			color = mix( vec3( 0.16, 0.035, 0.04 ), vec3( 0.26, 0.06, 0.06 ), cover );
			color = mix( color, vec3( 0.4, 0.22, 0.12 ), edge * 0.35 );
			if ( toWall < 0.3 ) color = mix( vec3( 0.28, 0.06, 0.05 ), color, smoothstep( 0.2, 0.22, toWall ) );
		}
	} else {
		// Linoleum: oxblood and cream squares, worn to the backing in places.
		vec2 q = p / 0.14;
		float checker = mod( floor( q.x ) + floor( q.y ), 2.0 );
		color = checker > 0.5 ? vec3( 0.46, 0.42, 0.33 ) : vec3( 0.26, 0.1, 0.08 );
		float worn = smoothstep( 0.5, 0.8, backroomsNoise( p * 1.3 ) * 0.7 + backroomsNoise( p * 7.0 ) * 0.3 );
		color = mix( color, vec3( 0.2, 0.17, 0.13 ), worn * 0.6 );
		hotelShine = 0.4 * ( 1.0 - worn );
	}
	float mottle = backroomsNoise( p * 0.5 ) * 0.6 + backroomsNoise( p * 2.1 + 4.0 ) * 0.4;
	color *= ( 0.86 + 0.28 * grain ) * ( 0.9 + 0.2 * mottle );
	diffuseColor.rgb = color;
}
`;

const SPECULAR_FLOOR = /* glsl */ `
#include <lights_phong_fragment>
material.specularShininess = mix( 4.0, 70.0, hotelShine );
material.specularStrength = hotelShine * 0.5;
`;

// ---------------------------------------------------------------------------------------------- ceilings

/**
 * The ceiling: cream plaster with a rose round every light slot's fitting; in a lobby, painted ochre between the
 * beams with a border along them; in the ballroom, coffered; in the staff passages, plain and sooted over the bulbs.
 */
const FRAGMENT_CEILING = /* glsl */ `
#include <map_fragment>
float hotelRelief = 0.0;
{
	vec2 p = vBackroomsWorldPosition.xz;
	vec2 cell = floor( p + 0.5 );
	vec4 bytes = hotelCell( cell );
	float look = mod( bytes.r, 8.0 );
	float grain = diffuseColor.r;
	float pixel = max( length( fwidth( p ) ), 1e-4 );
	float detail = 1.0 - smoothstep( 0.006, 0.02, pixel );
	vec3 color = vec3( 0.66, 0.6, 0.48 ) * ( 0.88 + 0.2 * grain );
	vec2 slot = floor( ( p - 1.0 ) * 0.5 + 0.5 ) * 2.0 + 1.0;
	float r = length( p - slot );
	if ( look > ${LOOK_ROOM}.5 && look < ${LOOK_LOBBY}.5 ) {
		// Ochre plaster, and a stencilled border.
		color = vec3( 0.5, 0.36, 0.14 ) * ( 0.85 + 0.25 * grain ) * ( 0.9 + 0.2 * backroomsNoise( p * 1.7 ) );
		vec2 f = abs( fract( p / 2.0 + 0.25 ) - 0.5 );
		float band = hotelFill( abs( max( f.x, f.y ) - 0.43 ) - 0.02, pixel / 2.0 );
		color = mix( color, vec3( 0.34, 0.08, 0.05 ), band * detail );
	} else if ( look > ${LOOK_LOBBY}.5 && look < ${LOOK_BALLROOM}.5 ) {
		// Coffers, a unit across, sunk between ribs; gilt round each.
		vec2 f = fract( p + 0.5 ) - 0.5;
		float d = 0.5 - max( abs( f.x ), abs( f.y ) );
		float rib = 1.0 - smoothstep( 0.05, 0.07, d );
		float gilt = hotelFill( abs( d - 0.085 ) - 0.006, pixel );
		color = vec3( 0.56, 0.5, 0.38 ) * ( 0.85 + 0.2 * grain ) * mix( 0.75, 1.0, rib );
		color = mix( color, vec3( 0.62, 0.46, 0.2 ), gilt * detail );
		hotelRelief = rib * detail;
	} else if ( look > ${LOOK_BALLROOM}.5 ) {
		color = vec3( 0.52, 0.49, 0.42 ) * ( 0.8 + 0.3 * grain );
		color *= 1.0 - 0.6 * ( 1.0 - smoothstep( 0.03, 0.3, r ) );
	}
	if ( look < ${LOOK_STAFF}.0 - 0.5 ) {
		// The rose round the fitting: rings of mouldings, and a ring of leaves.
		if ( r < 0.2 ) {
			float rings = hotelFill( abs( r - 0.17 ) - 0.008, pixel ) + hotelFill( abs( r - 0.12 ) - 0.006, pixel );
			float angle = atan( p.y - slot.y, p.x - slot.x );
			float leaves = hotelFill( abs( r - 0.145 ) - 0.012 * ( 0.4 + 0.6 * abs( cos( angle * 8.0 ) ) ), pixel );
			color *= 1.0 + 0.12 * ( rings + leaves ) * detail;
			hotelRelief = max( hotelRelief, ( rings + leaves ) * detail );
		}
		// Soot and damp.
		float stain = smoothstep( 0.68, 0.76, backroomsNoise( p * 0.35 + 13.0 ) );
		color = mix( color, color * vec3( 0.75, 0.62, 0.46 ), stain * 0.6 );
	}
	color *= 0.84 + 0.22 * backroomsNoise( p * 1.1 );
	diffuseColor.rgb = color;
}
`;

const NORMAL_CEILING = ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd()', '( dHdxy_fwd() + vec2( dFdx( hotelRelief ), dFdy( hotelRelief ) ) * 0.003 )');

/**
 * The ceiling catches the light coming back up off the floor and the walls, so it's never quite black under a lit
 * fitting.
 */
const BOUNCE = /* glsl */ `
#include <emissivemap_fragment>
{
	vec3 tint;
	vec2 nearest = floor( ( vBackroomsWorldPosition.xz - 1.0 ) * 0.5 + 0.5 ) * 2.0 + 1.0;
	float on = hotelSlotOn( nearest, tint );
	float halo = 1.0 - smoothstep( 0.05, 1.1, length( vBackroomsWorldPosition.xz - nearest ) );
	totalEmissiveRadiance += diffuseColor.rgb * ( 0.1 * backroomsArea + 0.3 * on * halo * halo * tint );
}
`;

// ---------------------------------------------------------------------------------------------- woodwork and the rest

/**
 * What most of Level 5's own meshes are made of (the mouldings, the doors, the columns, the furniture), by their finish
 * attribute (see FINISH_* in terrorHotelGeometry.js): varnished wood with its grain running the way the piece does,
 * paint, gilt and brass, faux marble, velvet and leather, linen, glass, plaster and stone, the lobbies' beams, and
 * marble in the colour it's given (white, or near black).
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
float hotelShine = 0.1;
float hotelSharp = 12.0;
{
	float kind = floor( vFinish.x + 0.5 );
	float param = vFinish.y;
	vec3 p = vBackroomsWorldPosition;
	vec3 base = diffuseColor.rgb;
	if ( kind < 3.5 && kind > 0.5 ) {
		// Wood, its grain along x, y or z.
		vec2 w = kind < 1.5 ? vec2( p.x, p.y + p.z * 0.7 ) : kind < 2.5 ? vec2( p.y, p.x + p.z ) : vec2( p.z, p.y + p.x * 0.7 );
		float g = hotelGrain( w + param * 13.0 );
		base *= 0.8 + 0.34 * g;
		hotelShine = 0.3;
		hotelSharp = 30.0;
	} else if ( kind < 4.5 && kind > 3.5 ) {
		// Gilt and brass: bright, and dull where it's been handled least.
		base *= 0.85 + 0.25 * backroomsNoise( vec2( p.x + p.z, p.y ) * 60.0 );
		hotelShine = 0.6;
		hotelSharp = 45.0;
	} else if ( kind < 5.5 && kind > 4.5 ) {
		// Scagliola: red, veined with gold and darker red.
		vec2 q = vec2( p.x + p.z, p.y * 1.3 );
		float veins = hotelVeins( q * 2.2 + param * 7.0 );
		float cloud = backroomsNoise( q * 3.0 ) * 0.6 + backroomsNoise( q * 11.0 ) * 0.4;
		base = mix( vec3( 0.36, 0.06, 0.05 ), vec3( 0.5, 0.12, 0.08 ), cloud );
		base = mix( base, vec3( 0.7, 0.5, 0.22 ), veins * 0.85 );
		base = mix( base, vec3( 0.16, 0.02, 0.02 ), hotelVeins( q * 5.0 + 3.0 ) * 0.6 );
		hotelShine = 0.75;
		hotelSharp = 60.0;
	} else if ( kind < 6.5 && kind > 5.5 ) {
		// Velvet and leather: a soft sheen.
		base *= 0.8 + 0.25 * backroomsNoise( vec2( p.x + p.z, p.y ) * 40.0 );
		hotelShine = 0.12;
		hotelSharp = 6.0;
	} else if ( kind < 7.5 && kind > 6.5 ) {
		// Linen: white, and its weave.
		base *= 0.9 + 0.1 * backroomsNoise( vec2( p.x + p.z, p.y ) * 200.0 );
		hotelShine = 0.05;
		hotelSharp = 4.0;
	} else if ( kind < 8.5 && kind > 7.5 ) {
		// Glass, and lacquer: dark, and shining.
		hotelShine = 0.6;
		hotelSharp = 90.0;
	} else if ( kind < 9.5 && kind > 8.5 ) {
		// Plaster: the cornices, the capitals' mouldings. Matte.
		base *= 0.92 + 0.12 * backroomsNoise( vec2( p.x + p.z, p.y ) * 30.0 );
		hotelShine = 0.02;
		hotelSharp = 4.0;
	} else if ( kind < 10.5 && kind > 9.5 ) {
		// Stone.
		base *= 0.88 + 0.2 * backroomsNoise( vec2( p.x + p.z, p.y ) * 25.0 );
		hotelShine = 0.1;
		hotelSharp = 10.0;
	} else if ( kind < 11.5 && kind > 10.5 ) {
		// The lobbies' beams: dark timber, their sides painted with a scroll in red and gold.
		vec3 n = normalize( inverseTransformDirection( vNormal, viewMatrix ) );
		float along = abs( n.x ) > 0.5 ? p.z : p.x;
		float side = step( 0.5, abs( n.x ) + abs( n.z ) );
		float g = hotelGrain( vec2( abs( n.x ) > 0.5 || abs( n.y ) > 0.5 && param > 0.5 ? p.z : p.x, p.y * 3.0 ) );
		base = vec3( 0.16, 0.09, 0.05 ) * ( 0.75 + 0.5 * g );
		float band = step( 0.925, p.y ) * step( p.y, 0.975 ) * side;
		float scroll = sin( along / 0.1 * 6.2831 + sin( ( p.y - 0.95 ) * 125.0 ) * 1.6 );
		vec3 painted = mix( vec3( 0.34, 0.07, 0.05 ), vec3( 0.6, 0.44, 0.18 ), smoothstep( 0.2, 0.6, scroll ) );
		base = mix( base, painted, band );
		if ( n.y < -0.5 ) {
			// Underneath: a red band between gold lines, a chain of gold lozenges down it. (The beams run on the lines
			// between cells, half a unit off the whole ones.)
			float d = abs( fract( param > 0.5 ? p.x : p.z ) - 0.5 );
			float s = param > 0.5 ? p.z : p.x;
			float lines = 1.0 - smoothstep( 0.003, 0.005, abs( d - 0.03 ) );
			float lozenge = 1.0 - smoothstep( 0.016, 0.019, abs( fract( s / 0.07 ) - 0.5 ) * 0.07 + d * 0.9 );
			vec3 soffit = mix( vec3( 0.3, 0.06, 0.045 ), vec3( 0.6, 0.44, 0.18 ), max( lines, lozenge ) );
			base = mix( base, soffit, step( d, 0.036 ) );
		}
		hotelShine = 0.15;
		hotelSharp = 20.0;
	} else if ( kind < 12.5 && kind > 11.5 ) {
		// Marble in its own colour (white, or near black), clouded and veined.
		vec2 q = vec2( p.x + p.y * 0.7, p.z - p.y * 0.5 ) + param * 5.0;
		float veins = hotelVeins( q * 2.6 );
		float fine = hotelVeins( q * 7.0 + 4.0 );
		float cloud = backroomsNoise( q * 4.0 ) * 0.6 + backroomsNoise( q * 13.0 ) * 0.4;
		float light = dot( base, vec3( 0.333 ) );
		vec3 vein = light > 0.4 ? base * vec3( 0.52, 0.5, 0.48 ) : base + vec3( 0.34, 0.3, 0.24 );
		base *= 0.9 + 0.14 * cloud;
		base = mix( base, vein, clamp( veins * 0.75 + fine * 0.3, 0.0, 1.0 ) );
		hotelShine = 0.7;
		hotelSharp = 70.0;
	}
	// Dust on what faces up; dirt on what faces down.
	vec3 n = normalize( inverseTransformDirection( vNormal, viewMatrix ) );
	base *= 1.0 - 0.18 * smoothstep( 0.3, 0.9, - n.y );
	diffuseColor.rgb = base;
	// A flat face is duller than a curved one, its shine broader (see Level 2's pipes).
	float flatFace = 1.0 - smoothstep( 1e-4, 1e-3, length( fwidth( vNormal ) ) );
	hotelShine *= 1.0 - 0.6 * flatFace;
	hotelSharp = mix( hotelSharp, min( hotelSharp, 14.0 ), flatFace );
}
`;

const SPECULAR_FINISH = /* glsl */ `
#include <lights_phong_fragment>
material.specularShininess = hotelSharp;
material.specularStrength = hotelShine;
`;

// ---------------------------------------------------------------------------------------------- fittings

/**
 * The fittings (see terrorHotelGeometry.js): what's lit of them (a bulb, an alabaster bowl, a lantern's glass, a lamp's
 * shade) glows when its light's on (its light attribute: which slot it goes with, how bright, and what kind), the rest
 * is shaded like everything else; a chandelier's crystals catch the light and flash.
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
`;

const EMISSIVE_LIGHT = /* glsl */ `
#include <emissivemap_fragment>
if ( vLight.z > 0.0 ) {
	vec3 tint = vec3( 1.0 );
	// A lamp (its slot 0, 0) is on while the power is; anything else, with its slot.
	float on = abs( vLight.x ) + abs( vLight.y ) < 0.5 ? 1.0 - blackout : hotelSlotOn( vLight.xy, tint );
	float kind = floor( vLight.w + 0.5 );
	vec3 glow = diffuseColor.rgb * tint * vLight.z * on;
	if ( kind > 0.5 ) {
		// Crystal: flashes, as the eye moves.
		ivec3 facet = ivec3( floor( vBackroomsWorldPosition * 90.0 ) );
		uint h = backroomsHash( uint( facet.x ) * 73856093u ^ uint( facet.y ) * 19349663u ^ uint( facet.z ) * 83492791u ^ uint( int( cameraPosition.x * 40.0 + cameraPosition.z * 37.0 ) ) * 2654435761u );
		glow += vec3( 1.0, 0.95, 0.85 ) * ( ( h & 63u ) < 3u ? 2.2 : 0.0 ) * on;
	}
	totalEmissiveRadiance += glow;
}
`;

// ---------------------------------------------------------------------------------------------- dials

/**
 * A lift's dial over its doors, and a clock's face (see terrorHotelGeometry.js), from their texture coordinates: its
 * colour's red is which (0: a lift's, 1: a clock's), its green its own time. The lift's needle drifts from floor to
 * floor, and now and then swings all the way over to the last; the clock's hands go round, backwards.
 */
const FRAGMENT_DIAL = /* glsl */ `
{
	vec3 which = vColor.rgb;
	vec2 q = vUv * 2.0 - 1.0;
	float r = length( q );
	float pixel = max( fwidth( r ), 1e-3 );
	float t = lightTime + which.g * 97.0;
	vec3 face;
	if ( which.r < 0.5 ) {
		// A half circle: the numbers round it as ticks, 1 to 13, the needle from the middle of the bottom.
		vec2 c = vec2( q.x, q.y + 0.8 ) / 1.6;
		float cr = length( c );
		float angle = atan( c.x, c.y );
		face = vec3( 0.72, 0.62, 0.4 );
		float ticks = step( 0.72, cr ) * step( cr, 0.86 ) * step( abs( angle ), 1.3 ) * ( 1.0 - smoothstep( 0.12, 0.12 + pixel * 12.0, abs( fract( ( angle + 1.3 ) / 2.6 * 12.0 + 0.5 ) - 0.5 ) ) );
		face = mix( face, vec3( 0.12, 0.08, 0.04 ), ticks );
		float drift = sin( t * 0.05 ) * 0.5 + 0.5;
		float swing = smoothstep( 0.0, 1.0, fract( t / 97.0 ) * 12.0 - 10.0 ) * ( 1.0 - smoothstep( 0.0, 1.0, fract( t / 97.0 ) * 12.0 - 11.0 ) );
		float value = mix( floor( drift * 11.0 + 0.5 ) / 12.0 + 0.02 * sin( t * 3.0 ), 1.0, swing );
		float a = ( value * 2.0 - 1.0 ) * 1.3;
		vec2 along = vec2( sin( a ), cos( a ) );
		float side = abs( dot( c, vec2( along.y, - along.x ) ) );
		float needle = step( 0.0, dot( c, along ) ) * step( dot( c, along ), 0.8 ) * ( 1.0 - smoothstep( 0.02, 0.02 + pixel * 2.0, side ) );
		face = mix( face, vec3( 0.08, 0.04, 0.02 ), needle );
		face *= 1.0 - smoothstep( 0.92, 1.0, cr ) * 0.8;
	} else {
		// A clock: twelve marks, the hands.
		float angle = atan( q.x, q.y );
		face = vec3( 0.82, 0.78, 0.66 );
		float marks = step( 0.74, r ) * step( r, 0.88 ) * ( 1.0 - smoothstep( 0.08, 0.08 + pixel * 6.0, abs( fract( angle / 6.2832 * 12.0 + 0.5 ) - 0.5 ) ) );
		face = mix( face, vec3( 0.1 ), marks );
		float minutes = - t * 0.21;
		float hours = minutes / 12.0 + which.g * 6.0;
		for ( int k = 0; k < 2; k ++ ) {
			float a = k == 0 ? minutes : hours;
			float len = k == 0 ? 0.72 : 0.48;
			vec2 along = vec2( sin( a ), cos( a ) );
			float side = abs( dot( q, vec2( along.y, - along.x ) ) );
			float hand = step( -0.1, dot( q, along ) ) * step( dot( q, along ), len ) * ( 1.0 - smoothstep( 0.03, 0.03 + pixel * 2.0, side ) );
			face = mix( face, vec3( 0.06 ), hand );
		}
		face *= 1.0 - smoothstep( 0.92, 1.0, r ) * 0.7;
	}
	diffuseColor.rgb = face;
}
`;

// ---------------------------------------------------------------------------------------------- the light under a door

/**
 * The light under a door (see terrorHotelGeometry.js): a line of it along the floor, fading out from the door, and now
 * and then the shadows of two feet crossing it from one side to the other, and back.
 */
export const SPILL_GLSL = /* glsl */ `
float hotelFeet( float along, float seed, float time ) {
	// Once every so often (each door in its own time), something crosses, slowly; now and then it stops halfway.
	float cycle = mod( time + seed * 61.0, 23.0 + seed * 9.0 );
	float walk = clamp( ( cycle - 4.0 ) / 6.0, 0.0, 1.0 );
	float x = mix( -0.35, 0.35, walk );
	if ( seed > 0.6 ) x = mix( -0.35, 0.02, clamp( ( cycle - 4.0 ) / 4.0, 0.0, 1.0 ) ) + max( cycle - 14.0, 0.0 ) * 0.07;
	float here = step( 3.9, cycle ) * step( cycle, 18.0 );
	float feet = max( 1.0 - smoothstep( 0.02, 0.04, abs( along - x - 0.05 ) ), 1.0 - smoothstep( 0.02, 0.04, abs( along - x + 0.05 ) ) );
	return feet * here;
}
`;

/**
 * What Level 5's own kinds of surface do to three.js' shaders (see SurfaceShading in levelShading.js).
 * @type {Record<string, import('./levelShading.js').SurfaceShading>}
 */
export const TERROR_HOTEL_SURFACES = {
    h5wall: (vertex, fragment) => ({
        vertex,
        fragment: PATTERNS_GLSL + fragment
            .replace('#include <map_fragment>', FRAGMENT_WALL)
            .replace('#include <normal_fragment_maps>', NORMAL_WALL)
            .replace('#include <lights_phong_fragment>', SPECULAR_WALL),
    }),
    h5floor: (vertex, fragment) => ({
        vertex,
        fragment: PATTERNS_GLSL + fragment.replace('#include <map_fragment>', FRAGMENT_FLOOR).replace('#include <lights_phong_fragment>', SPECULAR_FLOOR),
    }),
    h5ceiling: (vertex, fragment) => ({
        vertex,
        fragment: PATTERNS_GLSL + fragment
            .replace('#include <map_fragment>', FRAGMENT_CEILING)
            .replace('#include <normal_fragment_maps>', NORMAL_CEILING)
            .replace('#include <emissivemap_fragment>', BOUNCE),
    }),
    h5finish: (vertex, fragment) => ({
        vertex: VERTEX_FINISH_DECLARATIONS + vertex.replace('#include <begin_vertex>', VERTEX_FINISH),
        fragment: FRAGMENT_FINISH_DECLARATIONS + PATTERNS_GLSL + fragment
            .replace('#include <color_fragment>', FRAGMENT_FINISH)
            .replace('#include <lights_phong_fragment>', SPECULAR_FINISH),
    }),
    h5light: (vertex, fragment) => ({
        vertex: VERTEX_LIGHT_DECLARATIONS + vertex.replace('#include <begin_vertex>', VERTEX_LIGHT),
        fragment: FRAGMENT_LIGHT_DECLARATIONS + fragment.replace('#include <emissivemap_fragment>', EMISSIVE_LIGHT),
    }),
    h5dial: (vertex, fragment) => ({ vertex, fragment: fragment.replace('#include <color_fragment>', FRAGMENT_DIAL) }),
};
