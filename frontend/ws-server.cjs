// ws-server.js
// Minimal WebSocket relay for Secure Streaming Platform
// Listens on ws://localhost:8080/stream

const WebSocket = require("ws");

const PORT = 8080;

const wss = new WebSocket.Server({ port: PORT, path: "/stream" });

console.log(`WebSocket relay listening on ws://localhost:${PORT}/stream`);

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (data, isBinary) => {
    let text;
    try {
      text = isBinary ? data.toString() : data.toString();
    } catch {
      text = null;
    }

    // Try to interpret JSON control messages
    if (text) {
      try {
        const msg = JSON.parse(text);

        // latency ping -> pong
        if (msg.type === "metric") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }

        // hello message: just store some metadata (optional)
        if (msg.type === "hello") {
          ws.sessionId = msg.sessionId || null;
          ws.role = msg.role || null;
          console.log(
            `HELLO from client: role=${ws.role} session=${ws.sessionId}`
          );
          return;
        }

        // plain chat (unencrypted) can be broadcast as-is
        if (msg.type === "chat") {
          console.log(`CHAT: ${msg.text}`);
          // broadcast to everyone in same session (or everyone if no sessionId)
          wss.clients.forEach((client) => {
            if (client.readyState !== WebSocket.OPEN) return;
            if (ws.sessionId && client.sessionId && client.sessionId !== ws.sessionId) {
              return;
            }
            client.send(text);
          });
          return;
        }
      } catch {
        // not JSON, fall through to broadcast as raw frame
      }
    }

    // Encrypted frames (AES-GCM) come in as JSON too, but we don't care.
    // We just forward them to everyone else in the same session.
    console.log("Forwarding encrypted frame / raw data");

    wss.clients.forEach((client) => {
      if (client === ws || client.readyState !== WebSocket.OPEN) return;
      if (ws.sessionId && client.sessionId && client.sessionId !== ws.sessionId) {
        return;
      }
      client.send(data, { binary: isBinary });
    });
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });

  ws.on("error", (err) => {
    console.error("WS error:", err.message);
  });
});