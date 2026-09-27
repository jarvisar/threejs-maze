import {
    AdditiveBlending,
    BackSide,
    Color,
    DataTexture,
    DoubleSide,
    LinearFilter,
    LinearMipmapLinearFilter,
    MeshPhongMaterial,
    RepeatWrapping,
    ShaderMaterial,
    UniformsLib,
    UniformsUtils,
} from 'three';
import { FOG_DENSITY } from '../config.js';
import {
    FACADE_GLSL,
    GLASS_GLSL,
    OFFICE_AIR_GLSL,
    OFFICE_GLSL,
    PATTERNS_GLSL,
    SKY_GLSL,
} from './abandonedOfficeShading.js';
import { createGlowMaterial, withBackroomsShading, worldLighting } from './materials.js';
import { PANEL_LIGHT_GLSL } from './panelLights.js';

/**
 * Level 4's (see abandonedOffice.js): its walls, floor and ceiling, and its own meshes (abandonedOfficeGeometry.js): the
 * furnishings (the furniture, the doors, the windows' piers and frames, the fittings' housings), what's lit (the
 * troffers' louvres, the vending machines, the screens left on, the EXIT signs), the glow round each light, the glass,
 * the building across the light wells, the rain, and the sky.
 * @param {object} shared The materials every level has.
 * @param {number} maxAnisotropy
 * @param {number} level Its number, which its surfaces are compiled for.
 * @returns {import('./materials.js').LevelSurfaces}
 */
export function createAbandonedOfficeSurfaces(shared, maxAnisotropy, level) {
    // A little grain in everything (the shaders read it as the surface's own unevenness), and the relief it gives.
    const grain = createGrainTexture(maxAnisotropy);
    const chunkGrain = grain.clone();
    chunkGrain.repeat.set(16, 16);
    chunkGrain.needsUpdate = true;
    const displays = new MeshPhongMaterial({ vertexColors: true, specular: 0x9a9a9a, shininess: 60 });
    displays.defines = { USE_UV: '' };
    return {
        wall: withBackroomsShading(new MeshPhongMaterial({ map: grain, bumpMap: grain, bumpScale: 0.0006, specular: 0xffffff, shininess: 20 }), 'l4wall', level),
        floor: withBackroomsShading(new MeshPhongMaterial({ map: chunkGrain, bumpMap: chunkGrain, bumpScale: 0.0016, specular: 0xffffff, shininess: 30 }), 'l4floor', level),
        ceiling: withBackroomsShading(new MeshPhongMaterial({ map: chunkGrain, bumpMap: chunkGrain, bumpScale: 0.0008, specular: 0x000000, shininess: 0 }), 'l4ceiling', level),
        // (The vents in the ceiling: grey metal, in the shade of the tiles round them.)
        details: withBackroomsShading(new MeshPhongMaterial({ color: 0x6a6c6e, map: shared.details.map, shininess: 0 }), undefined, level),
        extras: {
            furnishings: withBackroomsShading(new MeshPhongMaterial({ vertexColors: true, specular: 0xffffff, shininess: 30 }), 'l4finish', level),
            displays: withBackroomsShading(displays, 'l4light', level),
            glows: createGlowMaterial({ light: GLOW_LIGHT, color: new Color(0.62, 0.68, 0.74), soft: 0.35 }),
            glass: createGlassMaterial(),
            facade: createFacadeMaterial(),
            rain: createRainMaterial(),
        },
        shadows: ['furnishings'],
        unreflected: ['glass', 'rain', 'facade'],
        backdrop: createBackdropMaterial(),
    };
}

/**
 * How bright the glow round each light is, and its colour (see createGlowMaterial in materials.js): a troffer's follows
 * its slot (its source −1); a vending machine's (−20) and a screen's (−21), the power; an EXIT sign's (−22) is always
 * on.
 */
