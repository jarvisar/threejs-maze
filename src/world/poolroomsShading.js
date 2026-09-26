import { DOOR_HEIGHT, DOOR_WIDTH } from '../config.js';
import { CELL_AQUA, CELL_BAND, CELL_DRAIN, CELL_LANE, CELL_LANE_Z, SKYLIGHT_HALF, SLOT_LAMP, SLOT_SKY, SUN, TILE } from './poolrooms.js';
import { COLUMN_RADIUS, SKY_TOP } from './poolroomsGeometry.js';

/*
 * Level 37's shaders: the tile, the water, the sun, and the air (see poolrooms.js). These are pieces of GLSL that
 * materials.js puts into three.js' own shaders: POOLROOMS_SHADING into everything drawn while Level 37 is showing
 * (see levelShading.js), and the rest into its own surfaces (POOLROOMS_SURFACES). They share the ceiling lights, the
 * panel states, the cells and the haze with every level.
 *
 * What makes the place:
 *
 * - The sun. It comes in through the skylights at an angle, so every opening throws a leaning shaft of light
 *   through the damp air and a bright patch, crossed by the shadow of its glazing bars, onto whatever it lands on.
 *   Worked out for every point, not faked: up along the sun to the ceiling, through an opening or not, and nothing
 *   in the way on the way (a column, a wall, the side of the pool it's down in); see poolSun.
 * - The water. One sheet of it over the whole level. Its surface ripples and reflects the rooms (see Reflection.js;
 *   without the reflection, a rough idea of them), and everything under it is seen through it: bent by the ripples,
 *   losing its reds with the depth, and lit by the bright network of light the ripples focus (the caustics). Where
 *   the sun lands on water, that network is thrown back up onto the walls and the ceiling, moving; and the lamps in
 *   the pools light them turquoise from below.
 * - The tile. White glazed tile on everything, each tile a little off true, so the lights and the skylights break
 *   up in the glaze tile by tile, with the grout between them.
 * - From under the water, the surface is a wobbling mirror with a window straight up in it, and everything fades
 *   into blue-green a few metres off.
 */

const FLOAT = (value) => (Number.isInteger(value) ? `${value}.0` : String(value));
const vec3 = ([x, y, z]) => `vec3( ${FLOAT(x)}, ${FLOAT(y)}, ${FLOAT(z)} )`;

/** The colour of the sun, of the light that fills the water, of the lamps in the pools, and of the tile. */
const SUN_COLOR = [2.05, 1.82, 1.36];
const LAMP_COLOR = [0.3, 0.95, 0.72];

/**
 * Everything Level 37 puts into every shader drawn while it's showing: the sun, the water, the caustics and the
 * air. Follows the lighting uniforms and PANEL_LIGHT_GLSL.
 */
