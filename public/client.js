const socket = io();

let scene, camera, renderer;
let localPlayerId;
let playersData = {};
let playerMeshes = {};
let wallMeshes = {};
let bulletMeshes = {};
let matchState = "LOBBY";
let handRegistry = {};

let cameraAngleY = 0; 
let cameraAngleX = 0.3; 
let cameraZoom = 12;
const MIN_ZOOM = 4, MAX_ZOOM = 25;

let keys = { w: false, a: false, s: false, d: false, space: false, arrowleft: false, arrowright: false, arrowup: false, arrowdown: false };
let isTyping = false;
let diverTacticalMode = false;
let shiftLockActive = false;

let yVelocity = 0;
const GRAVITY = -0.015;
let isGrounded = true;

init3DWorld();
animateLoop();
setupNetworkEvents();
setupInputListeners();

function init3DWorld() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); 

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 40, 20);
    scene.add(dirLight);

    const islandGeo = new THREE.CylinderGeometry(50, 48, 4, 32);
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x22aa22, roughness: 0.8 }); 
    const island = new THREE.Mesh(islandGeo, islandMat);
    island.position.set(0, -2, 0); 
    scene.add(island);

    const lobbyGroup = new THREE.Group();
    lobbyGroup.position.set(0, 15, -80); 

    const floorGeo = new THREE.BoxGeometry(30, 0.2, 20);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    lobbyGroup.add(floor);

    const carpetGeo = new THREE.BoxGeometry(8, 0.05, 20);
    const carpetMat = new THREE.MeshStandardMaterial({ color: 0xaa0000, roughness: 0.9 }); 
    const carpet = new THREE.Mesh(carpetGeo, carpetMat);
    carpet.position.set(0, 0.1, 0); 
    lobbyGroup.add(carpet);

    const handNames = ["Speedy", "Jumper", "Extended", "Diver", "Builder", "Sniper"];
    handNames.forEach((name, index) => {
        let plateGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.1, 16);
        let plateMat = new THREE.MeshStandardMaterial({ color: getGloveColorHex(name), emissive: getGloveColorHex(name), emissiveIntensity: 0.3 });
        let plate = new THREE.Mesh(plateGeo, plateMat);
        plate.position.set(-11 + (index * 4.4), 0.1, -6);
        plate.userData = { isHandPlate: true, handName: name };
        lobbyGroup.add(plate);
    });

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(30, 8, 0.5), wallMat);
    backWall.position.set(0, 4, -10);
    lobbyGroup.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 20), wallMat);
    leftWall.position.set(-15, 4, 0);
    lobbyGroup.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 20), wallMat);
    rightWall.position.set(15, 4, 0);
    lobbyGroup.add(rightWall);

    const pillarGeo = new THREE.BoxGeometry(2, 8, 0.5);
    for (let i = -14; i <= 14; i += 7) {
        const pillar = new THREE.Mesh(pillarGeo, wallMat);
        pillar.position.set(i, 4, 10);
        lobbyGroup.add(pillar);
    }
    const glassGeo = new THREE.BoxGeometry(5, 6, 0.1);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x66ccff, transparent: true, opacity: 0.3, roughness: 0.1 });
    for (let i = -10.5; i <= 10.5; i += 7) {
        const windowPane = new THREE.Mesh(glassGeo, glassMat);
        windowPane.position.set(i, 4, 10);
        lobbyGroup.add(windowPane);
    }

    scene.add(lobbyGroup);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function createPlayerCharacterMesh(gloveName) {
    const group = new THREE.Group();

    const bodyGeo = new THREE.CylinderGeometry(0.6, 0.6, 1.2, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0066ff, roughness: 0.5 }); 
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.2;
    group.add(body);

    const headGeo = new THREE.SphereGeometry(0.4, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffff00, roughness: 0.5 }); 
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 2.1;
    group.add(head);

    const legGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.6, 8);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x00aa00, roughness: 0.5 }); 
    
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.3, 0.3, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.3, 0.3, 0);
    group.add(rightLeg);

    const shoulderPivot = new THREE.Group();
    shoulderPivot.position.set(0.8, 1.4, 0); 
    
    const armGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.0, 8);
    armGeo.translate(0, -0.5, 0); 
    const armMat = new THREE.MeshStandardMaterial({ color: 0xffff00, roughness: 0.5 }); 
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.rotation.x = -Math.PI / 2; 
    shoulderPivot.add(arm);

    const handModelGroup = new THREE.Group();
    handModelGroup.position.set(0, -1.0, 0);

    const palmGeo = new THREE.BoxGeometry(0.4, 0.15, 0.4);
    const handMatColor = getGloveColorHex(gloveName);
    const handMaterial = new THREE.MeshStandardMaterial({ color: handMatColor, roughness: 0.4 });
    const palm = new THREE.Mesh(palmGeo, handMaterial);
    palm.position.y = -0.075;
    handModelGroup.add(palm);

    const thumbGeo = new THREE.BoxGeometry(0.12, 0.1, 0.15);
    const thumb = new THREE.Mesh(thumbGeo, handMaterial);
    thumb.position.set(0.24, -0.05, 0.05);
    handModelGroup.add(thumb);

    for (let i = 0; i < 4; i++) {
        let fingerGeo = new THREE.BoxGeometry(0.08, 0.08, 0.18);
        let finger = new THREE.Mesh(fingerGeo, handMaterial);
        finger.position.set(-0.15 + (i * 0.1), -0.04, -0.26);
        handModelGroup.add(finger);
    }

    arm.add(handModelGroup); 
    group.add(shoulderPivot);
    
    group.userData = { arm: arm, glove: handModelGroup, shoulder: shoulderPivot };
    return group;
}

