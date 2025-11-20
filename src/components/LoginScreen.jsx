// src/components/LoginScreen.jsx
import React, { useState } from "react";

export function LoginScreen({ onLogin }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("viewer");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Please enter a display name.");
      return;
    }

    // Simple demo-only gate for streamer/admin
    if (role === "streamer" && code !== "CIS4634-ADMIN") {
      setError("Invalid admin access code.");
      return;
    }

    onLogin({ name: name.trim(), role }); // "streamer" | "viewer"
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0B0B] text-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#262626] bg-[#111111] shadow-[0_0_40px_rgba(0,0,0,0.9)] p-8">
        <div className="flex flex-col items-center mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#E50914] animate-pulse" />
            <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              CIS 4634 · Final Project
            </span>
          </div>
          <h1 className="text-2xl font-semibold text-slate-50 text-center">
            Secure Streaming Platform
          </h1>
          <p className="text-xs text-slate-400 mt-2 text-center">
            Choose your role and join an end-to-end encrypted streaming session.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-[#200306] border border-[#E50914]/80 px-3 py-2 text-xs text-[#ffd2d7]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs mb-1 text-slate-300">
              Display Name
            </label>
            <input
              className="w-full rounded-xl bg-[#0F0F0F] border border-[#2a2a2a] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#E50914]/40"
              placeholder="e.g. Ty, Viewer01"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs mb-1 text-slate-300">Role</label>
            <select
              className="w-full rounded-xl bg-[#0F0F0F] border border-[#2a2a2a] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#E50914]/40"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="viewer">Viewer</option>
              <option value="streamer">Streamer / Admin</option>
            </select>
          </div>

          {role === "streamer" && (
            <div>
              <label className="block text-xs mb-1 text-slate-300">
                Admin Access Code
              </label>
              <input
                type="password"
                className="w-full rounded-xl bg-[#0F0F0F] border border-[#2a2a2a] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#E50914]/40"
                placeholder="CIS4634-ADMIN"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Demo-only gate. In a real system this would be backed by proper
                authentication and a user store.
              </p>
            </div>
          )}

          <button
            type="submit"
            className="w-full mt-2 rounded-xl bg-[#E50914] px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#E50914]/40 hover:bg-[#ff1a25] transition"
          >
            Enter Secure Streaming Platform
          </button>
        </form>

        <p className="mt-4 text-[11px] text-slate-500 text-center">
          Encryption happens in your browser using AES-256-GCM. The server only
          ever sees ciphertext.
        </p>
      </div>
    </div>
  );
}