import { Vector2 } from 'three';

/**
 * The whole "bad VHS tape" look in a single full-screen pass.
 *
 * This used to be five chained passes (static → RGB shift → film grain/scanlines → bad-TV distortion →
 * vignette), each reading and writing a full-screen render target. Here each stage samples the previous
 * one directly, in the same order and with the same maths, so it looks the same for a fifth of the
 * memory bandwidth. Every stage can still be switched off or tuned through uniforms.
 *
 * Based on:
 * - Bad TV, static and RGB shift shaders by Felix Turner / airtight.cc (MIT)
 *   https://github.com/felixturner/bad-tv-shader
 * - Film grain & scanlines and vignette shaders by alteredq (from the three.js examples), with noise by
 *   Pat 'Hawthorne' Shearon and Georg 'Leviathan' Steinrohder (CC BY 3.0)
 * - 2D simplex noise by Ian McEwan, Ashima Arts (MIT)
 */
export const VHSShader = {
    name: 'VHSShader',

    uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new Vector2(1, 1) },
        time: { value: 0 },

        staticEnabled: { value: true },
        staticAmount: { value: 0.04 },
        staticSize: { value: 4 },

        rgbShiftEnabled: { value: true },
        rgbShiftAmount: { value: 0.001 },
        rgbShiftAngle: { value: 0 },

        filmEnabled: { value: true },
        filmGrayscale: { value: false },
        filmNoiseIntensity: { value: 0.1 },
        filmScanlineIntensity: { value: 0.8 },
        filmScanlineCount: { value: 375 },

        badTVEnabled: { value: true },
        badTVDistortion: { value: 0.15 },
        badTVDistortion2: { value: 0.3 },
        badTVSpeed: { value: 0.005 },
        badTVRollSpeed: { value: 0 },

        vignetteEnabled: { value: true },
        vignetteOffset: { value: 0.81 },
        vignetteDarkness: { value: 1 },
    },

    vertexShader: /* glsl */ `
		varying vec2 vUv;

		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}
	`,

    fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		uniform vec2 resolution;
		uniform float time;

		uniform bool staticEnabled;
		uniform float staticAmount;
		uniform float staticSize;

		uniform bool rgbShiftEnabled;
		uniform float rgbShiftAmount;
		uniform float rgbShiftAngle;

		uniform bool filmEnabled;
		uniform bool filmGrayscale;
		uniform float filmNoiseIntensity;
		uniform float filmScanlineIntensity;
		uniform float filmScanlineCount;

		uniform bool badTVEnabled;
		uniform float badTVDistortion;
		uniform float badTVDistortion2;
		uniform float badTVSpeed;
		uniform float badTVRollSpeed;

		uniform bool vignetteEnabled;
		uniform float vignetteOffset;
		uniform float vignetteDarkness;

		varying vec2 vUv;

		// 2D simplex noise (Ashima Arts)
		vec3 mod289( vec3 x ) { return x - floor( x * ( 1.0 / 289.0 ) ) * 289.0; }
		vec2 mod289( vec2 x ) { return x - floor( x * ( 1.0 / 289.0 ) ) * 289.0; }
		vec3 permute( vec3 x ) { return mod289( ( ( x * 34.0 ) + 1.0 ) * x ); }

		float snoise( vec2 v ) {
			const vec4 C = vec4( 0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439 );
			vec2 i = floor( v + dot( v, C.yy ) );
			vec2 x0 = v - i + dot( i, C.xx );
			vec2 i1 = ( x0.x > x0.y ) ? vec2( 1.0, 0.0 ) : vec2( 0.0, 1.0 );
			vec4 x12 = x0.xyxy + C.xxzz;
			x12.xy -= i1;
			i = mod289( i );
			vec3 p = permute( permute( i.y + vec3( 0.0, i1.y, 1.0 ) ) + i.x + vec3( 0.0, i1.x, 1.0 ) );
			vec3 m = max( 0.5 - vec3( dot( x0, x0 ), dot( x12.xy, x12.xy ), dot( x12.zw, x12.zw ) ), 0.0 );
			m = m * m;
			m = m * m;
			vec3 x = 2.0 * fract( p * C.www ) - 1.0;
			vec3 h = abs( x ) - 0.5;
			vec3 ox = floor( x + 0.5 );
			vec3 a0 = x - ox;
			m *= 1.79284291400159 - 0.85373472095314 * ( a0 * a0 + h * h );
			vec3 g;
			g.x = a0.x * x0.x + h.x * x0.y;
			g.yz = a0.yz * x12.xz + h.yz * x12.yw;
			return 130.0 * dot( m, g );
		}

		float rand( vec2 co ) {
			return fract( sin( dot( co, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
		}

		// Stage 1: the scene plus blocky digital static. (Each stage is clamped like the 8-bit render targets
		// the separate passes used to write to.)
		vec4 staticStage( vec2 uv ) {
			vec4 color = clamp( texture2D( tDiffuse, uv ), 0.0, 1.0 );
			if ( staticEnabled ) {
				vec2 cell = floor( uv * resolution / staticSize );
				color = clamp( color + vec4( rand( cell * ( time * 0.1 ) ) * staticAmount ), 0.0, 1.0 );
			}
			return color;
		}

		// Stage 2: red and blue channels pulled apart.
		vec4 rgbShiftStage( vec2 uv ) {
			vec4 color = staticStage( uv );
			if ( rgbShiftEnabled ) {
				vec2 offset = rgbShiftAmount * vec2( cos( rgbShiftAngle ), sin( rgbShiftAngle ) );
				color.r = staticStage( uv + offset ).r;
				color.b = staticStage( uv - offset ).b;
			}
			return color;
		}

		// Stage 3: film grain and rolling scanlines.
		vec4 filmStage( vec2 uv ) {
			vec4 source = rgbShiftStage( uv );
			if ( ! filmEnabled ) {
				return source;
			}

			float x = uv.x * uv.y * time * 1000.0;
			x = mod( x, 13.0 ) * mod( x, 123.0 );
			float dx = mod( x, 0.01 );
			vec3 result = source.rgb + source.rgb * clamp( 0.1 + dx * 100.0, 0.0, 1.0 );
			vec2 sc = vec2( sin( uv.y * filmScanlineCount + time ) * 0.1, cos( uv.y * filmScanlineCount - time ) * -0.5 );
			result += source.rgb * vec3( sc.x, sc.y, sc.x ) * filmScanlineIntensity;
			result = source.rgb + clamp( filmNoiseIntensity, 0.0, 1.0 ) * ( result - source.rgb );
			if ( filmGrayscale ) result = vec3( result.r * 0.3 + result.g * 0.59 + result.b * 0.11 );
			return vec4( clamp( result, 0.0, 1.0 ), source.a );
		}

		void main() {
			// Stage 4: wobbly horizontal tape distortion (and optional vertical roll), applied by warping
			// where every earlier stage is sampled.
			vec2 uv = vUv;
			if ( badTVEnabled ) {
				float yt = vUv.y - time * 0.7 * badTVSpeed;
				float offset = snoise( vec2( yt * 3.0, 0.0 ) ) * 0.2;
				offset = offset * badTVDistortion * offset * badTVDistortion * offset;
				offset += snoise( vec2( yt * 50.0, 0.0 ) ) * badTVDistortion2 * 0.001;
				uv = vec2( fract( vUv.x + offset ), fract( vUv.y - time * badTVRollSpeed ) );
			}

			vec4 color = filmStage( uv );

			// Stage 5: vignette.
			if ( vignetteEnabled ) {
				vec2 v = ( vUv - 0.5 ) * vignetteOffset;
				color.rgb = mix( color.rgb, vec3( 1.0 - vignetteDarkness ), dot( v, v ) );
			}

			gl_FragColor = color;
		}
	`,
};
