import GUI from "https://cdn.skypack.dev/lil-gui@0.18.0";

import { PointerLockControls } from "./PointerLockControls.js";
import { EffectComposer } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/postprocessing/ShaderPass';
import { RGBShiftShader } from './shader/RGBShiftShader.js';
import { FilmShader } from './shader/FilmShader.js';
import { StaticShader } from './shader/StaticShader.js';
import { BadTVShader } from './shader/BadTVShader.js';
import Stats from 'https://cdn.skypack.dev/stats.js';
import { VignetteShader } from './shader/VignetteShader.js';
import { UnrealBloomPass } from './shader/UnrealBloomPass.js';

import * as THREE from 'https://unpkg.com/three@0.149.0/build/three.module.js';

var mazeWidth = 10;
var mazeHeight = mazeWidth;

var notStarted = true;

var flashlightEnabled = false;
var flashlight;

var fpsCapped = true;

var paused = true;

var dynamicLightsPopup = false;
var editModePopup = false;

var editMode = false;

var secretEnabled = false;

let timeout;
let currentMessage = "";
const popup = document.getElementById("popup");

var messageQueue = [];
var isShowingMessage = false;

// show loading spinner element with id loading-spinner
const loadingSpinner = document.getElementById('loading-spinner');
loadingSpinner.style.display = 'none';

// create a scene and camera and renderer and add them to the DOM with threejs and cannon
var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, mazeHeight + 1);
var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "default" });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

renderer.setPixelRatio(window.devicePixelRatio * 0.5);

renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const textureLoader = new THREE.TextureLoader();

const canvas = document.querySelector('.webgl')

// Create a render target for each composer
const renderTarget1 = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);

// Create EffectComposers
const composer = new EffectComposer(renderer, renderTarget1);

// Create render passes for each composer
const renderPass1 = new RenderPass(scene, camera);

const filmPass = new ShaderPass(FilmShader);
filmPass.renderToScreen = true;

filmPass.uniforms.grayscale.value = 0;
filmPass.uniforms.nIntensity.value = 0.1;
filmPass.uniforms.sIntensity.value = 0.8;
filmPass.uniforms.sCount.value = 375;

const staticPass = new ShaderPass(StaticShader);

staticPass.uniforms.amount.value = 0.04;
staticPass.uniforms.size.value = 4.0;

const RGBShiftShaderPass = new ShaderPass(RGBShiftShader);
RGBShiftShaderPass.renderToScreen = true;

RGBShiftShaderPass.uniforms.amount.value = 0.001;
RGBShiftShaderPass.uniforms.angle.value = 0.0;

const BadTVShaderPass = new ShaderPass(BadTVShader);
BadTVShaderPass.renderToScreen = true;

BadTVShaderPass.uniforms.distortion.value = 0.15;
BadTVShaderPass.uniforms.distortion2.value = 0.3;
BadTVShaderPass.uniforms.speed.value = 0.005;
BadTVShaderPass.uniforms.rollSpeed.value = 0;

const vignettePass = new ShaderPass(VignetteShader);
vignettePass.renderToScreen = true;

vignettePass.uniforms.offset.value = 0.81;
vignettePass.uniforms.darkness.value = 1.0;

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.renderToScreen = false;

bloomPass.threshold = 1;
bloomPass.strength = 0;
bloomPass.radius = 0.9;

// Add the render passes to their respective composers
composer.addPass(renderPass1);
composer.addPass(staticPass);
composer.addPass(RGBShiftShaderPass);
composer.addPass(filmPass);
composer.addPass(BadTVShaderPass);
composer.addPass(vignettePass);
composer.addPass(bloomPass);

let acceleration = 0.002;
let tolerance = mazeWidth;
var lightsEnabled = true;

var shadersToggled = true;

// add gui controls. instead of controls say settings
const gui = new GUI();
const graphicSettings = gui.addFolder("Graphics Settings");
const gameplaySettings = gui.addFolder("Gameplay Settings");
const shaderSettings = gui.addFolder("Shader Settings");
const staticSettings = shaderSettings.addFolder("Static Settings");
const rgbSettings = shaderSettings.addFolder("RGB Shift Settings");
const filmSettings = shaderSettings.addFolder("Scanline Settings");
const badtvSettings = shaderSettings.addFolder("Bad TV Settings");
const vignetteSettings = shaderSettings.addFolder("Vignette Settings");
const bloomSettings = shaderSettings.addFolder("Bloom Settings");
const guicontrols = {
    enabled: true,
    pixelratio: 50,
    movementspeed: 1,
    generationdistance: mazeWidth,
    dynamiclights: false,
    fpscapped: true
};
const staticControls = {
    enabled: true,
    amount: 0.04,
    size: 4.0
};
const rgbControls = {
    enabled: true,
    amount: 0.001,
    angle: 0.0
};
const filmControls = {
    enabled: true,
    grayscale: false,
    nIntensity: 0.1,
    sIntensity: 0.8,
    sCount: 375
};
const badtvControls = {
    enabled: true,
    distortion: 0.15,
    distortion2: 0.3,
    speed: 0.005,
    rollSpeed: 0
};
const vignetteControls = {
    enabled: true,
    offset: 0.81,
    darkness: 1.0
};
const bloomControls = {
    enabled: false,
    threshold: 1,
    strength: 0,
    radius: 0.9
};

// add control for rotationSpeed
graphicSettings.add(guicontrols, "pixelratio", 20, 100, 5).onChange((value) => {
    renderer.setPixelRatio(window.devicePixelRatio * (value / 100));
}).name("Pixel Ratio (%)").listen();

