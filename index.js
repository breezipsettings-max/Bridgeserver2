const WebSocket = require('ws');
const http = require('http');

const port = process.env.PORT || 3000;

// HTTP Health Check for Render
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Universal Bridge Chat: Online");
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log(`Player Connected. Total: ${wss.clients.size}`);

    ws.on('message', (data) => {
        const message = data.toString();

        wss.clients.forEach((client) => {
            // Relay to everyone except the person who sent it
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    // Error handling to prevent server crashes
    ws.on('error', (err) => console.error("Socket Error:", err));

    ws.on('close', () => {
        console.log(`Player Disconnected. Total: ${wss.clients.size}`);
    });
});

// Keep-alive: Pings clients every 30 seconds to keep the connection active
setInterval(() => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.ping();
        }
    });
}, 30000);

server.listen(port, () => {
    console.log(`Bridge listening on port ${port}`);
});