const GLOW_LIGHT = /* glsl */ `
	float strength = glow.z;
	vec3 tint = vec3( 1.0 );
	if ( glow.y < -21.5 ) {
		tint = vec3( 1.6, 0.14, 0.1 );
	} else if ( glow.y < -20.5 ) {
		strength *= 1.0 - blackout;
		tint = vec3( 0.5, 0.7, 1.5 );
	} else if ( glow.y < -19.5 ) {
		strength *= 1.0 - blackout;
		tint = vec3( 1.1, 1.25, 1.25 );
	} else if ( glow.y < 0.0 ) {
		vec4 state = panelState( floor( ( world.xz - 1.0 ) * 0.5 + 0.5 ) );
		strength *= state.r * panelFlicker( state.b ) * ( 1.0 - blackout );
		tint = state.a > 254.5 / 255.0 ? vec3( 0.95, 1.0, 1.1 ) : vec3( 0.98, 1.04, 0.88 );
	} else {
		strength *= panelFlicker( glow.y ) * ( 1.0 - blackout );
	}
`;

/** The uniforms the level's own shader materials share with every other (see worldLighting in materials.js). */
function sharedUniforms() {
    const { panelStates, cellStates, lightTime, blackout, lightning, lightningBolt, cameraAreaLight } = worldLighting;
    return { panelStates, cellStates, lightTime, blackout, lightning, lightningBolt, cameraAreaLight };
}

/**
 * The glass in our floor's windows (see windows in abandonedOfficeGeometry.js): the rain running down it, the room
 * faint in it, grime in its corners; seen through (it's drawn over what's behind it, and not in the depth).
 */
function createGlassMaterial() {
    return new ShaderMaterial({
        uniforms: sharedUniforms(),
        vertexShader: /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
	vec4 world = modelMatrix * vec4( position, 1.0 );
	vWorld = world.xyz;
	vNormalWorld = normalize( mat3( modelMatrix ) * normal );
	gl_Position = projectionMatrix * viewMatrix * world;
}
`,
        fragmentShader: /* glsl */ `
${PANEL_LIGHT_GLSL}
${OFFICE_GLSL}
${OFFICE_AIR_GLSL}
${GLASS_GLSL}
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
	float area = backroomsAreaLight( vWorld.xz - vNormalWorld.xz * 0.5 );
	gl_FragColor = officeGlass( vWorld, vNormalWorld, cameraPosition, area );
}
`,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
    });
}

/**
 * The building across the light wells, above and below our floor (see facade in abandonedOfficeGeometry.js): its own
 * light, and its own air (see FACADE_GLSL).
 */
function createFacadeMaterial() {
    return new ShaderMaterial({
        uniforms: sharedUniforms(),
        vertexShader: /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
	vec4 world = modelMatrix * vec4( position, 1.0 );
	vWorld = world.xyz;
	vNormalWorld = normalize( mat3( modelMatrix ) * normal );
	gl_Position = projectionMatrix * viewMatrix * world;
}
`,
        fragmentShader: /* glsl */ `
${PANEL_LIGHT_GLSL}
${OFFICE_GLSL}
${OFFICE_AIR_GLSL}
${PATTERNS_GLSL}
${FACADE_GLSL}
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
	vec3 ray = vWorld - cameraPosition;
	float dist = length( ray );
	vec3 dir = ray / max( dist, 1e-4 );
	float pixel = max( length( fwidth( vWorld ) ), 1e-5 );
	vec3 color = officeFacade( vWorld, vNormalWorld, dir, pixel );
	gl_FragColor = vec4( officeOutsideAir( color, vWorld, dist ), 1.0 );
}
`,
    });
}

/**
 * The rain in the light wells (see rain in abandonedOfficeGeometry.js): each drop a streak, falling from high over the
 * building down past the floors into the fog below, and round again; faint, lit up by the lightning; drawn added on.
 */
