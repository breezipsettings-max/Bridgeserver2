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

// Telegram Bot Configuration
const TelegramToken = "8890131325:AAG2SAW8cG1x8yH2U-uyHfPtrmsyNpcvb9w";
const TelegramChatId = "-5308116981";

// Helper function to escape HTML special characters for Telegram
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Helper function to send Telegram alerts using HTML parsing
async function sendTelegramAlert(text, clientWs = null) {
    try {
        if (!TelegramChatId || TelegramChatId === "5308116981") {
            console.error("Telegram Chat ID not configured.");
            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                    Type: "TelegramError",
                    ErrorDescription: "Telegram Chat ID configuration invalid."
                }));
            }
            return;
        }

        const url = `https://api.telegram.org/bot${TelegramToken}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: TelegramChatId,
                text: text,
                parse_mode: 'HTML'
            })
        });

        const data = await response.json();
        if (!data.ok) {
            console.error("Telegram Error:", data.description);
            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                    Type: "TelegramError",
                    ErrorDescription: data.description || "Telegram API rejected message"
                }));
            }
        }
    } catch (err) {
        console.error("Telegram Transport Error:", err);
        if (clientWs && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
                Type: "TelegramError",
                ErrorDescription: "Failed to communicate with Telegram servers"
            }));
        }
    }
}

// Telegram Inbound Command Polling Engine
let lastUpdateId = 0;

async function pollTelegramUpdates() {
    try {
        const url = `https://api.telegram.org/bot${TelegramToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
            for (const update of data.result) {
                lastUpdateId = update.update_id;

                if (update.message && update.message.text) {
                    const text = update.message.text;
                    const senderName = update.message.from ? (update.message.from.first_name || "Telegram User") : "Telegram User";

                    // Command Handler for Broadcasts sent from Telegram group to Roblox
                    if (text.startsWith("/announcement") || text.startsWith("/broadcast")) {
                        const cleanMsg = text.replace(/^\/(announcement|broadcast)(@\w+)?\s*/i, "").trim();
                        
                        if (cleanMsg.length > 0) {
                            const broadcastPayload = JSON.stringify({
                                Type: "ObsidianBroadcast",
                                Title: "Telegram Announcement",
                                Message: cleanMsg,
                                Sender: senderName
                            });

                            wss.clients.forEach((client) => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(broadcastPayload);
                                }
                            });
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error("Telegram Polling Error:", err);
    }

    // Schedule next polling cycle
    setTimeout(pollTelegramUpdates, 2000);
}

// Start polling for Telegram group commands
pollTelegramUpdates();

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

                    const telegramMessage = `💡 <b>New Suggestion Received</b>\n\n` +
                                            `<b>Player:</b> ${escapeHtml(playerName)}\n` +
                                            `<b>User ID:</b> <code>${userId}</code>\n` +
                                            `<b>Suggestion:</b> ${escapeHtml(suggestionText)}`;

                    sendTelegramAlert(telegramMessage, ws);
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
                    const warningMessage = `⚠️ <b>Unauthorized Owner Command Attempt</b>\n\n` +
                                           `<b>Player:</b> ${escapeHtml(playerName)}\n` +
                                           `<b>User ID:</b> <code>${requesterId}</code>\n` +
                                           `<b>Attempted Command:</b> <code>${escapeHtml(attemptedCommand)}</code>`;

                    sendTelegramAlert(warningMessage, ws);
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
