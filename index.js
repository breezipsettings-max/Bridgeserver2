const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

-- Translator Endpoint
app.post('/translate', async (req, res) => {
    const { text, target_lang } = req.body;

    if (!text || !target_lang) {
        return res.status(400).json({ error: "Missing text or target_lang" });
    }

    try {
        -- Using a public DeepLX node (No API Key Required)
        const response = await axios.post('https://deeplx.owo.network/translate', {
            text: text,
            source_lang: "auto",
            target_lang: target_lang
        });

        res.json({
            code: 200,
            data: response.data.data,
            source_lang: response.data.source_lang
        });
    } catch (err) {
        console.error("Translation Failed:", err.message);
        res.status(500).json({ error: "Translation failed", original: text });
    }
});

-- Bridge logic (Status Page)
app.get('/', (req, res) => {
    res.send('Bridge Server V2 + Translator is ONLINE');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

-- WebSocket Bridge Logic
wss.on('connection', (ws) => {
    console.log('Roblox Client Connected');

    ws.on('message', (data) => {
        const message = data.toString();
        -- Broadcast to all other Roblox servers
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
