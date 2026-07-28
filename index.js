const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SECONDARY_URL = "https://bridgeserver1-ydt4.onrender.com";

// Owner Verification and Caches
const OwnerUserId = 9271966310;
const HandshakePlatformCache = {};

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
    ws.role = 'CHAT';

    ws.on('message', async (data) => {
        const msgStr = typeof data === 'string' ? data : data.toString();

        if (msgStr.startsWith("JOIN:")) {
            const parts = msgStr.split(":");
            ws.room = parts[1] || 'EN';
            ws.playerName = parts[2] || 'Unknown';
            ws.role = parts[3] || "CHAT"; 
            console.log(`${ws.playerName} joined room: [${ws.room}] as ${ws.role}`);
            return;
        }

        if (msgStr.startsWith("SYSTEM_SWITCH|")) {
            const parts = msgStr.split("|");
            ws.room = parts[1];
            console.log(`${parts[2]} switched to channel: [${ws.room}]`);
            return;
        }

        if (msgStr.startsWith("JOIN_PRIVATE|")) {
            const parts = msgStr.split("|");
            ws.room = "Private_" + parts[1];
            ws.send("SYSTEM_LOG|Joined private room: " + parts[1]);
            return;
        }

        if (msgStr.startsWith("CREATE_PRIVATE|")) {
            const playerName = msgStr.split("|")[1];
            ws.room = "Private_" + playerName;
            ws.send("SYSTEM_LOG|Created and joined private room: " + playerName);
            return;
        }

        if (msgStr.startsWith("SECRET|")) {
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN && client.room === ws.room) {
                    client.send(msgStr);
                }
            });
            return;
        }

        if (msgStr === "GET_GLOBAL_USERS") {
            let globalUsers = [];
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN && client.room === "Global" && client.playerName) {
                    globalUsers.push(client.playerName);
                }
            });
            ws.send("GLOBAL_USERS_LIST|" + globalUsers.join(","));
            return;
        }

        if (msgStr.startsWith("GET_ONLINE_USERS|")) {
            let onlineNames = [];
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    let name = client.playerName || "Unknown";
                    if (!onlineNames.includes(name)) onlineNames.push(name);
                }
            });
            ws.send("ONLINE_USERS_RESPONSE|" + (onlineNames.length > 0 ? onlineNames.join(", ") : "None"));
            return;
        }

        if (msgStr.includes("ObsidianHandshake")) {
            try {
                const packet = JSON.parse(msgStr);
                if (packet.PlayerName) ws.playerName = packet.PlayerName;
                if (packet.UserId) ws.userId = Number(packet.UserId);
                if (packet.UserId && packet.Platform) {
                    HandshakePlatformCache[packet.UserId] = packet.Platform;
                }

                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(JSON.stringify({
                            Type: "ObsidianHandshake",
                            UserId: packet.UserId,
                            PlayerName: ws.playerName,
                            Platform: packet.Platform
                        }));
                    }
                });
            } catch (e) {}
            return;
        }

        if (msgStr.includes('"keyword":"DevHatSync"')) {
            try {
                const packet = JSON.parse(msgStr);
                if (packet.keyword === "DevHatSync") {
                    wss.clients.forEach((client) => {
                        if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                            client.send(msgStr);
                        }
                    });
                }
            } catch (e) {}
            return;
        }

        if (msgStr.includes("TelegramBroadcast") || msgStr.includes("ObsidianSuggest")) {
            try {
                const packet = JSON.parse(msgStr);
                const messageText = packet.Message || packet.Suggestion || "No content";
                const rawName = packet.PlayerName || ws.playerName || 'Unknown';
                const safeUserId = String(packet.UserId || ws.userId || 'N/A');

                console.log(`Forwarding suggestion from ${rawName} to Secondary Server...`);

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
            if (client.readyState === WebSocket.OPEN && client.room === ws.room && ws.room !== "SYSTEM_ONLY") {
                client.send(msgStr);
            }
        });
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server 1 (Primary) running on port ${PORT}`);
});
