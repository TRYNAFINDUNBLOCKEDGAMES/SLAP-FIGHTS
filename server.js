socket.on('player_movement', (data) => {
        let p = players[socket.id];
        if (!p) return;

        let finalX = data.x;
        let finalZ = data.z;

        // 🧱 BOUNDARY FORCE-FIELD
        // Match the client's exact 2.3 unit pushback radius to prevent snapping glitches
        walls.forEach(w => {
            let dx = finalX - w.x;
            let dz = finalZ - w.z;
            let distance = Math.sqrt(dx * dx + dz * dz);
            
            if (distance < 2.3) {
                let angle = Math.atan2(dz, dx);
                finalX = w.x + Math.sin(angle) * 2.3;
                finalZ = w.z + Math.cos(angle) * 2.3;
            }
        });

        p.x = finalX; p.y = data.y; p.z = finalZ; p.ry = data.ry;
        
        const now = Date.now();
        p.rotationHistory.push({ angle: data.ry, time: now });
        p.rotationHistory = p.rotationHistory.filter(h => now - h.time <= 150);

        // Send back the absolute, server-approved position to eliminate glitchy rubberbanding
        socket.emit('player_moved', { id: socket.id, x: p.x, y: p.y, z: p.z, ry: p.ry });
        socket.broadcast.emit('player_moved', { id: socket.id, x: p.x, y: p.y, z: p.z, ry: p.ry });
    });
