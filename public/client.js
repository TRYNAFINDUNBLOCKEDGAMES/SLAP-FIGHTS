const socket = io();

// Core Three.js Setup Variables
let scene, camera, renderer;
let localPlayerId;
let playersData = {};
let playerMeshes = {};
let wallMeshes = {};
let bulletMeshes = {};
let matchState = "LOBBY";
let handRegistry = {};

// Camera Control Parameters
let cameraAngleY = 0; // Rotates around character
let cameraAngleX = 0.3; // Look down angle
let cameraZoom = 12;
const MIN_ZOOM = 4, MAX_ZOOM = 25;

// Local Input Tracking
let keys = { w: false, a: false, s: false, d: false, space: false, arrowleft: false, arrowright: false, arrowup: false, arrowdown: false };
let isTyping = false;
let diverTacticalMode = false;

// Physics Baseline Constants
let yVelocity = 0;
const GRAVITY = -0.015;
let isGrounded = true;

// Initialize Game Window
init3DWorld();
animateLoop();
setupNetworkEvents();
setupInputListeners();

function init3DWorld() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    // Dynamic Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 40, 20);
    scene.add(dirLight);

    // Build the Arena Island Floor (Radius 50)
    const islandGeo = new THREE.CylinderGeometry(50, 48, 4, 32);
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x3a5f3a, roughness: 0.8 });
    const island = new THREE.Mesh(islandGeo, islandMat);
    island.position.y = -2; // Push down slightly so top surface sits at Y = 0
    scene.add(island);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// Custom Mesh Constructor Framework (Separates Body, Arm, and Glove cleanly)
function createPlayerCharacterMesh(gloveName) {
    const group = new THREE.Group();

    // 1. The Torso/Body
    const bodyGeo = new THREE.CapsuleGeometry(0.6, 1.2, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3366cc });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.9;
    group.add(body);

    // 2. The Shoulder Anchor Pivot (CRITICAL: Sets transformations to extend from shoulder socket)
    const shoulderPivot = new THREE.Group();
    shoulderPivot.position.set(0.8, 1.1, 0); // Position relative to torso right side
    
    // The Arm Mesh itself
    const armGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.5, 8);
    armGeo.translate(0, -0.75, 0); // Shifts interior geometry so its top pivot rests on the shoulder origin point
    const armMat = new THREE.MeshStandardMaterial({ color: 0x3366cc });
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.rotation.x = -Math.PI / 2; // Arm points forward straight ahead default
    shoulderPivot.add(arm);

    // 3. The Glove Mesh
    const gloveGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const gloveMat = new THREE.MeshStandardMaterial({ color: getGloveColorHex(gloveName) });
    const glove = new THREE.Mesh(gloveGeo, gloveMat);
    glove.position.set(0, -1.6, 0); // Positioned directly at the tip of the arm mesh
    arm.add(glove); // Parented directly to arm so scaling shifts its depth perfectly

    group.add(shoulderPivot);
    
    // Save structural internal links inside the group wrapper object for easy animation reference updates
    group.userData = { arm: arm, glove: glove, shoulder: shoulderPivot };
    return group;
}

function getGloveColorHex(name) {
    const colors = { Speedy: 0x00ffcc, Jumper: 0xffcc00, Extended: 0xff00ff, Diver: 0x33cc33, Builder: 0xff6600, Sniper: 0xcc0000 };
    return colors[name] || 0xffffff;
}

// UI Updating Engine
function updateHUD() {
    const lp = playersData[localPlayerId];
    if (lp) {
        document.getElementById('hud-glove-name').innerText = lp.equippedGlove;
        document.getElementById('hud-currency').innerText = lp.currency || 0;
        
        // Account authentication check mock layout toggles
        if (lp.isAdmin) {
            document.getElementById('admin-panel').style.display = 'block';
        }
    }
}

// Continuous Render Engine & Local Physics Tickers
function animateLoop() {
    requestAnimationFrame(animateLoop);

    processLocalMovement();
    updateCameraPosition();

    renderer.render(scene, camera);
}