function createRainMaterial() {
    return new ShaderMaterial({
        uniforms: { ...sharedUniforms(), fogDensity: { value: FOG_DENSITY } },
        vertexShader: /* glsl */ `
uniform float lightTime;
uniform vec4 lightning;
attribute vec2 corner;
attribute vec4 glow;
varying vec2 vCorner;
varying float vStrength;
// Each streak: where it is (its position's x and z), how fast it falls (glow.x), where in its fall it starts (glow.y),
// how long it is (glow.z).
const float TOP = 6.5;
const float FALL = 14.0;
void main() {
	vec3 world = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	float y = TOP - mod( glow.y * FALL + lightTime * glow.x, FALL );
	vec3 head = vec3( world.x, y, world.z );
	// Upright, turned to face the eye about the vertical.
	vec3 toEye = cameraPosition - head;
	vec3 side = normalize( vec3( toEye.z, 0.0, - toEye.x ) + 1e-5 );
	vec3 at = head + side * corner.x * 0.0022 + vec3( 0.0, corner.y * glow.z, 0.0 );
	vec4 view = viewMatrix * vec4( at, 1.0 );
	gl_Position = projectionMatrix * view;
	vCorner = corner;
	float d = length( toEye );
	// Thinner than a pixel far off: fainter instead. And gone in the fog.
	vStrength = ( 1.0 - smoothstep( 0.4, 6.0, d ) ) * smoothstep( 0.15, 0.5, d ) * ( 1.0 - smoothstep( -1.0, -5.0, y ) );
}
`,
        fragmentShader: /* glsl */ `
uniform vec4 lightning;
uniform float blackout;
varying vec2 vCorner;
varying float vStrength;
void main() {
	float across = 1.0 - abs( vCorner.x );
	float along = smoothstep( -1.0, 0.2, vCorner.y ) * ( 1.0 - smoothstep( 0.6, 1.0, vCorner.y ) );
	vec3 color = vec3( 0.16, 0.19, 0.24 ) * 0.9 + vec3( 0.86, 0.92, 1.1 ) * lightning.x * 1.2;
	gl_FragColor = vec4( color * across * along * vStrength, 1.0 );
}
`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
    });
}

/**
 * What's seen past the far end of the view (see LevelSurfaces.backdrop in materials.js): the haze level with the eye,
 * and up and down the light wells, the storm and the fog (see SKY_GLSL).
 */
function createBackdropMaterial() {
    return new ShaderMaterial({
        uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...sharedUniforms() },
        vertexShader: /* glsl */ `
varying vec3 vDirection;
void main() {
	vDirection = position;
	// Round the eye, turned with it, on the far plane: behind everything.
	gl_Position = ( projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 ) ).xyww;
}
`,
        fragmentShader: /* glsl */ `
uniform float cameraAreaLight;
uniform vec3 fogColor;
${PANEL_LIGHT_GLSL}
${OFFICE_GLSL}
${SKY_GLSL}
varying vec3 vDirection;
void main() {
	gl_FragColor = vec4( officeSky( fogColor * cameraAreaLight, normalize( vDirection ) ), 1.0 );
}
`,
        fog: true,
        side: BackSide,
        depthWrite: false,
    });
}

/** Smooth noise, a few octaves of it, tiling, as a grey texture: the grain every surface has in it. */
function createGrainTexture(maxAnisotropy) {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    const octave = (cells, seed) => {
        const values = new Float32Array(cells * cells);
        let s = seed;
        for (let k = 0; k < values.length; k++) {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            values[k] = s / 4294967296;
        }
        return (x, y) => {
            const fx = (x / size) * cells;
            const fy = (y / size) * cells;
            const ix = Math.floor(fx);
            const iy = Math.floor(fy);
            const tx = fx - ix;
            const ty = fy - iy;
            const sx = tx * tx * (3 - 2 * tx);
            const sy = ty * ty * (3 - 2 * ty);
            const at = (i, j) => values[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
            const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
            const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
            return top + (bottom - top) * sy;
        };
    };
    const octaves = [octave(8, 11), octave(32, 23), octave(128, 37)];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const value = 0.5 * octaves[0](x, y) + 0.3 * octaves[1](x, y) + 0.2 * octaves[2](x, y);
            const byte = Math.round(255 * (0.55 + 0.45 * value));
            const i = (y * size + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = byte;
            data[i + 3] = 255;
        }
    }
    const texture = new DataTexture(data, size, size);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
    return texture;
}