// add control for movementSpeed
gameplaySettings.add(guicontrols, "movementspeed", 0.2, 3, 0.1).onChange((value) => {
    acceleration = 0.002 * value;
}).name("Movement Speed").listen();

// add control for generationDistance
graphicSettings.add(guicontrols, "generationdistance", 1, mazeWidth, 1).onChange((value) => {
    tolerance = value;
}).name("Generation Distance").listen();

// add control for dynamicLights
graphicSettings.add(guicontrols, "dynamiclights").onChange((value) => {
    lightsEnabled = value;
    if (value) {
        createLightSources(offsetX, offsetZ);
        ceilingMaterial.color.setHex(0xffffff);
        ambientLight.intensity = 0.1;
    } else {
        deleteLights();
        ceilingMaterial.color.setHex(0x777777);
        ambientLight.intensity = 0.7;
    }
}).name("Dynamic Lights").listen();

// add control for fpsCapped
graphicSettings.add(guicontrols, "fpscapped").onChange((value) => {
    fpsCapped = value;
}).name("Cap FPS").listen();

staticSettings.add(staticControls, "enabled").onChange((value) => {
    staticPass.enabled = value;
    if (value) {
        staticPass.renderToScreen = true;
    } else {
        staticPass.renderToScreen = false;
    }
}).name("Enabled").listen();

staticSettings.add(staticControls, "amount", 0, 1, 0.01).onChange((value) => {
    staticPass.uniforms.amount.value = value;
}).name("Amount").listen();

staticSettings.add(staticControls, "size", 0, 10, 0.1).onChange((value) => {
    staticPass.uniforms.size.value = value;
}).name("Size").listen();

// add control for rgb shift
rgbSettings.add(rgbControls, "enabled").onChange((value) => {
    RGBShiftShaderPass.enabled = value;
    if (value) {
        RGBShiftShaderPass.renderToScreen = true;
    } else {
        RGBShiftShaderPass.renderToScreen = false;
    }
}).name("Enabled").listen();
rgbSettings.add(rgbControls, "amount", 0, 1, 0.001).onChange((value) => {
    RGBShiftShaderPass.uniforms.amount.value = value;
}).name("Amount").listen();
rgbSettings.add(rgbControls, "angle", 0, 1, 0.001).onChange((value) => {
    RGBShiftShaderPass.uniforms.angle.value = value;
}).name("Angle").listen();

// add control for film
filmSettings.add(filmControls, "enabled").onChange((value) => {
    filmPass.enabled = value;
    if (value) {
        filmPass.renderToScreen = true;
    } else {
        filmPass.renderToScreen = false;
    }
}).name("Enabled").listen();

filmSettings.add(filmControls, "grayscale").onChange((value) => {
    filmPass.uniforms.grayscale.value = value;
}).name("Grayscale").listen();

filmSettings.add(filmControls, "nIntensity", 0, 1, 0.001).onChange((value) => {
    filmPass.uniforms.nIntensity.value = value;
}).name("Noise Intensity").listen();

filmSettings.add(filmControls, "sIntensity", 0, 1, 0.001).onChange((value) => {
    filmPass.uniforms.sIntensity.value = value;
}).name("Scanline Intensity").listen();

filmSettings.add(filmControls, "sCount", 0, 1500, 1).onChange((value) => {
    filmPass.uniforms.sCount.value = value;
}).name("Scanline Count").listen();

// add control for bad tv
badtvSettings.add(badtvControls, "enabled").onChange((value) => {
    BadTVShaderPass.enabled = value;
    if (value) {
        BadTVShaderPass.renderToScreen = true;
    } else {
        BadTVShaderPass.renderToScreen = false;
    }
}).name("Enabled").listen();

badtvSettings.add(badtvControls, "distortion", 0, 1, 0.001).onChange((value) => {
    BadTVShaderPass.uniforms.distortion.value = value;
}).name("Distortion").listen();

badtvSettings.add(badtvControls, "distortion2", 0, 1, 0.001).onChange((value) => {
    BadTVShaderPass.uniforms.distortion2.value = value;
}).name("Distortion 2").listen();

badtvSettings.add(badtvControls, "speed", 0, 1, 0.001).onChange((value) => {
    BadTVShaderPass.uniforms.speed.value = value;
}).name("Speed").listen();

badtvSettings.add(badtvControls, "rollSpeed", 0, 1, 0.001).onChange((value) => {
    BadTVShaderPass.uniforms.rollSpeed.value = value;
}).name("Roll Speed").listen();

// add control for vignette
vignetteSettings.add(vignetteControls, "enabled").onChange((value) => {
    vignettePass.enabled = value;
    if (value) {
        vignettePass.renderToScreen = true;
    } else {
        vignettePass.renderToScreen = false;
    }
}).name("Enabled").listen();

vignetteSettings.add(vignetteControls, "offset", 0, 1, 0.001).onChange((value) => {
    vignettePass.uniforms.offset.value = value;
}).name("Offset").listen();

vignetteSettings.add(vignetteControls, "darkness", 0, 1, 0.001).onChange((value) => {
    vignettePass.uniforms.darkness.value = value;
}).name("Darkness").listen();

// add control for bloom
bloomSettings.add(bloomControls, "enabled").onChange((value) => {
    bloomPass.enabled = value;
    if (value) {
        bloomPass.renderToScreen = true;
    } else {
        bloomPass.renderToScreen = false;
    }
}).name("Enabled").listen();

