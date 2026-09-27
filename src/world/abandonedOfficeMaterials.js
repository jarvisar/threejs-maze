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
import { FOG_DENSITY, WALL_HEIGHT } from '../config.js';
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
    // (Glass and gloss: a small, sharp reflection of a light, the flashlight's too, not a sheen all over them.)
    const displays = new MeshPhongMaterial({ vertexColors: true, specular: 0x262626, shininess: 260 });
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
            glows: createGlowMaterial({ light: GLOW_LIGHT, color: new Color(0.62, 0.68, 0.74), soft: 0.35, ceiling: WALL_HEIGHT, floor: 0 }),
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
    const { panelStates, cellStates, lightTime, blackout, lightning, lightningBolt, cameraAreaLight, flashlightBeam, flashlightAim } = worldLighting;
    return { panelStates, cellStates, lightTime, blackout, lightning, lightningBolt, cameraAreaLight, flashlightBeam, flashlightAim };
}

/**
 * The glass in our floor's windows (see windows in abandonedOfficeGeometry.js): the water standing on it, the room faint
 * in it, the flashlight's glare, grime in its corners; seen through (it's drawn over what's behind it, and not in the
 * depth). Its colour is premultiplied, so a glint in a drop only adds light.
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
        premultipliedAlpha: true,
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
 * The rain in the light wells (see rain in abandonedOfficeGeometry.js), drawn added on. Each drop is a streak, long and
 * thin and a little slanted in the wind, falling from high over the building down past the floors into the fog below,
 * and round again. At night it's all but invisible: what shows it is what lights it, the light spilling out of our
 * floor's windows onto the rain just outside them, the flashlight's beam out through the glass, and the lightning. And on
 * the sills outside our windows, where it lands, it splashes.
 */
