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
  SignalHigh,
  Radio,
  Wifi,
  RotateCw,
} from "lucide-react";

const WS_RETRY_MS = 1200;
const MAX_LOG = 400;

// ---- Base64 helpers ----
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

// ---- WebCrypto AES-GCM helpers ----
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

// ---- Latency meter hook ----
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

export default function SecureStreamingApp({ username, token, onLogout }) {
  const [role, setRole] = useState("viewer");
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

  // Java key service
  const backendBaseUrl = "http://localhost:8081";

  const pushLog = (msg) =>
    setLog((prev) =>
      prev.length > MAX_LOG ? [...prev.slice(-MAX_LOG / 2), msg] : [...prev, msg]
    );

  // ---- WebSocket connect logic ----
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

    ws.onerror = (e) => {
      pushLog(`WS error: ${JSON.stringify(e)}`);
    };

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

  // ---- AES key helpers (local) ----
  const handleGenKey = async () => {
    setBusy(true);
    try {
      const key = await genAesKey(256);
      setAesKey(key);
      const raw = await exportRawAesKey(key);
      setAesKeyB64(bytesToB64(raw));
      pushLog("🔑 Locally generated AES-256-GCM key.");
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

  // ---- Host: create session key via Java backend ----
  const createSessionKeyFromBackend = async () => {
    if (!sessionId) {
      pushLog("⚠️ Enter a Session ID before creating a key.");
      return;
    }

    try {
      const res = await fetch(`${backendBaseUrl}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const data = await res.json();

      if (data.aesKeyB64) {
        setAesKeyB64(data.aesKeyB64);
        await handleLoadKey();
        pushLog("🔑 AES key loaded from Java backend (host).");
      } else {
        pushLog("❌ Backend did not return aesKeyB64 for /api/session.");
      }
    } catch (err) {
      pushLog("Error calling /api/session: " + err.message);
    }
  };

  // ---- Viewer: join session via Java backend ----
  const joinSessionKeyFromBackend = async () => {
    if (!sessionId) {
      pushLog("⚠️ Enter a Session ID before joining.");
      return;
    }

    try {
      const res = await fetch(`${backendBaseUrl}/api/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const data = await res.json();

      if (data.aesKeyB64) {
        setAesKeyB64(data.aesKeyB64);
        await handleLoadKey();
        pushLog("🔓 AES key loaded from Java backend (viewer).");
      } else {
        pushLog("❌ Backend did not return aesKeyB64 for /api/join.");
      }
    } catch (err) {
      pushLog("Error calling /api/join: " + err.message);
    }
  };

  // ---- Secure chat send ----
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
            ? "bg-emerald-500/10 text-emerald-300 border border-emerald-400/50"
            : "bg-indigo-500 text-white border border-indigo-400 hover:bg-indigo-400"
        }`}
      disabled={connected}
    >
      {connected ? <Plug className="w-4 h-4" /> : <PlugZap className="w-4 h-4" />}
      {connected ? "Connected" : "Connect"}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#050816] text-slate-100">
      {/* Top bar */}
      <header className="border-b border-[#1f2937] bg-[#050816]/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/40">
              <Radio className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight">
                  CIS 4634 – Secure Streaming Platform
                </h1>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#111827] border border-[#1f2937] text-slate-200">
                  AES-GCM • Hybrid key service
                </span>
              </div>
              <p className="text-xs text-slate-400">
                React frontend + Java key server + C++ WebSocket relay for end-to-end encrypted
                streaming.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2 text-slate-400">
                <Wifi className="w-3 h-3" />
                <span>RTT:</span>
                <span className={rtt != null ? "text-emerald-300" : "text-slate-500"}>
                  {rtt != null ? `${rtt} ms` : "–"}
                </span>
              </div>
              {username && (
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="text-[11px] bg-[#111827] px-2 py-0.5 rounded-full border border-[#1f2937]">
                    Logged in as <span className="font-semibold">{username}</span>
                  </span>
                  {onLogout && (
                    <button
                      onClick={onLogout}
                      className="text-[11px] px-2 py-0.5 rounded-full border border-[#1f2937] hover:bg-[#111827]"
                    >
                      Logout
                    </button>
                  )}
                </div>
              )}
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
            <div className="rounded-3xl border border-[#1f2937] bg-[#0b1120]/90 backdrop-blur-xl shadow-xl shadow-black/70 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  Session Control
                </h2>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#020617] text-slate-200 border border-[#1f2937]">
                  Client ID: {clientId.slice(0, 8)}…
                </span>
              </div>

              <div className="mt-4 space-y-3 text-sm">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                      Role
                    </label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full rounded-2xl bg-[#020617] border border-[#1f2937] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/70"
                    >
                      <option value="host">Host (Streamer)</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                  <div className="flex-[2]">
                    <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                      Session ID
                    </label>
                    <input
                      className="w-full rounded-2xl bg-[#020617] border border-[#1f2937] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/70"
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
                    className="w-full rounded-2xl bg-[#020617] border border-[#1f2937] px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/70 font-mono"
                    value={wsUrl}
                    onChange={(e) => setWsUrl(e.target.value)}
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Point this to your C++ backend, e.g.{" "}
                    <span className="font-mono text-slate-200">ws://localhost:8080/stream</span>
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

            {/* AES Key Management */}
            <div className="rounded-3xl border border-[#1f2937] bg-[#0b1120]/90 backdrop-blur-xl shadow-xl shadow-black/70 p-5">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                AES Key Management
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Per-session AES-256-GCM key. Host and viewers fetch the same key from the Java key
                service, then all encryption happens locally in the browser.
              </p>

              <div className="mt-4 space-y-3 text-sm">
                {/* Backend-driven key buttons */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5
                               bg-emerald-500 text-sm font-medium text-emerald-950 hover:bg-emerald-400 transition
                               shadow-md shadow-emerald-500/40 disabled:opacity-60"
                    onClick={createSessionKeyFromBackend}
                    disabled={busy}
                  >
                    <Lock className="w-4 h-4" />
                    <span>Host: Get Key from Backend</span>
                  </button>
                  <button
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5
                               bg-sky-500 text-sm font-medium text-sky-950 hover:bg-sky-400 transition
                               shadow-md shadow-sky-500/40 disabled:opacity-60"
                    onClick={joinSessionKeyFromBackend}
                    disabled={busy}
                  >
                    <SignalHigh className="w-4 h-4" />
                    <span>Viewer: Join & Load Key</span>
                  </button>
                </div>

                {/* Local fallback + rotate */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5
                               bg-[#020617] text-sm font-medium text-slate-100 hover:bg-slate-800
                               border border-[#1f2937] transition disabled:opacity-60"
                    onClick={handleGenKey}
                    disabled={busy}
                  >
                    <Lock className="w-4 h-4" />
                    <span>Generate Local AES-256</span>
                  </button>
                  <button
                    className="sm:w-32 inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5
                              bg-[#020617] text-sm font-medium text-slate-100 hover:bg-slate-800
                              border border-[#1f2937] transition"
                    onClick={handleRotate}
                  >
                    <RotateCw className="w-4 h-4" />
                    <span>Rotate Key</span>
                  </button>
                </div>

                {/* Key text + Load */}
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                    AES Key (Base64)
                  </label>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-2xl bg-[#020617] border border-[#1f2937] px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/70"
                      placeholder="Paste or fetch AES key…"
                      value={aesKeyB64}
                      onChange={(e) => setAesKeyB64(e.target.value)}
                    />
                    <button
                      className="inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2 bg-[#020617] text-sm text-slate-100 hover:bg-slate-800 border border-[#1f2937] transition"
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
                    • Bind <span className="font-mono">kind:counter</span> into AAD for replay
                    protection.
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
            <div className="rounded-3xl border border-[#1f2937] bg-gradient-to-br from-[#020617] via-[#020617] to-[#0b1120] backdrop-blur-xl shadow-xl shadow-black/80 p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Video className="w-4 h-4 text-indigo-400" />
                  Encrypted Stream Preview
                </h2>
                <span className="text-[11px] text-slate-400">
                  Media path will use the same AES key as secure chat.
                </span>
              </div>

              <div className="relative mt-1 aspect-video rounded-2xl border border-[#1f2937] bg-gradient-to-br from-[#020617] via-[#020617] to-[#020617] flex items-center justify-center overflow-hidden">
                <div className="pointer-events-none absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.4),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(34,197,94,0.35),_transparent_60%)]" />
                <div className="relative z-10 text-center flex flex-col items-center gap-2 px-4">
                  <VideoOff className="w-10 h-10 text-slate-400" />
                  <p className="text-sm text-slate-200">
                    When your C++ backend is ready, push encrypted H.264/AAC fragments over
                    WebSocket and decrypt them here.
                  </p>
                  <p className="text-xs text-slate-400">
                    For now, this card proves your front-end session and crypto flow are wired up.
                  </p>
                </div>
              </div>
            </div>

            {/* Chat + notes */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Secure Chat */}
              <div className="rounded-3xl border border-[#1f2937] bg-[#0b1120]/90 backdrop-blur-xl shadow-lg shadow-black/70 p-4">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <Send className="w-4 h-4 text-sky-400" />
                  Secure Chat (AES path)
                </h3>

                <p className="text-xs text-slate-400 mb-3">
                  Messages are encrypted client-side with AES-GCM before being sent over WebSocket.
                  This is your simplest smoke test before streaming media.
                </p>

                <div className="space-y-2">
                  <input
                    className="w-full rounded-2xl bg-[#020617] border border-[#1f2937] px-3 py-2.5 text-sm
                               focus:outline-none focus:ring-2 focus:ring-sky-500/70"
                    placeholder="Type a secure message…"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <button
                      className="w-28 sm:w-32 inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5
                                 bg-sky-500 text-sm font-medium text-sky-950 hover:bg-sky-400 transition
                                 shadow-md shadow-sky-500/40"
                      onClick={sendSecureChat}
                    >
                      <Send className="w-4 h-4" />
                      <span>Send</span>
                    </button>
                  </div>
                </div>

                <p className="mt-2 text-[11px] text-slate-500">
                  Encrypted chat shares the same AES key and IV/AAD rules as your media frames.
                </p>
              </div>

              {/* Architecture notes */}
              <div className="rounded-3xl border border-[#1f2937] bg-[#0b1120]/90 backdrop-blur-xl shadow-lg shadow-black/70 p-4 text-sm">
                <h3 className="font-semibold mb-2">Architecture Notes</h3>
                <ul className="space-y-1.5 text-slate-300 text-xs">
                  <li>
                    • <span className="font-semibold">Java key service</span> holds per-session
                    AES-256 keys indexed by Session ID.
                  </li>
                  <li>
                    • <span className="font-semibold">Browser clients</span> import the key and run
                    AES-GCM locally for chat and media frames.
                  </li>
                  <li>
                    • <span className="font-semibold">C++ WebSocket relay</span> (or future server)
                    just routes encrypted frames; it never sees plaintext.
                  </li>
                  <li>
                    • This demonstrates a hybrid scheme: symmetric AES for data + external service
                    for key management / distribution.
                  </li>
                </ul>
              </div>
            </div>

            {/* Event log */}
            <div className="rounded-3xl border border-[#1f2937] bg-[#020617]/95 backdrop-blur-xl shadow-lg shadow-black/80 p-4">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Event Log
              </h3>
              <div className="h-44 overflow-auto rounded-2xl bg-[#020617] border border-[#1f2937] px-3 py-2 text-[11px] font-mono text-slate-300">
                {log.length === 0 && (
                  <div className="text-slate-500 italic">
                    No events yet. Connect, fetch a key, or send a secure chat message to see the
                    pipeline in action.
                  </div>
                )}
                {log.map((entry, idx) => (
                  <div key={idx} className="whitespace-pre-wrap leading-relaxed">
                    {entry}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}