const POOLROOMS_GLSL = /* glsl */ `
// Rings spreading from where things went into the water (see Game): x, z, when (light time), how hard.
uniform vec4 poolRipples[ 8 ];
// Drawing the reflection in the water (see Reflection.js): the camera's under the water looking up, but the eye it
// stands for is above it.
uniform float mirrorView;

const vec3 SUN = ${vec3(SUN)};
const vec3 SUN_COLOR = ${vec3(SUN_COLOR)};
const vec3 LAMP_COLOR = ${vec3(LAMP_COLOR)};
const float SKYLIGHT_HALF = ${FLOAT(SKYLIGHT_HALF)};
const float SKY_TOP = ${FLOAT(SKY_TOP)};
const float COLUMN_RADIUS = ${COLUMN_RADIUS.toFixed(5)};
const float DOOR_HALF = ${FLOAT(DOOR_WIDTH / 2)};
const float DOOR_TOP = ${FLOAT(DOOR_HEIGHT)};
// The water: how much of each colour it takes out per unit of it the light goes through (the reds go first), and
// the colour it glows where there's light in it.
const vec3 WATER_ABSORB = vec3( 1.7, 0.36, 0.7 );
const vec3 WATER_GLOW = vec3( 0.025, 0.15, 0.1 );

vec3 poolEye() {
	return mirrorView > 0.5 ? cameraPosition * vec3( 1.0, -1.0, 1.0 ) : cameraPosition;
}

// The floor under a point, from its cell (see ChunkData.cells): in units, stairs left out.
float poolFloorAt( vec2 xz ) {
	return ( floor( cellState( floor( xz + 0.5 ) ).r * 255.0 + 0.5 ) - 128.0 ) / 64.0;
}

// How much of the floor round a point is under the water, blended between cells: 1 over the water, 0 over the dry
// walkways, fading from one to the other over a cell (for the light the water throws up, which spreads as it goes).
float poolWet( vec2 xz ) {
	vec2 i = floor( xz );
	vec2 f = xz - i;
	float a = step( cellState( i ).r * 255.0, 127.5 );
	float b = step( cellState( i + vec2( 1.0, 0.0 ) ).r * 255.0, 127.5 );
	float c = step( cellState( i + vec2( 0.0, 1.0 ) ).r * 255.0, 127.5 );
	float d = step( cellState( i + vec2( 1.0, 1.0 ) ).r * 255.0, 127.5 );
	return smoothstep( 0.0, 1.0, mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y ) );
}

// How much light the lamps in the pools put into the water round a point, blended between cells.
float poolGlow( vec2 xz ) {
	vec2 i = floor( xz );
	vec2 f = xz - i;
	float a = cellState( i ).b;
	float b = cellState( i + vec2( 1.0, 0.0 ) ).b;
	float c = cellState( i + vec2( 0.0, 1.0 ) ).b;
	float d = cellState( i + vec2( 1.0, 1.0 ) ).b;
	return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

// ------------------------------------------------------------------------------------------------ the water

// Clouds going over, somewhere up there: the sun comes and goes, slowly, a little at a time, across the level.
float poolClouds( vec2 xz ) {
	return 0.42 + 0.58 * smoothstep( 0.28, 0.72, backroomsNoise( xz * 0.04 + vec2( lightTime * 0.019, lightTime * 0.008 ) + 3.7 ) );
}

// Rings where drops fall from the ceiling now and then, as a tilt of the surface: in one cell in five of a loose grid,
// a drop every few seconds.
vec2 poolDrips( vec2 p ) {
	vec2 tilt = vec2( 0.0 );
	vec2 base = floor( p * 0.8 - 0.5 );
	for ( int i = 0; i < 2; i ++ ) {
		for ( int j = 0; j < 2; j ++ ) {
			vec2 cell = base + vec2( i, j );
			uint h = backroomsHash( uint( int( cell.x ) ) * 73856093u ^ uint( int( cell.y ) ) * 19349663u ^ 0x5eedu );
			if ( h % 5u != 0u ) continue;
			vec2 centre = ( cell + vec2( float( ( h >> 3u ) & 255u ), float( ( h >> 11u ) & 255u ) ) / 255.0 ) / 0.8;
			float period = 3.0 + 9.0 * float( ( h >> 19u ) & 63u ) / 63.0;
			float age = fract( lightTime / period + float( ( h >> 25u ) & 127u ) / 127.0 ) * period;
			vec2 away = p - centre;
			float d = length( away );
			float front = d - age * 0.28;
			float ring = sin( front * 80.0 ) * exp( - abs( front ) * 22.0 ) * exp( - age * 1.1 );
			tilt += away / max( d, 1e-3 ) * ring;
		}
	}
	return tilt * 0.12;
}

float poolWave( vec2 p, vec2 dir, float k, float a, float w ) {
	return a * k * cos( dot( dir, p ) * k - lightTime * w );
}

// The slope of the water's surface at p (dh/dx, dh/dz): never quite still, a few long slow swells and a fine chop
// over them, and rings spreading out from anything that's gone into it.
vec2 poolWaves( vec2 p ) {
	vec2 s = vec2( 0.8, 0.6 ) * poolWave( p, vec2( 0.8, 0.6 ), 5.1, 0.0042, 0.9 );
	s += vec2( -0.45, 0.89 ) * poolWave( p, vec2( -0.45, 0.89 ), 8.3, 0.0026, 1.3 );
	s += vec2( 0.96, -0.28 ) * poolWave( p, vec2( 0.96, -0.28 ), 13.7, 0.0014, 1.8 );
	s += vec2( -0.7, -0.71 ) * poolWave( p, vec2( -0.7, -0.71 ), 3.3, 0.006, 0.55 );
	s += poolDrips( p );
	vec2 q = p * 7.0 + vec2( lightTime * 0.23, - lightTime * 0.17 );
	float n0 = backroomsNoise( q );
	s += vec2( backroomsNoise( q + vec2( 0.25, 0.0 ) ) - n0, backroomsNoise( q + vec2( 0.0, 0.25 ) ) - n0 ) * 0.12;
	for ( int k = 0; k < 8; k ++ ) {
		vec4 ripple = poolRipples[ k ];
		float age = lightTime - ripple.z;
		if ( ripple.w <= 0.0 || age < 0.0 || age > 6.0 ) continue;
		vec2 away = p - ripple.xy;
		float d = length( away );
		float front = d - age * 0.3;
		float ring = sin( front * 60.0 ) * exp( - abs( front ) * 12.0 ) * exp( - age * 0.75 ) / ( 1.0 + d * 4.0 );
		s += away / max( d, 1e-3 ) * ring * ripple.w * 0.12;
	}
	return s;
}

// One layer of the caustics: the distance to the nearest edge between the cells of a drifting pattern.
float poolCausticLayer( vec2 p, float t ) {
	vec2 i = floor( p );
	vec2 f = p - i;
	float d1 = 8.0;
	float d2 = 8.0;
	for ( int y = -1; y <= 1; y ++ ) {
		for ( int x = -1; x <= 1; x ++ ) {
			vec2 g = vec2( x, y );
			uint h = backroomsHash( uint( int( i.x + g.x ) ) * 73856093u ^ uint( int( i.y + g.y ) ) * 19349663u );
			vec2 o = vec2( float( h & 1023u ), float( ( h >> 10u ) & 1023u ) ) / 1023.0;
			o = 0.5 + 0.4 * sin( t * ( 0.7 + 0.5 * o.yx ) + 6.2831853 * o );
			float d = length( g + o - f );
			if ( d < d1 ) {
				d2 = d1;
				d1 = d;
			} else if ( d < d2 ) {
				d2 = d;
			}
		}
	}
	return d2 - d1;
}

// The bright network of light that rippling water focuses onto what's under it (or throws back up off it): about
// 0.35 on average, up to about 1.6 on the lines. blur is how smeared it is (far off, or seen through deep water).
float poolCaustics( vec2 p, float blur ) {
	// Smeared right out, it's only its average: nothing to work out.
	if ( blur >= 0.6 ) return 0.35;
	float t = lightTime;
	// Bent, so its lines curve the way light through ripples does, and brighter in some stretches than others.
	vec2 bend = vec2( backroomsNoise( p * 2.3 + t * 0.11 ), backroomsNoise( p * 2.3 + 7.1 - t * 0.09 ) ) - 0.5;
	vec2 q = p + bend * 0.32;
	float a = poolCausticLayer( q * 7.5 + vec2( t * 0.07, t * 0.05 ), t * 0.9 );
	float b = poolCausticLayer( q * 5.3 + vec2( - t * 0.05, t * 0.06 ) + 17.3, t * 0.75 );
	float w = 0.06 + blur;
	float la = 1.0 - smoothstep( 0.0, w, a );
	float lb = 1.0 - smoothstep( 0.0, w * 1.4, b );
	float c = la * la * 0.7 + lb * lb * 0.4 + la * lb * 1.1;
	c *= 0.55 + 0.9 * backroomsNoise( p * 1.1 + vec2( t * 0.05, - t * 0.03 ) );
	return mix( c, 0.35, smoothstep( 0.05, 0.6, blur ) );
}

// Seen through inWater units of water: the reds go, and the water's own glow comes in (from the light round here,
// area, and the lamps in the pools).
vec3 poolThroughWater( vec3 color, float inWater, vec2 xz, float area ) {
	vec3 through = exp( - WATER_ABSORB * inWater );
	vec3 glow = WATER_GLOW * ( 0.15 + 0.85 * area ) * ( 1.0 - 0.8 * blackout ) + LAMP_COLOR * poolGlow( xz ) * 0.3 * ( 1.0 - blackout );
	return color * through + glow * ( 1.0 - exp( - 1.3 * inWater ) );
}

// ------------------------------------------------------------------------------------------------ the sun

// How open the ceiling is to the sun at c (where a ray to the sun comes up through it): 1 in a skylight's opening,
// with the shadows of the glazing bars across it, 0 elsewhere.
float poolSkylight( vec2 c ) {
	vec2 slot = floor( ( c - 1.0 ) * 0.5 + 0.5 );
	vec4 state = panelState( slot );
	if ( abs( state.a * 255.0 - ${SLOT_SKY}.0 ) > 0.5 ) return 0.0;
	vec2 d = abs( c - ( slot * 2.0 + 1.0 ) );
	float open = 1.0 - smoothstep( SKYLIGHT_HALF - 0.025, SKYLIGHT_HALF + 0.004, max( d.x, d.y ) );
	float bars = smoothstep( 0.009, 0.022, min( d.x, d.y ) );
	return open * bars;
}

// The same, with its edge blurred over soft either side of it, and no bars.
float poolSkylightSoft( vec2 c, float soft ) {
	vec2 slot = floor( ( c - 1.0 ) * 0.5 + 0.5 );
	vec4 state = panelState( slot );
	if ( abs( state.a * 255.0 - ${SLOT_SKY}.0 ) > 0.5 ) return 0.0;
	vec2 d = abs( c - ( slot * 2.0 + 1.0 ) );
	return 1.0 - smoothstep( SKYLIGHT_HALF - soft, SKYLIGHT_HALF + soft, max( d.x, d.y ) );
}

// Whether anything stands between p and the sun, on its way up to the ceiling at c (roof is the ceiling's height
// there): a column, a wall (though not through a doorway, under its top), or the side of the pool p is down in.
// 0, clear, to 1.
float poolSunBlocked( vec3 p, vec2 c, float roof ) {
	vec2 a = p.xz;
	vec2 d = c - a;
	float rise = roof - p.y;
	float blocked = 0.0;
	if ( p.y < 0.0 ) {
		// The pool's side: somewhere on the way up out of the water, a floor higher than the way.
		float reach = min( 1.0, ( 0.02 - p.y ) / rise );
		for ( int k = 1; k <= 5; k ++ ) {
			float t = reach * float( k ) / 5.0;
			if ( p.y + rise * t < poolFloorAt( a + d * t ) - 0.004 ) blocked = 1.0;
		}
	}
	vec2 lo = floor( min( a, c ) + 0.5 );
	vec2 hi = floor( max( a, c ) + 0.5 );
	float length2 = max( dot( d, d ), 1e-6 );
	for ( int i = 0; i < 3; i ++ ) {
		for ( int j = 0; j < 3; j ++ ) {
			vec2 cell = lo + vec2( i, j );
			if ( blocked >= 1.0 || cell.x > hi.x || cell.y > hi.y ) continue;
			uint walls = uint( cellState( cell ).a * 255.0 + 0.5 );
			if ( walls == 0u ) continue;
			if ( ( walls & 4u ) != 0u ) {
				// A column on the cell's far corner, softly (the sun isn't a point).
				vec2 corner = cell + 0.5;
				float s = clamp( dot( corner - a, d ) / length2, 0.0, 1.0 );
				float gap = length( a + d * s - corner );
				blocked = max( blocked, 1.0 - smoothstep( COLUMN_RADIUS - 0.012 - 0.01 * s, COLUMN_RADIUS + 0.012 + 0.02 * s, gap ) );
			}
			if ( ( walls & 1u ) != 0u && abs( d.x ) > 1e-5 ) {
				float s = ( cell.x + 0.5 - a.x ) / d.x;
				float along = a.y + d.y * s - cell.y;
				float y = p.y + rise * s;
				bool door = ( walls & 8u ) != 0u && abs( along ) < DOOR_HALF && y < DOOR_TOP;
				if ( s > 0.0 && s < 1.0 && abs( along ) <= 0.5 && !door && y < 1.0 ) blocked = 1.0;
			}
			if ( ( walls & 2u ) != 0u && abs( d.y ) > 1e-5 ) {
				float s = ( cell.y + 0.5 - a.y ) / d.y;
				float along = a.x + d.x * s - cell.x;
				float y = p.y + rise * s;
				bool door = ( walls & 16u ) != 0u && abs( along ) < DOOR_HALF && y < DOOR_TOP;
				if ( s > 0.0 && s < 1.0 && abs( along ) <= 0.5 && !door && y < 1.0 ) blocked = 1.0;
			}
		}
	}
	return blocked;
}

// How much sun reaches p, 0 to 1: up along the sun to the ceiling (or, up in a skylight's well, to its glass),
// through an opening there, and nothing in the way. Clouds come over in a power cut.
float poolSun( vec3 p ) {
	float roof = p.y > 0.999 ? SKY_TOP : 1.0;
	vec2 c = p.xz + SUN.xz / SUN.y * ( roof - p.y );
	float light = poolSkylight( c );
	if ( light <= 0.0 ) return 0.0;
	if ( p.y < 0.999 ) light *= 1.0 - poolSunBlocked( p, c, roof );
	return light * poolClouds( p.xz ) * ( 1.0 - 0.85 * blackout );
}

// Where on the water the light that lands on p came through (or, going back up, off), for the caustics: straight
// down along the sun. On a wall, the pattern runs along it and up it, rather than in streaks straight down.
vec2 poolThrough( vec3 p ) {
	return p.xz + SUN.xz / SUN.y * p.y;
}

// How much of the caustics' pattern one pixel covers at a point pixel units across: past a line's width, it smears.
float poolCausticBlur( float pixel ) {
	return pixel * 4.0;
}

// The sun on p as a light's colour: under the water, focused into caustics and going blue-green with the depth.
// pixel is about how far a pixel spans there (see backroomsPixel).
vec3 poolSunLight( vec3 p, float pixel ) {
	float sun = poolSun( p );
	if ( sun <= 0.0 ) return vec3( 0.0 );
	vec3 color = SUN_COLOR * sun;
	if ( p.y < 0.0 ) {
		float depth = - p.y;
		color *= exp( - WATER_ABSORB * depth / SUN.y ) * ( 0.3 + 1.25 * poolCaustics( poolThrough( p ), depth * 0.12 + poolCausticBlur( pixel ) ) );
	}
	return color;
}

// Sunlight thrown back up off the water onto p: from the spot on the water the sun would bounce off to reach p, if
// the sun's on it, as the moving network the ripples make of it (softer the further it's come).
vec3 poolSunBounce( vec3 p, float pixel ) {
	if ( p.y <= 0.004 ) return vec3( 0.0 );
	vec2 w = poolThrough( p );
	// The sun's patch on the water, blurred by the ripples on the way back up: no hard edge to it, and no bars.
	float lit = poolSkylightSoft( w + SUN.xz / SUN.y, 0.05 + p.y * 0.1 );
	if ( lit <= 0.0 ) return vec3( 0.0 );
	lit *= poolWet( w );
	if ( lit <= 0.0 ) return vec3( 0.0 );
	float spread = 1.0 / ( 1.0 + p.y * 1.5 );
	return SUN_COLOR * lit * poolCaustics( w * 0.9, 0.03 + p.y * 0.08 + poolCausticBlur( pixel * 0.9 ) ) * 0.42 * spread * poolClouds( w ) * ( 1.0 - 0.85 * blackout );
}

// The lamps in the pools, lighting what's over the water from under it, as the same network.
vec3 poolLampBounce( vec3 p, float pixel ) {
	if ( p.y <= 0.004 ) return vec3( 0.0 );
	float glow = poolGlow( p.xz );
	if ( glow <= 0.004 ) return vec3( 0.0 );
	// (Up through the water under it: fading out over the walkways.)
	glow *= poolWet( p.xz );
	if ( glow <= 0.004 ) return vec3( 0.0 );
	float network = poolCaustics( poolThrough( p ) * 0.8 + 3.1, 0.05 + p.y * 0.1 + poolCausticBlur( pixel * 0.8 ) );
	return LAMP_COLOR * glow * ( 0.15 + 0.85 * network ) * 0.3 * ( 1.0 - blackout );
}

// What a glazed surface at p, looking along r, sees in it: the skylights and the ceiling above, the walls round
// about, the water below.
vec3 poolEnvironment( vec3 p, vec3 r, float area ) {
	vec3 walls = vec3( 0.46, 0.46, 0.4 ) * ( 0.2 + 0.8 * area );
	vec3 seen = walls;
	if ( r.y > 0.02 ) {
		float roof = p.y > 0.999 ? SKY_TOP : 1.0;
		float up = ( roof - p.y ) / r.y;
		vec2 c = p.xz + r.xz * up;
		float sky = up < 7.0 ? poolSkylight( c ) : 0.0;
		vec3 above = vec3( 0.42, 0.48, 0.42 ) * ( 0.2 + 0.8 * backroomsAreaLight( c ) );
		seen = mix( above, vec3( 2.4, 2.2, 1.8 ) * ( 1.0 - 0.85 * blackout ), sky );
	} else if ( r.y < -0.02 ) {
		seen = vec3( 0.06, 0.24, 0.17 ) * ( 0.25 + 0.75 * area );
	}
	return mix( walls, seen, smoothstep( 0.0, 0.3, abs( r.y ) ) );
}

// ------------------------------------------------------------------------------------------------ the air

// The part of the line of sight from t0 to t1 whose footprint on the ceiling (seen along the sun), f0 + f1 t, is in the
// square round c of half-size h: as (from, to), empty if from >= to.
vec2 poolPane( vec2 f0, vec2 f1, vec2 c, float h, float t0, float t1 ) {
	vec2 lo = c - h - f0;
	vec2 hi = c + h - f0;
	for ( int axis = 0; axis < 2; axis ++ ) {
		float speed = f1[ axis ];
		if ( abs( speed ) < 1e-6 ) {
			if ( lo[ axis ] > 0.0 || hi[ axis ] < 0.0 ) t1 = t0;
		} else {
			float a = lo[ axis ] / speed;
			float b = hi[ axis ] / speed;
			t0 = max( t0, min( a, b ) );
			t1 = min( t1, max( a, b ) );
		}
	}
	return vec2( t0, t1 );
}

// The sun's shafts in the air between the eye and a point. Each skylight throws a leaning beam, four panes wide between
// its glazing bars; this works out exactly where the line of sight goes through each beam (walking the skylights its
// footprint on the ceiling crosses), so there's no noise to it. The air drifts through them. Under the water, they
// carry on, bluer and fading.
vec3 poolShafts( vec3 eye, vec3 dir, float dist ) {
	if ( mirrorView > 0.5 ) return vec3( 0.0 );
	vec2 lean = SUN.xz / SUN.y;
	vec2 f0 = eye.xz + lean * ( 1.0 - eye.y );
	vec2 f1 = dir.xz - lean * dir.y;
	// The part of the line of sight below the ceiling, and not too far off.
	float tStart = 0.0;
	float tEnd = min( dist, 10.0 );
	if ( abs( dir.y ) > 1e-5 ) {
		float tTop = ( 1.0 - eye.y ) / dir.y;
		if ( dir.y > 0.0 ) tEnd = min( tEnd, tTop );
		else tStart = max( tStart, tTop );
	}
	// Where it goes in or out of the water.
	float tWater = abs( dir.y ) > 1e-5 ? - eye.y / dir.y : ( eye.y < 0.0 ? - 1e6 : 1e6 );
	bool downward = dir.y < 0.0;
	vec3 sum = vec3( 0.0 );
	if ( tEnd > tStart ) {
		// Walk the skylight slots (2 × 2 cells) the footprint crosses, from tStart.
		vec2 from = f0 + f1 * tStart;
		vec2 slot = floor( from * 0.5 );
		vec2 stepDir = sign( f1 );
		vec2 tDelta = vec2( abs( f1.x ) > 1e-6 ? 2.0 / abs( f1.x ) : 1e9, abs( f1.y ) > 1e-6 ? 2.0 / abs( f1.y ) : 1e9 );
		vec2 tMax = vec2(
			abs( f1.x ) > 1e-6 ? ( ( slot.x + max( stepDir.x, 0.0 ) ) * 2.0 - f0.x ) / f1.x : 1e9,
			abs( f1.y ) > 1e-6 ? ( ( slot.y + max( stepDir.y, 0.0 ) ) * 2.0 - f0.y ) / f1.y : 1e9 );
		// From under the water, each beam is one shaft, the glazing bars lost in the ripples, and much softer at its
		// edges: seen from inside one, its edge would be a hard line right across the view.
		bool under = eye.y < 0.0;
		int panes = under ? 1 : 4;
		int softs = under ? 4 : 2;
		float paneHalf = under ? SKYLIGHT_HALF - 0.09 : ( SKYLIGHT_HALF - 0.016 ) * 0.5;
		float paneOffset = under ? 0.0 : 0.016 + paneHalf;
		float softStep = under ? 0.06 : 0.018;
		float softWeight = under ? 0.5 : 1.0;
		for ( int k = 0; k < 14; k ++ ) {
			vec4 state = panelState( slot );
			if ( abs( state.a * 255.0 - ${SLOT_SKY}.0 ) < 0.5 ) {
				vec2 centre = slot * 2.0 + 1.0;
				for ( int pane = 0; pane < 4; pane ++ ) {
					if ( pane >= panes ) break;
					vec2 c = centre + vec2( pane < 2 ? - paneOffset : paneOffset, ( pane & 1 ) == 0 ? - paneOffset : paneOffset );
					// Soft at the edges: the beam as it is, and a little wider.
					for ( int soft = 0; soft < 4; soft ++ ) {
						if ( soft >= softs ) break;
						vec2 span = poolPane( f0, f1, c, paneHalf + float( soft ) * softStep, tStart, tEnd );
						if ( span.x >= span.y ) continue;
						float middle = 0.5 * ( span.x + span.y );
						vec3 q = eye + dir * middle;
						float drift = backroomsNoise( q.xz * 1.4 + vec2( lightTime * 0.035, q.y * 2.1 - lightTime * 0.02 ) );
						float air = ( 0.5 + 1.0 * drift * drift ) * exp( - 0.03 * middle * middle ) * 0.5 * softWeight;
						// Split at the water.
						float inAir = downward ? max( min( span.y, tWater ) - span.x, 0.0 ) : max( span.y - max( span.x, tWater ), 0.0 );
						float inWater = ( span.y - span.x ) - inAir;
						sum += vec3( inAir * air );
						if ( inWater > 0.0 ) sum += inWater * air * 0.45 * exp( - WATER_ABSORB * ( max( - q.y, 0.0 ) / SUN.y + 0.3 * inWater ) ) * vec3( 0.55, 1.0, 1.0 );
					}
				}
			}
			float next = min( tMax.x, tMax.y );
			if ( next >= tEnd ) break;
			if ( tMax.x < tMax.y ) {
				slot.x += stepDir.x;
				tMax.x += tDelta.x;
			} else {
				slot.y += stepDir.y;
				tMax.y += tDelta.y;
			}
		}
	}
	return SUN_COLOR * sum * 0.07 * poolClouds( eye.xz + dir.xz * 3.0 ) * ( 1.0 - 0.9 * blackout );
}

// Level 37's air over a fragment's colour: the water between it and the eye, the haze (haze
// is its colour, fogFactor how much of it there is here, area how lit it is here), and the sun's shafts in it all.
vec3 poolAir( vec3 color, vec3 haze, float fogFactor, float area ) {
	vec3 eye = poolEye();
	vec3 p = vBackroomsWorldPosition;
	vec3 ray = p - eye;
	float dist = max( length( ray ), 1e-4 );
	vec3 dir = ray / dist;
	// How much the shafts show, over or under the water. (They're added once, at the end: a shader gets a whole
	// copy of them for each place they're used, and they're slow to compile.)
	float shafts;
	if ( eye.y >= 0.0 ) {
		if ( p.y < 0.0 ) {
			// Seen through the water, from where the line of sight goes into it.
			float inWater = dist * ( - p.y ) / max( eye.y - p.y, 1e-4 );
			color = poolThroughWater( color, inWater, p.xz, area );
		}
		color = mix( color, haze, fogFactor );
		shafts = 1.0 - 0.5 * fogFactor;
	} else {
		// Under the water: everything's seen through it, as far as the surface, and it closes in a few metres off.
		float inWater = p.y <= 0.0 ? dist : dist * ( - eye.y ) / max( p.y - eye.y, 1e-4 );
		vec3 deep = WATER_GLOW * ( 0.4 + 1.2 * cameraAreaLight ) + LAMP_COLOR * poolGlow( eye.xz ) * 0.18 * ( 1.0 - blackout );
		vec3 through = exp( - WATER_ABSORB * inWater * 1.2 );
		color = color * through + deep * ( 1.0 - exp( - 0.9 * inWater ) );
		if ( p.y > 0.0 ) {
			// Above the surface: only straight up, through the window in it; further over, it mirrors the water.
			float window = smoothstep( 0.62, 0.72, dir.y );
			color = mix( deep * 0.8, mix( color, haze, fogFactor ), window );
		}
		color = color * ( 0.96 + 0.08 * poolCaustics( poolThrough( p ) * 0.5, 0.2 ) );
		shafts = 0.7;
	}
	return color + poolShafts( eye, dir, dist ) * shafts;
}
`;

