const WebSocket = require('ws');
const http = require('http');
const https = require('https');
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

// Server-side cache for user platform tracking
const HandshakePlatformCache = {};

// Helper function to sanitize special characters for Telegram HTML formatting
function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Helper function to dispatch Telegram notifications
async function sendTelegramNotification(htmlMessage) {
    if (!TelegramToken || !TelegramChatId) {
        return;
    }

    const chatId = TelegramChatId.trim();
    const encodedText = encodeURIComponent(htmlMessage);
    const url = `https://api.telegram.org/bot${TelegramToken}/sendMessage?chat_id=${chatId}&text=${encodedText}`;

    try {
        if (typeof fetch !== 'undefined') {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: htmlMessage,
                    parse_mode: 'HTML'
                })
            });

            const data = await response.json();

            if (!data.ok) {
                const plainMessage = htmlMessage.replace(/<[^>]*>?/gm, '');
                const encodedPlain = encodeURIComponent(plainMessage);
                const fallbackUrl = `https://api.telegram.org/bot${TelegramToken}/sendMessage?chat_id=${chatId}&text=${encodedPlain}`;

                await fetch(fallbackUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: plainMessage
                    })
                });
            }
            return;
        }
    } catch (err) {
        // Suppressed exception
    }

    const payload = JSON.stringify({
        chat_id: chatId,
        text: htmlMessage,
        parse_mode: 'HTML'
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${TelegramToken}/sendMessage?chat_id=${chatId}&text=${encodedText}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(payload, 'utf8')
        }
    };

    const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
    });

    req.on('error', (err) => {
        // Suppressed exception
    });

    req.write(payload);
    req.end();
}

wss.on('connection', (ws) => {
    ws.room = 'EN';
    
    ws.on('message', (data) => {
        const msg = data.toString();

        if (msg.startsWith("JOIN:")) {
            const parts = msg.split(":");
            ws.room = parts[1];
            ws.playerName = parts[2];
            ws.role = parts[3] || "CHAT"; 
            return;
        }

        if (msg.startsWith("SYSTEM_SWITCH|")) {
            const parts = msg.split("|");
            ws.room = parts[1];
            return;
        }

        if (msg.startsWith("JOIN_PRIVATE|")) {
            const parts = msg.split("|");
            ws.room = "Private_" + parts[1];
            ws.send("SYSTEM_LOG|Joined private room: " + parts[1]);
            return;
        }

        if (msg.startsWith("CREATE_PRIVATE|")) {
            const playerName = msg.split("|")[1];
            ws.room = "Private_" + playerName;
            ws.send("SYSTEM_LOG|Created and joined private room: " + playerName);
            return;
        }

        if (msg.startsWith("GLOBAL_SET_LIMIT|") || msg.startsWith("GET_ONLINE_USERS|") || msg === "GET_GLOBAL_USERS") {
            // Handlers omitted for brevity / handled inline
        }

        // ==========================================
        // ISOLATED SYSTEM MODULE (SYSTEM_ONLY ROOM)
        // ==========================================
        
        if (msg.includes("ObsidianHandshake")) {
            try {
                const packet = typeof msg === 'string' ? JSON.parse(msg) : msg;
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
                // Suppressed exception
            }
            return;
        }

        if (msg.includes("ObsidianSuggest")) {
            try {
                const packet = typeof msg === 'string' ? JSON.parse(msg) : msg;

                if (packet.PlayerName) ws.playerName = packet.PlayerName;
                if (packet.UserId) ws.userId = Number(packet.UserId);

                if (packet.UserId && packet.Platform) {
                    HandshakePlatformCache[packet.UserId] = packet.Platform;
                }

                const userPlatform = packet.Platform || HandshakePlatformCache[packet.UserId] || "Unknown";
                const suggestionText = packet.Suggestion || packet.Message || packet.Text || packet.Content || "No message content provided";

                const safeName = escapeHTML(ws.playerName || 'Unknown');
                const safeUserId = escapeHTML(String(ws.userId || 'N/A'));
                const safePlatform = escapeHTML(userPlatform);
                const safeSuggestion = escapeHTML(suggestionText);

                const telegramFormattedText = 
                    `💡 <b>NEW SUGGESTION RECEIVED</b>\n` +
                    `👤 <b>User:</b> ${safeName} (ID: <code>${safeUserId}</code>)\n` +
                    `💻 <b>Platform:</b> ${safePlatform}\n` +
                    `📝 <b>Suggestion:</b> ${safeSuggestion}`;

                sendTelegramNotification(telegramFormattedText);

                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(JSON.stringify({
                            Type: "ObsidianSuggest",
                            UserId: packet.UserId,
                            PlayerName: ws.playerName,
                            Platform: userPlatform,
                            Suggestion: suggestionText
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

server.listen(PORT, () => console.log(`Bridge running on port ${PORT}`));
