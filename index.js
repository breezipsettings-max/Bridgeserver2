const WebSocket = require('ws');
const http = require('http');

// Use the port Render gives us, or default to 3000
const port = process.env.PORT || 3000;

// Create a basic server so Render stays happy
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("DefaultYourBot0 Bridge is Active");
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log("A player joined the bridge.");

    ws.on('message', (data) => {
        const message = data.toString();
        console.log("Relaying:", message);

        // Send the message to every other connected player
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => console.log("A player left the bridge."));
});

server.listen(port, () => {
    console.log(`Bridge listening on port ${port}`);
});
