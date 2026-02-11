const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// This is the missing piece: The Translate Endpoint
app.post('/translate', async (req, res) => {
    const { text, source_lang, target_lang } = req.body;

    if (!text || !target_lang) {
        return res.status(400).json({ code: 400, message: "Missing text or target_lang" });
    }

    try {
        // We use the public DeepLX engine
        const response = await axios.post('https://deeplx.owo.network/translate', {
            text: text,
            source_lang: source_lang || "auto",
            target_lang: target_lang
        });

        // Sending the exact format the Roblox script expects
        res.json({
            code: 200,
            data: response.data.data, 
            source_lang: response.data.source_lang
        });
    } catch (error) {
        console.error('Translation Engine Error:', error.message);
        res.status(500).json({ code: 500, data: text, message: "Translation Failed" });
    }
});

// Basic status route
app.get('/', (req, res) => {
    res.send('Bridge & Translator Server is Running');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('New connection established');

    ws.on('message', (data) => {
        const message = data.toString();
        console.log('Received:', message);

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => console.log('Connection closed'));
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