bloomSettings.add(bloomControls, "threshold", 0, 1, 0.001).onChange((value) => {
    bloomPass.threshold = value;
}).name("Threshold").listen();

bloomSettings.add(bloomControls, "strength", 0, 1, 0.001).onChange((value) => {
    bloomPass.strength = value;
}).name("Strength").listen();

bloomSettings.add(bloomControls, "radius", 0, 1, 0.001).onChange((value) => {
    bloomPass.radius = value;
}).name("Radius").listen();

// toggle all shaders
shaderSettings.add({ toggleAll: function () {
    toggleShaders();
} }, "toggleAll").name("Toggle All Shaders");

function toggleShaders(){
    if (shadersToggled) {
        staticPass.enabled = false;
        RGBShiftShaderPass.enabled = false;
        filmPass.enabled = false;
        BadTVShaderPass.enabled = false;
        vignettePass.enabled = false;
        bloomPass.enabled = false;
        shadersToggled = false;
    } else {
        staticPass.enabled = true;
        RGBShiftShaderPass.enabled = true;
        filmPass.enabled = true;
        BadTVShaderPass.enabled = true;
        vignettePass.enabled = true;
        shadersToggled = true;
    }
    if (staticPass.enabled) {
        staticPass.renderToScreen = true;
    } else {
        staticPass.renderToScreen = false;
    }
    if (RGBShiftShaderPass.enabled) {
        RGBShiftShaderPass.renderToScreen = true;
    } else {
        RGBShiftShaderPass.renderToScreen = false;
    }
    if (filmPass.enabled) {
        filmPass.renderToScreen = true;
    } else {
        filmPass.renderToScreen = false;
    }
    if (BadTVShaderPass.enabled) {
        BadTVShaderPass.renderToScreen = true;
    } else {
        BadTVShaderPass.renderToScreen = false;
    }
    if (vignettePass.enabled) {
        vignettePass.renderToScreen = true;
    } else {
        vignettePass.renderToScreen = false;
    }
    bloomPass.renderToScreen = false;
    // also set all the settings
    staticControls.enabled = staticPass.enabled;
    rgbControls.enabled = RGBShiftShaderPass.enabled;
    filmControls.enabled = filmPass.enabled;
    badtvControls.enabled = BadTVShaderPass.enabled;
    vignetteControls.enabled = vignettePass.enabled;
    bloomControls.enabled = bloomPass.enabled;
}

shaderSettings.close();
gameplaySettings.close();

// create a light and add it to the scene up top and add a shadow to the renderer
const light = new THREE.DirectionalLight(0xfeffd9, 0.9);
light.position.set(0, 10, 0);
light.castShadow = true;
light.shadow.mapSize.width = 1024;
light.shadow.mapSize.height = 1024;
light.shadow.camera.near = 0.5;
light.shadow.camera.far = mazeHeight + 1;
scene.add(light);

// pointer lock controls
const controls = new PointerLockControls(camera, canvas)
scene.add(controls.getObject()); 
const startButton = document.getElementById('startButton')
const menuPanel = document.getElementById('menuPanel')
startButton.addEventListener(
    'click',
    function () {
        controls.lock()
        // hide #startButton and #menuPanel
        startButton.style.display = 'none'
        menuPanel.style.display = 'none'
        if (notStarted){
            startButton.innerHTML = "Click to Resume"
            setTimeout(function () {
                popupMessage("Press \"F\" to toggle the flashlight.")
            }, 3000);
            setTimeout(function () {
                popupMessage("Press \"1\" to toggle all shader effects.")
            }, 15000);
            setTimeout(function () {
                if (dynamicLightsPopup)
                    return;
                popupMessage("Press \"2\" or \"G\" to toggle dynamic lights.")
            }, 22500);
            setTimeout(function () {

                popupMessage("Press \"3\" to toggle FPS cap.")
            }, 30000);
            setTimeout(function () {
                if (editModePopup)
                    return;
                popupMessage("Press \"X\" to toggle edit mode.")
            }, 45000);
            setTimeout(function () {

                popupMessage("Enter the Konami Code for a super top secret suprise!")
            }, 69000);
            acceleration = 0.002;
            keyState.KeyW = false;
            controls.getObject().position.x = 0;
            controls.getObject().position.y = 0.5;
            controls.getObject().position.z = 0;
            createFlashlight();
            notStarted = false;
        }
        paused = false;
    },
    false
)

controls.addEventListener('lock', function () {
    startButton.style.display = 'none'
    menuPanel.style.display = 'none'
    paused = false;
})

controls.addEventListener('unlock', function () {
    startButton.style.display = 'block'
    menuPanel.style.display = 'block'
    paused = true;
    menuPanel.style.backdropFilter = "blur(0px)";
    document.getElementById('title').style.display = 'none'
    Object.keys(keyState).forEach(function (key) {
        keyState[key] = false;
    });
})

var input = '';
var key = '38384040373937396665'; // konami code, up up down down left right left right b a

