const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => res.send('Bridge Online'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

ws.on('message', (data) => {
        const msg = data.toString();

        // Handle JOIN
        if (msg.startsWith("JOIN:")) {
            const parts = msg.split(":");
            ws.room = parts[1];
            ws.playerName = parts[2];
            console.log(`${ws.playerName} joined: ${ws.room}`);
            return;
        }

        // Handle Online Users Request
        if (msg.startsWith("GET_ONLINE_USERS|")) {
            let onlineNames = [];
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    onlineNames.push(client.playerName || "Unknown");
                }
            });
            const response = "ONLINE_USERS_RESPONSE|" + (onlineNames.length > 0 ? onlineNames.join(", ") : "None");
            ws.send(response);
            return;
        }

        // Handle Special Data Packets
        if (msg.includes("ObsidianHandshake") || msg.includes('"keyword":"DevHatSync"')) {
            // Process these separately in their specific blocks below
        } else {
            // THIS IS YOUR CHAT BROADCAST
            // It only runs if the message is NOT a special data packet
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                    client.send(msg);
                }
            });
        }

        // Handshake Logic
        if (msg.includes("ObsidianHandshake")) {
            try {
                const packet = JSON.parse(msg);
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(JSON.stringify({
                            Type: "ObsidianHandshake",
                            UserId: packet.UserId
                        }));
                    }
                });
            } catch (e) {}
            return;
        }

        // Global Sync Logic
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
