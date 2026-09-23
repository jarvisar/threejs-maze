// Must be first: switches off three.js colour management before any module creates a Color.
import './colorManagement.js';
import { Game } from './Game.js';

new Game().init();

// Offline support and "Add to Home Screen". Only in the build: in dev it would serve stale files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker not registered:', error));
    });
}
