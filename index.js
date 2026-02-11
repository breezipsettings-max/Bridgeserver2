const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => res.send('Bridge Online'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    ws.room = 'EN'; 
    ws.on('message', (data) => {
        const msg = data.toString();
        if (msg.startsWith("JOIN:")) {
            const newRoom = msg.split(":")[1];
            ws.room = newRoom;
            console.log(`User moved to channel: ${newRoom}`);
            return;
        }
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client.room === ws.room) {
                client.send(msg);
            }
        });
    });
});

server.listen(PORT, () => console.log(`Bridge running on ${PORT}`));
