import { DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from 'three';
import { CHUNK_SIZE, HALF_CHUNK } from '../config.js';
import { PANELS_PER_SIDE } from './generator.js';

/** Panels per side of the GPU copy: 64 panels cover 128 × 128 cells, far more than is ever in view. */
export const PANEL_WINDOW = 64;

/**
 * The state of the ceiling panels around the player, copied into a texture the shaders can read. Panel
 * (i, j), the one above cell (2i + 1, 2j + 1), lives at texel (i mod 64, j mod 64). The texture wraps
 * around, so as the player walks on, newly loaded chunks simply overwrite panels far behind them.
 *
 * Each texel is the panel's four bytes from ChunkData.lights.
 */
export class PanelLightMap {
    constructor() {
        this.data = new Uint8Array(PANEL_WINDOW * PANEL_WINDOW * 4).fill(255);
        this.texture = new DataTexture(this.data, PANEL_WINDOW, PANEL_WINDOW, RGBAFormat, UnsignedByteType);
        this.texture.magFilter = NearestFilter;
        this.texture.minFilter = NearestFilter;
        this.texture.generateMipmaps = false;
        this.texture.needsUpdate = true;
    }

    /** @param {import('./generator.js').ChunkData} chunk */
    writeChunk(chunk) {
        // Index of the chunk's first panel (above its first odd cell).
        const pi0 = (chunk.cx * CHUNK_SIZE - HALF_CHUNK) / 2;
        const pj0 = (chunk.cz * CHUNK_SIZE - HALF_CHUNK) / 2;
        for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
            const tx = mod(pi0 + pi, PANEL_WINDOW);
            for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
                const tz = mod(pj0 + pj, PANEL_WINDOW);
                const from = (pi * PANELS_PER_SIDE + pj) * 4;
                const to = (tz * PANEL_WINDOW + tx) * 4;
                for (let k = 0; k < 4; k++) this.data[to + k] = chunk.lights[from + k];
            }
        }
        this.texture.needsUpdate = true;
    }
}

function mod(a, b) {
    return ((a % b) + b) % b;
}

/**
 * How bright a flickering panel is right now (0.12 or 1): the same pattern the shaders draw, so sounds can
 * follow it. A failing tube has bursts of flickering every few seconds and is steady in between.
 * @param {number} pattern The panel's flicker byte (0 = steady).
 * @param {number} time The shared light time, in seconds.
 */
export function panelFlicker(pattern, time) {
    if (pattern === 0) return 1;
    const t = Math.fround(time);
    const burstSlot = Math.floor(t * 0.4) >>> 0;
    if ((hash32((Math.imul(pattern, 7919) + burstSlot) >>> 0) & 1023) >= 300) return 1;
    const blinkSlot = Math.floor(t * 17) >>> 0;
    return (hash32((Math.imul(pattern, 104729) ^ blinkSlot) >>> 0) & 1023) < 520 ? FLICKER_LOW : 1;
}

const FLICKER_LOW = 0.12;

/** 32-bit integer hash (Chris Wellons' "lowbias32"), identical to backroomsHash() in the shaders. */
function hash32(x) {
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
}

/** GLSL for reading the panel texture; shared by every material that needs it. */
export const PANEL_LIGHT_GLSL = /* glsl */ `
uniform sampler2D panelStates;
uniform float lightTime;

uint backroomsHash( uint x ) {
	x ^= x >> 16u;
	x *= 0x7feb352du;
	x ^= x >> 15u;
	x *= 0x846ca68bu;
	x ^= x >> 16u;
	return x;
}

// State of panel (i, j), the one above cell (2i + 1, 2j + 1): brightness, area light, flicker, unused.
vec4 panelState( vec2 panel ) {
	return texelFetch( panelStates, ivec2( mod( panel, ${PANEL_WINDOW}.0 ) ), 0 );
}

// Same as panelFlicker() in panelLights.js.
float panelFlicker( float pattern ) {
	if ( pattern < 0.5 / 255.0 ) return 1.0;
	uint seed = uint( pattern * 255.0 + 0.5 );
	uint burstSlot = uint( lightTime * 0.4 );
	if ( ( backroomsHash( seed * 7919u + burstSlot ) & 1023u ) >= 300u ) return 1.0;
	uint blinkSlot = uint( lightTime * 17.0 );
	return ( backroomsHash( seed * 104729u ^ blinkSlot ) & 1023u ) < 520u ? ${FLICKER_LOW} : 1.0;
}

// How lit the area around a point is (0..1), blended between the four nearest panels.
float backroomsAreaLight( vec2 xz ) {
	vec2 p = ( xz - 1.0 ) * 0.5;
	vec2 i = floor( p );
	vec2 f = p - i;
	float a = panelState( i ).g;
	float b = panelState( i + vec2( 1.0, 0.0 ) ).g;
	float c = panelState( i + vec2( 0.0, 1.0 ) ).g;
	float d = panelState( i + vec2( 1.0, 1.0 ) ).g;
	return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

// Smooth value noise, for stains and damp patches.
float backroomsNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = p - i;
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	uvec2 q = uvec2( ivec2( i ) );
	float a = float( backroomsHash( q.x * 1597334677u ^ q.y * 3812015801u ) & 65535u );
	float b = float( backroomsHash( ( q.x + 1u ) * 1597334677u ^ q.y * 3812015801u ) & 65535u );
	float c = float( backroomsHash( q.x * 1597334677u ^ ( q.y + 1u ) * 3812015801u ) & 65535u );
	float d = float( backroomsHash( ( q.x + 1u ) * 1597334677u ^ ( q.y + 1u ) * 3812015801u ) & 65535u );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ) / 65535.0;
}
`;
