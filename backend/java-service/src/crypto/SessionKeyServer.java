package crypto;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpExchange;

import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class SessionKeyServer {

    // sessionId -> AES key (bytes)
    private static final Map<String, byte[]> sessionKeys = new ConcurrentHashMap<>();

    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(8081), 0);

        server.createContext("/api/session", SessionKeyServer::handleCreateSession);
        server.createContext("/api/join", SessionKeyServer::handleJoinSession);

        server.setExecutor(null);
        server.start();
        System.out.println("Crypto service running on http://localhost:8081");
    }

    // Host: POST /api/session  body: {"sessionId":"demo"}
    private static void handleCreateSession(HttpExchange exchange) throws IOException {
        // CORS preflight
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendJson(exchange, 200, "");
            return;
        }

        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
            return;
        }

        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        String sessionId = extractField(body, "sessionId");
        if (sessionId == null || sessionId.isEmpty()) {
            sendJson(exchange, 400, "{\"error\":\"Missing sessionId\"}");
            return;
        }

        byte[] key = sessionKeys.computeIfAbsent(sessionId, s -> {
            try {
                KeyGenerator kg = KeyGenerator.getInstance("AES");
                kg.init(256);
                SecretKey sk = kg.generateKey();
                return sk.getEncoded();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });

        String aesB64 = Base64.getEncoder().encodeToString(key);
        String resp = "{\"sessionId\":\"" + sessionId + "\",\"aesKeyB64\":\"" + aesB64 + "\"}";
        sendJson(exchange, 200, resp);
    }

    // Viewer: POST /api/join  body: {"sessionId":"demo"}
    private static void handleJoinSession(HttpExchange exchange) throws IOException {
        // CORS preflight
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendJson(exchange, 200, "");
            return;
        }

        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
            return;
        }

        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        String sessionId = extractField(body, "sessionId");
        if (sessionId == null || sessionId.isEmpty()) {
            sendJson(exchange, 400, "{\"error\":\"Missing sessionId\"}");
            return;
        }

        byte[] key = sessionKeys.get(sessionId);
        if (key == null) {
            sendJson(exchange, 404, "{\"error\":\"Unknown sessionId\"}");
            return;
        }

        String aesB64 = Base64.getEncoder().encodeToString(key);
        String resp = "{\"sessionId\":\"" + sessionId + "\",\"aesKeyB64\":\"" + aesB64 + "\"}";
        sendJson(exchange, 200, resp);
    }

    private static void sendJson(HttpExchange ex, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);

        // CORS headers so React (localhost:5173) can talk to this server
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");

        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }

    // tiny JSON helper for {"field":"value"}
    private static String extractField(String json, String field) {
        String key = "\"" + field + "\"";
        int idx = json.indexOf(key);
        if (idx < 0) return null;
        idx = json.indexOf(':', idx);
        if (idx < 0) return null;
        idx = json.indexOf('"', idx);
        if (idx < 0) return null;
        int end = json.indexOf('"', idx + 1);
        if (end < 0) return null;
        return json.substring(idx + 1, end);
    }
}