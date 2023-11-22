import GUI from "https://cdn.skypack.dev/lil-gui@0.18.0";
import { MathUtils, Clock } from "https://cdn.skypack.dev/three@0.149.0";
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/controls/OrbitControls'
import { DragControls } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/controls/DragControls'
import * as THREE from "https://cdn.skypack.dev/three@0.149.0";
import  { Perlin, FBM } from "https://cdn.skypack.dev/three-noise@1.1.2";
import * as CANNON from 'https://cdn.skypack.dev/cannon-es';
import { GLTFLoader } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/loaders/GLTFLoader'
import { FlyControls } from "./FlyControls.js";
import { PointerLockControls } from "./PointerLockControls.js";


// create a scene and camera and renderer and add them to the DOM with threejs and cannon
var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 30);
var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
// make it lag less
renderer.setPixelRatio(window.devicePixelRatio);

renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const textureLoader = new THREE.TextureLoader();

const canvas = document.querySelector('.webgl')

// create a light and add it to the scene up top and add a shadow to the renderer
const light = new THREE.DirectionalLight(0xfeffd9, 0.9);
light.position.set(0, 10, 0);
light.castShadow = true;
light.shadow.mapSize.width = 1024;
light.shadow.mapSize.height = 1024;
light.shadow.camera.near = 0.5;
light.shadow.camera.far = 500;
scene.add(light);

var mazeWidth = 20;
var mazeHeight = 20;

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

// generate maze
var maze = generateMaze(mazeWidth, mazeHeight);

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

var wallSize = 1;
// create a box to represent a wall for each cell in the maze
for (var i = 0; i < mazeWidth; i++) {
    for (var j = 0; j < mazeHeight; j++) {
        if (maze[i][j] == 0) {
            const wallGeometry = new THREE.BoxGeometry(wallSize, wallSize, wallSize);
            const wallMaterial = new THREE.MeshPhongMaterial({ map: wallTexture });
            const wall = new THREE.Mesh(wallGeometry, wallMaterial);
            // put in middle, so go from - to +, not 0 to +.
            if (i - mazeWidth / 2 != 0) {
                wall.position.x = i - mazeWidth / 2;
            }
            if (j - mazeHeight / 2 != 0) {
                wall.position.z = j - mazeHeight / 2;
            }
            wall.position.y = wallSize / 2;
            wall.castShadow = true;
            wall.receiveShadow = true;
            const baseboardGeometry = new THREE.BoxGeometry(wallSize + 0.01, 0.065, wallSize + 0.01);
            const baseboardMaterial = new THREE.MeshPhongMaterial({ map: wallTexture });
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
            scene.add(wall);
        }
    }
}




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

