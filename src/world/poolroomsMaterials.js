import { Color, CustomBlending, DoubleSide, MeshBasicMaterial, MeshPhongMaterial, OneFactor, OneMinusSrcAlphaFactor } from 'three';
import { WALL_HEIGHT } from '../config.js';
import { DECAL_OPTIONS, createGlowMaterial, withBackroomsShading } from './materials.js';
import { SLOT_SKY } from './poolrooms.js';

/**
 * Level 37 materials (see poolrooms.js). Ceiling lights and skylights draw like Level 0's panels.
 * @param {object} shared The materials every level has.
 * @param {number} _maxAnisotropy
 * @param {number} level Surfaces are compiled per level.
 * @returns {import('./materials.js').LevelSurfaces}
 */
export function createPoolroomsSurfaces(shared, _maxAnisotropy, level) {
    // UVs are tile layout coords (see poolroomsShading.js).
    const tile = new MeshPhongMaterial({ color: 0xffffff, specular: 0x404242, shininess: 70 });
    tile.defines = { USE_UV: '' };
    withBackroomsShading(tile, 'l37tile', level);
    const water = new MeshPhongMaterial({ color: 0x000000, specular: 0xffffff, shininess: 900, transparent: true, depthWrite: false, side: DoubleSide });
    // Premultiplied: adds the reflection on top of what's below. Alpha is already in the color.
    water.blending = CustomBlending;
    water.blendSrc = OneFactor;
    water.blendDst = OneMinusSrcAlphaFactor;
    // AO comes from the pool floor underneath. The shine is drawn over it.
    water.userData.unoccluded = true;
    return {
        wall: tile,
        floor: tile,
        ceiling: tile,
        details: withBackroomsShading(new MeshPhongMaterial({ map: shared.details.map, shininess: 30 }), undefined, level),
        extras: {
            tiles: tile,
            water: withBackroomsShading(water, 'l37water', level),
            fixtures: shared.fixture,
            glows: createGlowMaterial({ light: GLOW_LIGHT, color: new Color(0.7, 0.7, 0.66), soft: 0.3, ceiling: WALL_HEIGHT }),
            trim: withBackroomsShading(new MeshPhongMaterial({ vertexColors: true, specular: 0x4a4a4a, shininess: 70, ...DECAL_OPTIONS }), undefined, level),
            lamps: withBackroomsShading(new MeshBasicMaterial({ vertexColors: true, userData: { unoccluded: true } }), 'l37lamp', level),
            metal: withBackroomsShading(new MeshPhongMaterial({ vertexColors: true, specular: 0xffffff, shininess: 120 }), 'l37metal', level),
            floats: withBackroomsShading(new MeshPhongMaterial({ vertexColors: true, specular: 0x3a3a3a, shininess: 45 }), 'l37float', level),
        },
        shadows: ['tiles', 'metal', 'floats'],
    };
}

/**
 * Light glow strength and tint (see createGlowMaterial in materials.js). Warm under skylights, whiter at ceiling
 * lights, turquoise at pool lamps, dimmed by water between it and the camera.
 */
const GLOW_LIGHT = /* glsl */ `
	float strength = glow.z;
	vec3 tint = vec3( 1.0, 0.97, 0.9 );
	if ( glow.y < 0.0 ) {
		vec4 state = panelState( floor( ( world.xz - 1.0 ) * 0.5 + 0.5 ) );
		bool sky = abs( state.a * 255.0 - ${SLOT_SKY}.0 ) < 0.5;
		strength *= state.r * panelFlicker( state.b ) * ( 1.0 - ( sky ? 0.85 : 1.0 ) * blackout );
		if ( sky ) tint = vec3( 1.2, 1.1, 0.9 );
	} else {
		strength *= panelFlicker( glow.y ) * ( 1.0 - blackout );
	}
	if ( world.y < 0.0 ) {
		// Underwater: turquoise, and dimmer when seen from above the surface.
		tint = vec3( 0.35, 1.0, 0.72 );
		if ( cameraPosition.y > 0.0 ) strength *= exp( - 1.2 * ( - world.y ) );
	}
`;
