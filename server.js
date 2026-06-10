const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const HAND_REGISTRY = require('./shared/hands.js');

const PORT = process.env.PORT || 3000;

// Serve public static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// Global Server States
let players = {};
let walls = [];       // Track builder walls: { id, ownerId, x, y, z, hp: 5 }
let bullets = [];     // Track sniper projectiles: { id, ownerId, x, y, z, vx, vz, startX, startZ }
let matchState = "LOBBY"; // LOBBY, MATCH
const ISLAND_RADIUS = 50; 

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Future-proof layout initialized inside the primary memory model
    players[socket.id] = {
        id: socket.id,
        username: `Guest_${socket.id.substring(0, 4)}`,
        x: 0, y: 5, z: 0,
        ry: 0, // Rotation tracking along Y axis
        rotationHistory: [], // Tracking spin velocity for easter egg physics
        equippedGlove: "Speedy",
        isAlive: false,
        isReady: false,
        cooldowns: { slap: 0, ability: 0 },
        diverTimer: null,
        // Account updates hooks placeholders
        currency: 0,
        isAdmin: false 
    };

    // Broadcast current arena environment to the newcomer
    socket.emit('init', { id: socket.id, players, walls, matchState, hands: HAND_REGISTRY });

    socket.on('player_ready', (readyStatus) => {
        if (players[socket.id]) {
            players[socket.id].isReady = readyStatus;
            checkMatchStartConditions();
        }
    });

    socket.on('select_glove', (gloveName) => {
        if (players[socket.id] && HAND_REGISTRY[gloveName] && matchState === "LOBBY") {
            players[socket.id].equippedGlove = gloveName;
            io.emit('player_updated', players[socket.id]);
        }
    });

    socket.on('player_movement', (data) => {
        let p = players[socket.id];
        if (!p) return;

        // Process position and record historical rotation vectors over time frames
        p.x = data.x; p.y = data.y; p.z = data.z; p.ry = data.ry;
        
        const now = Date.now();
        p.rotationHistory.push({ angle: data.ry, time: now });
        // Clean out history entries older than 150ms
        p.rotationHistory = p.rotationHistory.filter(h => now - h.time <= 150);

        io.emit('player_moved', { id: socket.id, x: p.x, y: p.y, z: p.z, ry: p.ry });
    });

    // Chat Message Event Interceptor
    socket.on('send_chat', (msg) => {
        let p = players[socket.id];
        if (!p || typeof msg !== 'string' || msg.length > 50) return;

        // Dormant Command Interceptor (Future Admin Abuse Expansion Hook)
        if (msg.startsWith('/') || msg.startsWith(';')) {
            processAdminCommand(socket.id, msg);
            return;
        }

        io.emit('chat_received', { username: p.username, message: msg });
    });

    // Core Combat: Regular Slap Logic
    socket.on('trigger_slap', () => {
        let attacker = players[socket.id];
        if (!attacker || attacker.cooldowns.slap > Date.now()) return;

        let gloveConfig = HAND_REGISTRY[attacker.equippedGlove];
        attacker.cooldowns.slap = Date.now() + 400; // Animation lockout lock

        io.emit('slap_animated', { id: socket.id });

        // Calculate custom spatial ranges based on glove modifiers
        let reach = (attacker.equippedGlove === "Extended") ? 8 : 4;
        let deadzone = (attacker.equippedGlove === "Extended") ? 2.5 : 0;

        // Server authoritative distance and angle cross checks
        Object.keys(players).forEach(targetId => {
            if (targetId === socket.id) return;
            let target = players[targetId];
            if (!target.isAlive || matchState !== "MATCH") return;

            let dx = target.x - attacker.x;
            let dz = target.z - attacker.z;
            let distance = Math.sqrt(dx*dx + dz*dz);

            if (distance >= deadzone && distance <= reach) {
                // Wall verification gate
                let wallInterfered = checkWallIntersection(attacker, target);
                // Only Builder and Extended hands pass validation to deal wall damage
                if (wallInterfered && !gloveConfig.wallPiercing) return;

                // Hit Confirmed! Calculate Spinning Vector Checks
                let isSpinning = calculateSpinVelocity(target);
                let knockbackPower = isSpinning ? 95 : 15; // INSANE chaotic power if spinning

                let angle = isSpinning ? Math.random() * Math.PI * 2 : Math.atan2(dz, dx);
                
                io.emit('player_hit', {
                    targetId: targetId,
                    attackerId: socket.id,
                    angle: angle,
                    power: knockbackPower,
                    chaotic: isSpinning
                });
            }
        });
    });

    // Core Combat: Ability Controls (E)
    socket.on('trigger_ability', (clickCoords) => {
        let p = players[socket.id];
        if (!p || matchState !== "MATCH" || p.cooldowns.ability > Date.now()) return;

        let glove = p.equippedGlove;
        let config = HAND_REGISTRY[glove];

        if (glove === "Builder") {
            p.cooldowns.ability = Date.now() + config.cooldown;
            spawnBuilderWall(socket.id);
        } else if (glove === "Sniper") {
            p.cooldowns.ability = Date.now() + config.cooldown;
            spawnSniperBullet(socket.id);
        } else if (glove === "Diver") {
            p.cooldowns.ability = Date.now() + config.cooldown;
            executeDiverLaunch(socket.id);
        }
    });

    socket.on('diver_land', (coords) => {
        let p = players[socket.id];
        if (p && p.equippedGlove === "Diver" && p.diverTimer) {
            clearTimeout(p.diverTimer);
            p.diverTimer = null;
            io.emit('diver_landed', { id: socket.id, coords: coords });
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // Clear lingering asset queues linked to player
        walls = walls.filter(w => w.ownerId !== socket.id);
        delete players[socket.id];
        io.emit('player_disconnected', socket.id);
        checkMatchEndConditions();
    });
});

