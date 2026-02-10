const WebSocket = require('ws');
const http = require('http');

const port = process.env.PORT || 3000;

// HTTP Health Check for Render
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Universal Bridge Chat: Online");
});

const wss = new WebSocket.Server({ 
    server,
    clientTracking: true 
});

wss.on('connection', (ws) => {
    // FORCE AUTO-GREEN: Send a packet immediately on connection
    // This tells the Roblox executor the connection is solid right now.
    ws.send("SYSTEM_CONNECTED");
    
    console.log(`Player Connected. Total: ${wss.clients.size}`);

    ws.on('message', (data) => {
        const message = data.toString();

        wss.clients.forEach((client) => {
            // High-speed relay
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('error', (err) => console.error("Socket Error:", err));

    ws.on('close', () => {
        console.log(`Player Disconnected. Total: ${wss.clients.size}`);
    });
});

// FAST HEARTBEAT: Reduced to 25s to stay ahead of Render's 30s timeout
setInterval(() => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.ping();
        }
    });
}, 25000);

server.listen(port, "0.0.0.0", () => {
    console.log(`Bridge listening on port ${port}`);
});
