const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Translator Endpoint
app.post('/translate', async (req, res) => {
    const { text, source_lang, target_lang } = req.body;

    if (!text || !target_lang) {
        return res.status(400).json({ code: 400, message: "Missing text or target_lang" });
    }

    try {
        const response = await axios.post('https://deeplx.owo.network/translate', {
            text: text,
            source_lang: source_lang || "auto",
            target_lang: target_lang
        }, { timeout: 5000 });

        // Sends the exact format your Roblox script needs
        res.json({
            code: 200,
            data: response.data.data,          // The translated text
            source_lang: response.data.source_lang // The original language
        });

    } catch (error) {
        console.error("DeepLX Error:", error.message);
        res.status(500).json({ code: 500, data: text, message: "Engine error" });
    }
});

// Status Page
app.get('/', (req, res) => {
    res.send('Bridge Server V2 + DeepLX Translator is ONLINE');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// WebSocket Bridge Logic
wss.on('connection', (ws) => {
    console.log('Roblox Client Connected');

    ws.on('message', (data) => {
        const message = data.toString();
        // Broadcast to all other Roblox servers
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => console.log('Client disconnected'));
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
