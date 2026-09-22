const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Bridge Online and Fully Server-Sided');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const HandshakePlatformCache = {};
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
    ws.isAlive = true;
    ws.room = 'Global';
    ws.outputLang = 'en';

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', async (data) => {
        const msgStr = data.toString();

        if (msgStr.startsWith("JOIN:")) {
            const parts = msgStr.split(":");
            ws.room = parts[1] || "Global";
            ws.playerName = parts[2] || "Unknown";
            ws.role = parts[3] || "CHAT"; 
            console.log(`Player joined room -> Name: ${ws.playerName} | Room: [${ws.room}] | Role: ${ws.role}`);
            return;
        }

        if (msgStr.startsWith("SYSTEM_SWITCH|")) {
            const parts = msgStr.split("|");
            ws.room = parts[1] || "Global";
            ws.playerName = parts[2] || ws.playerName;
            console.log(`System switch -> Player ${ws.playerName} moved to channel: [${ws.room}]`);
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

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client.room === ws.room) {
                client.send(msgStr);
            }
        });
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server-sided bridge running smoothly on port ${PORT}`);
});