document.addEventListener(
    'keydown',
    function (e) {
        if (!paused){
            input += '' + e.keyCode;
            if (input === key) {
                input = '';
                if (secretEnabled)
                    return;
                activateKonamiCode();
            }
        }
        if (e.code === 'KeyF') {
            if (!paused){
                if (flashlightEnabled) {
                    deleteFlashlight();
                    flashlightEnabled = false;
                } else {
                    flashlightEnabled = true;
                    createFlashlight();
                }
            }
        }
        if (e.code == 'Digit1') {
            toggleShaders();
        }
        if (e.code === 'Digit2' || e.code === 'KeyG') {
            if (lightsEnabled) {
                lightsEnabled = false;
                guicontrols.dynamiclights = false;
                deleteLights();
                ceilingMaterial.color.setHex(0x777777);
                ambientLight.intensity = 0.7;
            } else {
                lightsEnabled = true;
                guicontrols.dynamiclights = true;
                createLightSources(offsetX, offsetZ);
                ceilingMaterial.color.setHex(0xffffff);
                ambientLight.intensity = 0.1;
            }
        }
        if (e.code == 'Digit3') {
            fpsCapped = !fpsCapped;
            guicontrols.fpscapped = fpsCapped;
        }
        if (e.code == "Digit4") {
            if (guicontrols.pixelratio == 100 || guicontrols.pixelratio != 55) {
                guicontrols.pixelratio = 55;
                renderer.setPixelRatio(window.devicePixelRatio * 0.55);
            } else {
                guicontrols.pixelratio = 100;
                renderer.setPixelRatio(window.devicePixelRatio * 1);
            }
        }
        if (e.code == "KeyX") {
            if (!paused) {
                toggleEditMode();
            }
        }
        if (!key.indexOf(input)) return;
        input = '' + e.keyCode;
        if (e.code === 'Escape') {
            // show #startButton and #menuPanel
            startButton.style.display = 'block'
            menuPanel.style.display = 'block'
            paused = true;
        }
    },
    false
)

flashlight = new THREE.SpotLight(0xffffff, 0, 0, Math.PI / 6, 0.5, 2.5);
flashlight.castShadow = true;
flashlight.shadow.mapSize.width = 1024;
flashlight.shadow.mapSize.height = 1024;
flashlight.shadow.camera.near = 0.5;
flashlight.shadow.camera.far = mazeHeight + 1;
flashlight.identifier = "flashlight";
scene.add(flashlight);
flashlight.intensity = 0;

function createFlashlight(){
    flashlight.intensity = 0.7;
}

function deleteFlashlight(){
    flashlight.intensity = 0;
}


// if lose focus of canvas, unlock pointer lock controls and show #startButton and #menuPanel. listen for blur
window.addEventListener(
    'blur',
    function () {
        controls.unlock()
        paused = true;
        // show #startButton and #menuPanel
        startButton.style.display = 'block'
        menuPanel.style.display = 'block'
    },
    false
)

