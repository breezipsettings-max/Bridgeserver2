const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
app.use(express.json());

const TelegramToken = "8890131325:AAG2SAW8cG1x8yH2U-uyHfPtrmsyNpcvb9w";
const TelegramChatId = "-5308116981";
const OwnerUserId = "9271966310";

const HandshakePlatformCache = {};

function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function sendTelegramNotification(htmlMessage, replyMarkup = null) {
    if (!TelegramToken || !TelegramChatId) {
        return;
    }

    const chatId = TelegramChatId.trim();
    let url = `https://api.telegram.org/bot${TelegramToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(htmlMessage)}&parse_mode=HTML`;

    if (replyMarkup) {
        url += `&reply_markup=${encodeURIComponent(JSON.stringify(replyMarkup))}`;
    }

    try {
        if (typeof fetch !== 'undefined') {
            const response = await fetch(url, { method: 'POST' });
            const data = await response.json();

            if (!data.ok) {
                const plainMessage = htmlMessage.replace(/<[^>]*>?/gm, '');
                let fallbackUrl = `https://api.telegram.org/bot${TelegramToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(plainMessage)}`;
                
                if (replyMarkup) {
                    fallbackUrl += `&reply_markup=${encodeURIComponent(JSON.stringify(replyMarkup))}`;
                }

                await fetch(fallbackUrl, { method: 'POST' });
            }
            return;
        }
    } catch (err) {
        console.error("Telegram Dispatch Error:", err.message);
    }
}

app.get('/', (req, res) => {
    res.send('Bridge Online');
});

app.post('/telegram-webhook', (req, res) => {
    const update = req.body;

    if (update && update.message && update.message.text) {
        const message = update.message;
        const firstName = message.from.first_name || "Admin";
        const lastName = message.from.last_name || "";
        const senderName = `${firstName} ${lastName}`.trim();
        const senderUserId = message.from.id;
        const telegramText = message.text;

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

        if (commandName === "reply") {
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

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    ws.room = 'EN';
    ws.playerName = 'Unknown';
    ws.userId = 'N/A';

    ws.on('message', (msg) => {
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
                const messageText = packet.Message || packet.Suggestion || "No message content provided";

                const rawName = packet.PlayerName || ws.playerName || 'Unknown';
                const safeName = escapeHTML(rawName);
                const safeUserId = escapeHTML(String(packet.UserId || ws.userId || 'N/A'));
                const safeMessage = escapeHTML(messageText);

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

        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                client.send(msgStr);
            }
        });
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
