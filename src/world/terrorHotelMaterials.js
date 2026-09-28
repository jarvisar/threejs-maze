import { AdditiveBlending, Color, MeshPhongMaterial, ShaderMaterial } from 'three';
import { WALL_HEIGHT } from '../config.js';
import { DECAL_OPTIONS, createGlowMaterial, withBackroomsShading, worldLighting } from './materials.js';
import { PANEL_LIGHT_GLSL } from './panelLights.js';
import { createTerrorHotelTextures } from './terrorHotelTextures.js';
import { SPILL_GLSL, TERROR_HOTEL_LIGHT_GLSL } from './terrorHotelShading.js';

/**
 * Level 5 materials (see terrorHotel.js). Walls, floor, ceiling, plus the extras its meshes in
 * terrorHotelGeometry.js use.
 * @param {object} shared Materials shared by every level.
 * @param {number} maxAnisotropy
 * @param {number} level Level number the surfaces are compiled for.
 * @returns {import('./materials.js').LevelSurfaces}
 */
export function createTerrorHotelSurfaces(shared, maxAnisotropy, level) {
    const textures = createTerrorHotelTextures(maxAnisotropy);
    const wall = withBackroomsShading(new MeshPhongMaterial({ map: textures.walls, bumpMap: textures.walls, bumpScale: 0.0012, specular: 0xffffff, shininess: 20 }), 'h5wall', level);
    const woodwork = new MeshPhongMaterial({ vertexColors: true, specular: 0xffffff, shininess: 30 });
    const dials = new MeshPhongMaterial({ vertexColors: true, specular: 0x8a8a8a, shininess: 60 });
    dials.defines = { USE_UV: '' };
    return {
        wall,
        floor: withBackroomsShading(new MeshPhongMaterial({ map: textures.floor, bumpMap: textures.floor, bumpScale: 0.004, specular: 0xffffff, shininess: 30 }), 'h5floor', level),
        ceiling: withBackroomsShading(new MeshPhongMaterial({ map: textures.ceiling, bumpMap: textures.ceiling, bumpScale: 0.002, specular: 0x000000, shininess: 0 }), 'h5ceiling', level),
        details: withBackroomsShading(new MeshPhongMaterial({ map: shared.details.map, shininess: 20 }), undefined, level),
        extras: {
            woodwork: withBackroomsShading(woodwork, 'h5finish', level),
            fittings: withBackroomsShading(new MeshPhongMaterial({ vertexColors: true, specular: 0xffffff, shininess: 80 }), 'h5light', level),
            glows: createGlowMaterial({ declarations: TERROR_HOTEL_LIGHT_GLSL, light: GLOW_LIGHT, color: new Color(0.82, 0.6, 0.38), soft: 0.4, ceiling: WALL_HEIGHT, floor: 0 }),
            paint: withBackroomsShading(new MeshPhongMaterial({ map: textures.paint, vertexColors: true, shininess: 10, ...DECAL_OPTIONS }), undefined, level),
            dials: withBackroomsShading(dials, 'h5dial', level),
            spill: createSpillMaterial(),
        },
        shadows: ['woodwork'],
        // too small or dim to show in a reflection, and this level has none anyway
        unreflected: ['dials', 'spill'],
    };
}

/**
 * Glow strength and color per light (see createGlowMaterial in materials.js). Fittings follow their own slot.
 * Sconces (source -2 and below) follow a slot about a cell away. Lamps (-20) follow the power.
 */
const GLOW_LIGHT = /* glsl */ `
	float strength = glow.z;
	vec3 tint = vec3( 1.0 );
	if ( glow.y < -19.5 ) {
		strength *= 1.0 - blackout;
		tint = vec3( 1.0, 0.72, 0.42 );
	} else if ( glow.y < -1.5 ) {
		float code = - glow.y - 2.0;
		vec2 slot = floor( world.xz + 0.5 ) + vec2( floor( code / 3.0 ) - 1.0, mod( code, 3.0 ) - 1.0 );
		strength *= hotelSlotOn( slot, tint );
		tint *= vec3( 1.0, 0.8, 0.55 );
	} else if ( glow.y < 0.0 ) {
		strength *= hotelSlotOn( world.xz, tint );
	} else {
		strength *= panelFlicker( glow.y ) * ( 1.0 - blackout );
	}
`;

/**
 * Light under a door (see spill in terrorHotelGeometry.js). Fades out from the door, with the odd shadow of feet.
 * Off during a blackout.
 */
function createSpillMaterial() {
    const { lightTime, blackout, panelStates, cellStates } = worldLighting;
    return new ShaderMaterial({
        uniforms: { lightTime, blackout, panelStates, cellStates },
        vertexShader: /* glsl */ `
attribute vec3 color;
varying vec2 vUv;
varying float vSeed;
void main() {
	vUv = uv;
	vSeed = color.r;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`,
        fragmentShader: /* glsl */ `
${PANEL_LIGHT_GLSL}
${SPILL_GLSL}
varying vec2 vUv;
varying float vSeed;
void main() {
	float along = vUv.x - 0.5;
	float out_ = vUv.y;
	float edges = smoothstep( 0.5, 0.36, abs( along ) );
	float light = exp( - out_ * 9.0 ) * edges;
	// two dark shapes where feet block the light, shadows stretching out along it
	float feet = hotelFeet( along * 0.84, vSeed, lightTime );
	light *= 1.0 - 0.85 * feet * smoothstep( 0.9, 0.2, out_ );
	gl_FragColor = vec4( vec3( 1.0, 0.66, 0.34 ) * light * 0.55 * ( 1.0 - blackout ), 1.0 );
}
`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
    });
}
