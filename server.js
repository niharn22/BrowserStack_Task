const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const logFilePath = path.join(__dirname, 'logs', 'log.txt');
let lastReadPosition = 0;
let lastModified = 0;
const clients = [];

// Create HTTP server
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8', (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('Client connected');
    clients.push(ws);

    // Send last 10 lines of the log file with timestamps to the new client
    sendLastLines(ws);

    ws.on('close', () => {
        console.log('Client disconnected');
        const index = clients.indexOf(ws);
        if (index > -1) {
            clients.splice(index, 1);
        }
    });
});

// Function to format timestamps
function formatTimestamp() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

// Function to format lines with timestamps
function formatLinesWithTimestamps(lines) {
    return lines.map(line => {
        const timestamp = formatTimestamp();
        return `<div class="log-entry"><strong>[${timestamp}]</strong> ${line}</div>`;
    });
}

// Function to send last 10 lines to a WebSocket client
function sendLastLines(ws) {
    fs.readFile(logFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading file:', err);
            return;
        }
        const lines = data.trim().split('\n');
        if (lines.length >= 10) {
            const last10Lines = lines.slice(-10).reverse(); // Reverse to show latest updates on top
            const formattedLines = formatLinesWithTimestamps(last10Lines);
            ws.send(JSON.stringify({ type: 'initialLines', lines: formattedLines }));
        }
    });
}

// Function to send new lines to all WebSocket clients
function sendNewLines() {
    fs.open(logFilePath, 'r', (err, fd) => {
        if (err) {
            console.error('Error opening file:', err);
            return;
        }

        const bufferSize = 1024;  // Define a buffer size
        let buffer = Buffer.alloc(bufferSize);
        let fileSize = fs.statSync(logFilePath).size;
        let position = fileSize - 1;
        let lines = [];
        let remaining = '';

        // Move to the last read position
        position = Math.min(fileSize - 1, lastReadPosition);

        // Read the file backwards in chunks until we have at least 10 lines
        while (position >= 0 && lines.length < 10) {
            const start = Math.max(0, position - bufferSize + 1);
            const length = Math.min(bufferSize, position + 1);
            fs.readSync(fd, buffer, 0, length, start);

            remaining = buffer.toString('utf8') + remaining;
            const newLines = remaining.split('\n');
              // Add new lines to the beginning of the list
            lines = newLines.concat(lines); 
            
            if (lines.length > 10) {
                lines = lines.slice(-10);  // Keep only the last 10 lines
            }

            remaining = newLines[0];  // In case the chunk splits a line
            position -= bufferSize;
        }

        fs.close(fd, (err) => {
            if (err) {
                console.error('Error closing file:', err);
            }
        });

        // Update last read position
        lastReadPosition = fileSize;

        // Only push to the client if we have more than 10 new lines
        if (lines.length > 10) {
            const formattedLines = formatLinesWithTimestamps(lines.reverse());  // Reverse to show latest updates on top
            clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'newLine', lines: formattedLines }));
                }
            });
        } else {
            console.log('Fewer than 10 new lines detected. No update sent to clients.');
        }
    });
}

// Poll for file changes
setInterval(() => {
    fs.stat(logFilePath, (err, stats) => {
        if (err) {
            console.error('Error getting file stats:', err);
            return;
        }

        if (stats.mtimeMs > lastModified) {
            lastModified = stats.mtimeMs;
            sendNewLines();
        }
    });
}, 1000); // Check for updates every second

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
