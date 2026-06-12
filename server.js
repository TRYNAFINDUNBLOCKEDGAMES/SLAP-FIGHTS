const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const HAND_REGISTRY = require('./shared/hands.js');

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

let players = {};
let walls = [];       
let bullets = [];     
let matchState = "LOBBY"; 
const ISLAND_RADIUS = 50; 

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    players[socket.id] = {
        id: socket.id,
        username: `Guest_${socket.id.substring(0, 4)}`,
        x: 0, y: 16, z: -80, 
        ry: 0, 
        rotationHistory: [], 
        equippedGlove: "Speedy",
        isAlive: false,
        isReady: false,
        cooldowns: { slap: 0, ability: 0 },
        diverTimer: null,
        currency: 0,
        isAdmin: false 
    };

    socket.emit('init', { id: socket.id, players, walls, matchState, hands: HAND_REGISTRY });
    io.emit('player_joined', players[socket.id]);

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

        // 🧱 BUILDER WALL COLLISION (Server-side enforcement)
        // Check if the player's new movement coordinates collide with any active walls
        let finalX = data.x;
        let finalZ = data.z;

        walls.forEach(w => {
            let dx = finalX - w.x;
            let dz = finalZ - w.z;
            let distance = Math.sqrt(dx * dx + dz * dz);
            
            // If player gets closer than 2.2 units to a wall center, push them back out
            if (distance < 2.2) {
                let angle = Math.atan2(dz, dx);
                finalX = w.x + Math.sin(angle) * 2.2;
                finalZ = w.z + Math.cos(angle) * 2.2;
            }
        });

        p.x = finalX; p.y = data.y; p.z = finalZ; p.ry = data.ry;
        
        const now = Date.now();
        p.rotationHistory.push({ angle: data.ry, time: now });
        p.rotationHistory = p.rotationHistory.filter(h => now - h.time <= 150);

        // Broadcast corrected position back to everyone so nobody phases through walls
        socket.broadcast.emit('player_moved', { id: socket.id, x: p.x, y: p.y, z: p.z, ry: p.ry });
    });

    socket.on('send_chat', (msg) => {
        let p = players[socket.id];
        if (!p || typeof msg !== 'string' || msg.length > 50) return;

        if (msg.startsWith('/name ')) {
            let newName = msg.replace('/name ', '').trim();
            if (newName.length > 0 && newName.length <= 14) {
                let oldName = p.username;
                p.username = newName;
                io.emit('player_updated', p);
                io.emit('chat_received', { username: "System", message: `${oldName} changed their name to ${newName}` });
            }
            return;
        }

        io.emit('chat_received', { username: p.username, message: msg });
    });

    socket.on('trigger_slap', () => {
        let attacker = players[socket.id];
        if (!attacker || attacker.cooldowns.slap > Date.now()) return;

        attacker.cooldowns.slap = Date.now() + 400; 
        io.emit('slap_animated', { id: socket.id });

        // 📏 FIXING EXTENDED HAND REACH
        // Automatically upgrades reach to 9.5 units if they are wearing "Extended"
        let reach = (attacker.equippedGlove === "Extended") ? 9.5 : 4.5;
        let deadzone = (attacker.equippedGlove === "Extended") ? 2.0 : 0.0;

        Object.keys(players).forEach(targetId => {
            if (targetId === socket.id) return;
            let target = players[targetId];
            if (!target.isAlive || matchState !== "MATCH") return;

            let dx = target.x - attacker.x;
            let dz = target.z - attacker.z;
            let distance = Math.sqrt(dx*dx + dz*dz);

            if (distance >= deadzone && distance <= reach) {
                let isSpinning = calculateSpinVelocity(target);
                let knockbackPower = isSpinning ? 95 : 18; 
                let angle = Math.atan2(dz, dx);
                
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

    socket.on('trigger_ability', () => {
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
        walls = walls.filter(w => w.ownerId !== socket.id);
        delete players[socket.id];
        io.emit('player_disconnected', socket.id);
        checkMatchEndConditions();
    });
});

function calculateSpinVelocity(target) {
    if (target.rotationHistory.length < 2) return false;
    let minAngle = Infinity;
    let maxAngle = -Infinity;
    target.rotationHistory.forEach(h => {
        if (h.angle < minAngle) minAngle = h.angle;
        if (h.angle > maxAngle) maxAngle = h.angle;
    });
    let totalDelta = (maxAngle - minAngle) * (180 / Math.PI);
    return totalDelta >= 360;
}

function spawnBuilderWall(ownerId) {
    let p = players[ownerId];
    let spawnDistance = 4.5; 
    let targetX = p.x + Math.sin(p.ry) * spawnDistance;
    let targetY = p.y;
    let targetZ = p.z + Math.cos(p.ry) * spawnDistance;

    let newWall = {
        id: `wall_${Date.now()}`,
        ownerId: ownerId,
        x: targetX, y: targetY, z: targetZ, ry: p.ry,
        hp: 5
    };

    let ownerWalls = walls.filter(w => w.ownerId === ownerId);
    if (ownerWalls.length >= 4) {
        let oldestWallIndex = walls.findIndex(w => w.id === ownerWalls[0].id);
        if (oldestWallIndex !== -1) {
            io.emit('wall_destroyed', walls[oldestWallIndex].id);
            walls.splice(oldestWallIndex, 1);
        }
    }

    walls.push(newWall);
    io.emit('wall_spawned', newWall);
}

function spawnSniperBullet(ownerId) {
    let p = players[ownerId];
    let bulletSpeed = 1.2;
    let bId = `bullet_${Date.now()}`;
    
    let bullet = {
        id: bId,
        ownerId: ownerId,
        x: p.x, y: p.y + 0.5, z: p.z, 
        vx: Math.sin(p.ry) * bulletSpeed,
        vz: Math.cos(p.ry) * bulletSpeed,
        startX: p.x, startZ: p.z
    };
    bullets.push(bullet);
    io.emit('bullet_spawned', bullet);
}

function executeDiverLaunch(ownerId) {
    io.emit('diver_launched', ownerId);
    players[ownerId].diverTimer = setTimeout(() => {
        let p = players[ownerId];
        if (p && p.diverTimer) {
            p.diverTimer = null;
            io.emit('diver_timed_out', ownerId);
        }
    }, 7000);
}

setInterval(() => {
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx; b.z += b.vz;

        let traveled = Math.sqrt(Math.pow(b.x - b.startX, 2) + Math.pow(b.z - b.startZ, 2));
        let destroyed = false;

        if (traveled > 150) {
            destroyed = true;
        } else {
            for (let j = walls.length - 1; j >= 0; j--) {
                let w = walls[j];
                let dist = Math.sqrt(Math.pow(w.x - b.x, 2) + Math.pow(w.z - b.z, 2));
                if (dist < 2.5) {
                    w.hp--;
                    destroyed = true;
                    if (w.hp <= 0) {
                        io.emit('wall_destroyed', w.id);
                        walls.splice(j, 1);
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

    if (matchState === "MATCH") {
        let aliveCount = 0;
        Object.keys(players).forEach(id => {
            let p = players[id];
            if (!p.isAlive) return;

            if (p.y < -15) { 
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
            p.currency += 15;
        }
        p.isAlive = false;
        p.isReady = false;
        p.x = 0; p.y = 16; p.z = -80; 
    });
    walls = []; bullets = [];
    io.emit('match_ended', { winnerId, players });
}

http.listen(PORT, () => {
    console.log(`Server running smoothly on port: ${PORT}`);
});
