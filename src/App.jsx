import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { v4 as uuidv4 } from "uuid";
import {
  Copy,
  KeyRound,
  Lock,
  ShieldCheck,
  Video,
  VideoOff,
  Send,
  Plug,
  PlugZap,
  SignalHigh,
  Loader2,
} from "lucide-react";

/**
 * Secure Streaming Platform – Frontend MVP (React + Tailwind)
 * Works in a plain Vite React + JS project.
 * - AES-GCM helpers via WebCrypto
 * - WebSocket control + encrypted frame path
 * - Secure chat using same AES pipeline
 */

// -----------------------------
// Constants
// -----------------------------
const WS_RETRY_MS = 1200;
const MAX_LOG = 400;

// -----------------------------
// Base64 ↔ ArrayBuffer
// -----------------------------
function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// -----------------------------
// WebCrypto AES-GCM helpers
// -----------------------------
async function importRawAesKey(rawKey) {
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}
async function exportRawAesKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return new Uint8Array(raw);
}
async function genAesKey(bits = 256) {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: bits },
    true,
    ["encrypt", "decrypt"]
  );
}
async function aesGcmEncrypt(key, plaintext, iv, aad) {
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    plaintext
  );
  return new Uint8Array(ct);
}
async function aesGcmDecrypt(key, ciphertext, iv, aad) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    ciphertext
  );
  return new Uint8Array(pt);
}

// -----------------------------
// Minimal RTT meter
// -----------------------------
function useLatencyMeter(wsRef) {
  const [rtt, setRtt] = useState(null);
  const lastPingTs = useRef(null);

  useEffect(() => {
    const id = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      lastPingTs.current = performance.now();
      ws.send(JSON.stringify({ type: "metric", ts: Date.now() }));
    }, 3000);
    return () => clearInterval(id);
  }, [wsRef]);

  const onPong = () => {
    if (lastPingTs.current) setRtt(Math.round(performance.now() - lastPingTs.current));
  };

  return { rtt, onPong };
}