/**
 * Level 37's part of every shader compiled for it (see levelShading.js): its lights, its air, and the sun and the
 * water's light as lights of their own (LEVEL_DIRECT, which the ceiling lights in materials.js take in after theirs,
 * as three.js' own lights do).
 */
export const POOLROOMS_SHADING = /* glsl */ `
${POOLROOMS_GLSL}

vec3 levelLightTint( float code ) {
	float byte = floor( code * 255.0 + 0.5 );
	if ( byte > ${SLOT_LAMP}.0 - 0.5 ) return vec3( 1.0, 0.97, 0.9 );
	if ( byte > ${SLOT_SKY}.0 - 0.5 ) return vec3( 1.12, 1.05, 0.92 );
	return vec3( 1.0 );
}

vec3 levelAir( vec3 color, vec3 haze, float fogFactor, float area ) {
	return poolAir( color, haze, fogFactor, area );
}

// A dead light: a grey disc.
const vec3 LEVEL_DEAD_LIGHT = vec3( 0.42, 0.43, 0.43 );

// The sun through the skylights, the sun and the lamps thrown back up off the water, the light off the white floor
// onto the undersides of things, and under the water, the lamps' light in it and the caustics over everything down
// there. (A macro: it runs in main, where the material is. The lights' colours are as they look, so they're scaled
// by π for three.js' lights, which divide by it; see lighting.js.)
#define LEVEL_DIRECT { \\
	IncidentLight levelLight; \\
	levelLight.visible = true; \\
	vec3 levelPoint = vBackroomsWorldPosition; \\
	vec3 levelNormal = inverseTransformDirection( geometryNormal, viewMatrix ); \\
	reflectedLight.indirectDiffuse += material.diffuseColor * vec3( 0.6, 0.78, 0.66 ) * ( 0.5 - 0.5 * levelNormal.y ) * backroomsArea * 0.3; \\
	if ( levelPoint.y < 0.0 ) { \\
		float levelFocus = 0.72 + 0.55 * poolCaustics( poolThrough( levelPoint ), min( - levelPoint.y * 0.1, 0.3 ) + poolCausticBlur( backroomsPixel ) ); \\
		reflectedLight.indirectDiffuse *= levelFocus; \\
		reflectedLight.directDiffuse *= mix( 1.0, levelFocus, 0.6 ); \\
		reflectedLight.indirectDiffuse += material.diffuseColor * LAMP_COLOR * poolGlow( levelPoint.xz ) * ( 1.0 - blackout ) * 0.55; \\
	} \\
	vec3 levelSun = poolSunLight( levelPoint, backroomsPixel ); \\
	if ( levelSun.r > 0.0 ) { \\
		levelLight.direction = normalize( ( viewMatrix * vec4( SUN, 0.0 ) ).xyz ); \\
		levelLight.color = levelSun * PI; \\
		RE_Direct( levelLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight ); \\
	} \\
	vec3 levelBounce = poolSunBounce( levelPoint, backroomsPixel ); \\
	if ( levelBounce.r > 0.0 ) { \\
		levelLight.direction = normalize( ( viewMatrix * vec4( SUN.x, - SUN.y, SUN.z, 0.0 ) ).xyz ); \\
		levelLight.color = levelBounce * PI; \\
		RE_Direct( levelLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight ); \\
	} \\
	vec3 levelLamps = poolLampBounce( levelPoint, backroomsPixel ); \\
	if ( levelLamps.r > 0.0 ) { \\
		levelLight.direction = normalize( ( viewMatrix * vec4( 0.0, - 1.0, 0.0, 0.0 ) ).xyz ); \\
		levelLight.color = levelLamps * PI; \\
		RE_Direct( levelLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight ); \\
		reflectedLight.indirectDiffuse += material.diffuseColor * levelLamps * 0.3; \\
	} \\
}
`;