function getGloveColorHex(name) {
    const colors = { Speedy: 0x00ffcc, Jumper: 0xffcc00, Extended: 0xff00ff, Diver: 0x33cc33, Builder: 0xff6600, Sniper: 0xcc0000 };
    return colors[name] || 0xffffff;
}

function updateHUD() {
    const lp = playersData[localPlayerId];
    if (lp) {
        document.getElementById('hud-glove-name').innerText = lp.equippedGlove;
        document.getElementById('hud-currency').innerText = lp.currency || 0;
        if (lp.isAdmin) document.getElementById('admin-panel').style.display = 'block';
    }
}

function animateLoop() {
    requestAnimationFrame(animateLoop);
    processLocalMovement();
    updateCameraPosition();
    renderer.render(scene, camera);
}

function processLocalMovement() {
    const lp = playersData[localPlayerId];
    const mesh = playerMeshes[localPlayerId];
    if (!lp || !mesh || isTyping || diverTacticalMode) return;

    let config = handRegistry[lp.equippedGlove] || { speedMultiplier: 1.0, jumpMultiplier: 1.0 };
    let baseSpeed = 0.15 * config.speedMultiplier;

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

    if (moveX !== 0 || moveZ !== 0) {
        let length = Math.sqrt(moveX * moveX + moveZ * moveZ);
        mesh.position.x += (moveX / length) * baseSpeed;
        mesh.position.z += (moveZ / length) * baseSpeed;
        if (!shiftLockActive) {
            mesh.rotation.y = Math.atan2(moveX, moveZ);
        }
    }

    if (shiftLockActive) {
        mesh.rotation.y = cameraAngleY + Math.PI; 
    }

    yVelocity += GRAVITY;
    mesh.position.y += yVelocity;

    isGrounded = false;
    let groundHeight = -999; 

    if (mesh.position.z >= -90 && mesh.position.z <= -70 && mesh.position.x >= -15 && mesh.position.x <= 15) {
        groundHeight = 15; 
        isGrounded = true;
        
        mesh.position.x = Math.max(-14.5, Math.min(14.5, mesh.position.x));
        mesh.position.z = Math.max(-89.5, Math.min(-70.5, mesh.position.z));

        let localX = mesh.position.x;
        let localZ = mesh.position.z - (-80); 
        let handNames = ["Speedy", "Jumper", "Extended", "Diver", "Builder", "Sniper"];
        handNames.forEach((name, index) => {
            let pX = -11 + (index * 4.4);
            let pZ = -6;
            let dist = Math.sqrt(Math.pow(localX - pX, 2) + Math.pow(localZ - pZ, 2));
            if (dist < 1.4 && lp.equippedGlove !== name) {
                socket.emit('select_glove', name);
            }
        });
    } 
    else if (Math.sqrt(mesh.position.x * mesh.position.x + mesh.position.z * mesh.position.z) <= 50 && mesh.position.y <= 0.5) {
        if (lp.isAlive) {
            groundHeight = 0;
            isGrounded = true;
        }
    }

    Object.values(wallMeshes).forEach(wMesh => {
        let dx = Math.abs(mesh.position.x - wMesh.position.x);
        let dz = Math.abs(mesh.position.z - wMesh.position.z);
        if (dx < 2.2 && dz < 2.2) {
            let topOfWall = wMesh.position.y + 4;
            if (mesh.position.y >= topOfWall - 0.5 && yVelocity <= 0) {
                groundHeight = topOfWall;
                isGrounded = true;
            }
        }
    });

    if (mesh.position.y <= groundHeight) {
        mesh.position.y = groundHeight;
        yVelocity = 0;
        isGrounded = true;
    }

    if (keys.space && isGrounded) {
        let baseJumpPower = 0.35;
        yVelocity = baseJumpPower * config.jumpMultiplier;
        isGrounded = false;
    }

    socket.emit('player_movement', { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, ry: mesh.rotation.y });
}

