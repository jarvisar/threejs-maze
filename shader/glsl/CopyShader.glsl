// Full-screen textured quad shader

varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
// Full-screen textured quad shader

uniform float opacity;
uniform sampler2D tDiffuse;
varying vec2 vUv;

void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    gl_FragColor = opacity * texel;
}
