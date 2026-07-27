const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => res.send('Bridge Online'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Owner Verification
const OwnerUserId = 9271966310;
// Suggest
const DiscordWebhookUrl = "https://discord.com/api/webhooks/1531108468365459579/lsmG4jh_ZMAlTQUBghxmPkF2T3-13R6HDKxyDseE0ksN_E0-Vg8RAMUbMwjDsc7zdsGF";
// Server-side cache for user platform tracking
const HandshakePlatformCache = {};

wss.on('connection', (ws) => {
    // Default fallback room assignment
    ws.room = 'EN';
    
    ws.on('message', (data) => {
        const msg = data.toString();

        // Handle JOIN (Sets the room channel and roles for the socket)
        if (msg.startsWith("JOIN:")) {
            const parts = msg.split(":");
            ws.room = parts[1];
            ws.playerName = parts[2];
            ws.role = parts[3] || "CHAT"; 
            console.log(`${ws.playerName} joined room: [${ws.room}] as ${ws.role}`);
            return;
        }

        // Handle SYSTEM_SWITCH (Handles channel switching for Global/Server commands)
        if (msg.startsWith("SYSTEM_SWITCH|")) {
            const parts = msg.split("|");
            const newRoom = parts[1];
            const playerName = parts[2];
            
            ws.room = newRoom;
            console.log(`${playerName} switched to channel: [${ws.room}]`);
            return;
        }

        // Handle PRIVATE ROOM Logic
        if (msg.startsWith("JOIN_PRIVATE|")) {
            const parts = msg.split("|");
            ws.room = "Private_" + parts[1];
            ws.send("SYSTEM_LOG|Joined private room: " + parts[1]);
            console.log(`Player joined private room: [${ws.room}]`);
            return;
        }

        // Handle CREATE_PRIVATE Logic
        if (msg.startsWith("CREATE_PRIVATE|")) {
            const playerName = msg.split("|")[1];
            ws.room = "Private_" + playerName;
            ws.send("SYSTEM_LOG|Created and joined private room: " + playerName);
            console.log(`${playerName} created private room: [${ws.room}]`);
            return;
        }

        // Handle GLOBAL_SET_LIMIT Logic
        if (msg.startsWith("GLOBAL_SET_LIMIT|")) {
            const limit = msg.split("|")[1];
            console.log(`Global limit set to: ${limit}`);
            return;
        }

        // Handle SECRET Broadcast
        if (msg.startsWith("SECRET|")) {
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN && client.room === ws.room) {
                    client.send(msg);
                }
            });
            return;
        }

        // Handle Global View Request
        if (msg === "GET_GLOBAL_USERS") {
            let globalUsers = [];
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN && client.room === "Global") {
                    if (client.playerName) {
                        globalUsers.push(client.playerName);
                    }
                }
            });
            ws.send("GLOBAL_USERS_LIST|" + globalUsers.join(","));
            return;
        }

        // Handle Online Users Request
        if (msg.startsWith("GET_ONLINE_USERS|")) {
            let onlineNames = [];
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    let name = client.playerName || "Unknown";
                    if (!onlineNames.includes(name)) {
                        onlineNames.push(name);
                    }
                }
            });
            ws.send("ONLINE_USERS_RESPONSE|" + (onlineNames.length > 0 ? onlineNames.join(", ") : "None"));
            return;
        }

        // ==========================================
        // ISOLATED SYSTEM MODULE (SYSTEM_ONLY ROOM)
        // ==========================================
        
        if (msg.includes("ObsidianHandshake")) {
            try {
                const packet = JSON.parse(msg);

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
            } catch (e) {
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(msg);
                    }
                });
            }
            return;
        }

        if (msg.includes("ObsidianSuggest") || msg.includes("Suggest")) {
            try {
                const packet = JSON.parse(msg);
                if (packet.Type === "ObsidianSuggest" || packet.Suggest) {
                    const suggestionText = packet.Suggest || packet.Message;
                    
                    const playerName = packet.PlayerName || ws.playerName || "Unknown";
                    const userId = packet.UserId || ws.userId || "Unknown";

                    const payload = JSON.stringify({
                        username: "Obsidian Warden Bot",
                        content: "",
                        embeds: [
                            {
                                title: "New Suggestion Received",
                                description: suggestionText,
                                color: 16766720,
                                fields: [
                                    {
                                        name: "Roblox Player",
                                        value: String(playerName),
                                        inline: true
                                    },
                                    {
                                        name: "Roblox User ID",
                                        value: String(userId),
                                        inline: true
                                    }
                                ]
                            }
                        ]
                    });

                    const url = new URL(DiscordWebhookUrl);
                    const options = {
                        hostname: url.hostname,
                        path: url.pathname + url.search,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(payload)
                        }
                    };

                    const req = require('https').request(options, (res) => {
                        res.on('data', () => {});
                        res.on('end', () => {
                            if (res.statusCode === 204 || res.statusCode === 200) {
                                ws.send(JSON.stringify({
                                    Type: "SuggestionSuccess",
                                    response: "sent"
                                }));
                            } else {
                                ws.send(JSON.stringify({
                                    Type: "SuggestionFailed",
                                    response: res.statusCode
                                }));
                            }
                        });
                    });
                    req.on('error', (error) => {
                        console.error('Webhook error:', error);
                        ws.send(JSON.stringify({
                            Type: "SuggestionFailed",
                            response: error.message
                        }));
                    });
                    req.write(payload);
                    req.end();
                }
            } catch (e) {
                console.error('Suggest parse error:', e);
            }
            return;
        }

        if (msg.includes("ObsidianOwnerCommand") || msg.includes("OwnerCmd")) {
            try {
                const packet = JSON.parse(msg);
                const requesterId = Number(packet.UserId || ws.userId);
                const playerName = packet.PlayerName || ws.playerName || "Unknown";
                const attemptedCommand = packet.Command || packet.Message || "Unknown Command";

                if (requesterId !== OwnerUserId) {
                    const warningPayload = JSON.stringify({
                        username: "Obsidian Warden Bot",
                        content: "",
                        embeds: [
                            {
                                title: "⚠️ Unauthorized Owner Command Attempt",
                                description: "A non-owner user attempted to execute a restricted command.",
                                color: 16711680,
                                fields: [
                                    {
                                        name: "Roblox Player",
                                        value: String(playerName),
                                        inline: true
                                    },
                                    {
                                        name: "Roblox User ID",
                                        value: String(requesterId),
                                        inline: true
                                    },
                                    {
                                        name: "Attempted Command",
                                        value: String(attemptedCommand),
                                        inline: false
                                    }
                                ]
                            }
                        ]
                    });

                    const url = new URL(DiscordWebhookUrl);
                    const options = {
                        hostname: url.hostname,
                        path: url.pathname + url.search,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(warningPayload)
                        }
                    };

                    const req = require('https').request(options, (res) => {
                        res.on('data', () => {});
                    });
                    req.on('error', (error) => {
                        console.error('Webhook error:', error);
                    });
                    req.write(warningPayload);
                    req.end();
                    return;
                }

                // Verified Owner Actions & Room Broadcasts
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(JSON.stringify({
                            Type: "ObsidianOwnerAction",
                            Command: attemptedCommand,
                            Payload: packet.Payload || null
                        }));
                    }
                });
            } catch (e) {
                console.error('Owner command parse error:', e);
            }
            return;
        }
        
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
                return;
            } catch (e) {
                return;
            }
        }

        // ==========================================
        // STANDARD CHAT BROADCAST ENGINE (LOCAL ROOM)
        // ==========================================
        
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client.room === ws.room && ws.room !== "SYSTEM_ONLY") {
                client.send(msg);
            }
        });
    });
});

server.listen(PORT, () => console.log(`Bridge running on ${PORT}`));