// ---------------------------------------------------------------------------------------------- surfaces

/**
 * The tile, for everything tiled (the walls, and the floor, ceiling, columns and arches of poolroomsGeometry.js):
 * worked out from its texture coordinates, which are in world units along each surface. White, glazed, in 1/16-unit
 * tiles (17 cm) with grey grout, each tile a little off true; the pools' floors pale aqua in some pools, with dark
 * lane lines down the long ones and a drain in the middle; a row of deep blue tiles at the water's edge on every
 * wall; and a band of blue round the walls of some rooms. Sets poolGrout (0 glaze .. 1 grout) and poolTilt (how the
 * tile's face leans, along u and v) for the normal and the glaze below.
 */
const TILE_GLSL = /* glsl */ `
float poolGrout = 0.0;
vec2 poolTilt = vec2( 0.0 );
float poolGloss = 1.0;
{
	vec3 p = vBackroomsWorldPosition;
	vec3 worldNormal = inverseTransformDirection( normalize( vNormal ), viewMatrix );
	vec2 uv = vUv;
	float size = ${TILE};
	vec2 cell = floor( p.xz + worldNormal.xz * 0.06 + 0.5 );
	vec4 here = cellState( cell );
	uint flags = uint( here.g * 255.0 + 0.5 );
	bool upward = worldNormal.y > 0.7;
	bool upright = abs( worldNormal.y ) < 0.3;
	// Under the water, the tiles waver with the ripples over them (and on the floor, the lines and drains on them).
	vec2 wobble = vec2( 0.0 );
	if ( p.y < 0.0 ) {
		vec3 eye = poolEye();
		if ( eye.y > 0.0 ) {
			float t = eye.y / max( eye.y - p.y, 1e-4 );
			vec2 surface = mix( eye.xz, p.xz, t );
			vec2 bend = poolWaves( surface ) * ( - p.y ) * 0.9;
			wobble = upward ? bend : vec2( bend.x + bend.y, 0.0 );
			uv += wobble;
		}
	}
	vec2 q = uv / size;
	vec2 id = floor( q );
	vec2 f = q - id - 0.5;
	vec2 e = 0.5 - abs( f );
	float pixel = max( length( fwidth( uv ) ), 1e-5 ) / size;
	float joint = 0.03;
	float grout = 1.0 - smoothstep( joint - pixel * 0.7, joint + pixel * 0.7, min( e.x, e.y ) );
	// Far off, where a joint is thinner than a pixel, just a shade darker on average.
	float far = smoothstep( 0.06, 0.3, pixel );
	poolGrout = mix( grout, 0.14, far );
	uint h = backroomsHash( uint( int( id.x ) + 65536 ) * 2654435761u ^ uint( int( id.y ) + 65536 ) * 2246822519u );
	vec2 lean = ( vec2( float( h & 255u ), float( ( h >> 8u ) & 255u ) ) / 255.0 - 0.5 ) * 0.045;
	// The glaze rolls over at each tile's edge.
	vec2 roll = sign( f ) * ( 1.0 - smoothstep( 0.0, 0.07, e ) ) * 0.3;
	poolTilt = ( lean + roll * ( 1.0 - grout ) ) * ( 1.0 - far );
	vec3 glaze = vec3( 0.9, 0.89, 0.82 ) * ( 0.975 + 0.05 * float( ( h >> 16u ) & 255u ) / 255.0 );
	vec3 groutColour = vec3( 0.3, 0.31, 0.28 );
	if ( upward && ( flags & ${CELL_AQUA}u ) != 0u ) glaze = vec3( 0.66, 0.84, 0.74 ) * ( 0.97 + 0.06 * float( ( h >> 16u ) & 255u ) / 255.0 );
	if ( upward ) {
		// Lane lines down the pool, and the drain in the middle of it (or of a flooded floor).
		vec2 local = p.xz + wobble - cell;
		if ( ( flags & ${CELL_LANE}u ) != 0u && abs( local.y ) < 0.045 ) glaze = vec3( 0.08, 0.17, 0.14 );
		if ( ( flags & ${CELL_LANE_Z}u ) != 0u && abs( local.x ) < 0.045 ) glaze = vec3( 0.08, 0.17, 0.14 );
		if ( ( flags & ${CELL_DRAIN}u ) != 0u && max( abs( local.x ), abs( local.y ) ) < 0.075 ) {
			// Its slots, fading to their average where they're finer than a pixel.
			float slots = local.x * 70.0;
			float slot = mix( step( 0.5, fract( slots ) ), 0.5, smoothstep( 0.35, 0.9, fwidth( slots ) ) );
			glaze = mix( vec3( 0.3, 0.32, 0.33 ), vec3( 0.06, 0.07, 0.08 ), slot );
			poolGloss = 0.3;
			poolGrout = 0.0;
		}
	}
	if ( upright ) {
		// A row of deep blue at the water's edge, the way pools are tiled, and a band round some rooms.
		if ( p.y > - size && p.y < 0.0 ) glaze = vec3( 0.13, 0.3, 0.25 ) * ( 0.92 + 0.1 * float( ( h >> 16u ) & 255u ) / 255.0 );
		if ( ( flags & ${CELL_BAND}u ) != 0u ) {
			if ( p.y > 4.0 * size && p.y < 5.0 * size ) glaze = vec3( 0.24, 0.44, 0.36 ) * ( 0.93 + 0.1 * float( ( h >> 16u ) & 255u ) / 255.0 );
			if ( p.y > 5.0 * size && p.y < 5.25 * size ) glaze = vec3( 0.1, 0.2, 0.16 );
		}
	}
	diffuseColor.rgb *= mix( glaze, groutColour, poolGrout );
}
`;

