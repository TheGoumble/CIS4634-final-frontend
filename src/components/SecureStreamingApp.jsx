// src/components/SecureStreamingApp.jsx
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
  Radio,
  Wifi,
  RotateCw,
} from "lucide-react";

const WS_RETRY_MS = 1200;
const MAX_LOG = 400;

/* ---------- Crypto helpers ---------- */

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

/* ---------- Latency hook ---------- */

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

/* ---------- Main secure streaming UI (role-aware) ---------- */

export function SecureStreamingApp({ user, onLogout }) {
  const [role, setRole] = useState(user?.role === "streamer" ? "host" : "viewer");
  const [sessionId, setSessionId] = useState("");
  const [clientId] = useState(() => uuidv4());
  const [connected, setConnected] = useState(false);
  const [wsUrl, setWsUrl] = useState("ws://localhost:8080/stream");
  const [log, setLog] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [frameCounter, setFrameCounter] = useState(0);
  const [busy, setBusy] = useState(false);

  const [aesKey, setAesKey] = useState(null);
  const [aesKeyB64, setAesKeyB64] = useState("");

  const wsRef = useRef(null);
  const { rtt, onPong } = useLatencyMeter(wsRef);

  const pushLog = (s) =>
    setLog((L) => (L.length > MAX_LOG ? [...L.slice(-MAX_LOG / 2), s] : [...L, s]));

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
      ws.send(
        JSON.stringify({
          type: "hello",
          role: role === "host" ? "host" : "viewer",
          sessionId,
          clientId,
          userName: user?.name || "",
        })
      );
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

        const txt = new TextDecoder().decode(ev.data);
        const f = JSON.parse(txt);
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
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium
        ${
          connected
            ? "bg-[#112218] text-emerald-300 border border-emerald-400/60"
            : "bg-[#E50914] text-white border border-[#ff4b5a]/80 hover:bg-[#ff1a25]"
        } transition`}
      disabled={connected}
    >
      {connected ? <Plug className="w-4 h-4" /> : <PlugZap className="w-4 h-4" />}
      {connected ? "Connected" : "Connect"}
    </button>
  );

  const isHost = role === "host";

  return (
    <div className="min-h-screen bg-[#0B0B0B] text-slate-100">
      {/* Top bar */}
      <header className="border-b border-[#262626] bg-[#0C0C0C]/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-[#E50914] flex items-center justify-center shadow-[0_0_22px_rgba(229,9,20,0.7)]">
              <Radio className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight">
                  Secure Streaming Platform
                </h1>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#181818] border border-[#333] text-slate-300">
                  AES-256-GCM · WebSocket
                </span>
              </div>
              <p className="text-xs text-slate-400">
                OBS-style control panel for an end-to-end encrypted streaming session.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="hidden sm:flex flex-col items-end text-slate-400">
              <span className="text-[11px]">
                Logged in as{" "}
                <span className="font-semibold text-slate-100">{user?.name}</span>{" "}
                ({user?.role === "streamer" ? "Streamer/Admin" : "Viewer"})
              </span>
              <button
                onClick={onLogout}
                className="mt-1 inline-flex items-center justify-center rounded-full border border-[#333] px-2 py-0.5 text-[11px] text-slate-300 hover:bg-[#1b1b1b] transition"
              >
                Log out
              </button>
            </div>
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-[#101010] border border-[#262626] text-[11px] text-slate-300">
              <Wifi className="w-3 h-3" />
              <span>RTT</span>
              <span className={rtt != null ? "text-emerald-300" : "text-slate-500"}>
                {rtt != null ? `${rtt} ms` : "–"}
              </span>
            </div>
            <div
              className={`px-2 py-1 rounded-full text-[11px] border ${
                connected
                  ? "border-emerald-500/60 bg-[#102018] text-emerald-300"
                  : "border-[#E50914]/70 bg-[#240407] text-[#ff7b86]"
              }`}
            >
              {connected ? "Live WebSocket" : "Disconnected"}
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)] gap-6 items-start">
          {/* Left column – controls */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Session card */}
            <div className="rounded-2xl border border-[#262626] bg-[#111111] shadow-lg shadow-black/70 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#E50914]" />
                  Session Control
                </h2>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#181818] text-slate-300 border border-[#333]">
                  Client ID: {clientId.slice(0, 8)}…
                </span>
              </div>

              <div className="mt-4 space-y-3 text-sm">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                      Role
                    </label>
                    {user?.role === "streamer" ? (
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="w-full rounded-xl bg-[#101010] border border-[#303030] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#E50914]/40"
                      >
                        <option value="host">Host (Streamer)</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <div className="w-full rounded-xl bg-[#101010] border border-[#303030] px-3 py-2 text-sm text-slate-300 flex items-center">
                        Viewer (read-only)
                      </div>
                    )}
                  </div>
                  <div className="flex-[2]">
                    <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                      Session ID
                    </label>
                    <input
                      className="w-full rounded-xl bg-[#101010] border border-[#303030] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#E50914]/40"
                      placeholder="e.g. cis4634-final-demo"
                      value={sessionId}
                      onChange={(e) => setSessionId(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                    WebSocket URL
                  </label>
                  <input
                    className="w-full rounded-xl bg-[#101010] border border-[#303030] px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#E50914]/40 font-mono"
                    value={wsUrl}
                    onChange={(e) => setWsUrl(e.target.value)}
                    disabled={!isHost}
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Point this at your C++ backend, e.g.{" "}
                    <span className="font-mono text-slate-300">ws://localhost:8080/stream</span>
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <ConnectButton />
                  <span className="text-[11px] text-slate-500">
                    Auto-retries every <span className="font-mono">{WS_RETRY_MS}ms</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Crypto card */}
            <div className="rounded-2xl border border-[#262626] bg-[#111111] shadow-lg shadow-black/70 p-5">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#E50914]" />
                AES Key Management
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Per-session AES-256-GCM key. The host derives or loads the key, then shares it
                securely with viewers using your key exchange scheme.
              </p>

              <div className="mt-4 space-y-3 text-sm">
                {isHost && (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 bg-[#E50914] text-sm font-medium text-white hover:bg-[#ff1a25] transition shadow-md shadow-[#E50914]/40 disabled:opacity-60"
                      onClick={handleGenKey}
                      disabled={busy}
                    >
                      <Lock className="w-4 h-4" />
                      <span>Generate AES-256</span>
                    </button>
                    <button
                      className="sm:w-32 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 bg-[#1F1F1F] text-sm font-medium text-slate-100 hover:bg-[#292929] border border-[#333] transition"
                      onClick={handleRotate}
                    >
                      <RotateCw className="w-4 h-4" />
                      <span>Rotate Key</span>
                    </button>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                    AES Key (Base64)
                  </label>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-xl bg-[#101010] border border-[#303030] px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#E50914]/40"
                      placeholder={
                        isHost
                          ? "Generate or paste AES key…"
                          : "Paste AES key shared by host…"
                      }
                      value={aesKeyB64}
                      onChange={(e) => setAesKeyB64(e.target.value)}
                    />
                    <button
                      className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 bg-[#1F1F1F] text-sm text-slate-100 hover:bg-[#292929] border border-[#333] transition"
                      onClick={handleLoadKey}
                    >
                      <Copy className="w-4 h-4" />
                      Load
                    </button>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 space-y-1">
                  <p>
                    • Use a unique <span className="font-mono">IV</span> per frame.
                  </p>
                  <p>
                    • Bind <span className="font-mono">kind:counter</span> into AAD to defend
                    against replays.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right column – preview, chat, log */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Video preview */}
            <div className="rounded-2xl border border-[#262626] bg-[#151515] shadow-lg shadow-black/80 p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Video className="w-4 h-4 text-[#E50914]" />
                  Encrypted Stream Preview
                </h2>
                <span className="text-[11px] text-slate-400">
                  Media will use the same AES key and IV/AAD rules as secure chat.
                </span>
              </div>

              <div className="relative mt-1 aspect-video rounded-xl border border-[#262626] bg-gradient-to-br from-[#0B0B0B] via-[#151515] to-[#101010] flex items-center justify-center overflow-hidden">
                <div className="pointer-events-none absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_rgba(229,9,20,0.22),_transparent_60%)]" />
                <div className="relative z-10 text-center flex flex-col items-center gap-2 px-4">
                  <VideoOff className="w-10 h-10 text-slate-400" />
                  <p className="text-sm text-slate-200">
                    When your C++ backend is ready, push encrypted H.264/AAC fragments over
                    WebSocket and decrypt them here in real time.
                  </p>
                  <p className="text-xs text-slate-400">
                    For now, this preview card represents the “video frame” side of the same hybrid
                    encryption pipeline.
                  </p>
                </div>
              </div>
            </div>

            {/* Chat + notes */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Secure Chat */}
              <div className="rounded-2xl border border-[#262626] bg-[#111111] shadow-md shadow-black/70 p-4">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <Send className="w-4 h-4 text-[#E50914]" />
                  Secure Chat (AES-256-GCM)
                </h3>

                <p className="text-xs text-slate-400 mb-3">
                  Chat messages are encrypted in the browser with AES-256-GCM before being sent over
                  WebSocket. Only clients with the session key can read them.
                </p>

                <div className="space-y-2">
                  <input
                    className="w-full rounded-xl bg-[#101010] border border-[#303030] px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#E50914]/40"
                    placeholder="Type a secure message…"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <button
                      className="w-28 sm:w-32 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 bg-[#E50914] text-sm font-medium text-white hover:bg-[#ff1a25] transition shadow-md shadow-[#E50914]/40"
                      onClick={sendSecureChat}
                    >
                      <Send className="w-4 h-4" />
                      <span>Send</span>
                    </button>
                  </div>
                </div>

                <p className="mt-2 text-[11px] text-slate-500">
                  This is the same encryption path used for media frames, just with smaller payloads.
                </p>
              </div>

              {/* Notes */}
              <div className="rounded-2xl border border-[#262626] bg-[#111111] shadow-md shadow-black/70 p-4 text-sm">
                <h3 className="font-semibold mb-2">
                  {isHost ? "Architecture Notes" : "Session / Viewer Notes"}
                </h3>
                {isHost ? (
                  <ul className="space-y-1.5 text-slate-300 text-xs">
                    <li>
                      • <span className="font-semibold">Host</span> owns session lifecycle, key
                      rotation, and WebSocket endpoint selection.
                    </li>
                    <li>
                      • AES-256-GCM keys are generated or loaded in the browser and never exposed to
                      the backend in plaintext.
                    </li>
                    <li>
                      • WebSocket carries both control messages and encrypted payloads; the server
                      can route data without understanding it.
                    </li>
                    <li>
                      • In a full deployment, add a public-key layer (e.g., X25519) so AES keys are
                      exchanged securely over an untrusted channel.
                    </li>
                  </ul>
                ) : (
                  <ul className="space-y-1.5 text-slate-300 text-xs">
                    <li>
                      • Viewers join by session ID and load the AES key shared by the host via a
                      secure side channel or key exchange.
                    </li>
                    <li>
                      • All decryption happens locally; the server only forwards ciphertext.
                    </li>
                    <li>
                      • Viewers cannot rotate keys or modify transport settings, which models least
                      privilege in an E2EE streaming scenario.
                    </li>
                    <li>
                      • This UI is meant to feel like an OBS monitoring panel dedicated to crypto
                      and transport instead of scenes and sources.
                    </li>
                  </ul>
                )}
              </div>
            </div>

            {/* Event log */}
            <div className="rounded-2xl border border-[#262626] bg-[#101010] shadow-md shadow-black/80 p-4">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#E50914] animate-pulse" />
                Event Log
              </h3>
              <div className="h-44 overflow-auto rounded-xl bg-[#050505] border border-[#1f1f1f] px-3 py-2 text-[11px] font-mono text-slate-300">
                {log.length === 0 && (
                  <div className="text-slate-500 italic">
                    No events yet. Connect, generate/load a key, or send a secure chat message to
                    see the pipeline in action.
                  </div>
                )}
                {log.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap leading-relaxed">
                    {l}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Backend contract */}
        <pre className="mt-8 text-[11px] text-slate-300 bg-[#101010] border border-[#262626] rounded-2xl p-4 overflow-auto font-mono">
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
      </main>
    </div>
  );
}