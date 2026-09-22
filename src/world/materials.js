import {
    Color,
    LineBasicMaterial,
    MeshBasicMaterial,
    MeshPhongMaterial,
    MeshStandardMaterial,
    ShaderChunk,
} from 'three';

export const FIXTURE_PANEL_COLOR = 0xfeffe8;
export const FIXTURE_FRAME_COLOR = 0x333333;
// The ceiling is darkened when the lights are off (it isn't lit by anything but ambient light then).
export const CEILING_COLOR_DIM = 0x777777;
export const CEILING_COLOR_LIT = 0xffffff;

/**
 * Uniforms for the ceiling lights ("dynamic lights"), shared by every lit material.
 *
 * The original version added 25 real PointLights around the player's current chunk. Changing the number of
 * lights forces three.js to recompile every material, which froze the game for close to a second whenever
 * they were toggled, and 25 lights per pixel was slow on most GPUs. The panels sit on a perfectly regular
 * grid, though, so each fragment can simply evaluate the 4×4 panels around it in the shader: every panel in
 * the world is lit, toggling is a uniform change (no recompile), and the cost is constant.
 */
export const ceilingLights = {
    gridLightIntensity: { value: 0 },
    // Same colour/intensity as the original PointLight(0xf5f4cb, 1.1, 3.1), including the ×π that
    // three.js applied to light intensities before r155 ("legacy lights").
    gridLightColor: { value: new Color(0xf5f4cb).multiplyScalar(1.1 * Math.PI) },
    gridLightDistance: { value: 3.1 },
    gridLightDecay: { value: 2 },
    gridLightHeight: { value: 0.85 },
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
`;

const FRAGMENT_CEILING_LIGHTS = /* glsl */ `
#include <lights_fragment_begin>
if ( gridLightIntensity > 0.0 ) {
	// Panels hang at every odd integer (x, z). With a 3.1 unit range, only the 4 nearest per axis can
	// reach this fragment. Work in view space like three.js' own lights: transform the first panel once,
	// then step along the grid's view-space axes.
	vec2 firstPanel = floor( ( vBackroomsWorldPosition.xz - 1.0 ) * 0.5 ) * 2.0 - 1.0;
	vec3 panelOrigin = ( viewMatrix * vec4( firstPanel.x, gridLightHeight, firstPanel.y, 1.0 ) ).xyz;
	vec3 panelStepX = viewMatrix[ 0 ].xyz * 2.0;
	vec3 panelStepZ = viewMatrix[ 2 ].xyz * 2.0;
	IncidentLight panelLight;
	panelLight.visible = true;
	for ( int ix = 0; ix < 4; ix ++ ) {
		for ( int iz = 0; iz < 4; iz ++ ) {
			vec3 lVector = panelOrigin + float( ix ) * panelStepX + float( iz ) * panelStepZ - geometryPosition;
			float lightDistance = length( lVector );
			if ( lightDistance >= gridLightDistance ) continue;
			panelLight.direction = lVector / lightDistance;
			// Legacy (pre-r155) distance falloff, to keep the original look.
			panelLight.color = gridLightColor * gridLightIntensity * pow( 1.0 - lightDistance / gridLightDistance, gridLightDecay );
			RE_Direct( panelLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		}
	}
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
 * Adds the ceiling lights and the legacy bump mapping to a built-in lit material.
 * @template {MeshPhongMaterial | MeshStandardMaterial} T
 * @param {T} material
 * @returns {T}
 */
function withBackroomsShading(material) {
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, ceilingLights);
        shader.vertexShader = VERTEX_DECLARATIONS + shader.vertexShader.replace('#include <project_vertex>', VERTEX_WORLD_POSITION);
        shader.fragmentShader = FRAGMENT_DECLARATIONS + shader.fragmentShader
            .replace('#include <bumpmap_pars_fragment>', LEGACY_BUMP_MAP)
            .replace('#include <lights_fragment_begin>', FRAGMENT_CEILING_LIGHTS);
    };
    // Keep these programs separate from unpatched materials of the same type.
    material.customProgramCacheKey = () => 'backrooms-shading-v1';
    return material;
}

/**
 * @param {ReturnType<import('./textures.js').loadTextures>} textures
 */
export function createMaterials(textures) {
    return {
        wall: withBackroomsShading(new MeshPhongMaterial({ map: textures.wallpaper })),
        baseboard: withBackroomsShading(new MeshPhongMaterial({ map: textures.baseboard, shininess: 0 })),
        floor: withBackroomsShading(new MeshPhongMaterial({
            color: 0x4a4a4a,
            map: textures.carpet,
            bumpMap: textures.carpetBump,
            bumpScale: 0.005,
            shininess: 0,
        })),
        ceiling: withBackroomsShading(new MeshStandardMaterial({
            color: CEILING_COLOR_DIM,
            map: textures.ceiling,
            bumpMap: textures.ceilingBump,
            bumpScale: 0.0015,
            roughness: 1,
            metalness: 0,
        })),
        fixture: new MeshBasicMaterial({ vertexColors: true }),
        highlight: new LineBasicMaterial({ color: 0xfff3a8, transparent: true, opacity: 0.9 }),
    };
}
