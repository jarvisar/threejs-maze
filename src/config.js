// World layout. One world unit == one grid cell; the ceiling is one unit up. Walls are thin partitions that
// run along the lines between cells, not whole cells.
export const CHUNK_SIZE = 16; // cells per chunk side (must be even)
export const HALF_CHUNK = CHUNK_SIZE / 2;
export const WALL_HEIGHT = 1;
export const EYE_HEIGHT = 0.5;

export const WALL_THICKNESS = 0.08;
export const DOOR_WIDTH = 0.44;
export const DOOR_HEIGHT = 0.72;
export const PILLAR_SIZE = 0.18;

// Nothing past the camera's far plane is drawn, and the fog has fully swallowed the scene well before it.
export const VIEW_DISTANCE = 11;
export const CHUNK_LOAD_DISTANCE = VIEW_DISTANCE + 1;
export const CHUNK_UNLOAD_DISTANCE = CHUNK_LOAD_DISTANCE + 8;

// Atmosphere
export const CLEAR_COLOR = 0xe8e4d1;
export const FOG_COLOR = 0xe8e4d1;
export const FOG_DENSITY = 0.17;

// Player
export const PLAYER_RADIUS = 0.12; // half-width of the player's collision box
export const PHYSICS_RATE = 60; // fixed simulation steps per second
export const ACCELERATION = 0.002; // per step, scaled by the movement-speed setting
export const DAMPING = 0.9; // velocity multiplier per step
export const SPRINT_MULTIPLIER = 2.5;
export const FLY_CEILING = 6; // highest point you can fly to in edit mode
export const EDIT_REACH = 8;

// Camcorder zoom
export const MAX_ZOOM = 4;

// VR: how big one world unit feels in a headset. At 2.7 m the ceiling is office height and a doorway is
// just taller than a person.
export const VR_METERS_PER_UNIT = 2.7;
