const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

-- Pointing ONLY to the root domain as requested
const ENGINE_URL = "https://deeplx-translator.onrender.com";
const AUTH_TOKEN = "Translator";

app.post('/translate', async (req, res) => {
    const { text, source_lang, target_lang } = req.body;

    try {
        const response = await axios.post(ENGINE_URL, {
            text: text,
            source_lang: source_lang || "auto",
            target_lang: target_lang
        }, { 
            headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
            timeout: 6000 
        });

        res.json(response.data);
    } catch (error) {
        res.status(500).json({ code: 500, message: "Engine Offline" });
    }
});

app.get('/', (req, res) => res.send('Bridge V2 Online'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    ws.on('message', (data) => {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data.toString());
            }
        });
    });
});

server.listen(PORT, () => console.log(`Bridge running on ${PORT}`));