// if escape is pressed, unlock pointer lock controls and show #startButton and #menuPanel
document.addEventListener(
    'keydown',
    function (event) {
        console.log(event.code)
        if (event.code === 'Escape') {
            
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

controls.getObject().position.y = 0.5;

// velocity for player
const velocity = new THREE.Vector3();
const acceleration = 0.007;
const damping = 0.9;

// Key state to track whether a key is currently pressed
const keyState = {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    Space: false,
    ShiftLeft: false,
};

document.addEventListener('keydown', function (event) {
    keyState[event.code] = true;
});

document.addEventListener('keyup', function (event) {
    // print x and y of camera
    console.log(controls.getObject().position.x)
    console.log(controls.getObject().position.z)
    keyState[event.code] = false;
});
console.log(controls.getObject().position.z)
// update loop
function update() {

    if (keyState.KeyW) {
        velocity.z += acceleration;
    }
    if (keyState.KeyA) {
        velocity.x -= acceleration;
    }
    if (keyState.KeyS) {
        velocity.z -= acceleration;
    }
    if (keyState.KeyD) {
        velocity.x += acceleration;
    }
    if (keyState.Space) {
        velocity.y += acceleration;
    }
    if (keyState.ShiftLeft) {
        velocity.y -= acceleration;
    }

    // Apply damping to gradually slow down the velocity (friction)
    velocity.multiplyScalar(damping);

    controls.moveForward(velocity.z);
    controls.moveRight(velocity.x);
    controls.moveUp(velocity.y);

    renderer.render(scene, camera);

    requestAnimationFrame(update);
}

// ambient light
var ambientLight = new THREE.AmbientLight(0xffe0e0, 0.4);
scene.add(ambientLight);

// FLOOR
const floorTexture = textureLoader.load('./public/floor.png', function (texture) {
    // Enable mipmapping for the texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Add random offsets to the texture coordinates
    texture.offset.set(Math.random(), Math.random());
    texture.repeat.set(200, 175);
});

const heightTexture = textureLoader.load('./public/heightmap.png', function (texture) {
    // Enable mipmapping for the heightmap texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Add random offsets to the texture coordinates
    texture.offset.set(Math.random(), Math.random());
    texture.repeat.set(200, 175);
});

const phongMaterial = new THREE.MeshPhongMaterial({ map: floorTexture, bumpMap: heightTexture, bumpScale: 5.5 });
const planeGeometry = new THREE.PlaneGeometry(mazeWidth, mazeWidth)
const planeMesh = new THREE.Mesh(planeGeometry, phongMaterial)
planeMesh.rotateX(-Math.PI / 2)
planeMesh.position.y = 0;
planeMesh.receiveShadow = true;
// make it look like carpet. no shiny, just flat
planeMesh.material.flatShading = true;
scene.add(planeMesh)

// CEILING
const ceilingTexture = textureLoader.load('./public/ceiling_tile.jpg', function (texture) {
    // Enable mipmapping for the texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(350, 350);
});
const ceilingHeightTexture = textureLoader.load('./public/ceiling_tile_heightmap.jpg', function (texture) {
    // Enable mipmapping for the heightmap texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(350, 350);
});
const ceilingMaterial = new THREE.MeshPhongMaterial({ map: ceilingTexture, bumpMap: ceilingHeightTexture, bumpScale: 0.05 });
const ceilingGeometry = new THREE.PlaneGeometry(mazeWidth, mazeWidth)
const ceilingMesh = new THREE.Mesh(ceilingGeometry, ceilingMaterial)
ceilingMesh.rotateX(Math.PI / 2)
// same height as the cubes
ceilingMesh.position.y = 1;
scene.add(ceilingMesh)

for (var i = 0; i < mazeWidth; i = i + 2) {
    for (var j = 0; j < mazeHeight; j = j + 2) {
        if (maze[i][j] == 1) {
            const lightGeometry = new THREE.BoxGeometry(0.15, 0.01, 0.15);
            const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xfeffe8 });
            const light = new THREE.Mesh(lightGeometry, lightMaterial);
            light.position.x = i - mazeWidth / 2;
            light.position.y = 0.99;
            light.position.z = j - mazeHeight / 2;
            // thin black outline around light, 0.01 on each side. ADD TO LIGHT.
            const outlineGeometry = new THREE.BoxGeometry(0.17, 0.01, 0.17);
            const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });
            const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
            outline.position.x = i - mazeWidth / 2;
            outline.position.y = 0.999;
            outline.position.z = j - mazeHeight / 2;
            const lightSource = new THREE.PointLight(0xfeffe8, 1, 1);
            lightSource.position.x = i - mazeWidth / 2;
            lightSource.position.y = 0.99;
            lightSource.position.z = j - mazeHeight / 2;
            scene.add(lightSource);
            scene.add(outline);
            scene.add(light);
        }
    }
}

update();

// konami code listener. If entered, open ./tetris.html
var konamiCode = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65]; 
var konamiCodePosition = 0;
document.addEventListener('keydown', function(e) {
    var key = parseInt(e.keyCode || e.which);
    if (key == konamiCode[konamiCodePosition]) {
        konamiCodePosition++;
        if (konamiCodePosition == konamiCode.length) {
            window.location = './tetris.html';
        }
    } else {
        konamiCodePosition = 0;
    }
});

// on window resize, update camera and renderer
window.addEventListener('resize', function() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});