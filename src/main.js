// Must be first: switches off three.js colour management before any module creates a Color.
import './colorManagement.js';
import './styles.css';
import { Game } from './Game.js';

new Game().init();
