import GUI from "https://cdn.skypack.dev/lil-gui@0.18.0";
import * as THREE from "https://cdn.skypack.dev/three@0.149.0";
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/controls/OrbitControls';
import { DragControls } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/controls/DragControls';
import { Perlin, FBM } from "https://cdn.skypack.dev/three-noise@1.1.2";
import * as CANNON from 'https://cdn.skypack.dev/cannon-es';
import { ColladaLoader } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/loaders/ColladaLoader';
import { FlyControls } from "./FlyControls.js";
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

var mazeWidth = 10;
var mazeHeight = mazeWidth;

var secretEnabled = false;

// show loading spinner element with id loading-spinner
const loadingSpinner = document.getElementById('loading-spinner');
loadingSpinner.style.display = 'none';

// create a scene and camera and renderer and add them to the DOM with threejs and cannon
var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, mazeHeight + 1);
var renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

renderer.setPixelRatio(window.devicePixelRatio * 0.55);

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

vignettePass.uniforms.offset.value = 0.7;
vignettePass.uniforms.darkness.value = 1.0;

// Add the render passes to their respective composers
composer.addPass(renderPass1);
composer.addPass(staticPass);
composer.addPass(RGBShiftShaderPass);
composer.addPass(filmPass);
composer.addPass(BadTVShaderPass);
composer.addPass(vignettePass);

let acceleration = 0.002;
let tolerance = mazeWidth;
var lightsEnabled = true;

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
const guicontrols = {
    enabled: true,
    pixelratio: 55,
    movementspeed: 1,
    generationdistance: mazeWidth,
    dynamiclights: true
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
    offset: 0.7,
    darkness: 1.0
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
        ambientLight.intensity = 0.05;
    } else {
        deleteLights();
        ambientLight.intensity = 0.7;
    }
}).name("Dynamic Lights").listen();

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
    },
    false
)

controls.addEventListener('lock', function () {
    startButton.style.display = 'none'
    menuPanel.style.display = 'none'
})

controls.addEventListener('unlock', function () {
    startButton.style.display = 'block'
    menuPanel.style.display = 'block'
})

// event listener for konami code
var input = '';
var key = '38384040373937396665'; // konami code, up up down down left right left right b a


// if escape is pressed, unlock pointer lock controls and show #startButton and #menuPanel
document.addEventListener(
    'keydown',
    function (e) {
        input += '' + e.keyCode;
        if (input === key) {
            input = '';
            if (secretEnabled)
                return
            activateKonamiCode();
        }
        if (!key.indexOf(input)) return;
        input = '' + e.keyCode;
        if (e.code === 'Escape') {
            
            // show #startButton and #menuPanel
            startButton.style.display = 'block'
            menuPanel.style.display = 'block'
        }
    },
    false
)

// if lose focus of canvas, unlock pointer lock controls and show #startButton and #menuPanel. listen for blur
window.addEventListener(
    'blur',
    function () {
        controls.unlock()
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
    keyState[event.code] = true;
});

var offsetX = 0;
var offsetZ = 0;
var visitedOffsets = [[0,0]];
document.addEventListener('keyup', function (event) {
    keyState[event.code] = false;
});

// add fps copunter
const stats = new Stats();
document.body.appendChild(stats.dom);


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

const wallTexture = textureLoader.load('./public/wallpaper.png', function (texture) {
    // Enable mipmapping for the texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Add random offsets to the texture coordinates
    texture.offset.set(Math.random(), Math.random());
    texture.repeat.set(1, 1);
});
const baseboardTexture = textureLoader.load('./public/baseboard.jpg', function (texture) {
    // Enable mipmapping for the texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    // performance increase
    texture.anisotropy = 16;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    texture.repeat.set(10, 10);
});