/** The tile's face, off true, and rolled at its edges (see TILE_GLSL), on the surface's own directions. */
const TILE_NORMAL_GLSL = /* glsl */ `
#include <normal_fragment_maps>
{
	vec3 eyePosition = - vViewPosition;
	vec3 q0 = dFdx( eyePosition );
	vec3 q1 = dFdy( eyePosition );
	vec2 st0 = dFdx( vUv );
	vec2 st1 = dFdy( vUv );
	vec3 q1perp = cross( q1, normal );
	vec3 q0perp = cross( normal, q0 );
	vec3 T = q1perp * st0.x + q0perp * st1.x;
	vec3 B = q1perp * st0.y + q0perp * st1.y;
	float det = max( dot( T, T ), dot( B, B ) );
	float scale = det == 0.0 ? 0.0 : inversesqrt( det );
	normal = normalize( normal + ( T * poolTilt.x + B * poolTilt.y ) * scale );
}
`;

/** The glaze shines; the grout doesn't. */
const TILE_SPECULAR_GLSL = /* glsl */ `
#include <lights_phong_fragment>
material.specularStrength = ( 1.0 - 0.94 * poolGrout ) * poolGloss;
`;

/**
 * The glaze reflects the room: at a glancing angle most of all. The floor at the water's height takes the reflection
 * the water has (see Reflection.js), smeared by the glaze; everything else, the skylights and the room roughly.
 */
