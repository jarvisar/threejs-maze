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
var camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
var renderer = new THREE.WebGLRenderer({ antialias: true });
// renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const textureLoader = new THREE.TextureLoader();

const canvas = document.querySelector('.webgl')

// create a light and add it to the scene up top and add a shadow to the renderer
const light = new THREE.DirectionalLight(0xaaaaaa, 0.7);
light.position.set(0, 10, 10);
light.castShadow = true;
light.shadow.mapSize.width = 1024;
light.shadow.mapSize.height = 1024;
light.shadow.camera.near = 0.5;
light.shadow.camera.far = 500;
scene.add(light);

var mazeWidth = 100;
var mazeHeight = 100;

// prim's algorithm to generate a maze
function generateMaze(width, height) {
    var maze = new Array(width);
    for (var i = 0; i < width; i++) {
        maze[i] = new Array(height);
        for (var j = 0; j < height; j++) {
            maze[i][j] = 0;
        }
    }

    var visited = new Array(width);
    for (var i = 0; i < width; i++) {
        visited[i] = new Array(height);
        for (var j = 0; j < height; j++) {
            visited[i][j] = false;
        }
    }

    var walls = [];
    var start = [Math.floor(Math.random() * width), Math.floor(Math.random() * height)];
    visited[start[0]][start[1]] = true;
    walls.push(start);
    
    while (walls.length > 0) {
        // should be somewhat dense, but not too dense. 0.5 is a good number
        var randomIndex = Math.floor(Math.random() * walls.length);
        var randomWall = walls[randomIndex];
        var x = randomWall[0];
        var y = randomWall[1];
        var neighbors = [];

        if (x - 2 >= 0 && !visited[x - 2][y]) {
            neighbors.push([x - 2, y]);
        }
        if (x + 2 < width && !visited[x + 2][y]) {
            neighbors.push([x + 2, y]);
        }
        if (y - 2 >= 0 && !visited[x][y - 2]) {
            neighbors.push([x, y - 2]);
        }
        if (y + 2 < height && !visited[x][y + 2]) {
            neighbors.push([x, y + 2]);
        }

        if (neighbors.length > 0 && Math.random() < 0.5) {
            var randomNeighborIndex = Math.floor(Math.random() * neighbors.length);
            var randomNeighbor = neighbors[randomNeighborIndex];
            var nx = randomNeighbor[0];
            var ny = randomNeighbor[1];
            maze[(x + nx) / 2][(y + ny) / 2] = 1;
            visited[nx][ny] = true;
            walls.push([nx, ny]);
        } else {
            walls.splice(randomIndex, 1);
        }
        
        
    }

    return maze;
}
console.log()
// generate maze
var maze = generateMaze(mazeWidth, mazeHeight);
// print number of 0s and 1s
var numZeros = 0;
var numOnes = 0;
for (var i = 0; i < mazeWidth; i++) {
    for (var j = 0; j < mazeHeight; j++) {
        if (maze[i][j] == 1) {
            numZeros++;
        } else {
            numOnes++;
        }
    }
}
console.log("Blanks: " + numZeros);
console.log("Walls: " + numOnes);

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
            scene.add(wall);
        }
    }
}

// need to add basebaords, should be a thin rectangle that clips into the bottom of every cube/cell/wall. make it 0.05 high but add 0.05 to the x and y scale so it sticks out 0.05 on each side
for (var i = 0; i < mazeWidth; i++) {
    for (var j = 0; j < mazeHeight; j++) {
        if (maze[i][j] == 0) {
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
            baseboard.position.y = 0;
            baseboard.castShadow = true;
            scene.add(baseboard);
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

const velocity = new THREE.Vector3(); // Assuming you are using Three.js for 3D graphics
const acceleration = 0.1; // You can adjust this value to control the acceleration

const onKeyDown = function (event) {
    switch (event.code) {
        case "KeyW":
            velocity.z += acceleration;
            break;
        case "KeyA":
            velocity.x -= acceleration;
            break;
        case "KeyS":
            velocity.z -= acceleration;
            break;
        case "KeyD":
            velocity.x += acceleration;
            break;
        case "Space":
            velocity.y += acceleration;
            break;
        case "ShiftLeft":
            velocity.y -= acceleration;
            break;
    }
};
document.addEventListener('keydown', onKeyDown, false);


// move camera back away from very center of payer
camera.position.set(5, 0.5, 5);
// update loop
function update() {

    controls.moveForward(velocity.z);
    controls.moveRight(velocity.x);
    controls.moveUp(velocity.y);

    // Damping to gradually slow down the velocity (friction)
    velocity.multiplyScalar(0.9);

    renderer.render(scene, camera);

    requestAnimationFrame(update);
}


// ambient light
var ambientLight = new THREE.AmbientLight(0xffe0e0, 0.5);
scene.add(ambientLight);
const floorTexture = textureLoader.load('./public/floor.png', function (texture) {
    // Enable mipmapping for the texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Add random offsets to the texture coordinates
    texture.offset.set(Math.random(), Math.random());
    texture.repeat.set(150, 150);
});




const heightTexture = textureLoader.load('./public/heightmap.png', function (texture) {
    // Enable mipmapping for the heightmap texture
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Add random offsets to the texture coordinates
    texture.offset.set(Math.random(), Math.random());
    texture.repeat.set(150, 150);
});

const phongMaterial = new THREE.MeshPhongMaterial({ map: floorTexture, bumpMap: heightTexture, bumpScale: 5.5 });
const planeGeometry = new THREE.PlaneGeometry(mazeWidth + 10, mazeWidth + 10)
const planeMesh = new THREE.Mesh(planeGeometry, phongMaterial)
planeMesh.rotateX(-Math.PI / 2)
planeMesh.position.y = 0;
planeMesh.receiveShadow = true;
scene.add(planeMesh)

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
const ceilingGeometry = new THREE.PlaneGeometry(mazeWidth + 10, mazeWidth + 10)
const ceilingMesh = new THREE.Mesh(ceilingGeometry, ceilingMaterial)
ceilingMesh.rotateX(Math.PI / 2)
// same height as the cubes
ceilingMesh.position.y = 1;
ceilingMesh.receiveShadow = true
ceilingMesh.castShadow = true
scene.add(ceilingMesh)

// for (var i = 0; i < mazeWidth; i = i + 2) {
//     for (var j = 0; j < mazeHeight; j = j + 2) {
//         if (maze[i][j] == 1) {
//             const lightGeometry = new THREE.BoxGeometry(0.15, 0.01, 0.15);
//             const lightMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
//             const light = new THREE.Mesh(lightGeometry, lightMaterial);
//             light.position.x = i - mazeWidth / 2;
//             light.position.y = 0.99;
//             light.position.z = j - mazeHeight / 2;
//             light.castShadow = true;
//             scene.add(light);
//         }
//     }
// }

// same as above but make it match the ceiling tiling perfectly
for (var i = 0; i < mazeWidth; i = i + 2) {
    for (var j = 0; j < mazeHeight; j = j + 2) {
        if (maze[i][j] == 1) {
            const lightGeometry = new THREE.BoxGeometry(0.15, 0.01, 0.15);
            const lightMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
            const light = new THREE.Mesh(lightGeometry, lightMaterial);
            light.position.x = i - mazeWidth / 2;
            light.position.y = 0.99;
            light.position.z = j - mazeHeight / 2;
            light.castShadow = true;
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