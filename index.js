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

// Server-side cache for user platform tracking and targeted session mapping
const HandshakePlatformCache = {};
const connectedClients = {};
const adminActiveTargets = {};

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function sendTelegramNotification(htmlMessage, replyMarkup = null, targetChatId = TelegramChatId) {
    if (!TelegramToken || !targetChatId) {
        return;
    }

    const chatId = String(targetChatId).trim();
    let url = `https://api.telegram.org/bot${TelegramToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(htmlMessage)}&parse_mode=HTML`;

    if (replyMarkup) {
        url += `&reply_markup=${encodeURIComponent(JSON.stringify(replyMarkup))}`;
    }

    try {
        if (typeof fetch !== 'undefined') {
            const response = await fetch(url, { method: 'POST' });
            const data = await response.json();
            console.log("Telegram Response:", data);

            if (!data.ok) {
                console.error("Telegram API Error Details:", data);
                const plainMessage = htmlMessage.replace(/<[^>]*>?/gm, '');
                let fallbackUrl = `https://api.telegram.org/bot${TelegramToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(plainMessage)}`;
                
                if (replyMarkup) {
                    fallbackUrl += `&reply_markup=${encodeURIComponent(JSON.stringify(replyMarkup))}`;
                }

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

// Telegram Webhook Endpoint with Targeted Parsing and Restored Global Broadcast
app.post('/telegram-webhook', (req, res) => {
    const update = req.body;

    if (update && update.message && update.message.text) {
        const message = update.message;
        const firstName = message.from.first_name || "Admin";
        const lastName = message.from.last_name || "";
        const senderName = `${firstName} ${lastName}`.trim();
        const senderUserId = message.from.id;

        // Security check enforcing owner/admin validation
        if (OwnerUserId && senderUserId !== OwnerUserId) {
            console.log(`Unauthorized webhook access attempt from User ID: ${senderUserId}`);
            return res.sendStatus(200);
        }

        const telegramText = message.text;

        console.log(`Received from Telegram (${senderName} [${senderUserId}]): ${telegramText}`);

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

        // Handle Deep Link /start reply_<userId> vs Native /start
        if (commandName === "start") {
            if (commandPayload.startsWith("reply_")) {
                const targetUserId = commandPayload.replace("reply_", "").trim();
                adminActiveTargets[senderUserId] = targetUserId;
                sendTelegramNotification(
                    `🟢 <b>Target Locked</b>\nYou are now targeting User ID: <code>${targetUserId}</code>.\nType your message below to send it directly to them.`,
                    null,
                    senderUserId
                );
            } else {
                const currentActive = adminActiveTargets[senderUserId] ? `Currently locked target ID: <code>${adminActiveTargets[senderUserId]}</code>` : `No active target locked. Click a suggestion link in your broadcast feed to target a player.`;
                sendTelegramNotification(
                    `🤖 <b>Obsidian Warden Bot Online</b>\nBridge server is active and running.\n\n${currentActive}`,
                    null,
                    senderUserId
                );
            }
            return res.sendStatus(200);
        }

        let targetUser = "";
        let replyText = commandPayload;

        if (commandName === "replytosuggest") {
            const payloadParts = commandPayload.trim().split(" ");
            targetUser = payloadParts[0] || "";
            replyText = payloadParts.slice(1).join(" ") || "";
        } else if (message.reply_to_message && message.reply_to_message.text) {
            const repliedText = message.reply_to_message.text;
            const match = repliedText.match(/ID:\s*<code>(\d+)<\/code>/);
            if (match && match[1]) {
                targetUser = match[1];
                replyText = telegramText;
            }
        } else if (adminActiveTargets[senderUserId]) {
            targetUser = adminActiveTargets[senderUserId];
            replyText = telegramText;
        }

        // Optional direct targeted socket push if connected
        if (targetUser && replyText) {
            const targetWs = connectedClients[targetUser];
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                const directPayload = JSON.stringify({
                    Type: "AdminDirectReply",
                    Sender: senderName,
                    AdminId: senderUserId,
                    Message: replyText
                });
                targetWs.send(directPayload);
                sendTelegramNotification(`✅ Reply successfully sent to user ID <code>${targetUser}</code>.`, null, senderUserId);
                console.log(`Targeted reply routed to user ID ${targetUser}: ${replyText}`);
            } else {
                sendTelegramNotification(`⚠️ User ID <code>${targetUser}</code> is currently offline or not connected.`, null, senderUserId);
            }
        }

        // Always broadcast TelegramCommand globally so client scripts receive updates reliably
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
                if (packet.UserId) {
                    ws.userId = Number(packet.UserId);
                    connectedClients[String(packet.UserId)] = ws;
                }

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
                const packet = JSON.parse(msg);
                const messageText = packet.Message || packet.Suggestion || "No message content provided";

                const rawName = packet.PlayerName || ws.playerName || 'Unknown';
                const safeName = escapeHTML(rawName);
                const safeUserId = escapeHTML(String(packet.UserId || ws.userId || 'N/A'));
                const safeMessage = escapeHTML(messageText);

                if (packet.UserId) {
                    ws.userId = Number(packet.UserId);
                    connectedClients[String(packet.UserId)] = ws;
                }

                const telegramFormattedText = 
                    `💡 <b>NEW TELEGRAM BROADCAST / SUGGESTION</b>\n` +
                    `👤 <b>User:</b> ${safeName} (ID: <code>${safeUserId}</code>)\n` +
                    `📝 <b>Message:</b> ${safeMessage}\n` +
                    `💬 <a href="https://t.me/Obsidian_WardenBot?start=reply_${safeUserId}">Click here to Reply to ${safeName}</a>`;

                sendTelegramNotification(telegramFormattedText);
            } catch (e) {
                console.error("Message Parse Error:", e.message);
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

    ws.on('close', () => {
        if (ws.userId) {
            delete connectedClients[String(ws.userId)];
        }
    });
});

server.listen(PORT, () => console.log(`Bridge running on ${PORT}`));
