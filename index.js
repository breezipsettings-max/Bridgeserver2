const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => res.send('Bridge Online'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    ws.on('message', (data) => {
        const msg = data.toString();

        // Handle JOIN (Now includes Role: CHAT or SYSTEM)
        // Format: JOIN:RoomID:PlayerName:Role
        if (msg.startsWith("JOIN:")) {
            const parts = msg.split(":");
            ws.room = parts[1];
            ws.playerName = parts[2];
            ws.role = parts[3] || "CHAT"; 
            console.log(`${ws.playerName} joined: ${ws.room} as ${ws.role}`);
            return;
        }

        // Handle Online Users Request
        if (msg.startsWith("GET_ONLINE_USERS|")) {
            let onlineNames = [];
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN && client.room === ws.room) {
                    onlineNames.push(client.playerName || "Unknown");
                }
            });
            ws.send("ONLINE_USERS_RESPONSE|" + (onlineNames.length > 0 ? onlineNames.join(", ") : "None"));
            return;
        }

        // 1. STRICT CHAT BROADCAST
        // Only broadcast if it is NOT JSON AND the sender is a CHAT role
        if (msg.startsWith("JOIN:")) {
            const parts = msg.split(":");
            ws.room = parts[1];
            ws.playerName = parts[2];
            ws.role = parts[3] || "CHAT"; 
            console.log(`${ws.playerName} joined: ${ws.room} as ${ws.role}`);
            return;
        }

        // 2. ISOLATED HANDSHAKE LOGIC
        if (msg.includes("ObsidianHandshake")) {
            let userId = null;
            
            try {
                const packet = JSON.parse(msg);
                userId = packet.UserId;
            } catch (e) {
                // Fallback: Extract the digits using regex if JSON parsing fails
                const match = msg.match(/\d+/);
                if (match) {
                    userId = match[0];
                }
            }

            // Broadcast if we successfully found a UserId
            if (userId) {
                wss.clients.forEach((client) => {
                    // Send to everyone in the room, regardless of role
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(JSON.stringify({
                            Type: "ObsidianHandshake",
                            UserId: userId
                        }));
                    }
                });
            }
            return;
        }

        // 3. ISOLATED SYNC LOGIC
        if (msg.includes('"keyword":"DevHatSync"')) {
            try {
                const packet = JSON.parse(msg);
                if (packet.keyword === "DevHatSync") {
                    wss.clients.forEach((client) => {
                        if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                            client.send(msg);
                        }
                    });
                }
            } catch (e) {}
            return;
        }
    });
});

server.listen(PORT, () => console.log(`Bridge running on ${PORT}`));
