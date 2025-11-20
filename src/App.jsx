// src/App.jsx
import React, { useState } from "react";
import { LoginScreen } from "./components/LoginScreen";
import { SecureStreamingApp } from "./components/SecureStreamingApp";

export default function App() {
  const [user, setUser] = useState(null); // { name, role: "streamer" | "viewer" }

  if (!user) {
    return <LoginScreen onLogin={setUser} />;
  }

  const handleLogout = () => setUser(null);

  return <SecureStreamingApp user={user} onLogout={handleLogout} />;
}