function processLocalMovement() {
    const lp = playersData[localPlayerId];
    const mesh = playerMeshes[localPlayerId];
    if (!lp || !mesh || !lp.isAlive || isTyping || diverTacticalMode) return;

    let config = handRegistry[lp.equippedGlove] || { speedMultiplier: 1.0, jumpMultiplier: 1.0 };
    let baseSpeed = 0.15 * config.speedMultiplier;

    // Movement Angle Vector Math aligned relative to Camera View Angles
    let forwardX = Math.sin(cameraAngleY);
    let forwardZ = Math.cos(cameraAngleY);
    let sideX = Math.sin(cameraAngleY + Math.PI / 2);
    let sideZ = Math.cos(cameraAngleY + Math.PI / 2);

    let moveX = 0;
    let moveZ = 0;

    if (keys.w) { moveX += forwardX; moveZ += forwardZ; }
    if (keys.s) { moveX -= forwardX; moveZ -= forwardZ; }
    if (keys.a) { moveX += sideX; moveZ += sideZ; }
    if (keys.d) { moveX -= sideX; moveZ -= sideZ; }

    // Normalize movement vectors
    if (moveX !== 0 || moveZ !== 0) {
        let length = Math.sqrt(moveX * moveX + moveZ * moveZ);
        mesh.position.x += (moveX / length) * baseSpeed;
        mesh.position.z += (moveZ / length) * baseSpeed;
        
        // Orient local mesh direction to match direction of walking vector angles
        mesh.rotation.y = Math.atan2(moveX, moveZ);
    }

    // Local Jumping Physics & Basic Step-Up Climbs
    yVelocity += GRAVITY;
    mesh.position.y += yVelocity;

    isGrounded = false;
    let groundHeight = 0;

    // Raycast/Box checks against every active wall object for climbing mechanics
    Object.values(wallMeshes).forEach(wMesh => {
        let dx = Math.abs(mesh.position.x - wMesh.position.x);
        let dz = Math.abs(mesh.position.z - wMesh.position.z);
        // Checking if standing layout matches bounding grid box dimensions
        if (dx < 2.2 && dz < 2.2) {
            let topOfWall = wMesh.position.y + 4; // Walls are 4 units high
            if (mesh.position.y >= topOfWall - 0.5 && yVelocity <= 0) {
                groundHeight = topOfWall;
                isGrounded = true;
            }
        }
    });

    // Check primary map island ground floor baseline
    if (mesh.position.y <= groundHeight && Math.sqrt(mesh.position.x*mesh.position.x + mesh.position.z*mesh.position.z) <= 50) {
        mesh.position.y = groundHeight;
        yVelocity = 0;
        isGrounded = true;
    }

    if (keys.space && isGrounded) {
        let baseJumpPower = 0.35;
        yVelocity = baseJumpPower * config.jumpMultiplier;
        isGrounded = false;
    }

    // Send high-speed position state data up streams to server pipelines
    socket.emit('player_movement', { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, ry: mesh.rotation.y });
}

function updateCameraPosition() {
    const mesh = playerMeshes[localPlayerId];
    if (!mesh) return;

    // Option A Camera Sync Gate Control Logic: Diver Jump Sync Handler
    const lp = playersData[localPlayerId];
    if (diverTacticalMode || (lp && lp.isAlive && lp.equippedGlove === "Diver" && mesh.position.y > 25)) {
        // Force immediate overhead flat birds-eye perspective viewport angles
        camera.position.set(mesh.position.x, mesh.position.y + 35, mesh.position.z);
        camera.lookAt(mesh.position.x, mesh.position.y, mesh.position.z);
        return;
    }

    // Standard Third-Person Orbit Camera Controls
    if (!isTyping) {
        if (keys.arrowleft) cameraAngleY += 0.04;
        if (keys.arrowright) cameraAngleY -= 0.04;
        if (keys.arrowup) cameraAngleX = Math.min(Math.PI/2 - 0.1, cameraAngleX + 0.03);
        if (keys.arrowdown) cameraAngleX = Math.max(-0.2, cameraAngleX - 0.03);
    }

    let targetX = mesh.position.x - Math.sin(cameraAngleY) * Math.cos(cameraAngleX) * cameraZoom;
    let targetY = mesh.position.y + Math.sin(cameraAngleX) * cameraZoom + 1.5;
    let targetZ = mesh.position.z - Math.cos(cameraAngleY) * Math.cos(cameraAngleX) * cameraZoom;

    camera.position.set(targetX, targetY, targetZ);
    camera.lookAt(mesh.position.x, mesh.position.y + 1, mesh.position.z);
}