// Helper: Calculate total degrees rotated in the last 150ms frame
function calculateSpinVelocity(target) {
    if (target.rotationHistory.length < 2) return false;
    let minAngle = Infinity;
    let maxAngle = -Infinity;
    target.rotationHistory.forEach(h => {
        if (h.angle < minAngle) minAngle = h.angle;
        if (h.angle > maxAngle) maxAngle = h.angle;
    });
    // Converting radian delta into scale degrees
    let totalDelta = (maxAngle - minAngle) * (180 / Math.PI);
    return totalDelta >= 360;
}

// Helper: Line-to-Box wall intersecting check 
function checkWallIntersection(p1, p2) {
    let interfered = false;
    walls.forEach(w => {
        // Broad phase bounding check
        let midX = (p1.x + p2.x) / 2;
        let midZ = (p1.z + p2.z) / 2;
        let distToWall = Math.sqrt(Math.pow(w.x - midX, 2) + Math.pow(w.z - midZ, 2));
        if (distToWall < 4) interfered = true; 
    });
    return interfered;
}

// Builder Ability Handler
function spawnBuilderWall(ownerId) {
    let p = players[ownerId];
    // Distance parameter offsets wall exactly 2 lengths forward
    let spawnDistance = 4; 
    let targetX = p.x + Math.sin(p.ry) * spawnDistance;
    let targetY = p.y;
    let targetZ = p.z + Math.cos(p.ry) * spawnDistance;

    // Check for existing walls sitting on coords
    walls.forEach(w => {
        let d = Math.sqrt(Math.pow(w.x - targetX, 2) + Math.pow(w.z - targetZ, 2));
        if (d < 2) {
            // Snap forward or backward based on which is closer to target
            let checkForwardX = targetX + Math.sin(p.ry) * 2.1;
            let checkForwardZ = targetZ + Math.cos(p.ry) * 2.1;
            let checkBackX = targetX - Math.sin(p.ry) * 2.1;
            let checkBackZ = targetZ - Math.cos(p.ry) * 2.1;

            if (Math.abs(p.x - checkForwardX) < Math.abs(p.x - checkBackX)) {
                targetX = checkForwardX; targetZ = checkForwardZ;
            } else {
                targetX = checkBackX; targetZ = checkBackZ;
            }
        }
    });

    let newWall = {
        id: `wall_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        ownerId: ownerId,
        x: targetX, y: targetY, z: targetZ, ry: p.ry,
        hp: 5
    };

    // Manage strict Max 6 queue limit structure
    let ownerWalls = walls.filter(w => w.ownerId === ownerId);
    if (ownerWalls.length >= 6) {
        let oldestWallIndex = walls.findIndex(w => w.id === ownerWalls[0].id);
        if (oldestWallIndex !== -1) {
            io.emit('wall_destroyed', walls[oldestWallIndex].id);
            walls.splice(oldestWallIndex, 1);
        }
    }

    walls.push(newWall);
    io.emit('wall_spawned', newWall);
}

// Sniper Ability Projectile Vector Handler
function spawnSniperBullet(ownerId) {
    let p = players[ownerId];
    let bulletSpeed = 1.2;
    let bId = `bullet_${Date.now()}`;
    
    let bullet = {
        id: bId,
        ownerId: ownerId,
        x: p.x, y: p.y + 0.5, z: p.z, // Dynamic height assignment tracking
        vx: Math.sin(p.ry) * bulletSpeed,
        vz: Math.cos(p.ry) * bulletSpeed,
        startX: p.x, startZ: p.z
    };
    bullets.push(bullet);
    io.emit('bullet_spawned', bullet);
}

// Diver Jump Execution
function executeDiverLaunch(ownerId) {
    io.emit('diver_launched', ownerId);
    // Force a 7 second failure auto fall drop timeline tracker
    players[ownerId].diverTimer = setTimeout(() => {
        let p = players[ownerId];
        if (p && p.diverTimer) {
            p.diverTimer = null;
            io.emit('diver_timed_out', ownerId);
        }
    }, 7000);
}

// Game Loop Tick: Server-Side Frame Processing (Projectiles & Out-of-Bounds Checks)
setInterval(() => {
    // Projectile Loop Engine
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx; b.z += b.vz;

        let traveled = Math.sqrt(Math.pow(b.x - b.startX, 2) + Math.pow(b.z - b.startZ, 2));
        let maxRange = ISLAND_RADIUS * 2 * 3.5;

        let destroyed = false;

        // Despawn check when range limits clip
        if (traveled > maxRange) {
            destroyed = true;
        } else {
            // Check wall collision matrix
            for (let j = walls.length - 1; j >= 0; j--) {
                let w = walls[j];
                let dist = Math.sqrt(Math.pow(w.x - b.x, 2) + Math.pow(w.z - b.z, 2));
                if (dist < 2.5) {
                    w.hp--;
                    destroyed = true;
                    if (w.hp <= 0) {
                        io.emit('wall_destroyed', w.id);
                        walls.splice(j, 1);
                    } else {
                        io.emit('wall_damaged', { id: w.id, hp: w.hp });
                    }
                    break;
                }
            }
        }

        if (destroyed) {
            io.emit('bullet_destroyed', b.id);
            bullets.splice(i, 1);
        } else {
            io.emit('bullet_moved', { id: b.id, x: b.x, z: b.z });
        }
    }

    // Out-of-bounds map void elimination sweeps
    if (matchState === "MATCH") {
        let aliveCount = 0;
        Object.keys(players).forEach(id => {
            let p = players[id];
            if (!p.isAlive) return;

            if (p.y < -15) { // Void depth limit check
                p.isAlive = false;
                io.emit('player_eliminated', id);
            } else {
                aliveCount++;
            }
        });

        if (aliveCount <= 1) {
            endMatchCycle();
        }
    }
}, 1000 / 60);

function checkMatchStartConditions() {
    if (matchState !== "LOBBY") return;
    let pArray = Object.values(players);
    let readyPlayers = pArray.filter(p => p.isReady);

    if (pArray.length >= 2 && readyPlayers.length === pArray.length) {
        matchState = "MATCH";
        walls = []; bullets = [];
        Object.values(players).forEach(p => {
            p.isAlive = true;
            p.x = (Math.random() - 0.5) * 20;
            p.y = 2;
            p.z = (Math.random() - 0.5) * 20;
        });
        io.emit('match_started', players);
    }
}

function endMatchCycle() {
    matchState = "LOBBY";
    let winnerId = null;
    Object.values(players).forEach(p => {
        if (p.isAlive) {
            winnerId = p.id;
            p.currency += 15; // Give currency on win
        }
        p.isAlive = false;
        p.isReady = false;
        p.x = 0; p.y = 5; p.z = 0;
    });
    walls = []; bullets = [];
    io.emit('match_ended', { winnerId, players });
}

// Dormant Command Router Container (Future Admin Update Interface)
function processAdminCommand(callerId, fullCmd) {
    console.log(`Admin parser caught execution attempt: ${callerId} typed ${fullCmd}`);
}

http.listen(PORT, () => {
    console.log(`Server executing safely on port: ${PORT}`);
});
