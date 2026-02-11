const WebSocket = require('ws');
const http = require('http');

// Use the port Render or other hosts provide, or default to 8080
const PORT = process.env.PORT || 8080;

// Create a basic HTTP server so the WebSocket has something to attach to
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bridge Server is Running\n');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('New connection established');

    ws.on('message', (data) => {
        // Convert the buffer to a string
        const message = data.toString();
        console.log('Received:', message);

        // Broadcast the message to EVERYONE connected
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => {
        console.log('Connection closed');
    });

    ws.on('error', (err) => {
        console.error('WS Error:', err);
    });
});

server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
