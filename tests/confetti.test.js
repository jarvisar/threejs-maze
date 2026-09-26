import { Matrix4, MeshBasicMaterial, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Confetti } from '../src/fx/Confetti.js';

/** Where every piece that's showing is (checking that's where its instance is drawn, too). */
function pieces(confetti) {
    const matrix = new Matrix4();
    const drawn = new Vector3();
    const out = [];
    for (let i = 0; i < confetti.mesh.count; i++) {
        if (!confetti.alive[i] || confetti.delay[i] > 0) continue;
        const at = new Vector3().fromArray(confetti.position, i * 3);
        confetti.mesh.getMatrixAt(i, matrix);
        expect(drawn.setFromMatrixPosition(matrix).distanceTo(at)).toBeLessThan(1e-5);
        out.push(at);
    }
    return out;
}

/** Runs it for `seconds`, a frame at a time. */
function run(confetti, seconds) {
    for (let t = 0; t < seconds; t += 1 / 30) confetti.update(1 / 30);
}

describe('confetti', () => {
    it('flies up and out, flutters down, lands on the carpet, and is gone a while later', () => {
        const confetti = new Confetti(new Scene(), new MeshBasicMaterial());
        confetti.burst(2, 0.45, -3, 100, 1.5);
        run(confetti, 0.25);
        const early = pieces(confetti);
        expect(early.length).toBe(100);
        expect(Math.max(...early.map((p) => p.y))).toBeGreaterThan(0.5);
        // Paper falls slowly: none of it on the floor yet.
        run(confetti, 0.3);
        expect(pieces(confetti).filter((p) => p.y < 0.01).length).toBe(0);
        run(confetti, 8);
        const landed = pieces(confetti);
        expect(landed.length).toBe(100);
        for (const p of landed) {
            expect(p.y).toBeLessThan(0.004);
            expect(Math.hypot(p.x - 2, p.z + 3)).toBeLessThan(2);
        }
        run(confetti, 14);
        expect(confetti.mesh.count).toBe(0);
    });

    it('rains down from the ceiling over a while, and clears at once', () => {
        const confetti = new Confetti(new Scene(), new MeshBasicMaterial());
        confetti.shower(0, 0, 0.8, 200, 1);
        run(confetti, 0.1);
        const first = pieces(confetti).length;
        expect(first).toBeGreaterThan(0);
        run(confetti, 1);
        expect(pieces(confetti).length).toBe(200);
        expect(first).toBeLessThan(200);
        confetti.clear();
        expect(confetti.mesh.count).toBe(0);
        confetti.update(0.1);
        expect(confetti.mesh.count).toBe(0);
    });
});