const TILE_GLAZE_GLSL = /* glsl */ `
{
	vec3 p = vBackroomsWorldPosition;
	vec3 toEye = normalize( poolEye() - p );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	float facing = clamp( dot( n, toEye ), 0.0, 1.0 );
	float fresnel = 0.035 + 0.965 * pow( 1.0 - facing, 5.0 );
	vec3 r = reflect( - toEye, n );
	vec3 seen;
	if ( reflectionOn > 0.5 && n.y > 0.8 && p.y > - 0.005 && p.y < 0.06 && mirrorView < 0.5 ) {
		vec4 clip = reflectionMatrix * vec4( p, 1.0 );
		vec2 uv = clip.xy / clip.w + poolTilt * 0.02;
		seen = texture2D( reflectionMap, uv ).rgb * 0.5 + texture2D( reflectionMap, uv + vec2( 0.004, 0.006 ) ).rgb * 0.25 + texture2D( reflectionMap, uv - vec2( 0.005, 0.004 ) ).rgb * 0.25;
	} else {
		seen = poolEnvironment( p, r, backroomsArea );
	}
	outgoingLight = mix( outgoingLight, seen, fresnel * ( abs( n.y ) > 0.7 ? 0.55 : 0.22 ) * ( 1.0 - 0.95 * poolGrout ) * poolGloss );
}
#include <opaque_fragment>
`;

