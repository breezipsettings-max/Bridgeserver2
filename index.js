const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SECONDARY_URL = "https://bridgeserver1-ydt4.onrender.com";

app.post('/push-to-roblox', (req, res) => {
    const broadcastPayload = JSON.stringify(req.body);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastPayload);
        }
    });
    res.sendStatus(200);
});

wss.on('connection', (ws) => {
    ws.room = 'EN';
    ws.playerName = 'Unknown';
    ws.userId = 'N/A';

    ws.on('message', async (msg) => {
        const msgStr = typeof msg === 'string' ? msg : msg.toString();

        if (msgStr.startsWith("JOIN:")) {
            const parts = msgStr.split(":");
            ws.room = parts[1] || 'EN';
            ws.playerName = parts[2] || 'Unknown';
            ws.userId = parts[3] || 'N/A';
            return;
        }

        if (msgStr.includes("TelegramBroadcast") || msgStr.includes("ObsidianSuggest")) {
            try {
                const packet = JSON.parse(msgStr);
                const messageText = packet.Message || packet.Suggestion || "No content";
                const rawName = packet.PlayerName || ws.playerName || 'Unknown';
                const safeUserId = String(packet.UserId || ws.userId || 'N/A');

                await fetch(`${SECONDARY_URL}/send-to-telegram`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        playerName: rawName,
                        userId: safeUserId,
                        message: messageText
                    })
                });
            } catch (e) {
                console.error("Failed to forward suggestion to Secondary Server:", e.message);
            }
            return;
        }

        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                client.send(msgStr);
            }
        });
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server 1 (Primary) running on port ${PORT}`);
});
