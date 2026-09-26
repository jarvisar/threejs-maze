import { Color, MeshBasicMaterial, MeshPhongMaterial, ShaderMaterial } from 'three';
import { FOG_DENSITY } from '../config.js';
import { DECAL_OPTIONS, createGlowMaterial, withBackroomsShading, worldLighting } from './materials.js';
import { PANEL_LIGHT_GLSL } from './panelLights.js';
import { PIPE_DREAMS_LAMP_GLSL } from './pipeDreamsShading.js';
import { createPipeDreamsTextures } from './pipeDreamsTextures.js';

/**
 * Level 2's (see pipeDreams.js): its walls, floor and ceiling, and its own meshes (pipeDreamsGeometry.js): the pipes and
 * everything else metal, the lamps (lit like Level 0's panels), the glow round each and round the fires, the paint (signs,
 * tape, streaks, doors), the stencils, the black stuff's puddles, the fires, the gauges' faces, the ledges (the walls'
 * own concrete), and the steam.
 * @param {object} shared The materials every level has.
 * @param {number} maxAnisotropy
 * @param {number} level Its number, which its surfaces are compiled for.
 * @returns {import('./materials.js').LevelSurfaces}
 */
export function createPipeDreamsSurfaces(shared, maxAnisotropy, level) {
    const textures = createPipeDreamsTextures(maxAnisotropy);
    const wall = withBackroomsShading(new MeshPhongMaterial({ map: textures.walls, bumpMap: textures.walls, bumpScale: 0.0035, specular: 0x101010, shininess: 8 }), 'l2wall', level);
    // (Their texture coordinates are how far along them, and round them: see pipeDreamsShading.js.)
    const pipes = new MeshPhongMaterial({ vertexColors: true, specular: 0xffffff, shininess: 30 });
    pipes.defines = { USE_UV: '' };
    const gauges = new MeshPhongMaterial({ vertexColors: true, specular: 0x8a8a8a, shininess: 80 });
    gauges.defines = { USE_UV: '' };
    const fire = new MeshBasicMaterial({ vertexColors: true });
    fire.defines = { USE_UV: '' };
    return {
        wall,
        floor: withBackroomsShading(new MeshPhongMaterial({ map: textures.floor, bumpMap: textures.floor, bumpScale: 0.005, specular: 0xffffff, shininess: 30 }), 'l2floor', level),
        ceiling: withBackroomsShading(new MeshPhongMaterial({ map: textures.ceiling, specular: 0x000000, shininess: 0 }), 'l2ceiling', level),
        details: withBackroomsShading(new MeshPhongMaterial({ map: shared.details.map, shininess: 20 }), undefined, level),
        extras: {
            pipes: withBackroomsShading(pipes, 'l2pipe', level),
            fixtures: shared.fixture,
            glows: createGlowMaterial({ declarations: PIPE_DREAMS_LAMP_GLSL, light: GLOW_LIGHT, color: new Color(0.78, 0.62, 0.44), soft: 0.35 }),
            paint: withBackroomsShading(new MeshPhongMaterial({ map: textures.paint, vertexColors: true, shininess: 6, ...DECAL_OPTIONS }), undefined, level),
            stencils: withBackroomsShading(new MeshPhongMaterial({ map: textures.glyphs, vertexColors: true, shininess: 4, ...DECAL_OPTIONS }), undefined, level),
            // The black stuff: glossy, and catching the bulbs overhead where it's pooled (as Level 0's wet carpet does).
            goo: withBackroomsShading(new MeshPhongMaterial({ color: 0x0b0908, map: textures.paint, specular: 0x9a9a9a, shininess: 90, ...DECAL_OPTIONS }), 'decal', level),
            fire: withBackroomsShading(fire, 'l2fire', level),
            gauges: withBackroomsShading(gauges, 'l2gauge', level),
            ledges: wall,
            steam: createSteamMaterial(),
        },
        shadows: ['pipes'],
    };
}

