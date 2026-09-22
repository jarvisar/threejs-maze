import { ColorManagement } from 'three';

// The look predates three.js' colour management (r152), so colours and textures are used exactly as
// authored: no sRGB decoding on input and no encoding on output (see Game.js).
//
// This lives in its own module, imported before anything else, because some modules create `Color`s
// while they're being imported, and those would otherwise be converted using the default setting.
ColorManagement.enabled = false;