// -----------------------------
// Main Component
// -----------------------------
export default function App() {
  const [role, setRole] = useState("viewer"); // "host" | "viewer"
  const [sessionId, setSessionId] = useState("");
  const [clientId] = useState(() => uuidv4());
  const [connected, setConnected] = useState(false);
  const [wsUrl, setWsUrl] = useState("ws://localhost:8080/stream");
  const [log, setLog] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [frameCounter, setFrameCounter] = useState(0);
  const [busy, setBusy] = useState(false);

  // AES key state
  const [aesKey, setAesKey] = useState(null);
  const [aesKeyB64, setAesKeyB64] = useState("");

  const wsRef = useRef(null);
  const { rtt, onPong } = useLatencyMeter(wsRef);

  // log helper
  const pushLog = (s) =>
    setLog((L) => (L.length > MAX_LOG ? [...L.slice(-MAX_LOG / 2), s] : [...L, s]));

  // connect/reconnect
  const connectWs = () => {
    if (!sessionId) {
      pushLog("⚠️ Enter a Session ID first.");
      return;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const url = `${wsUrl}?id=${encodeURIComponent(sessionId)}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setConnected(true);
      pushLog(`🔌 Connected to ${url}`);
      ws.send(JSON.stringify({ type: "hello", role, sessionId, clientId }));
    };
    ws.onclose = () => {
      setConnected(false);
      pushLog("❌ Disconnected.");
      setTimeout(() => connectWs(), WS_RETRY_MS);
    };
    ws.onerror = (e) => pushLog(`WS error: ${JSON.stringify(e)}`);

    ws.onmessage = async (ev) => {
      try {
        if (typeof ev.data === "string") {
          const msg = JSON.parse(ev.data);
          if (msg.type === "pong") onPong();
          if (msg.type === "chat") pushLog(`💬 ${msg.text}`);
          return;
        }
        // binary path: JSON-encoded EncryptedFrame for MVP
        const txt = new TextDecoder().decode(ev.data);
        const f = JSON.parse(txt); // { kind, ivB64, aadB64, payloadB64, counter }
        if (!aesKey) {
          pushLog("🔐 Received frame but no AES key loaded.");
          return;
        }
        const iv = b64ToBytes(f.ivB64);
        const aad = b64ToBytes(f.aadB64);
        const ct = b64ToBytes(f.payloadB64);
        const t0 = performance.now();
        const pt = await aesGcmDecrypt(aesKey, ct, iv, aad);
        const ms = Math.round(performance.now() - t0);
        if (f.kind === "chat") {
          pushLog(`💬(secure) ${new TextDecoder().decode(pt)}  (dec ${ms} ms)`);
        } else {
          pushLog(`🎞️ media frame ${f.counter} (${pt.byteLength} bytes, dec ${ms} ms)`);
        }
      } catch (err) {
        pushLog(`Decrypt/parse error: ${err?.message || err}`);
      }
    };

    wsRef.current = ws;
  };

  // key controls
  const handleGenKey = async () => {
    setBusy(true);
    try {
      const key = await genAesKey(256);
      setAesKey(key);
      const raw = await exportRawAesKey(key);
      setAesKeyB64(bytesToB64(raw));
      pushLog("🔑 Generated AES-256-GCM key.");
    } finally {
      setBusy(false);
    }
  };
  const handleLoadKey = async () => {
    try {
      const raw = b64ToBytes(aesKeyB64);
      const key = await importRawAesKey(raw);
      setAesKey(key);
      pushLog("🔓 Loaded AES key from Base64.");
    } catch (e) {
      pushLog("Key import failed: " + e?.message);
    }
  };
  const handleRotate = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "rotate", reason: "manual" }));
    pushLog("♻️ Requested key rotation.");
  };

  // secure chat over AES path
  const sendSecureChat = async () => {
    if (!aesKey) return pushLog("Load or generate an AES key first.");
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)
      return pushLog("Not connected.");

    const counter = frameCounter + 1;
    setFrameCounter(counter);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode(`chat:${counter}`);
    const pt = new TextEncoder().encode(chatInput);
    const ct = await aesGcmEncrypt(aesKey, pt, iv, aad);

    const frame = {
      kind: "chat",
      ivB64: bytesToB64(iv),
      aadB64: bytesToB64(aad),
      payloadB64: bytesToB64(ct),
      counter,
    };
    wsRef.current.send(JSON.stringify(frame));
    setChatInput("");
    pushLog(`➡️ sent secure chat (${pt.byteLength} bytes)`);
  };

  const ConnectButton = () => (
    <button
      onClick={connectWs}
      className={`btn ${connected ? "opacity-50 cursor-not-allowed" : ""} w-full flex items-center justify-center gap-2`}
      disabled={connected}
    >
      {connected ? <Plug className="w-4 h-4" /> : <PlugZap className="w-4 h-4" />}{" "}
      {connected ? "Connected" : "Connect"}
    </button>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-slate-100 p-6">
      <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-6">
        {/* Left: Session & Crypto Controls */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="md:col-span-1">
          <div className="rounded-2xl shadow-xl p-5 bg-slate-900/70 backdrop-blur border border-slate-800">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" /> Session
            </h2>

            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <select value={role} onChange={(e) => setRole(e.target.value)} className="select w-32">
                  <option value="host">Host</option>
                  <option value="viewer">Viewer</option>
                </select>
                <input
                  className="input flex-1"
                  placeholder="Session ID (e.g., abc-123)"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                />
              </div>

              <div className="flex gap-2">
                <input className="input flex-1" value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} />
              </div>

              <ConnectButton />

              <div className="mt-2 text-sm text-slate-300 flex items-center gap-2">
                <SignalHigh className="w-4 h-4" /> RTT: {rtt ?? "–"} ms
              </div>
            </div>

            <div className="mt-6 border-t border-slate-800 pt-4">
              <h3 className="font-semibold flex items-center gap-2">
                <KeyRound className="w-5 h-5" /> Crypto
              </h3>
              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <button className="btn" onClick={handleGenKey} disabled={busy}>
                    <Lock className="w-4 h-4" /> Generate AES-256
                  </button>
                  <button className="btn" onClick={handleRotate}>
                    <Loader2 className="w-4 h-4" /> Rotate Key
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Paste Base64 AES key…"
                    value={aesKeyB64}
                    onChange={(e) => setAesKeyB64(e.target.value)}
                  />
                  <button className="btn" onClick={handleLoadKey}>
                    <Copy className="w-4 h-4" /> Load
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  Per-session key. Viewers should receive a wrapped key via your handshake.
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Middle: Media/Preview & Chat */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="md:col-span-2">
          <div className="rounded-2xl shadow-xl p-5 bg-slate-900/70 backdrop-blur border border-slate-800">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Video className="w-5 h-5" /> Live Preview
            </h2>

            <div className="mt-3 aspect-video bg-slate-950/60 rounded-xl border border-slate-800 flex items-center justify-center">
              <div className="text-slate-400 flex flex-col items-center gap-2">
                <VideoOff className="w-8 h-8" />
                <span className="text-sm">
                  Your C++ backend should push encrypted frames over WS → decrypt here → append to MSE
                </span>
              </div>
            </div>

            <div className="mt-6 grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold">Secure Chat (shares AES path)</h3>
                <div className="mt-2 flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Type a message…"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                  />
                  <button className="btn" onClick={sendSecureChat}>
                    <Send className="w-4 h-4" /> Send
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  This is a great smoke test for your AES pipeline before wiring actual media.
                </p>
              </div>

              <div>
                <h3 className="font-semibold">Notes</h3>
                <ul className="mt-2 text-sm list-disc pl-5 space-y-1 text-slate-300">
                  <li>Include frame counter in AAD to prevent replays.</li>
                  <li>IV must be unique per frame (12-byte, random/nonces).</li>
                  <li>Rotate keys on host change, N minutes, or viewer count spikes.</li>
                  <li>Pin TLS and validate origins for the WS endpoint.</li>
                </ul>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="font-semibold">Event Log</h3>
              <div className="mt-2 h-44 overflow-auto rounded-lg bg-black/30 border border-slate-800 p-2 text-xs font-mono">
                {log.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap">
                    {l}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Simple CSS for .btn/.input/.select (since Tailwind @apply doesn't work inline) */}
      <style>{`
        .btn {
          display: inline-flex; align-items: center; gap: 0.5rem;
          border-radius: 1rem; padding: 0.5rem 1rem;
          background: rgb(79 70 229); /* indigo-600 */
          color: white; transition: background .15s ease; box-shadow: 0 1px 3px rgba(0,0,0,.3);
        }
        .btn:hover { background: rgb(99 102 241); } /* indigo-500 */
        .btn:active { background: rgb(67 56 202); } /* indigo-700 */
        .input, .select {
          border-radius: 0.75rem; padding: 0.5rem 0.75rem;
          background: rgba(30, 41, 59, 0.7); /* slate-800/70 */
          border: 1px solid rgb(51 65 85); color: #E2E8F0;
          outline: none;
        }
      `}</style>

      {/* Backend contract (docs only) */}
      <pre className="max-w-6xl mx-auto mt-8 text-xs text-slate-300 bg-slate-900/60 p-4 rounded-xl overflow-auto border border-slate-800">
{`BACKEND CONTRACT (C++):

1) POST /api/session
   Req:  {role: "host"|"viewer", desiredSessionId?: string}
   Resp: {sessionId: string, wsUrl: string}

2) POST /api/key-exchange  (X25519 or server-wrapped AES)
   Host Req:   {sessionId, action: "init", hostPubKey?: base64}
   Viewer Req: {sessionId, action: "join", viewerPubKey?: base64}
   Resp:       {peerPubKey?: base64, wrappedKey?: base64}
   Note: If using KMS, return AES key wrapped with viewer public key; client unwraps → importRawAesKey

3) WS /stream?id=SESSION_ID
   Control JSON (utf-8 text frames):
     {type:"hello", role, sessionId, clientId}
     {type:"chat", text, clientId, ts}
     {type:"metric", ts}  → server replies {type:"pong"}
     {type:"rotate"}

   EncryptedFrame JSON (binary or text ok, but binary preferred):
     {
       kind: "media"|"chat",
       ivB64: base64(12B IV),
       aadB64: base64(utf8('kind:counter')),
       payloadB64: base64(AES-GCM(ct || tag)),
       counter: N
     }

   Media framing:
     - If you use MSE: payload = mp4/ts fragment bytes (H.264/AAC)
     - If you use WebRTC: you can move to Insertable Streams later for true E2EE

Security notes:
  - Use TLS for all HTTP/WS
  - Per-session AES-256-GCM key; rotate regularly
  - Nonce IV per frame; never reuse IV under same key
  - AAD must bind counter + stream kind
  - Server should drop out-of-order frames beyond a small window to defeat replays
`}
      </pre>
    </div>
  );
}
