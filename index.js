const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Cache storage for platform handshakes
const HandshakePlatformCache = {};

// Cache storage for translation Caches
const translationCache = {};

const requestHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache'
};

const interval = setInterval(() => {
    wss.clients.forEach((client) => {
        if (client.isAlive === false) return client.terminate();
        client.isAlive = false;
        client.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

app.get('/json.txt', async (req, res) => {
    const textToTranslate = req.query.text;
    if (!textToTranslate) {
        return res.status(400).json({ error: "Missing text query parameter" });
    }
    
    const targetLang = req.query.target || "en";
    const cacheKey = `${targetLang}_${textToTranslate}`;

    if (translationCache[cacheKey]) {
        console.log(`[HTTP Cache Hit]: ${textToTranslate} -> ${targetLang}`);
        res.setHeader('Content-Type', 'application/json');
        return res.send(JSON.stringify(translationCache[cacheKey].rawBody));
    }
    
    const translateUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(textToTranslate)}`;
    
    try {
        const response = await fetch(translateUrl, { headers: requestHeaders });
        
        if (response.status === 429) {
            console.error("CRITICAL: Google rate limit hit on HTTP endpoint!");
            return res.status(429).json({ error: "Proxy server rate-limited by translation provider." });
        }

        const translationData = await response.json();
        
        let translated = "";
        let sourceCode = "unknown";
        if (translationData && translationData[0]) {
            for (const part of translationData[0]) {
                if (part && part[0]) {
                    translated += part[0];
                }
            }
            sourceCode = translationData[2] || "unknown";
        }

        translationCache[cacheKey] = {
            translated: translated.trim(),
            sourceCode: sourceCode,
            rawBody: translationData
        };

        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(translationData));
    } catch (e) {
        console.error("json.txt endpoint error:", e);
        res.status(500).json({ error: "Failed to fetch raw translation format" });
    }
});

wss.on('connection', (ws) => {
    // Default fallback room assignment
    ws.room = 'EN';
    
    ws.on('message', async (data) => {
        const msg = data.toString();
        const msgStr = msg;

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
        // ISOLATED SYSTEM MODULE (TRANSLATION ENGINE AND Handshakes)
        // ==========================================


        if (msgStr.includes("update_lang")) {
            try {
                const packet = JSON.parse(msgStr);
                if (packet.target) {
                    ws.outputLang = packet.target;
                    console.log(`[Lang Sync] Player ${ws.playerName || "Unknown"} updated output lang to: [${ws.outputLang}]`);
                }
            } catch (e) {
                console.error("update_lang error:", e);
            }
            return;
        }

        if (msgStr.includes("translate_request")) {
            let packet;
            try {
                packet = JSON.parse(msgStr);
                if (packet.type === "translate_request") {
                    const userId = packet.userId || ws.userId || 0;
                    const playerName = packet.playerName || ws.playerName || "Unknown";
                    
                    ws.userId = Number(userId);
                    ws.playerName = playerName;
                    if (packet.target) {
                        ws.outputLang = packet.target;
                    }

                    const targetLang = ws.outputLang || "en";
                    const textToTranslate = packet.text || "";
                    
                    const cacheKey = `${targetLang}_${textToTranslate}`;
                    if (translationCache[cacheKey]) {
                        ws.send(JSON.stringify({
                            type: "translate_response",
                            id: packet.id,
                            translated: translationCache[cacheKey].translated,
                            sourceCode: translationCache[cacheKey].sourceCode
                        }));
                        return;
                    }
                    
                    const translateUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(textToTranslate)}`;
                    const response = await fetch(translateUrl, { headers: requestHeaders });
                    
                    if (response.status === 429) {
                        ws.send(JSON.stringify({ type: "translate_response", id: packet.id, translated: textToTranslate, sourceCode: "unknown" }));
                        return;
                    }

                    const translationData = await response.json();
                    let translated = "";
                    let sourceCode = "unknown";
                    
                    if (translationData && translationData[0]) {
                        for (const part of translationData[0]) {
                            if (part && part[0]) {
                                translated += part[0];
                            }
                        }
                        sourceCode = translationData[2] || "unknown";
                    }
                    
                    const finalTranslated = translated.trim();
                    translationCache[cacheKey] = {
                        translated: finalTranslated,
                        sourceCode: sourceCode,
                        rawBody: translationData
                    };
                    
                    ws.send(JSON.stringify({
                        type: "translate_response",
                        id: packet.id,
                        translated: finalTranslated,
                        sourceCode: sourceCode
                    }));
                }
            } catch (e) {
                console.error("Server translation error:", e);
            }
            return;
        }

        if (msgStr.includes("sign_broadcast")) {
            try {
                const packet = JSON.parse(msgStr);
                if (packet.playerName) ws.playerName = packet.playerName;
                if (packet.userId) ws.userId = Number(packet.userId);
                if (packet.target) ws.outputLang = packet.target;
                
                const rawText = packet.rawText || "";
                const targetLang = ws.outputLang || "en";
                const cacheKey = `${targetLang}_${rawText}`;
                
                let finalTranslated = rawText;
                let sourceCode = "unknown";
                
                if (rawText !== "") {
                    if (translationCache[cacheKey]) {
                        finalTranslated = translationCache[cacheKey].translated;
                        sourceCode = translationCache[cacheKey].sourceCode;
                    } else {
                        const translateUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(rawText)}`;
                        const response = await fetch(translateUrl, { headers: requestHeaders });
                        if (response.status !== 429) {
                            const translationData = await response.json();
                            let translated = "";
                            if (translationData && translationData[0]) {
                                for (const part of translationData[0]) {
                                    if (part && part[0]) {
                                        translated += part[0];
                                    }
                                }
                                sourceCode = translationData[2] || "unknown";
                            }
                            finalTranslated = translated.trim() || rawText;
                            translationCache[cacheKey] = {
                                translated: finalTranslated,
                                sourceCode: sourceCode,
                                rawBody: translationData
                            };
                        }
                    }
                }

                const broadcastPacket = JSON.stringify({
                    type: "sign_broadcast",
                    playerName: ws.playerName,
                    displayName: packet.displayName || ws.playerName,
                    rawText: rawText,
                    translatedText: finalTranslated,
                    sourceCode: sourceCode
                });

                console.log(`[Server-Sided Broadcast] ${ws.playerName}: "${rawText}" -> "${finalTranslated}"`);

                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(broadcastPacket);
                    }
                });
            } catch (e) {
                console.error("sign_broadcast error:", e);
            }
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
            } catch (e) {
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(msgStr);
                    }
                });
            }
            return;
        }

        if (msgStr.includes("R3XHandShake")) {
            try {
                const packet = JSON.parse(msgStr);
                if (packet.PlayerName) ws.playerName = packet.PlayerName;
                if (packet.UserId) ws.userId = Number(packet.UserId);
                console.log(`R3XHandShake received from player: ${ws.playerName} [ID: ${ws.userId}]`);

                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(msgStr);
                    }
                });
            } catch (e) {
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(msgStr);
                    }
                });
            }
            return;
        }

        if (msgStr.includes("CharacterSync")) {
            try {
                const packet = JSON.parse(msgStr);
                if (packet.PlayerName) ws.playerName = packet.PlayerName;
                if (packet.UserId) ws.userId = Number(packet.UserId);
                console.log(`CharacterSync received from player: ${ws.playerName} [ID: ${ws.userId}]`);

                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(msgStr);
                    }
                });
            } catch (e) {
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(msgStr);
                    }
                });
            }
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

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server 1 (Primary) running on port ${PORT}`);
});
