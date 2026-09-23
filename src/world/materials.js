import {
    CanvasTexture,
    ClampToEdgeWrapping,
    Color,
    DataTexture,
    LinearFilter,
    LineBasicMaterial,
    MeshBasicMaterial,
    MeshPhongMaterial,
    MeshStandardMaterial,
    NearestFilter,
    ShaderChunk,
} from 'three';
import { SHADE_COLUMNS } from './chunkGeometry.js';
import { createDecalAtlas, createPropAtlas } from './decorationTextures.js';
import { PANEL_LIGHT_GLSL } from './panelLights.js';

export const FIXTURE_PANEL_COLOR = 0xfeffe8;
export const FIXTURE_FRAME_COLOR = 0x8f8c82;
// The ceiling is darkened when the lights are off (it isn't lit by anything but ambient light then).
export const CEILING_COLOR_DIM = 0x777777;
export const CEILING_COLOR_LIT = 0xffffff;

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
};

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vBackroomsWorldPosition;
`;

const VERTEX_WORLD_POSITION = /* glsl */ `
#include <project_vertex>
vBackroomsWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

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

const FRAGMENT_MAIN = /* glsl */ `
void main() {
	float backroomsArea = backroomsAreaLight( vBackroomsWorldPosition.xz );
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
// the panels have died. (The flashlight is a spot light and isn't affected.)
const LIGHTS_BEGIN = skipDarkSpotLights(ShaderChunk.lights_fragment_begin)
    .replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= backroomsArea;',
    )
    .replace(
        'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );',
        'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * backroomsArea;',
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
	for ( int ix = 0; ix < 4; ix ++ ) {
		for ( int iz = 0; iz < 4; iz ++ ) {
			// Most of the 16 are out of range; rule those out before reading the panel's state.
			vec3 lVector = panelOrigin + float( ix ) * panelStepX + float( iz ) * panelStepZ - geometryPosition;
			float lightDistance = length( lVector );
			if ( lightDistance >= gridLightDistance ) continue;
			vec4 state = panelState( firstPanel + vec2( ix, iz ) );
			float brightness = state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
			if ( brightness <= 0.0 ) continue;
			panelLight.direction = lVector / lightDistance;
			// Legacy (pre-r155) distance falloff, to keep the original look.
			panelLight.color = gridLightColor * gridLightIntensity * brightness * pow( 1.0 - lightDistance / gridLightDistance, gridLightDecay );
			RE_Direct( panelLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		}
	}
}
`;

// The haze is only as bright as the lights around it: near a surface it takes the light there, and it
// blends towards the light at the camera with distance, matching the background beyond the far plane.
const FRAGMENT_FOG = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * mix( backroomsArea, cameraAreaLight, fogFactor ), fogFactor );
#endif
`;

// The figure in Found Footage keeps more of itself in the haze than anything else does: it's darker than
// the distance should allow.
const FRAGMENT_FOG_FIGURE = FRAGMENT_FOG.replace('gl_FragColor.rgb = mix(', 'fogFactor *= 0.6;\n\tgl_FragColor.rgb = mix(');

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
		diffuseColor.rgb *= 1.0 - 0.2 * join * ( 1.0 - smoothstep( 0.025, 0.09, pixel ) );
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
	outgoingLight += wet * fresnel * ( vec3( 0.9, 0.88, 0.74 ) * backroomsArea * 0.08 + vec3( 1.0, 0.98, 0.88 ) * glint * 1.6 );
}
#include <opaque_fragment>
`;

// Damp patches in the carpet.
const FRAGMENT_FLOOR = /* glsl */ `
#include <map_fragment>
float damp = backroomsNoise( vBackroomsWorldPosition.xz * 0.45 ) * 0.65 + backroomsNoise( vBackroomsWorldPosition.xz * 1.7 + 31.0 ) * 0.35;
diffuseColor.rgb *= 1.0 - 0.3 * smoothstep( 0.6, 0.78, damp );
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
	totalEmissiveRadiance += vec3( 0.95, 0.93, 0.8 ) * on * glow * glow * 0.2 * ( 1.0 - 0.8 * clamp( gridLightIntensity, 0.0, 1.0 ) );
}
`;

// Light panels: the bright diffuser follows the panel's state; the painted frame around it is only as light
// as the room.
const FRAGMENT_FIXTURE = /* glsl */ `
#include <color_fragment>
if ( diffuseColor.r > 0.8 ) {
	vec4 state = panelState( floor( ( vBackroomsWorldPosition.xz - 1.0 ) * 0.5 + 0.5 ) );
	diffuseColor.rgb = mix( vec3( 0.36, 0.36, 0.33 ), diffuseColor.rgb, state.r * panelFlicker( state.b ) * ( 1.0 - blackout ) );
} else {
	diffuseColor.rgb *= 0.2 + 0.8 * backroomsArea;
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

/**
 * Adds the world lighting (ceiling lights, panel states, area light and fog) to a built-in material.
 * @template {MeshPhongMaterial | MeshStandardMaterial | MeshBasicMaterial} T
 * @param {T} material
 * @param {'wall' | 'floor' | 'ceiling' | 'fixture' | 'decal' | 'figure'} [surface] Extra detail for particular
 *     surfaces.
 * @returns {T}
 */
export function withBackroomsShading(material, surface) {
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, worldLighting);
        shader.vertexShader = VERTEX_DECLARATIONS + shader.vertexShader.replace('#include <project_vertex>', VERTEX_WORLD_POSITION);
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
        shader.fragmentShader = FRAGMENT_DECLARATIONS + fragment;
    };
    // Keep these programs separate from unpatched materials (and each other).
    material.customProgramCacheKey = () => `backrooms-shading-v4-${surface ?? 'plain'}`;
    return material;
}

// Decals float a hair in front of the surface they're on; the polygon offset keeps them in front of it in
// the depth buffer at any distance.
const DECAL_OPTIONS = {
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
    return {
        wall: withBackroomsShading(new MeshPhongMaterial({ map: textures.wallpaper }), 'wall'),
        baseboard: withBackroomsShading(new MeshPhongMaterial({ map: textures.baseboard, shininess: 0 })),
        details: withBackroomsShading(new MeshPhongMaterial({ map: createDetailsTexture(), shininess: 8 })),
        floor: withBackroomsShading(new MeshPhongMaterial({
            color: 0x4a4a4a,
            map: textures.carpet,
            bumpMap: textures.carpetBump,
            bumpScale: 0.005,
            shininess: 0,
        }), 'floor'),
        ceiling: withBackroomsShading(new MeshStandardMaterial({
            color: CEILING_COLOR_DIM,
            map: textures.ceiling,
            bumpMap: textures.ceilingBump,
            bumpScale: 0.0015,
            roughness: 1,
            metalness: 0,
        }), 'ceiling'),
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
