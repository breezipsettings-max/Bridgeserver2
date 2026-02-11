const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => res.send('Breezip Channel Bridge Online'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    -- Default to English until they join a room
    ws.room = 'EN'; 

    ws.on('message', (data) => {
        const msg = data.toString();

        -- Logic: Join Room Command "JOIN:ISO_CODE"
        if (msg.startsWith("JOIN:")) {
            const newRoom = msg.split(":")[1];
            ws.room = newRoom;
            console.log(`Client joined channel: ${newRoom}`);
            return;
        }

        -- Broadcast ONLY to clients in the same channel
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client.room === ws.room) {
                client.send(msg);
            }
        });
    });
});

server.listen(PORT, () => console.log(`Bridge running on ${PORT}`));