/** The reflection's uniforms (see Reflection.js). */
const REFLECTION_DECLARATIONS = /* glsl */ `
uniform sampler2D reflectionMap;
uniform mat4 reflectionMatrix;
uniform float reflectionOn;
`;

/**
 * The water's surface (see poolroomsGeometry.js): no colour of its own, only what it reflects, and what's under it
 * shows through (drawn already, and seen through the water by its own air: see poolAir). Its normal is the ripples';
 * the lights shine in it (with the sun, sharply); how much it reflects depends on the angle, much more at a glance.
 * From under it, a mirror but for a window straight up. Drawn with its alpha already in its colour, so it adds its
 * reflection and lets through the rest.
 */
const WATER_NORMAL_GLSL = /* glsl */ `
#include <normal_fragment_maps>
vec2 poolSlope = poolWaves( vBackroomsWorldPosition.xz );
vec3 poolNormal = normalize( vec3( - poolSlope.x, 1.0, - poolSlope.y ) );
normal = normalize( ( viewMatrix * vec4( gl_FrontFacing ? poolNormal : - poolNormal, 0.0 ) ).xyz );
`;

/**
 * The lights shine in it faintly: the reflection has them already, where there is one. (The sun's glitter is its own:
 * see below.)
 */
const WATER_SPECULAR_GLSL = /* glsl */ `
#include <lights_phong_fragment>
material.specularStrength = reflectionOn > 0.5 ? 0.12 : 0.6;
`;