function updateCameraPosition() {
    const mesh = playerMeshes[localPlayerId];
    if (!mesh) return;

    const lp = playersData[localPlayerId];
    if (diverTacticalMode || (lp && lp.isAlive && lp.equippedGlove === "Diver" && mesh.position.y > 25)) {
        camera.position.set(mesh.position.x, mesh.position.y + 35, mesh.position.z);
        camera.lookAt(mesh.position.x, mesh.position.y, mesh.position.z);
        return;
    }

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

function setupNetworkEvents() {
    socket.on('init', (data) => {
        localPlayerId = data.id;
        playersData = data.players;
        matchState = data.matchState;
        handRegistry = data.hands;

        Object.keys(playerMeshes).forEach(id => { scene.remove(playerMeshes[id]); });
        playerMeshes = {};

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

    socket.on('player_joined', (p) => {
        if(p.id === localPlayerId) return;
        playersData[p.id] = p;
        if(playerMeshes[p.id]) scene.remove(playerMeshes[p.id]);
        const m = createPlayerCharacterMesh(p.equippedGlove);
        m.position.set(p.x, p.y, p.z);
        scene.add(m);
        playerMeshes[p.id] = m;
    });

    socket.on('player_updated', (p) => {
        playersData[p.id] = p;
        if (playerMeshes[p.id]) {
            let currentPos = playerMeshes[p.id].position.clone();
            let currentRot = playerMeshes[p.id].rotation.y;
            scene.remove(playerMeshes[p.id]);
            
            const m = createPlayerCharacterMesh(p.equippedGlove);
            m.position.copy(currentPos);
            m.rotation.y = currentRot;
            scene.add(m);
            playerMeshes[p.id] = m;
        }
        if (p.id === localPlayerId) updateHUD();
    });

    socket.on('player_moved', (data) => {
        if (data.id === localPlayerId) return; 
        const m = playerMeshes[data.id];
        if (m) {
            m.position.set(data.x, data.y, data.z);
            m.rotation.y = data.ry;
        }
    });

    socket.on('slap_animated', (data) => {
        const m = playerMeshes[data.id];
        if (m) {
            let arm = m.userData.arm;
            let timeline = 0;
            let animInterval = setInterval(() => {
                timeline += 0.1;
                if (timeline <= 0.5) {
                    arm.rotation.x = -Math.PI / 2 - (timeline * 2);
                } else if (timeline <= 1.0) {
                    arm.rotation.x = Math.min(-Math.PI / 2, -Math.PI / 2 - 1.0 + ((timeline - 0.5) * 2));
                } else {
                    clearInterval(animInterval);
                    arm.rotation.set(-Math.PI / 2, 0, 0);
                }
            }, 30);
        }
    });

    socket.on('player_hit', (data) => {
        if (data.targetId === localPlayerId) {
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
            yVelocity = 0.8; 
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
        Object.keys(playerMeshes).forEach(id => {
            if (playersData[id]) playerMeshes[id].position.set(playersData[id].x, playersData[id].y, playersData[id].z);
        });
        updateHUD();
    });

    socket.on('player_disconnected', (id) => {
        if (playerMeshes[id]) {
            scene.remove(playerMeshes[id]);
            delete playerMeshes[id];
        }
        delete playersData[id];
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
    mainWall.position.y = 2; 
    group.add(mainWall);

    group.position.set(w.x, w.y, w.z);
    group.rotation.y = w.ry;
    scene.add(group);
    wallMeshes[w.id] = group;
}

function setupInputListeners() {
    window.addEventListener('keydown', (e) => {
        let key = e.key.toLowerCase();
        
        if (e.key === 'Shift') {
            shiftLockActive = !shiftLockActive;
            return;
        }

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
                if (input.value.trim() !== '') {
                    if (input.value.startsWith('/ready')) {
                        socket.emit('player_ready', true);
                    } else {
                        socket.emit('send_chat', input.value);
                    }
                }
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
            if (diverTacticalMode) return; 
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

    window.addEventListener('click', (e) => {
        if (!diverTacticalMode) return;
        
        let mouse = new THREE.Vector2(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        
        let raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        
        let targetPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        let intersection = new THREE.Vector3();
        raycaster.ray.intersectPlane(targetPlane, intersection);

        socket.emit('diver_land', { x: intersection.x, z: intersection.z });
    });
}

function triggerAdminAction(type) {
    console.log(`Admin panel dispatch: ${type}`);
}