const wallGeometry = new THREE.BoxGeometry(wallSize, wallSize, wallSize);
const wallMaterial = new THREE.MeshPhongMaterial({ map: wallTexture });
const baseboardGeometry = new THREE.BoxGeometry(wallSize + 0.01, 0.065, wallSize + 0.01);
const baseboardMaterial = new THREE.MeshPhongMaterial({ map: baseboardTexture, reflectivity: 1 });

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
                wall.add(baseboard);
                wall.identifier = `${offsetX},${offsetZ},wall`
                if (offsetX == 0 && offsetZ == 0) {
                    if (i < ((mazeWidth / 2) - 1) || i > ((mazeWidth / 2) + 1) || j < ((mazeHeight / 2) - 1) || j > ((mazeHeight / 2) + 1)) {
                        scene.add(wall);
                    }
                } else {
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

let shaderTime = 0;
const halfMazeWidth = mazeWidth / 2;
const halfMazeHeight = mazeHeight / 2;

var lastTime = 0;
var maxFPS = 100;

let clock = new THREE.Clock();

function update() {
    var currentTime = performance.now();
    var deltaTime = currentTime - lastTime;

    // Limit frame rate
    if (deltaTime > 1000 / maxFPS) {
        stats.begin();

        if (keyState.KeyW) velocity.z += acceleration;
        if (keyState.KeyA) velocity.x -= acceleration;
        if (keyState.KeyS) velocity.z -= acceleration;
        if (keyState.KeyD) velocity.x += acceleration;
        if (keyState.KeyQ) velocity.y += acceleration;
        if (keyState.Space) velocity.y += acceleration;
        if (keyState.KeyE) velocity.y -= acceleration;
        if (keyState.ShiftLeft) velocity.z += acceleration * 1.5;

        // Apply damping to gradually slow down the velocity (friction)
        velocity.multiplyScalar(damping);

        // record old position
        var oldPosition = controls.getObject().position.clone();

        controls.moveForward(velocity.z);
        controls.moveRight(velocity.x);
        controls.moveUp(velocity.y);

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
    // Adjust the size of the collision box based on your character dimensions
    var boxSize = new THREE.Vector3(0.32, 1.0, 0.32);

    // Check for collision in the x, y, and z axes
    return (
        position.x + boxSize.x / 2 >= wall.position.x - wall.geometry.parameters.width / 2 &&
        position.x - boxSize.x / 2 <= wall.position.x + wall.geometry.parameters.width / 2 &&
        position.z + boxSize.z / 2 >= wall.position.z - wall.geometry.parameters.depth / 2 &&
        position.z - boxSize.z / 2 <= wall.position.z + wall.geometry.parameters.depth / 2 &&
        position.y + boxSize.y / 2 >= wall.position.y - wall.geometry.parameters.height / 2 &&
        position.y - boxSize.y / 2 <= wall.position.y + wall.geometry.parameters.height / 2
    );
}


// ambient light
var ambientLight = new THREE.AmbientLight(0xe8e4ca, 0.05);
scene.add(ambientLight);

// add fog relative to camera, should block far fulcrum
scene.fog = new THREE.FogExp2(0xe8e4d1, 0.17);

// change background color to white for threejs
renderer.setClearColor(0xe8e4d1);

// FLOOR
const floorTexture = textureLoader.load('./public/floor.png', function (texture) {
    // Enable mipmapping for the texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Add random offsets to the texture coordinates
    texture.offset.set(Math.random(), Math.random());
    texture.repeat.set(60, 60);
});

const heightTexture = textureLoader.load('./public/heightmap.png', function (texture) {
    // Enable mipmapping for the heightmap texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Add random offsets to the texture coordinates
    texture.offset.set(Math.random(), Math.random());
    texture.repeat.set(60, 60);
});

const floorMaterial = new THREE.MeshPhongMaterial({ color: 0xad825e, map: floorTexture, bumpMap: heightTexture, bumpScale: 12 });
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
    scene.add(floorMesh)
}

createFloor(0,0)

// CEILING
const ceilingTexture = textureLoader.load('./public/ceiling_tile.jpg', function (texture) {
    // Enable mipmapping for the texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(60, 30);
});
const ceilingHeightTexture = textureLoader.load('./public/ceiling_tile_heightmap.jpg', function (texture) {
    // Enable mipmapping for the heightmap texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(60, 30);
});
const ceilingMaterial = new THREE.MeshStandardMaterial({ map: ceilingTexture, bumpMap: ceilingHeightTexture, bumpScale: 0.0008 });
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
            const lightSource = new THREE.PointLight(0xfeffe8, 1, 4);
            lightSource.position.x = (i - mazeWidth / 2) + (offsetX * mazeWidth);
            lightSource.position.y = 0.9;
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

update();
handleOffsetChange(1,0);
handleOffsetChange(-1,0);
handleOffsetChange(0,1);
handleOffsetChange(0,-1);
handleOffsetChange(1,1);
handleOffsetChange(1,-1);
handleOffsetChange(-1,1);
handleOffsetChange(-1,-1);

function activateKonamiCode() {
    console.log("konami code activated!")
    const loader = new ColladaLoader();
    loader.load( './public/models/stormtrooper.dae', function ( collada ) {

        const avatar = collada.scene;
        const animations = avatar.animations;

        mixer = new THREE.AnimationMixer( avatar );
        mixer.clipAction( animations[ 0 ] ).play();

        // set scale
        avatar.scale.x = 0.1;
        avatar.scale.y = 0.1;
        avatar.scale.z = 0.1;

        scene.add( avatar );
        secretEnabled = true;
    });
}