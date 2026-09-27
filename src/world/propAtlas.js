/*
 * Where each picture is in the props texture (drawn in decorationTextures.js, and read by props.js and every level's
 * ColorBuilder): a module of its own, with nothing to import, so anything can read it while the modules that use it are
 * still being put together.
 */

export const PROP_ATLAS_WIDTH = 1024;
export const PROP_ATLAS_HEIGHT = 1024;
/** In pixels, [x0, y0, x1, y1]. Level 1's are on the right; what's only put down in edit mode is in the bottom half. */
export const PROP_ATLAS = {
    sign: [0, 0, 256, 256],
    monitor: [256, 0, 512, 256],
    label: [0, 256, 256, 320],
    // A ceiling tile, face up: the part that broke off is the bottom 40%.
    tile: [352, 256, 512, 496],
    // Solid white, for parts coloured by their vertices alone.
    plain: [304, 304, 336, 336],
    // Level 1: a supply crate's side, plain and stencilled, and its lid; cardboard, with tape, and with a label;
    // a pallet's boards; a drum's hazard label; boxes shrink-wrapped on a pallet; racking's wire decking; paper
    // sacks; and a car's number plate, grille and lights.
    crate: [512, 0, 640, 128],
    crateStencil: [640, 0, 768, 128],
    crateTop: [768, 0, 896, 128],
    wood: [896, 0, 1024, 128],
    cardboard: [512, 128, 640, 256],
    cardboardLabel: [640, 128, 768, 256],
    cardboardTop: [768, 128, 896, 256],
    drumLabel: [896, 128, 1024, 256],
    wrap: [512, 256, 640, 384],
    decking: [640, 256, 768, 384],
    sack: [768, 256, 896, 384],
    plate: [896, 256, 1024, 320],
    grille: [896, 320, 1024, 384],
    // Level 2: the labels round a row of tins, and the spines of a row of box files.
    tins: [0, 320, 128, 384],
    spines: [128, 320, 256, 384],
    // What only edit mode puts down (see decorations.js). A television's screen, showing snow or a blank blue tape; a
    // vending machine's front, lit; a whiteboard with a meeting still on it; a clock's face; an EXIT sign; the warning
    // on a fuse box; the stripes on a road barrier; a pressure gauge's dial; the menu on the hotel's blackboard.
    snow: [0, 512, 128, 608],
    blueScreen: [128, 512, 256, 608],
    vending: [384, 512, 480, 736],
    whiteboard: [480, 512, 672, 624],
    clockFace: [672, 512, 768, 608],
    exitSign: [768, 512, 896, 576],
    danger: [896, 512, 960, 576],
    menu: [960, 512, 1024, 600],
    stripes: [480, 624, 608, 656],
    gauge: [608, 624, 640, 656],
    // The hotel's portraits (see terrorHotelTextures.js), smaller.
    portraits: [[0, 608, 96, 736], [96, 608, 192, 736], [192, 608, 288, 736], [288, 608, 384, 736]],
    // Notes left on the walls: Level 0's eight from a tape (see noteTextures.js), smaller.
    notes: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [k * 128, 736, k * 128 + 128, 917]),
};
