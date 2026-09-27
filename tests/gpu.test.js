import { describe, expect, it } from 'vitest';
import { dedicatedGpu } from '../src/gpu.js';

// Names as browsers give them (Chrome and Edge through ANGLE, Linux through Mesa, Firefox's rounded ones, Safari's).
describe('dedicated graphics cards', () => {
    it('are the desktop-class ones', () => {
        for (const name of [
            'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 (0x00002704) Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'NVIDIA GeForce GTX 980, or similar',
            'NVIDIA GeForce RTX 3070/PCIe/SSE2',
            'ANGLE (NVIDIA, NVIDIA RTX A2000 Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'AMD Radeon RX 580 Series (polaris10, LLVM 15.0.7, DRM 3.49, 6.1.0)',
            'ANGLE (AMD, Radeon RX Vega 64 Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'ANGLE (Apple, ANGLE Metal Renderer: AMD Radeon Pro 5500M, Unspecified Version)',
            'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Max, Unspecified Version)',
        ]) {
            expect(dedicatedGpu(name), name).toBe(true);
        }
    });

    it("aren't phones, the Steam Deck, graphics built into a processor, software, or unnamed", () => {
        for (const name of [
            'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'ANGLE (Intel, Intel(R) Arc(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'Intel(R) HD Graphics, or similar',
            'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'ANGLE (AMD, AMD Radeon 780M Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'ANGLE (AMD, AMD Radeon RX Vega 11 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'AMD Custom GPU 0405 (vangogh, LLVM 15.0.7, DRM 3.54, 6.1.52-valve16-1-neptune-61)',
            'ANGLE (NVIDIA, NVIDIA GeForce MX450 Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'ANGLE (NVIDIA, NVIDIA GeForce GTX 750 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
            'Apple GPU',
            'Adreno (TM) 740',
            'Mali-G78 MP20',
            'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
            'llvmpipe (LLVM 15.0.7, 256 bits)',
            'WebKit WebGL',
            '',
        ]) {
            expect(dedicatedGpu(name), name).toBe(false);
        }
    });
});