const WATER_SURFACE_GLSL = /* glsl */ `
{
	vec3 p = vBackroomsWorldPosition;
	vec3 toEye = normalize( poolEye() - p );
	float alpha;
	if ( gl_FrontFacing ) {
		float facing = clamp( dot( poolNormal, toEye ), 0.0, 1.0 );
		float fresnel = 0.02 + 0.98 * pow( 1.0 - facing, 5.0 );
		vec3 mirrored;
		if ( reflectionOn > 0.5 ) {
			vec4 clip = reflectionMatrix * vec4( p, 1.0 );
			mirrored = texture2D( reflectionMap, clip.xy / clip.w + poolSlope * 0.35 ).rgb;
		} else {
			mirrored = poolEnvironment( p, reflect( - toEye, poolNormal ), backroomsArea );
		}
		// A little of the light in the water comes back up off it, more at a glance.
		vec3 film = WATER_GLOW * ( 0.2 + 0.8 * backroomsArea ) * 0.35;
		// Where the sun's on it, it glitters.
		float glint = pow( max( dot( reflect( - toEye, poolNormal ), SUN ), 0.0 ), 900.0 );
		vec3 sparkle = glint > 0.001 ? SUN_COLOR * glint * poolSun( p ) * 7.0 : vec3( 0.0 );
		outgoingLight = outgoingLight + mirrored * fresnel + film * ( 0.3 + 0.7 * fresnel ) + sparkle;
		alpha = clamp( fresnel + 0.05, 0.0, 1.0 );
	} else {
		// From underneath: beyond the angle light can get out at, the surface mirrors the water.
		float up = clamp( dot( - poolNormal, toEye ), 0.0, 1.0 );
		float window = smoothstep( 0.62, 0.72, up );
		vec3 deep = WATER_GLOW * ( 0.35 + 0.9 * cameraAreaLight ) + LAMP_COLOR * poolGlow( p.xz ) * 0.4 * ( 1.0 - blackout );
		float shimmer = poolCaustics( p.xz * 1.3, 0.05 + poolCausticBlur( backroomsPixel * 1.3 ) );
		outgoingLight = outgoingLight + mix( deep * ( 0.8 + 0.5 * shimmer ), vec3( 0.0 ), window );
		alpha = mix( 0.85, 0.15, window );
	}
	gl_FragColor = vec4( outgoingLight, alpha );
}
`;

/** The haze over the water's surface: over its own light only (what's under it has had its own). */
const WATER_FOG_GLSL = /* glsl */ `
#ifdef USE_FOG
	float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	vec3 poolHaze = fogColor * mix( backroomsArea * backroomsTint, vec3( cameraAreaLight ), fogFactor );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, poolHaze * gl_FragColor.a, fogFactor );
#endif
`;

/** Chrome: it's almost all reflection. */
const METAL_GLSL = /* glsl */ `
{
	vec3 p = vBackroomsWorldPosition;
	vec3 toEye = normalize( poolEye() - p );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec3 seen = poolEnvironment( p, reflect( - toEye, n ), backroomsArea );
	outgoingLight = outgoingLight * 0.35 + seen * diffuseColor.rgb * 0.75;
}
#include <opaque_fragment>
`;

/** The lamps in the pools: their lenses glow (and go out in a power cut); the chrome round them is lit. */
const LAMP_GLSL = /* glsl */ `
#include <color_fragment>
if ( diffuseColor.b > 0.95 ) diffuseColor.rgb = mix( vec3( 0.3, 0.36, 0.33 ), vec3( 0.75, 1.45, 1.15 ), 1.0 - blackout );
else diffuseColor.rgb *= 0.35 + 0.65 * backroomsArea;
`;

/**
 * Whatever's floating (see ColorBuilder.drift): bobbing on the swell, tipping with it, turning slowly and wandering
 * a little way round where it was left.
 */
const FLOAT_DECLARATIONS = /* glsl */ `
attribute vec4 drift;
uniform float lightTime;
// A point (or, with point false, a normal) of it, where it's drifted to.
vec3 poolDrift( vec3 v, bool point ) {
	float t = lightTime;
	float phase = drift.z;
	vec3 centre = vec3( drift.x, 0.0, drift.y );
	vec3 local = point ? v - centre : v;
	float turn = t * drift.w + phase;
	float c = cos( turn );
	float s = sin( turn );
	local = vec3( c * local.x - s * local.z, local.y, s * local.x + c * local.z );
	// Tipping with the swell (as a shear: it's slight).
	float tx = 0.07 * sin( t * 0.9 + phase );
	float tz = 0.07 * cos( t * 0.7 + phase * 1.3 );
	if ( !point ) return normalize( vec3( local.x - local.y * tx, local.y, local.z - local.y * tz ) );
	local.y += local.x * tx + local.z * tz;
	vec3 wander = vec3( sin( t * 0.021 + phase ) * 0.22, 0.004 * sin( t * 1.25 + phase * 2.0 ), cos( t * 0.017 + phase * 1.7 ) * 0.22 );
	return centre + local + wander;
}
`;

const FLOAT_VERTEX_GLSL = /* glsl */ `
#include <begin_vertex>
transformed = poolDrift( transformed, true );
`;

const FLOAT_NORMAL_GLSL = /* glsl */ `
#include <beginnormal_vertex>
objectNormal = poolDrift( objectNormal, false );
`;

/**
 * Level 37's own surfaces (see withBackroomsShading in materials.js): each takes the vertex and fragment shaders
 * three.js made for it and puts its part in.
 * @type {Record<string, (vertex: string, fragment: string) => { vertex: string, fragment: string }>}
 */
export const POOLROOMS_SURFACES = {
    l37tile: (vertex, fragment) => ({
        vertex,
        fragment: REFLECTION_DECLARATIONS + fragment
            .replace('#include <map_fragment>', `#include <map_fragment>\n${TILE_GLSL}`)
            .replace('#include <normal_fragment_maps>', TILE_NORMAL_GLSL)
            .replace('#include <lights_phong_fragment>', TILE_SPECULAR_GLSL)
            .replace('#include <opaque_fragment>', TILE_GLAZE_GLSL),
    }),
    l37water: (vertex, fragment) => ({
        vertex,
        fragment: REFLECTION_DECLARATIONS + fragment
            .replace('#include <normal_fragment_maps>', WATER_NORMAL_GLSL)
            .replace('#include <lights_phong_fragment>', WATER_SPECULAR_GLSL)
            .replace('#include <opaque_fragment>', WATER_SURFACE_GLSL)
            .replace('#include <fog_fragment>', WATER_FOG_GLSL),
    }),
    l37metal: (vertex, fragment) => ({ vertex, fragment: fragment.replace('#include <opaque_fragment>', METAL_GLSL) }),
    l37lamp: (vertex, fragment) => ({ vertex, fragment: fragment.replace('#include <color_fragment>', LAMP_GLSL) }),
    l37float: (vertex, fragment) => ({
        vertex: FLOAT_DECLARATIONS + vertex.replace('#include <begin_vertex>', FLOAT_VERTEX_GLSL).replace('#include <beginnormal_vertex>', FLOAT_NORMAL_GLSL),
        fragment,
    }),
};
