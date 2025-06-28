
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const { setupSocketHandlers } = require('./socketHandler'); // Import the socket handler

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity in development
    methods: ["GET", "POST"]
  }
});

const port = 3000;

// Serve static files from the parent directory (project root)
// because main.js is now in server/
app.use(express.static(path.join(__dirname, '..')));

// Route for the home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Initialize Socket.IO handlers
setupSocketHandlers(io);

server.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
