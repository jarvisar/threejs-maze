import GUI from "https://cdn.skypack.dev/lil-gui@0.18.0";
import { MathUtils, Clock } from "https://cdn.skypack.dev/three@0.149.0";
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/controls/OrbitControls'
import { PointerLockControls } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/controls/PointerLockControls'
import { DragControls } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/controls/DragControls'
import * as THREE from "https://cdn.skypack.dev/three@0.149.0";
import  { Perlin, FBM } from "https://cdn.skypack.dev/three-noise@1.1.2";
import * as CANNON from 'https://cdn.skypack.dev/cannon-es';
import { GLTFLoader } from 'https://cdn.skypack.dev/three@0.149.0/examples/jsm/loaders/GLTFLoader'
import { FlyControls } from "./FlyControls.js";


// create a scene and camera and renderer and add them to the DOM with threejs and cannon
var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
var renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const canvas = document.querySelector('.webgl')

// create a cannon world
var world = new CANNON.World();
world.gravity.set(0, -9.82 * 20, 0);
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 10;

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

// Set up the ground plane to cast shadows
const phongMaterial = new THREE.MeshPhongMaterial()
const planeGeometry = new THREE.PlaneGeometry(mazeWidth + 10, mazeWidth + 10)
const planeMesh = new THREE.Mesh(planeGeometry, phongMaterial)
planeMesh.rotateX(-Math.PI / 2)
planeMesh.position.y = -1;
planeMesh.receiveShadow = true
scene.add(planeMesh)
const planeShape = new CANNON.Plane()
const planeBody = new CANNON.Body({ mass: 0 })
planeBody.addShape(planeShape)
planeBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
planeBody.position.y = -5;
world.addBody(planeBody)

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
        var wall = walls[Math.floor(Math.random() * walls.length)];
        var x = wall[0];
        var y = wall[1];
        var neighbors = [];
        if (x > 0 && !visited[x - 1][y]) {
            neighbors.push([x - 1, y]);
        }
        if (x < width - 1 && !visited[x + 1][y]) {
            neighbors.push([x + 1, y]);
        }
        if (y > 0 && !visited[x][y - 1]) {
            neighbors.push([x, y - 1]);
        }
        if (y < height - 1 && !visited[x][y + 1]) {
            neighbors.push([x, y + 1]);
        }
        if (neighbors.length > 0) {
            var neighbor = neighbors[Math.floor(Math.random() * neighbors.length)];
            visited[neighbor[0]][neighbor[1]] = true;
            walls.push(neighbor);
            if (neighbor[0] == x - 1) {
                maze[x - 1][y] = 1;
            } else if (neighbor[0] == x + 1) {
                maze[x][y] = 1;
            } else if (neighbor[1] == y - 1) {
                maze[x][y - 1] = 1;
            } else if (neighbor[1] == y + 1) {
                maze[x][y] = 1;
            }
        } else {
            walls.splice(walls.indexOf(wall), 1);
        }
    }

    return maze;
}

// generate maze
var maze = generateMaze(mazeWidth, mazeHeight);

// create a box to represent a wall for each cell in the maze
for (var i = 0; i < mazeWidth; i++) {
    for (var j = 0; j < mazeHeight; j++) {
        if (maze[i][j] == 0) {
            const wallGeometry = new THREE.BoxGeometry(1, 1, 1);
            const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x0000ff });
            const wall = new THREE.Mesh(wallGeometry, wallMaterial);
            // put in middle, so go from - to +, not 0 to +.
            if (i - mazeWidth / 2 != 0) {
                wall.position.x = i - mazeWidth / 2;
            }
            if (j - mazeHeight / 2 != 0) {
                wall.position.z = j - mazeHeight / 2;
            }
            wall.position.y = 0.1;
            // shadow
            wall.castShadow = true;
            scene.add(wall);
        }
    }
}

// use cannon physics to check for collisions
var world = new CANNON.World();
world.gravity.set(0, -9.82, 0);
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 10

var playerShape = new CANNON.Sphere(0.4);
var playerBody = new CANNON.Body({ mass: 1 });
playerBody.addShape(playerShape);
playerBody.position.set(0, 0.01, 0);
world.addBody(playerBody);

// Create a Three.js sphere mesh
var sphereGeometry = new THREE.SphereGeometry(0.4, 32, 32);
var sphereMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
// shadow
sphereMaterial.castShadow = true;
sphereMaterial.receiveShadow = true;
var sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);

// Set the position of the mesh to match the Cannon.js body
sphereMesh.position.copy(playerBody.position);

// Add the mesh to the scene
scene.add(sphereMesh);

// move player using WASD
var moveForward = false;
var moveBackward = false;
var moveLeft = false;
var moveRight = false;
var canJump = false;

var prevTime = performance.now();
var velocity = new THREE.Vector3();

function onKeyDown(event) {
    switch (event.keyCode) {
        case 38: // up
        case 87: // w
            moveForward = true;
            break;
        case 37: // left
        case 65: // a
            moveLeft = true;
            break;
        case 40: // down
        case 83: // s
            moveBackward = true;
            break;
        case 39: // right
        case 68: // d
            moveRight = true;
            break;
        case 32: // space  
            if (canJump === true) velocity.y += 350;
            canJump = false;
            break;
    }
}

function onKeyUp(event) {
    switch (event.keyCode) {
        case 38: // up
        case 87: // w
            moveForward = false;
            break;
        case 37: // left
        case 65: // a
            moveLeft = false;
            break;
        case 40: // down
        case 83: // s
            moveBackward = false;
            break;
        case 39: // right
        case 68: // d
            moveRight = false;
            break;
    }
}

function updatePlayer() {
    var time = performance.now();
    var delta = (time - prevTime) / 1000;

    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;
    velocity.y -= 9.8 * 100.0 * delta; // 100.0 = mass

    if (moveForward) velocity.z -= 400.0 * delta;
    if (moveBackward) velocity.z += 400.0 * delta;
    if (moveLeft) velocity.x -= 400.0 * delta;
    if (moveRight) velocity.x += 400.0 * delta;

    playerBody.velocity.set(velocity.x, velocity.y, velocity.z);

    if (playerBody.position.y < 0) {
        velocity.y = 0;
        playerBody.position.y = 0;
        canJump = true;
    }
}

document.addEventListener('keydown', onKeyDown, false);
document.addEventListener('keyup', onKeyUp, false);

// update physics
function updatePhysics() {
    // Step the physics world
    world.step(1 / 60);

    // Copy coordinates from Cannon.js to Three.js
    sphereMesh.position.copy(playerBody.position);
    sphereMesh.quaternion.copy(playerBody.quaternion);
}

// move camera back away from very center of payer
camera.position.set(5, 5, 5);

// update loop
function update() {
    var time = performance.now();
    controls.target.set(playerBody.position.x, playerBody.position.y, playerBody.position.z);
    updatePhysics();
    updatePlayer();
    renderer.render(scene, camera);

    requestAnimationFrame(update);

    prevTime = time;
}

// orbit controls
var controls = new OrbitControls(camera, canvas);
controls.update();

// create a box to represent a wall for each cell in the maze
for (var i = 0; i < mazeWidth; i++) {
    for (var j = 0; j < mazeHeight; j++) {
        if (maze[i][j] == 0) {
            var wallShape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));
            var wallBody = new CANNON.Body({ mass: 0 });
            wallBody.addShape(wallShape);
            wallBody.position.set(i, 0.5, j);
            world.addBody(wallBody);
        }
    }
}

// ambient light
var ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

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