/**
 * How bright the glow round each light is, and its colour (see createGlowMaterial in materials.js): a bulb's follows
 * its slot and the bulb's colour; a fire's (its source 2 and up) flickers orange whatever the power's doing.
 */
const GLOW_LIGHT = /* glsl */ `
	float strength = glow.z;
	vec3 tint = vec3( 1.0 );
	if ( glow.y >= 2.0 ) {
		strength *= pipeFire( glow.y - 2.0 );
		tint = vec3( 1.5, 0.62, 0.2 );
	} else if ( glow.y < 0.0 ) {
		vec4 state = panelState( floor( ( world.xz - 1.0 ) * 0.5 + 0.5 ) );
		strength *= state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
		tint = pipeLamp( state.a );
	} else {
		strength *= panelFlicker( glow.y ) * ( 1.0 - blackout );
	}
`;

/**
 * The steam (see buildSteam in pipeDreamsGeometry.js): each puff a soft, stirring blob facing the camera, moved along by
 * its vertex shader from the leak it came out of, and lit like the air where it's got to: the light round about, and
 * the nearest bulb. A jet shoots out and slows, spreading and rising as it cools; a plume just rises; a safety valve
 * blows off for a few seconds now and then. A drop of the black stuff (the last kind) hangs under its pipe, swelling,
 * then falls, and is gone into its puddle.
 */
