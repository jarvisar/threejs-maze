import { BackSide, Color, MeshBasicMaterial, MeshPhongMaterial, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
import { WALL_HEIGHT } from '../config.js';
import { LEVEL_ONE_GLOW_GLSL, LEVEL_ONE_GLSL } from './levelOneShading.js';
import { createLevelOneTextures } from './levelOneTextures.js';
import { DECAL_OPTIONS, createGlowMaterial, withBackroomsShading, worldLighting } from './materials.js';
import { PANEL_LIGHT_GLSL } from './panelLights.js';

/**
 * Level 1 materials (see levelOne.js): concrete walls, floor and slab, plus the meshes from levelOneGeometry.js.
 * Battens are lit like Level 0's panels. Pipes and cars use the prop texture and get the slab's bounce light.
 * @param {object} shared The materials every level has.
 * @param {number} maxAnisotropy
 * @param {number} level Level number the surfaces are compiled for.
 * @returns {import('./materials.js').LevelSurfaces}
 */
export function createLevelOneSurfaces(shared, maxAnisotropy, level) {
    const textures = createLevelOneTextures(maxAnisotropy);
    return {
        wall: withBackroomsShading(new MeshPhongMaterial({ map: textures.walls, bumpMap: textures.walls, bumpScale: 0.004, specular: 0x0c0c0c, shininess: 6 }), 'l1wall', level),
        floor: withBackroomsShading(new MeshPhongMaterial({ color: 0x9a9a95, map: textures.floor, bumpMap: textures.floor, bumpScale: 0.006, specular: 0x404040, shininess: 30 }), 'l1floor', level),
        ceiling: withBackroomsShading(new MeshPhongMaterial({ color: 0xd2d2ce, map: textures.ceiling, specular: 0x000000, shininess: 0 }), 'l1ceiling', level),
        details: withBackroomsShading(new MeshPhongMaterial({ map: textures.details, shininess: 20 }), undefined, level),
        extras: {
            pillars: withBackroomsShading(new MeshPhongMaterial({ map: textures.walls, bumpMap: textures.walls, bumpScale: 0.003, specular: 0x101010, shininess: 8 }), 'l1column', level),
            fixtures: shared.fixture,
            // Prop texture, plus floor bounce light near the slab (see FRAGMENT_L1_BOUNCE).
            services: withBackroomsShading(new MeshPhongMaterial({ map: shared.prop.map, vertexColors: true, shininess: 18 }), 'l1services', level),
            tubes: withBackroomsShading(new MeshBasicMaterial({ vertexColors: true, userData: { unoccluded: true } }), 'l1tube', level),
            paint: withBackroomsShading(new MeshPhongMaterial({ map: textures.glyphs, vertexColors: true, shininess: 4, ...DECAL_OPTIONS }), undefined, level),
            glows: createGlowMaterial({ declarations: LEVEL_ONE_GLSL, light: GLOW_LIGHT, color: new Color(0.62, 0.66, 0.7), soft: 0.35, ceiling: WALL_HEIGHT, floor: 0 }),
            // Exit signs and their green glow. On battery, so they stay lit in a blackout.
            lamps: withBackroomsShading(new MeshBasicMaterial({ map: textures.signs, vertexColors: true, userData: { unoccluded: true } }), undefined, level),
            exitGlows: createGlowMaterial({ light: EXIT_GLOW_LIGHT, color: new Color(0.3, 0.85, 0.45), soft: 0.5, ceiling: WALL_HEIGHT, floor: 0 }),
            // Hanging aisle signs. Go dark in a blackout.
            lightboxes: withBackroomsShading(new MeshBasicMaterial({ map: textures.signs, vertexColors: true, userData: { unoccluded: true } }), 'powered', level),
        },
        shadows: ['pillars', 'services'],
        backdrop: createBackdropMaterial(),
    };
}

/**
 * Backdrop past the far end of the view (see WorldView). Fog lit to match the player's spot, plus the glow of nearby
 * lights. Surfaces near the far plane get the same glow, otherwise every aisle ended in a dark gap.
 */
function createBackdropMaterial() {
    const { panelStates, lightTime, blackout, gridLightIntensity, gridLightColor, gridLightHeight, cameraAreaLight } = worldLighting;
    return new ShaderMaterial({
        uniforms: {
            ...UniformsUtils.clone(UniformsLib.fog),
            panelStates,
            lightTime,
            blackout,
            gridLightIntensity,
            gridLightColor,
            gridLightHeight,
            cameraAreaLight,
        },
        vertexShader: /* glsl */ `
varying vec3 vDirection;
void main() {
	vDirection = position;
	// Centered on the camera, rotation only, pushed to the far plane so it's behind everything.
	gl_Position = ( projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 ) ).xyww;
}
`,
        fragmentShader: /* glsl */ `
uniform float gridLightIntensity;
uniform vec3 gridLightColor;
uniform float gridLightHeight;
uniform float cameraAreaLight;
uniform vec3 fogColor;
${PANEL_LIGHT_GLSL}
${LEVEL_ONE_GLSL}
${LEVEL_ONE_GLOW_GLSL}
varying vec3 vDirection;
void main() {
	// Same as a surface at the far plane: all fog, plus whatever glow the fog lets through.
	vec3 glow = levelOneGlow( cameraPosition, normalize( vDirection ), 100.0 );
	gl_FragColor = vec4( fogColor * cameraAreaLight + glow * 0.4, 1.0 );
}
`,
        fog: true,
        side: BackSide,
        depthWrite: false,
    });
}

/** Exit sign glow. Always steady, ignores blackouts (see createGlowMaterial). */
const EXIT_GLOW_LIGHT = /* glsl */ `
	float strength = glow.z;
	vec3 tint = vec3( 1.0 );
`;

/**
 * Brightness and color of the fog glow around each Level 1 light (see createGlowMaterial in materials.js, spots come
 * from levelOneGeometry.js). Makes a column with a tube behind it show dark against a halo. A spot uses its own
 * flicker, or its light slot's flicker and tube color.
 */
const GLOW_LIGHT = /* glsl */ `
	float strength = glow.z * ( 1.0 - blackout );
	vec3 tint = vec3( 1.0 );
	if ( glow.y < 0.0 ) {
		vec4 state = panelState( floor( ( world.xz - 1.0 ) * 0.5 + 0.5 ) );
		strength *= state.r * panelFlicker( state.b );
		tint = levelOneTube( state.a );
	} else {
		strength *= panelFlicker( glow.y );
	}
`;