function createRainMaterial() {
    return new ShaderMaterial({
        uniforms: { ...sharedUniforms(), fogDensity: { value: FOG_DENSITY } },
        vertexShader: /* glsl */ `
uniform float lightTime;
uniform vec4 lightning;
uniform float cameraAreaLight;
uniform vec4 flashlightBeam;
uniform vec3 flashlightAim;
attribute vec2 corner;
attribute vec4 glow;
varying vec2 vCorner;
varying vec3 vColor;
varying float vKind;
varying float vLife;
varying float vSeed;
// A streak (glow.w 0): where it is at our floor (its position's x and z), how fast it falls (glow.x), where in its fall
// it starts (glow.y), how long it is (glow.z). A splash (glow.w 1): where on a sill (its position), how many times a
// second (glow.x), when (glow.y), how big (glow.z).
const float TOP = 6.5;
const float FALL = 14.0;
// How long a splash lasts, in seconds.
const float SPLASH = 0.16;
const vec3 FLASH = vec3( 0.86, 0.92, 1.1 );
// How lit something out there is: by the light spilling out of our floor (brightest just outside the glass, as the room
// where the eye is is lit), by the flashlight's beam, and by the lightning.
vec3 lit( vec3 p, float d ) {
	float spill = 1.0 - smoothstep( 0.3, 2.4, d );
	vec3 fromLamp = p - flashlightBeam.xyz;
	float r = length( fromLamp );
	float beam = flashlightBeam.w * smoothstep( 0.86, 0.96, dot( fromLamp / max( r, 1e-4 ), flashlightAim ) ) / ( 1.0 + r * r * 0.3 );
	return vec3( 0.5, 0.56, 0.66 ) * ( 0.04 + 0.4 * cameraAreaLight * spill * spill ) + vec3( 1.0, 0.97, 0.9 ) * beam * 1.8 + FLASH * lightning.x * 1.2;
}
void main() {
	vec3 base = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	vKind = glow.w;
	vCorner = corner;
	vLife = 0.0;
	vSeed = 0.0;
	vec3 at;
	if ( glow.w < 0.5 ) {
		float y = TOP - mod( glow.y * FALL + lightTime * glow.x, FALL );
		// The wind, gusting: it's slanted, and where it was put is where it passes our floor's middle (so at our floor it
		// keeps inside the well).
		vec2 wind = vec2( 0.075, 0.03 ) * ( 0.75 + 0.25 * sin( lightTime * 0.37 + base.x * 0.11 + base.z * 0.07 ) );
		vec3 head = vec3( base.x + wind.x * ( y - 0.5 ), y, base.z + wind.y * ( y - 0.5 ) );
		vec3 up = normalize( vec3( wind.x, 1.0, wind.y ) );
		vec3 toEye = cameraPosition - head;
		float d = length( toEye );
		// Turned to face the eye about its own length; no thinner than a couple of pixels (at the picture's lowest
		// resolution; fainter instead, so it doesn't break up into dots): a drop's streak is thinner than that from anywhere.
		vec3 side = normalize( cross( up, toEye ) + 1e-5 );
		float width = max( 0.0014, d * 0.0021 );
		at = head + side * corner.x * width + up * ( corner.y * 0.5 + 0.5 ) * glow.z;
		// Gone in the fog, and down in the dark below.
		float fade = smoothstep( 0.12, 0.4, d ) * ( 1.0 - smoothstep( 1.5, 7.5, d ) ) * ( 1.0 - smoothstep( -1.0, -5.0, y ) );
		vColor = lit( head, d ) * fade * 0.0012 / width;
	} else {
		// A splash: now and then, a crown of spray for a moment, and gone.
		float cycle = lightTime * glow.x + glow.y;
		vSeed = floor( cycle );
		vLife = fract( cycle ) / ( SPLASH * glow.x );
		float on = step( vLife, 1.0 ) * step( 0.15, fract( sin( vSeed * 12.9898 + glow.y * 78.233 ) * 43758.5453 ) );
		vec3 toEye = cameraPosition - base;
		float d = length( toEye );
		vec3 side = normalize( vec3( toEye.z, 0.0, - toEye.x ) + 1e-5 );
		at = base + ( side * corner.x + vec3( 0.0, corner.y + 0.8, 0.0 ) ) * glow.z * on;
		vColor = lit( base, d ) * on * ( 1.0 - smoothstep( 1.5, 4.0, d ) );
	}
	gl_Position = projectionMatrix * viewMatrix * vec4( at, 1.0 );
}
`,
        fragmentShader: /* glsl */ `
varying vec2 vCorner;
varying vec3 vColor;
varying float vKind;
varying float vLife;
varying float vSeed;
float splashHash( float n ) {
	return fract( sin( n * 91.345 + vSeed * 17.13 ) * 43758.5453 );
}
void main() {
	float shine;
	if ( vKind < 0.5 ) {
		// Across it, soft; along it, fading in from its tail and out towards its head.
		float across = 1.0 - abs( vCorner.x );
		float along = smoothstep( -1.0, -0.2, vCorner.y ) * ( 1.0 - smoothstep( 0.2, 1.0, vCorner.y ) );
		shine = across * along;
	} else {
		// A few drops thrown up and out, falling back; the ring of it spreading on the sill.
		float t = clamp( vLife, 0.0, 1.0 );
		shine = 0.0;
		for ( int k = 0; k < 5; k ++ ) {
			float a = ( ( float( k ) + splashHash( float( k ) ) ) / 5.0 - 0.5 ) * 2.4;
			float speed = 0.6 + 0.5 * splashHash( float( k ) + 7.0 );
			vec2 at = vec2( sin( a ) * speed * t * 0.9, -0.8 + cos( a ) * speed * t * 2.6 - 2.2 * t * t );
			shine += 1.0 - smoothstep( 0.04, 0.1 + 0.05 * ( 1.0 - t ), length( vCorner - at ) );
		}
		vec2 ring = vec2( vCorner.x / ( 0.15 + 0.75 * t ), ( vCorner.y + 0.82 ) / 0.05 );
		shine += ( 1.0 - smoothstep( 0.0, 1.0, abs( length( ring ) - 1.0 ) * 4.0 ) ) * 0.2;
		shine *= ( 1.0 - t ) * 0.9;
	}
	gl_FragColor = vec4( vColor * shine, 1.0 );
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
