const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Cache storage for platform handshakes
const HandshakePlatformCache = {};

// Cache storage for translations to prevent Google 429 rate-limiting
const translationCache = {};

// Express endpoint to serve or handle raw Google Translate json.txt format responses
app.get('/json.txt', async (req, res) => {
    const textToTranslate = req.query.text || "Test";
    const targetLang = req.query.target || "en";
    const translateUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(textToTranslate)}`;
    
    try {
        const response = await fetch(translateUrl);
        const translationData = await response.json();
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
        // ISOLATED SYSTEM MODULE (SYSTEM_ONLY ROOM)
        // ==========================================
        
        if (msgStr.includes("translate_request")) {
            let packet;
            try {
                packet = JSON.parse(msgStr);
                if (packet.type === "translate_request") {
                    // Flexible mapping for target language and text fields
                    const rawTarget = packet.target || packet.outputLang || packet.OutputLang || packet.targetLang || "";
                    const targetLang = (rawTarget !== "") ? rawTarget : "en";
                    const textToTranslate = packet.text || packet.message || "";
                    
                    // Check cache first to avoid rate-limiting
                    const cacheKey = `${targetLang}_${textToTranslate}`;
                    if (translationCache[cacheKey]) {
                        ws.send(JSON.stringify({
                            type: "translation_response",
                            id: packet.id,
                            translated: translationCache[cacheKey].translated,
                            finalMessage: translationCache[cacheKey].translated,
                            sourceCode: translationCache[cacheKey].sourceCode,
                            detectedSource: translationCache[cacheKey].sourceCode
                        }));
                        return;
                    }
                    
                    const translateUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(textToTranslate)}`;
                    
                    const response = await fetch(translateUrl);
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
                    
                    // Store in cache
                    translationCache[cacheKey] = {
                        translated: finalTranslated,
                        sourceCode: sourceCode
                    };
                    
                    ws.send(JSON.stringify({
                        type: "translation_response",
                        id: packet.id,
                        translated: finalTranslated,
                        finalMessage: finalTranslated,
                        sourceCode: sourceCode,
                        detectedSource: sourceCode
                    }));
                }
            } catch (e) {
                console.error("Translation proxy error:", e);
                let packetId = null;
                try {
                    const parsed = JSON.parse(msgStr);
                    packetId = parsed.id;
                } catch (err) {}
                
                try {
                    ws.send(JSON.stringify({
                        type: "translation_response",
                        id: packetId,
                        translated: null,
                        finalMessage: null,
                        sourceCode: "unknown",
                        detectedSource: "unknown"
                    }));
                } catch (err) {}
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
