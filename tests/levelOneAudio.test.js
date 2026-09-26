import { describe, expect, it } from 'vitest';
import { Ambience } from '../src/audio/Ambience.js';
import { LevelOneAudio } from '../src/audio/LevelOne.js';

describe('Level 1 sound', () => {
    it('is safe to use before there is any sound (there is no audio context until the first click)', () => {
        const ambience = new Ambience();
        const audio = new LevelOneAudio(ambience);
        expect(() => {
            ambience.setHumScale(0);
            audio.setEnabled(true);
            audio.setAreaLight(0.4);
            audio.setPower(0);
            audio.setWetness(1);
            for (let i = 0; i < 600; i++) audio.update(1 / 60);
            audio.footstep(1.5, 1);
            audio.drip(1, -0.5);
            audio.drip(1, 0.5, true, true);
            audio.setPower(1);
            audio.setEnabled(false);
        }).not.toThrow();
        expect(audio.built).toBe(false);
    });
});
