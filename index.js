const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => res.send('Bridge Online'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const TelegramToken = "8890131325:AAG2SAW8cG1x8yH2U-uyHfPtrmsyNpcvb9w";
const TelegramChatId = "-5308116981";

// Owner Verification
const OwnerUserId = 9271966310;

// Server-side cache for user platform tracking
const HandshakePlatformCache = {};

// Track Telegram update offset for polling
let telegramOffset = 0;

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function sendTelegramNotification(htmlMessage) {
    if (!TelegramToken || !TelegramChatId) {
        return;
    }

    const chatId = TelegramChatId.trim();
    const encodedText = encodeURIComponent(htmlMessage);
    const url = `https://api.telegram.org/bot${TelegramToken}/sendMessage?chat_id=${chatId}&text=${encodedText}&parse_mode=HTML`;

    try {
        if (typeof fetch !== 'undefined') {
            const response = await fetch(url, { method: 'POST' });
            const data = await response.json();
            console.log("Telegram Response:", data);

            if (!data.ok) {
                const plainMessage = htmlMessage.replace(/<[^>]*>?/gm, '');
                const encodedPlain = encodeURIComponent(plainMessage);
                const fallbackUrl = `https://api.telegram.org/bot${TelegramToken}/sendMessage?chat_id=${chatId}&text=${encodedPlain}`;

                const fallbackResponse = await fetch(fallbackUrl, { method: 'POST' });
                const fallbackData = await fallbackResponse.json();
                console.log("Telegram Fallback Response:", fallbackData);
            }
            return;
        }
    } catch (err) {
        console.error("Telegram Dispatch Error:", err.message);
    }
}

// Telegram Webhook Endpoint with Targeted Parsing for /replytosuggest
app.post('/telegram-webhook', (req, res) => {
    const update = req.body;

    if (update && update.message && update.message.text) {
        const message = update.message;
        const firstName = message.from.first_name || "Admin";
        const lastName = message.from.last_name || "";
        const senderName = `${firstName} ${lastName}`.trim();
        const senderUserId = message.from.id;
        const telegramText = message.text;

        console.log(`Received from Telegram Webhook (${senderName}): ${telegramText}`);

        let commandName = "";
        let commandPayload = telegramText;

        if (telegramText.startsWith("/")) {
            const parts = telegramText.split(" ");
            let cmdPart = parts[0];
            if (cmdPart.includes("@")) {
                cmdPart = cmdPart.split("@")[0];
            }
            commandName = cmdPart.substring(1).toLowerCase();
            commandPayload = parts.slice(1).join(" ");
        }

        let targetUser = "";
        let replyText = commandPayload;

        if (commandName === "replytosuggest") {
            const payloadParts = commandPayload.trim().split(" ");
            targetUser = payloadParts[0] || "";
            replyText = payloadParts.slice(1).join(" ") || "";
        }

        const broadcastPayload = JSON.stringify({
            Type: "TelegramCommand",
            Command: commandName,
            Sender: senderName,
            UserId: senderUserId,
            Message: telegramText,
            Payload: commandPayload,
            TargetUser: targetUser,
            ReplyText: replyText
        });

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(broadcastPayload);
            }
        });
    }

    res.sendStatus(200);
});

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
        
        if (msg.includes("TelegramBroadcast") || msg.includes("ObsidianSuggest")) {
            try {
                const packet = typeof msg === 'string' ? JSON.parse(msg) : msg;
                const messageText = packet.Message || packet.Suggestion || "No message content provided";

                const safeName = escapeHTML(packet.PlayerName || ws.playerName || 'Unknown');
                const safeUserId = escapeHTML(String(packet.UserId || ws.userId || 'N/A'));
                const safeMessage = escapeHTML(messageText);

                const telegramFormattedText = 
                    `💡 <b>NEW TELEGRAM BROADCAST</b>\n` +
                    `👤 <b>User:</b> ${safeName} (ID: <code>${safeUserId}</code>)\n` +
                    `📝 <b>Message:</b> ${safeMessage}`;

                sendTelegramNotification(telegramFormattedText);
            } catch (e) {
                console.error("Message Parse Error:", e.message);
            }
            return;
        }

        // Handle Owner Actions / Verified Owner Commands / Announcements (With Telegram Integration)
        if (msg.includes("ObsidianOwnerAction") || msg.includes("ObsidianOwnerCommand") || msg.includes("ObsidianAnnouncement")) {
            try {
                const packet = JSON.parse(msg);
                if (packet.UserId === OwnerUserId || ws.userId === OwnerUserId) {
                    const attemptedCommand = packet.Command || packet.Payload;
                    
                    const safeName = escapeHTML(packet.PlayerName || ws.playerName || 'Owner');
                    const safeUserId = escapeHTML(String(packet.UserId || ws.userId || OwnerUserId));
                    const messageText = attemptedCommand || packet.Message || "No content provided";
                    const safeMessage = escapeHTML(messageText);

                    const telegramFormattedText = 
                        `👑 <b>OWNER ANNOUNCEMENT / ACTION</b>\n` +
                        `👤 <b>User:</b> ${safeName} (ID: <code>${safeUserId}</code>)\n` +
                        `📝 <b>Content:</b> ${safeMessage}`;

                    sendTelegramNotification(telegramFormattedText);

                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN && client.room === ws.room) {
                            client.send(JSON.stringify({
                                Type: packet.Type || "ObsidianOwnerAction",
                                Command: attemptedCommand,
                                Payload: packet.Payload || null,
                                PlayerName: packet.PlayerName || packet.Sender || "Owner"
                            }));
                        }
                    });
                }
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