// resize canvas when window is resized
window.addEventListener('resize', function () {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

controls.getObject().position.y = 0.5;

// velocity for player
const velocity = new THREE.Vector3();
const damping = 0.9;

// Key state to track whether a key is currently pressed
const keyState = {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    KeyQ: false,
    KeyE: false,
    Space: false,
};

document.addEventListener('keydown', function (event) {
    if (!paused) {
        keyState[event.code] = true;
    }
});

var offsetX = 0;
var offsetZ = 0;
var visitedOffsets = [[0,0]];
document.addEventListener('keyup', function (event) {
    if (!paused) {
        keyState[event.code] = false;
    }
});

// add fps copunter
const stats = new Stats();
document.body.appendChild(stats.dom);

const wallTexture = textureLoader.load('./public/wallpaper.png', function (texture) {
    // Enable mipmapping for the texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.NearestMipmapNearestFilter ;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Add random offsets to the texture coordinates
    texture.offset.set(Math.random(), Math.random());
    texture.repeat.set(1, 1);
});
const baseboardTexture = textureLoader.load('./public/baseboard.jpg', function (texture) {
    // Enable mipmapping for the texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.NearestMipmapNearestFilter ;
    // performance increase
    texture.anisotropy = 16;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    texture.repeat.set(20, 20);
});

// FLOOR
const floorTexture = textureLoader.load('./public/floor.png', function (texture) {
    // Enable mipmapping for the texture

    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Add random offsets to the texture coordinates

    texture.repeat.set(60, 60);
});

const heightTexture = textureLoader.load('./public/heightmap.png', function (texture) {
    // Enable mipmapping for the heightmap texture

    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Add random offsets to the texture coordinates

    texture.repeat.set(60, 60);
});

// CEILING
const ceilingTexture = textureLoader.load('./public/ceiling_tile.jpg', function (texture) {
    // Enable mipmapping for the texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(60, 40);
});
const ceilingHeightTexture = textureLoader.load('./public/ceiling_tile_heightmap.png', function (texture) {
    // Enable mipmapping for the heightmap texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(60, 40);
});

// prim's algorithm to generate a maze
function generateMaze(width, height) {
    // Initialize the maze with all walls (1s)
    const maze = Array.from({ length: height }, () => Array(width).fill(1));
  
    // Initialize the starting point
    const startX = 1;
    const startY = 1;
    maze[startY][startX] = 0; // Set the starting point as a blank cell
  
    // Helper function to get neighboring cells
    const getNeighbors = (x, y) => {
      const neighbors = [];
  
      if (x >= 2) neighbors.push([x - 2, y]);
      if (y >= 2) neighbors.push([x, y - 2]);
      if (x < width - 2) neighbors.push([x + 2, y]);
      if (y < height - 2) neighbors.push([x, y + 2]);
  
      return neighbors;
    };
  
    // Helper function to shuffle an array in-place
    const shuffleArray = (array) => {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
    };
  
    // Perform Prim's algorithm
    const frontier = [];
    frontier.push([startX, startY]);
  
    while (frontier.length > 0) {
      shuffleArray(frontier);
      const [currentX, currentY] = frontier.pop();
  
      const neighbors = getNeighbors(currentX, currentY);
      shuffleArray(neighbors);
  
      for (const [nextX, nextY] of neighbors) {
        if (maze[nextY][nextX] === 1) {
          maze[nextY][nextX] = 0;
          maze[currentY + (nextY - currentY) / 2][currentX + (nextX - currentX) / 2] = 0;
          frontier.push([nextX, nextY]);
        }
      }
    }
  
    return maze;
}

// procedural generation when player reaches end of maze, within two blocks of end. should attach to the edge of the maze using the array of the mazesize
// generate a new maze, and add it to the current maze. should be able to generate multiple mazes, and have them all connect to each other. make sure to use the previous/adjacent mazes to generate the new maze, so they connect. use a 2d array of mazes, which itself is a 2d array of 1s and 0s representing walls and blanks
var mazes = [];
mazes.push(generateMaze(mazeWidth, mazeHeight));
var initialMaze = mazes[0];
var currentMaze = mazes[0];
var mazeIndex = 0;
var mazeCount = 1;
var wallSize = 1;

const wallGeometry = new THREE.BoxGeometry(wallSize+0.000001, wallSize, wallSize+0.000001);
const wallMaterial = new THREE.MeshPhongMaterial({ map: wallTexture });
const baseboardGeometry = new THREE.BoxGeometry(wallSize + 0.01, 0.065, wallSize + 0.01);
const baseboardMaterial = new THREE.MeshPhongMaterial({ map: baseboardTexture, reflectivity: 0, shininess: 0, roughness: 1 });

generateMazeWalls(currentMaze, offsetX, offsetZ);

function generateMazeWalls(maze, offsetX, offsetZ) {
    // create a box to represent a wall for each cell in the maze
    for (var i = 0; i < mazeWidth; i++) {
        for (var j = 0; j < mazeHeight; j++) {
            if (maze[i][j] == 0) {
                const wall = new THREE.Mesh(wallGeometry, wallMaterial);
                if (i - mazeWidth / 2 != 0) {
                    wall.position.x = (i - mazeWidth / 2) + (offsetX * mazeWidth)
                }
                if (j - mazeHeight / 2 != 0) {
                    wall.position.z = (j - mazeHeight / 2) + (offsetZ * mazeHeight)
                }
                wall.position.y = wallSize / 2;
                wall.castShadow = true;
                wall.receiveShadow = true;

                const baseboard = new THREE.Mesh(baseboardGeometry, baseboardMaterial);
                // put in middle, so go from - to +, not 0 to +.
                if (i - mazeWidth / 2 != 0) {
                    baseboard.position.x = i - mazeWidth / 2;
                }
                if (j - mazeHeight / 2 != 0) {
                    baseboard.position.z = j - mazeHeight / 2;
                }
                baseboard.position.x = 0.00;
                baseboard.position.z = 0.00;
                baseboard.position.y = -0.5;
                baseboard.castShadow = true;
                baseboard.receiveShadow = true;
                wall.add(baseboard);
                wall.identifier = `${offsetX},${offsetZ},wall`
                if (offsetX == 0 && offsetZ == 0) { // gap in middle of maze (player spawn)
                    if (i < ((mazeWidth / 2) - 1) || i > ((mazeWidth / 2) + 1) || j < ((mazeHeight / 2) - 1) || j > ((mazeHeight / 2) + 1)) {
                        scene.add(wall);
                    }
                } else { // only add walls that are within the current maze based on offset
                    if (wall.position.x < 0) {
                        if (wall.position.x > (offsetX * mazeWidth) - mazeWidth && wall.position.x < (offsetX * mazeWidth) + mazeWidth) {
                            if (wall.position.z < 0) {
                                if (wall.position.z > (offsetZ * mazeHeight) - mazeHeight && wall.position.z < (offsetZ * mazeHeight) + mazeHeight) {
                                    scene.add(wall);
                                }
                            } else {
                                if (wall.position.z > (offsetZ * mazeHeight) - mazeHeight && wall.position.z < (offsetZ * mazeHeight) + mazeHeight) {
                                    scene.add(wall);
                                }
                            }
                        }
                    } else {
                        if (wall.position.x > (offsetX * mazeWidth) - mazeWidth && wall.position.x < (offsetX * mazeWidth) + mazeWidth) {
                            if (wall.position.z < 0) {
                                if (wall.position.z > (offsetZ * mazeHeight) - mazeHeight && wall.position.z < (offsetZ * mazeHeight) + mazeHeight) {
                                    scene.add(wall);
                                }
                            } else {
                                if (wall.position.z > (offsetZ * mazeHeight) - mazeHeight && wall.position.z < (offsetZ * mazeHeight) + mazeHeight) {
                                    scene.add(wall);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

const raycaster = new THREE.Raycaster();

function toggleEditMode(){
    if (!editModePopup)
        editModePopup = true;
    editMode = !editMode;
    if (editMode) {
        popupMessage("Edit Mode Enabled. <br> Click to remove walls or right click to add walls.")
        // add event listener for mouse clicks
        document.addEventListener('click', handleEditModeClick, false);
    } else {
        popupMessage("Edit Mode Disabled.")
        // remove event listener for mouse clicks
        document.removeEventListener('click', handleEditModeClick, false);
    }

}

function handleEditModeClick(event) {
    if (paused)
        return;
    if (event.button == 2){
        const mouse = new THREE.Vector2();
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children);
        if (intersects.length > 0) {
            if (intersects[0].object.identifier?.includes("wall")) {
                const wall = new THREE.Mesh(wallGeometry, wallMaterial);
                wall.position.x = intersects[0].object.position.x + intersects[0].face.normal.x;
                wall.position.z = intersects[0].object.position.z + intersects[0].face.normal.z;
                wall.position.y = wallSize / 2;
                wall.castShadow = true;
                wall.receiveShadow = true;
                wall.identifier = `${offsetX},${offsetZ},wall`
                console.log(wall.identifier)
                const baseboard = new THREE.Mesh(baseboardGeometry, baseboardMaterial);
                baseboard.position.x = 0.00;
                baseboard.position.z = 0.00;
                baseboard.position.y = -0.5;
                baseboard.castShadow = true;
                baseboard.receiveShadow = true;
                baseboard.identifier = `${offsetX},${offsetZ},baseboard`
                if (wall.position.x == Math.round(controls.getObject().position.x) && wall.position.z == Math.round(controls.getObject().position.z)) {
                    return;
                }
                wall.add(baseboard);
                scene.add(wall);
            } else if  (intersects[0].object.identifier?.includes("floor")) {
                const wall = new THREE.Mesh(wallGeometry, wallMaterial);
                wall.position.x = Math.round(intersects[0].point.x);
                wall.position.z = Math.round(intersects[0].point.z);
                wall.position.y = wallSize / 2;
                wall.castShadow = true;
                wall.receiveShadow = true;
                wall.identifier = `${offsetX},${offsetZ},wall`
                const baseboard = new THREE.Mesh(baseboardGeometry, baseboardMaterial);
                baseboard.position.x = 0.00;
                baseboard.position.z = 0.00;
                baseboard.position.y = -0.5;
                baseboard.castShadow = true;
                baseboard.receiveShadow = true;
                if (wall.position.x == Math.round(controls.getObject().position.x) && wall.position.z == Math.round(controls.getObject().position.z)) {
                    return;
                }
                wall.add(baseboard);
                scene.add(wall);
            }
        }
    } else if (event.button == 0){
        if (event.target.tagName === 'CANVAS') {
            const mouse = new THREE.Vector2();
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObjects(scene.children);
            if (intersects.length > 0) {
                if (intersects[0].object.identifier?.includes("wall") || intersects[0].object.identifier?.includes("baseboard")) {
                    // if baseboard, delet wall too
                    console.log(intersects[0].object.parent.identifier)
                    if (intersects[0].object.parent.identifier?.includes("wall")) {
                        scene.remove(intersects[0].object.parent);
                    } else {
                        scene.remove(intersects[0].object);
                    }
                }
            } 
        }
    }
}

let shaderTime = 0;

const halfMazeWidth = mazeWidth / 2;
const halfMazeHeight = mazeHeight / 2;

var lastTime = 0;
var maxFPS = 100;

var performanceOverride = false;

let clock = new THREE.Clock();

function update() {
    var currentTime = performance.now();
    var deltaTime = currentTime - lastTime;
    // Limit frame rate to prevent physics bugs
    if (deltaTime > 1000 / maxFPS || !fpsCapped) {
        stats.begin();

        if (keyState.KeyW) velocity.z += acceleration;
        if (keyState.KeyA) velocity.x -= acceleration;
        if (keyState.KeyS) velocity.z -= acceleration;
        if (keyState.KeyD) velocity.x += acceleration;
        if (keyState.KeyQ) velocity.y += acceleration;
        if (keyState.Space && editMode) velocity.y += acceleration;
        if (keyState.KeyE && editMode) velocity.y -= acceleration;
        if (keyState.ShiftLeft) velocity.z += acceleration * 1.5;

        velocity.multiplyScalar(damping);

        var oldPosition = controls.getObject().position.clone();

        controls.moveForward(velocity.z);
        controls.moveRight(velocity.x);
        controls.moveUp(velocity.y);

        if (flashlightEnabled && flashlight != undefined) { // flashlight follows camera
            flashlight.position.copy(controls.getObject().position);
            flashlight.position.y -= 0.12;
            // use trig to always keep the flashlight directly to the right of the camera
            
            flashlight.position.x += Math.cos(camera.rotation.y + Math.PI / 2) * 0.15;
            flashlight.position.z += Math.sin(camera.rotation.y + Math.PI / 2) * 0.15;
            
            var direction = new THREE.Vector3(0, 0, -1);
            direction.applyQuaternion(camera.quaternion); // apply camera's quaternion to the direction
    
            var distance = 5;
    
            var targetPosition = new THREE.Vector3();
            targetPosition.copy(controls.getObject().position).add(direction.multiplyScalar(distance));
    
            flashlight.target.position.copy(targetPosition);
            flashlight.target.updateMatrixWorld();
        }

        checkWallCollisions(oldPosition);

        const playerPosition = controls.getObject().position;
        const { x: oldX, z: oldZ } = oldPosition;
        const { x: playerX, z: playerZ } = playerPosition;

        if (oldX !== playerX || oldZ !== playerZ) {
            const calculateOffset = (position, halfMaze, mazeDimension) => {
                return (position < 0 ? (position - halfMaze) : (position + halfMaze)) / mazeDimension | 0;
            };        

            const newOffsetX = calculateOffset(playerX, halfMazeWidth, mazeWidth);
            const newOffsetZ = calculateOffset(playerZ, halfMazeHeight, mazeHeight);

            const offsetPairs = [];
 
            for (let xOffset = -tolerance; xOffset <= tolerance; xOffset++) { 
                const newX = Math.floor((playerX + xOffset + halfMazeWidth) / mazeWidth);

                for (let zOffset = -tolerance; zOffset <= tolerance; zOffset++) {
                    const newZ = Math.floor((playerZ + zOffset + halfMazeHeight) / mazeHeight);

                    if (!offsetPairs.some(([x, z]) => x === newX && z === newZ)) {
                        offsetPairs.push([newX, newZ]);
                    }
                }
            }

            handleOffsetChange(newOffsetX, newOffsetZ, offsetPairs);
        }

        shaderTime += 0.1;
        staticPass.uniforms.time.value = (shaderTime / 10);
        filmPass.uniforms.time.value = shaderTime;
        BadTVShaderPass.uniforms.time.value = shaderTime;

        composer.render();

        lastTime = currentTime;
        stats.end();
    }

    if (currentTime > 1000 && !performanceOverride) {
        lightsEnabled = false;
            guicontrols.dynamiclights = false;
            deleteLights();
            ceilingMaterial.color.setHex(0x777777);
            ambientLight.intensity = 0.7;
            popupMessage("Dynamic lights have been automatically disabled. \n Press \"2\" or \"G\" to re-enable them.")
            dynamicLightsPopup = true;
        performanceOverride = true;
    }

    const delta = clock.getDelta();

    if ( mixer !== undefined ) {

        mixer.update( delta );

    }

    requestAnimationFrame(update);
}

const coordinates = document.getElementById('coordinates');

function handleOffsetChange(newOffsetX, newOffsetZ, offsetPairs) {
    offsetPairs.forEach(([x, z]) => {
        if (!hasVisitedOffset(x, z)) {
            mazes.push(generateMaze(mazeWidth, mazeHeight));
            mazeIndex = mazes.length - 1;
            generateMazeWalls(mazes[mazeIndex], x, z);
            currentMaze = mazes[mazeIndex];
            mazeCount++;
            createFloor(x, z);
            createCeiling(x, z);
            createLights(x, z);
            visitedOffsets.push([x, z]);
        }
    });

    if ((newOffsetX != offsetX || newOffsetZ != offsetZ) && !hasVisitedOffset(newOffsetX, newOffsetZ)) {
        offsetX = newOffsetX;
        offsetZ = newOffsetZ;
        createLightSources(offsetX, offsetZ);
        deleteLightsExceptOffset(offsetX, offsetZ);
        visitedOffsets.push([newOffsetX, newOffsetZ]);
        coordinates.innerHTML = `(${offsetX},${offsetZ})`;
    } else if (newOffsetX != offsetX || newOffsetZ != offsetZ) {
        offsetX = newOffsetX;
        offsetZ = newOffsetZ;
        deleteLightsExceptOffset(offsetX, offsetZ);
        createLightSources(offsetX, offsetZ);
        coordinates.innerHTML = `(${offsetX},${offsetZ})`;
    }
}

coordinates.innerHTML = `(${offsetX},${offsetZ})`;

function hasVisitedOffset(x, z) {
    return visitedOffsets.some(([vx, vz]) => vx === x && vz === z);
}

function checkWallCollisions(oldPosition) {
    // Get the current position of the controls object
    var position = controls.getObject().position;

    // Iterate over all walls in the scene
    scene.children?.forEach(function (object) {
        if (object instanceof THREE.Mesh && object.identifier?.includes("wall")) {
            // Check for collision with each wall
            if (checkCollision(position, object)) {
                // If there is a collision, move the controls object back to its old position
                controls.getObject().position.copy(oldPosition);
            }
        }
    });
}

function checkCollision(position, wall) {
    var boxSize = new THREE.Vector3(0.32, 1.0, 0.32);

    return (
        position.x + boxSize.x / 2 >= wall.position.x - wall.geometry.parameters.width / 2 &&
        position.x - boxSize.x / 2 <= wall.position.x + wall.geometry.parameters.width / 2 &&
        position.z + boxSize.z / 2 >= wall.position.z - wall.geometry.parameters.depth / 2 &&
        position.z - boxSize.z / 2 <= wall.position.z + wall.geometry.parameters.depth / 2 &&
        position.y + boxSize.y / 2 >= wall.position.y - wall.geometry.parameters.height / 2 &&
        position.y - boxSize.y / 2 <= wall.position.y + wall.geometry.parameters.height / 2
    );
}

var ambientLight = new THREE.AmbientLight(0xe8e4ca, 0.1);
scene.add(ambientLight);

scene.fog = new THREE.FogExp2(0xe8e4d1, 0.17);

renderer.setClearColor(0xe8e4d1);

const floorMaterial = new THREE.MeshPhongMaterial({ color: 0x4a4a4a, map: floorTexture, bumpMap: heightTexture, bumpScale: 0.005, shininess: 0, reflectivity: 0, roughness: 1 });
floorMaterial.shininess = 0;
floorMaterial.reflectivity = 0;
floorMaterial.roughness = 1;
const floorGeometry = new THREE.PlaneGeometry(mazeWidth, mazeWidth)

function createFloor(offsetX, offsetZ) {
    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial)
    floorMesh.rotateX(-Math.PI / 2)
    floorMesh.position.y = 0;
    floorMesh.position.x = offsetX * mazeWidth;
    floorMesh.position.z = offsetZ * mazeHeight;
    floorMesh.receiveShadow = true;
    floorMesh.identifier = `${offsetX},${offsetZ},floor`
    scene.add(floorMesh)
}

createFloor(0,0)

const ceilingMaterial = new THREE.MeshStandardMaterial({ map: ceilingTexture, bumpMap: ceilingHeightTexture, bumpScale: 0.0015 });
ceilingMaterial.shininess = 0;
ceilingMaterial.reflectivity = 0;
ceilingMaterial.roughness = 1;
const ceilingGeometry = new THREE.PlaneGeometry(mazeWidth, mazeWidth)

function createCeiling(offsetX, offsetZ) {
    const ceilingMesh = new THREE.Mesh(ceilingGeometry, ceilingMaterial)
    ceilingMesh.rotateX(Math.PI / 2)
    // same height as the cubes
    ceilingMesh.position.y = 1;
    ceilingMesh.position.x = offsetX * mazeWidth;
    ceilingMesh.position.z = offsetZ * mazeHeight;
    ceilingMesh.identifier = `${offsetX},${offsetZ}`
    ceilingMesh.receiveShadow = true;
    scene.add(ceilingMesh)
}

createCeiling(0,0);

const lightGeometry = new THREE.BoxGeometry(0.15, 0.01, 0.15);
const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xfeffe8 });
const outlineGeometry = new THREE.BoxGeometry(0.17, 0.01, 0.17);
const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });

function createLights(offsetX, offsetZ) {
    for (var i = 0; i < mazeWidth; i = i + 2) {
        for (var j = 0; j < mazeHeight; j = j + 2) {
            if (currentMaze[i][j] == 1) {
                const light = new THREE.Mesh(lightGeometry, lightMaterial);
                light.position.x = (i - mazeWidth / 2) + (offsetX * mazeWidth);
                light.position.y = 0.99;
                light.position.z = (j - mazeHeight / 2) + (offsetZ * mazeHeight);
                const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
                outline.position.x = (i - mazeWidth / 2) + (offsetX * mazeWidth);
                outline.position.y = 0.999;
                outline.position.z = (j - mazeHeight / 2) + (offsetZ * mazeHeight);
                light.identifier = `${offsetX},${offsetZ}`
                outline.identifier = `${offsetX},${offsetZ}`
                scene.add(outline);
                scene.add(light);
            }
        }
    }
}

function createLightSources(offsetX, offsetZ){
    if (!lightsEnabled) {
        return;
    }
    // do same as above, but go two block out from the maze, and add a lightsource every 2 blocks
    for (var i = -tolerance; i < mazeWidth + tolerance; i = i + 2) {
        for (var j = -tolerance; j < mazeHeight + tolerance; j = j + 2) {
            const lightSource = new THREE.PointLight(0xf5f4cb, 1.1, 3.1);
            lightSource.position.x = (i - mazeWidth / 2) + (offsetX * mazeWidth);
            lightSource.position.y = 0.85;
            lightSource.position.z = (j - mazeHeight / 2) + (offsetZ * mazeHeight);
            // add identifier to lightsource so we can delete it later
            lightSource.identifier = `${offsetX},${offsetZ}`
            scene.add(lightSource);
        }
    }
}

createLights(0,0);
createLightSources(0,0);

let mixer;

function deleteLightsExceptOffset(offsetX, offsetZ) {
    for (var i = scene.children.length - 1; i >= 0; i--) {
        if (scene.children[i].type === "PointLight") {
            if (scene.children[i].identifier != `${offsetX},${offsetZ}`) {
                scene.remove(scene.children[i]);
            }
        }
    }
}

function deleteLights() {
    for (var i = scene.children.length - 1; i >= 0; i--) {
        if (scene.children[i].type === "PointLight") {
            scene.remove(scene.children[i]);
        }
    }
}

// set position for moving camera 
controls.getObject().position.x = (mazeWidth / 2) - 0.00001;
controls.getObject().position.y = 0.5;
controls.getObject().position.z = 0;

// keystate for w is true
keyState.KeyW = true;
acceleration = 0.001;

update();

function activateKonamiCode() {
    popupMessage("Konami Code activated!")
    
}

function popupMessage(message) {
    if (!currentMessage)
    {
        currentMessage = "";
    }
    if (message === currentMessage || messageQueue.includes(message)) {
        return;
    }

    messageQueue.push(message);

    if (!isShowingMessage) {
        showNextMessage();
    }
}

function showNextMessage() {
    if (messageQueue.length > 0) {
        // hide the current message
        popup.classList.remove("show");
        popup.classList.add("hide");
        // var nextMessage = messageQueue.shift();
        // showMessage(nextMessage);
        // wait a second for tran  sition
        setTimeout(function () {
            var nextMessage = messageQueue.shift();
            showMessage(nextMessage);
        }, 550);
    }
}

function showMessage(message) {
    isShowingMessage = true;
    popup.innerHTML = message;
    currentMessage = message;
    popup.classList.add("show");
    popup.classList.remove("hide"); // Remove the 'hide' class if it was added

    if (timeout !== undefined) {
        clearTimeout(timeout);
    }

    timeout = setTimeout(function () {
        popup.classList.remove("show");
        popup.classList.add("hide");
        currentMessage = "";
        isShowingMessage = false;
        showNextMessage(); // Show the next message in the queue
    }, 2500);
}

lightsEnabled = false;
        guicontrols.dynamiclights = false;
        deleteLights();
        ceilingMaterial.color.setHex(0x777777);
        ambientLight.intensity = 0.7;
        popupMessage("Dynamic lights have been automatically disabled. \n Press \"2\" or \"G\" to re-enable them.")
        dynamicLightsPopup = true;
    performanceOverride = true;