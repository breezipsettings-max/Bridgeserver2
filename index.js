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

// Helper function with comprehensive debug states for Telegram notification dispatch
async function sendTelegramNotification(htmlMessage) {
    console.log("[TELEGRAM DEBUG] === sendTelegramNotification CALLED ===");
    console.log("[TELEGRAM DEBUG] Raw HTML message received:", htmlMessage);

    if (!TelegramToken || !TelegramChatId) {
        console.error("[TELEGRAM DEBUG] ERROR: TelegramToken or TelegramChatId is missing or undefined!");
        return;
    }

    const chatId = TelegramChatId.trim();
    const encodedText = encodeURIComponent(htmlMessage);
    const url = `https://api.telegram.org/bot${TelegramToken}/sendMessage?chat_id=${chatId}&text=${encodedText}`;

    console.log("[TELEGRAM DEBUG] Target Chat ID:", chatId);
    console.log("[TELEGRAM DEBUG] Target URL generated (length: " + url.length + "):", url);

    // Try modern fetch API first
    try {
        if (typeof fetch !== 'undefined') {
            console.log("[TELEGRAM DEBUG] Fetch API is available. Dispatching POST request...");
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
            console.log("[TELEGRAM DEBUG] Fetch HTTP status code:", response.status);
            console.log("[TELEGRAM DEBUG] Telegram API JSON response:", JSON.stringify(data));

            if (!data.ok) {
                console.error('[TELEGRAM DEBUG] WARNING: Telegram API rejected HTML mode! Description:', data.description);
                
                // Fallback: Strip HTML tags and send as plain text
                const plainMessage = htmlMessage.replace(/<[^>]*>?/gm, '');
                console.log("[TELEGRAM DEBUG] Fallback plain text message:", plainMessage);
                
                const encodedPlain = encodeURIComponent(plainMessage);
                const fallbackUrl = `https://api.telegram.org/bot${TelegramToken}/sendMessage?chat_id=${chatId}&text=${encodedPlain}`;

                const fallbackResponse = await fetch(fallbackUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: plainMessage
                    })
                });
                const fallbackData = await fallbackResponse.json();
                console.log("[TELEGRAM DEBUG] Fallback API JSON response:", JSON.stringify(fallbackData));
            } else {
                console.log('[TELEGRAM DEBUG] SUCCESS: Telegram notification successfully delivered via fetch!');
            }
            return;
        } else {
            console.log("[TELEGRAM DEBUG] Global fetch is undefined in this Node environment. Falling back to https module.");
        }
    } catch (err) {
        console.error('[TELEGRAM DEBUG] EXCEPTION in fetch block:', err.message);
    }

    // Fallback HTTPS Request for older Node environments
    console.log("[TELEGRAM DEBUG] Initiating https.request fallback...");
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
        res.on('end', () => {
            console.log("[TELEGRAM DEBUG] HTTPS request completed with status code:", res.statusCode);
            console.log("[TELEGRAM DEBUG] HTTPS response body:", responseBody);
            if (res.statusCode !== 200) {
                console.error(`[TELEGRAM DEBUG] ERROR: Telegram API responded with status ${res.statusCode}:`, responseBody);
            } else {
                console.log('[TELEGRAM DEBUG] SUCCESS: Telegram notification delivered via HTTPS request!');
            }
        });
    });

    req.on('error', (err) => {
        console.error('[TELEGRAM DEBUG] CRITICAL ERROR: Telegram Dispatch HTTPS Exception:', err.message);
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
            console.log(`${ws.playerName} joined room: [${ws.room}] as ${ws.role}`);
            return;
        }

        if (msg.startsWith("SYSTEM_SWITCH|")) {
            const parts = msg.split("|");
            ws.room = parts[1];
            console.log(`${parts[2]} switched channel to: [${ws.room}]`);
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
                    console.log(`[HANDSHAKE DEBUG] Cached platform '${packet.Platform}' for UserId: ${packet.UserId}`);
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
                console.error("[SERVER ERROR] Failed to parse ObsidianHandshake:", e.message);
            }
            return;
        }

        if (msg.includes("ObsidianSuggest")) {
            console.log("[SERVER DEBUG] Incoming WebSocket message matched 'ObsidianSuggest':", msg);
            try {
                const packet = typeof msg === 'string' ? JSON.parse(msg) : msg;
                console.log("[SERVER DEBUG] Successfully parsed packet object:", packet);

                if (packet.PlayerName) ws.playerName = packet.PlayerName;
                if (packet.UserId) ws.userId = Number(packet.UserId);

                if (packet.UserId && packet.Platform) {
                    HandshakePlatformCache[packet.UserId] = packet.Platform;
                }

                const userPlatform = packet.Platform || HandshakePlatformCache[packet.UserId] || "Unknown";
                const suggestionText = packet.Suggestion || packet.Message || packet.Text || packet.Content || "No message content provided";

                console.log("[SERVER DEBUG] Resolved userPlatform:", userPlatform);
                console.log("[SERVER DEBUG] Resolved suggestionText:", suggestionText);

                // Safe HTML string escaping for Telegram
                const safeName = escapeHTML(ws.playerName || 'Unknown');
                const safeUserId = escapeHTML(String(ws.userId || 'N/A'));
                const safePlatform = escapeHTML(userPlatform);
                const safeSuggestion = escapeHTML(suggestionText);

                console.log("[SERVER DEBUG] Sanitized safeName:", safeName);
                console.log("[SERVER DEBUG] Sanitized safeUserId:", safeUserId);
                console.log("[SERVER DEBUG] Sanitized safePlatform:", safePlatform);
                console.log("[SERVER DEBUG] Sanitized safeSuggestion:", safeSuggestion);

                // Format and route suggestion to Telegram safely
                const telegramFormattedText = 
                    `💡 <b>NEW SUGGESTION RECEIVED</b>\n` +
                    `👤 <b>User:</b> ${safeName} (ID: <code>${safeUserId}</code>)\n` +
                    `💻 <b>Platform:</b> ${safePlatform}\n` +
                    `📝 <b>Suggestion:</b> ${safeSuggestion}`;

                console.log("[SERVER DEBUG] Final telegramFormattedText built:\n", telegramFormattedText);

                // Trigger Telegram dispatch function
                sendTelegramNotification(telegramFormattedText);

                // Broadcast back to WebSocket client network
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
                console.error("[SERVER ERROR] Exception caught inside ObsidianSuggest handler:", e.message, e.stack);
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