function createSteamMaterial() {
    const { panelStates, lightTime, blackout, gridLightIntensity, gridLightColor, flashlightBeam, flashlightAim } = worldLighting;
    return new ShaderMaterial({
        uniforms: { panelStates, lightTime, blackout, gridLightIntensity, gridLightColor, flashlightBeam, flashlightAim, fogDensity: { value: FOG_DENSITY } },
        vertexShader: /* glsl */ `
${PANEL_LIGHT_GLSL}
${PIPE_DREAMS_LAMP_GLSL}
uniform float gridLightIntensity;
uniform vec3 gridLightColor;
uniform float fogDensity;
uniform vec4 flashlightBeam;
uniform vec3 flashlightAim;
attribute vec2 corner;
attribute vec4 puff;
attribute vec4 shape;
varying vec2 vCorner;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
varying float vDrop;
void main() {
	vec3 origin = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	float size = shape.x;
	float life = shape.y;
	float kind = shape.z;
	float strength = shape.w;
	float age = fract( lightTime / life + puff.w );
	float t = age * life;
	vec3 at;
	float radius;
	float alpha;
	if ( kind < 0.5 ) {
		float speed = 0.7 + 0.6 * strength;
		at = origin + puff.xyz * speed * ( 1.0 - exp( - 3.0 * t ) ) / 3.0 + vec3( 0.0, 0.1 * t * t, 0.0 );
		radius = size * ( 0.3 + 3.0 * age );
		alpha = smoothstep( 0.0, 0.05, age ) * pow( 1.0 - age, 1.5 ) * ( 0.45 + 0.35 * strength );
	} else if ( kind < 1.5 ) {
		at = origin + vec3( 0.0, 0.3 * t, 0.0 );
		radius = size * ( 0.5 + 2.0 * age );
		alpha = smoothstep( 0.0, 0.15, age ) * pow( 1.0 - age, 1.3 ) * 0.4 * strength;
	} else if ( kind < 2.5 ) {
		// Blowing off for four seconds or so in every twenty-odd, each valve in its own time.
		float cycle = mod( lightTime + origin.x * 7.3 + origin.z * 3.1, 23.0 );
		float blowing = smoothstep( 0.0, 0.4, cycle ) * ( 1.0 - smoothstep( 3.5, 4.5, cycle ) );
		at = origin + vec3( 0.0, 0.9 * t, 0.0 );
		radius = size * ( 0.3 + 2.4 * age );
		alpha = smoothstep( 0.0, 0.1, age ) * pow( 1.0 - age, 1.4 ) * 0.5 * blowing;
	} else {
		// A drop: hanging and swelling for most of its time, then falling (at g, in units of 2.7 m) to the floor.
		float falling = max( t - life * 0.85, 0.0 );
		float fall = 1.8 * falling * falling;
		at = origin - vec3( 0.0, fall, 0.0 );
		radius = size * mix( 0.4, 1.0, smoothstep( 0.0, 0.85, age ) );
		alpha = step( fall, origin.y );
	}
	vDrop = step( 2.5, kind );
	// Stirred about as it goes, and kept under the ceiling (a drop just falls).
	float stir = puff.w * 53.0;
	float stirred = age * ( 1.0 - vDrop );
	at.x += ( backroomsNoise( vec2( t * 1.7 + stir, 1.3 ) ) - 0.5 ) * 0.14 * stirred;
	at.z += ( backroomsNoise( vec2( 4.1, t * 1.7 + stir ) ) - 0.5 ) * 0.14 * stirred;
	at.y = min( at.y, 0.99 - radius * 0.25 );
	// Lit like the air round it: the light about, and the nearest bulb.
	vec2 panel = floor( ( at.xz - 1.0 ) * 0.5 + 0.5 );
	vec4 state = panelState( panel );
	vec3 bulb = vec3( panel.x * 2.0 + 1.0, 0.9, panel.y * 2.0 + 1.0 );
	float near = max( 1.0 - length( bulb - at ) / 2.2, 0.0 );
	float lit = state.r * panelFlicker( state.b ) * ( 1.0 - blackout ) * near * near * gridLightIntensity;
	vColor = vec3( 0.55, 0.5, 0.43 ) * ( 0.05 + 0.75 * backroomsAreaLight( at.xz ) ) + gridLightColor * pipeLamp( state.a ) * lit * 0.3;
	// And the flashlight, if it's in the beam.
	vec3 fromTorch = at - flashlightBeam.xyz;
	float torch = length( fromTorch );
	vColor += vec3( 0.9, 0.88, 0.82 ) * flashlightBeam.w * smoothstep( 0.84, 0.95, dot( fromTorch / max( torch, 1e-3 ), flashlightAim ) ) / ( 1.0 + torch * torch * 0.25 );
	// A drop's black, with the light caught in it; drawn long as it falls.
	vColor = mix( vColor, vec3( 0.015, 0.012, 0.01 ) + vColor * 0.35, vDrop );
	vec4 view = viewMatrix * vec4( at, 1.0 );
	view.xy += corner * radius * vec2( 1.0, 1.0 + vDrop * min( origin.y - at.y, 0.2 ) * 12.0 );
	gl_Position = projectionMatrix * view;
	float depth = - view.z;
	// Gone right up close (it would fill the picture), and into the haze with distance.
	vAlpha = alpha * smoothstep( 0.08, 0.4, depth ) * exp( - fogDensity * fogDensity * depth * depth * 0.6 );
	vCorner = corner;
	vSeed = puff.w * 17.0 + origin.x * 3.1 + origin.z * 1.7;
}
`,
        fragmentShader: /* glsl */ `
${PANEL_LIGHT_GLSL}
varying vec2 vCorner;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
varying float vDrop;
void main() {
	float r = length( vCorner );
	if ( r > 1.0 ) discard;
	float n = backroomsNoise( vCorner * 2.2 + vec2( vSeed, lightTime * 0.5 ) ) * 0.6 + backroomsNoise( vCorner * 5.0 - vec2( lightTime * 0.4, vSeed ) ) * 0.4;
	float soft = 1.0 - smoothstep( 0.1, 1.0, r + ( n - 0.5 ) * 0.7 );
	// (A drop is a crisp bead, not a wisp.)
	float a = mix( soft, 1.0 - smoothstep( 0.65, 1.0, r ), vDrop ) * vAlpha;
	gl_FragColor = vec4( vColor, a );
}
`,
        transparent: true,
        depthWrite: false,
    });
}