// Network Packets IO Event Streams
function setupNetworkEvents() {
    socket.on('init', (data) => {
        localPlayerId = data.id;
        playersData = data.players;
        matchState = data.matchState;
        handRegistry = data.hands;

        // Populate baseline scene maps
        Object.keys(playersData).forEach(id => {
            const p = playersData[id];
            const m = createPlayerCharacterMesh(p.equippedGlove);
            m.position.set(p.x, p.y, p.z);
            scene.add(m);
            playerMeshes[id] = m;
        });

        data.walls.forEach(w => spawnWallLocal(w));
        updateHUD();
    });

    socket.on('player_moved', (data) => {
        if (data.id === localPlayerId) return; // Local prediction bypass updates
        const m = playerMeshes[data.id];
        if (m) {
            m.position.set(data.x, data.y, data.z);
            m.rotation.y = data.ry;
        }
    });

    socket.on('slap_animated', (data) => {
        const m = playerMeshes[data.id];
        const p = playersData[data.id];
        if (m && p) {
            let arm = m.userData.arm;
            let timeline = 0;
            // Linear arm expansion scaling interpolation logic
            let animInterval = setInterval(() => {
                timeline += 0.1;
                if (timeline <= 0.5) {
                    if (p.equippedGlove === "Extended") arm.scale.y = 1.0 + (timeline * 6); // Stretch arm length
                    else arm.rotation.x = -Math.PI / 2 - (timeline * 2);
                } else if (timeline <= 1.0) {
                    if (p.equippedGlove === "Extended") arm.scale.y = Math.max(1.0, 4.0 - ((timeline - 0.5) * 6));
                    else arm.rotation.x = Math.min(-Math.PI / 2, -Math.PI / 2 - 1.0 + ((timeline - 0.5) * 2));
                } else {
                    clearInterval(animInterval);
                    arm.scale.set(1, 1, 1);
                    arm.rotation.set(-Math.PI / 2, 0, 0);
                }
            }, 30);
        }
    });

    socket.on('player_hit', (data) => {
        if (data.targetId === localPlayerId) {
            // Apply impact velocity corrections
            yVelocity = data.chaotic ? Math.random() * 2.0 + 0.5 : 0.2;
            let speed = data.power * 0.05;
            let intervalCount = 0;
            
            let pushInterval = setInterval(() => {
                const m = playerMeshes[localPlayerId];
                if (!m || intervalCount++ > 15) return clearInterval(pushInterval);
                m.position.x += Math.sin(data.angle) * speed * (1 - intervalCount/15);
                m.position.z += Math.cos(data.angle) * speed * (1 - intervalCount/15);
            }, 20);
        }
    });

    socket.on('wall_spawned', (w) => spawnWallLocal(w));

    socket.on('wall_destroyed', (wId) => {
        if (wallMeshes[wId]) {
            scene.remove(wallMeshes[wId]);
            delete wallMeshes[wId];
        }
    });

    socket.on('bullet_spawned', (b) => {
        const geo = new THREE.SphereGeometry(0.25, 8, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(b.x, b.y, b.z);
        scene.add(mesh);
        bulletMeshes[b.id] = mesh;
    });

    socket.on('bullet_moved', (b) => {
        if (bulletMeshes[b.id]) bulletMeshes[b.id].position.set(b.x, bulletMeshes[b.id].position.y, b.z);
    });

    socket.on('bullet_destroyed', (bId) => {
        if (bulletMeshes[bId]) {
            scene.remove(bulletMeshes[bId]);
            delete bulletMeshes[bId];
        }
    });

    socket.on('diver_launched', (id) => {
        if (id === localPlayerId) diverTacticalMode = true;
        const m = playerMeshes[id];
        if (m) {
            yVelocity = 0.8; // High launch scale velocity mechanics
            isGrounded = false;
        }
    });

    socket.on('diver_landed', (data) => {
        if (data.id === localPlayerId) diverTacticalMode = false;
        const m = playerMeshes[data.id];
        if (m) m.position.set(data.coords.x, 0, data.coords.z);
    });

    socket.on('diver_timed_out', (id) => {
        if (id === localPlayerId) diverTacticalMode = false;
    });

    socket.on('match_started', (updatedPlayers) => {
        matchState = "MATCH";
        playersData = updatedPlayers;
        Object.keys(playerMeshes).forEach(id => {
            if (playersData[id]) playerMeshes[id].position.set(playersData[id].x, playersData[id].y, playersData[id].z);
        });
    });

    socket.on('match_ended', (data) => {
        matchState = "LOBBY";
        playersData = data.players;
        diverTacticalMode = false;
        Object.keys(wallMeshes).forEach(id => scene.remove(wallMeshes[id]));
        wallMeshes = {};
        updateHUD();
    });

    socket.on('chat_received', (data) => {
        const log = document.getElementById('chat-log');
        log.innerHTML += `<div><b>${data.username}:</b> ${data.message}</div>`;
        log.scrollTop = log.scrollHeight;
    });
}

function spawnWallLocal(w) {
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(4, 4, 0.8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, roughness: 0.9 });
    const mainWall = new THREE.Mesh(geo, mat);
    mainWall.position.y = 2; // Sits centered on bottom origin surface point
    group.add(mainWall);

    group.position.set(w.x, w.y, w.z);
    group.rotation.y = w.ry;
    scene.add(group);
    wallMeshes[w.id] = group;
}

