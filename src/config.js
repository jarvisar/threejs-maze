// World layout. One world unit == one maze cell; walls and the ceiling are one unit tall.
export const CHUNK_SIZE = 10; // cells per chunk side (must be even, see world/maze.js)
export const HALF_CHUNK = CHUNK_SIZE / 2;
export const WALL_HEIGHT = 1;
export const EYE_HEIGHT = 0.5;

// Nothing past the camera's far plane is drawn, and the fog has fully swallowed the scene well before it.
export const VIEW_DISTANCE = 11;
export const CHUNK_LOAD_DISTANCE = VIEW_DISTANCE + 1;
export const CHUNK_UNLOAD_DISTANCE = CHUNK_LOAD_DISTANCE + 8;

// Atmosphere
export const CLEAR_COLOR = 0xe8e4d1;
export const FOG_COLOR = 0xe8e4d1;
export const FOG_DENSITY = 0.17;

// Player
export const PLAYER_RADIUS = 0.17; // half-width of the player's collision box
export const PHYSICS_RATE = 60; // fixed simulation steps per second
export const ACCELERATION = 0.002; // per step, scaled by the movement-speed setting
export const DAMPING = 0.9; // velocity multiplier per step
export const SPRINT_MULTIPLIER = 2.5;
export const FLY_CEILING = 6; // highest point you can fly to in edit mode
export const EDIT_REACH = 8;
