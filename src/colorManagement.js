import { ColorManagement } from 'three';

// The look predates three.js color management (r152), so colors and textures are used as authored. No sRGB
// decoding on input and no encoding on output (see Game.js).
//
// Its own module, imported first, because some modules create Colors at import time and those would otherwise
// get converted with the default setting.
ColorManagement.enabled = false;