// User Actions & Peripheral Hardware Listeners
function setupInputListeners() {
    window.addEventListener('keydown', (e) => {
        let key = e.key.toLowerCase();
        
        // Chat Box Toggling Gate Logic Handles Controls Lockout Instantly
        if (key === '/') {
            if (!isTyping) {
                e.preventDefault();
                isTyping = true;
                const input = document.getElementById('chat-input');
                input.style.display = 'block';
                input.focus();
            }
            return;
        }

        if (isTyping) {
            if (key === 'enter') {
                const input = document.getElementById('chat-input');
                if (input.value.trim() !== '') socket.emit('send_chat', input.value);
                input.value = '';
                input.style.display = 'none';
                isTyping = false;
            }
            return;
        }

        if (key === 'r') {
            const container = document.getElementById('chat-container');
            container.style.opacity = (container.style.opacity === '0') ? '1' : '0';
        }

        if (key === 'z') cameraZoom = Math.max(MIN_ZOOM, cameraZoom - 1);
        if (key === 'x') cameraZoom = Math.min(MAX_ZOOM, cameraZoom + 1);
        if (key === 'q') socket.emit('trigger_slap');
        if (key === 'e') {
            if (diverTacticalMode) return; // Requires cursor target clicks instead of key activations
            socket.emit('trigger_ability');
        }

        if (key === ' ') keys.space = true;
        if (['w','a','s','d','arrowleft','arrowright','arrowup','arrowdown'].includes(key)) keys[key] = true;
    });

    window.addEventListener('keyup', (e) => {
        let key = e.key.toLowerCase();
        if (key === ' ') keys.space = false;
        if (keys.hasOwnProperty(key)) keys[key] = false;
    });

    // Raycast Interaction clicks targeting dive coordinate systems
    window.addEventListener('click', (e) => {
        if (!diverTacticalMode) return;
        
        let mouse = new THREE.Vector2(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        
        let raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        
        // Mock dynamic baseline targeting coordinates projection math vector alignments
        let targetPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        let intersection = new THREE.Vector3();
        raycaster.ray.intersectPlane(targetPlane, intersection);

        socket.emit('diver_land', { x: intersection.x, z: intersection.z });
    });
}

// Abstract Action Proxy Interceptor Placeholder (Future Expansion Hook for Admin Panels)
function triggerAdminAction(type) {
    console.log(`Frontend dispatching admin action payload: ${type}`);
}
