# Secure Streaming Platform — CIS 4634 Final Project

This project is our secure streaming prototype for CIS 4634.  
It demonstrates a **hybrid cryptographic scheme** using:

- **React Frontend**
- **Java AES Key Server**
- **AES-256-GCM encryption/decryption in the browser (WebCrypto)**
- **(Future) C++ WebSocket relay** that only transports encrypted frames

The core idea:  
**The backend manages keys.  
The browser encrypts+decrypts.  
The relay never sees plaintext.**

---

## Features

###  Frontend (React + Vite)
- Login screen  
- Host or Viewer mode  
- Create or join a Session ID  
- Fetch AES-256-GCM key from Java backend  
- Locally import AES key  
- Encrypt chat messages with AES-GCM  
- Send encrypted messages over WebSocket  
- Clean event log to visualize the pipeline

###  Java Backend (AES Key Server)
Runs at: **http://localhost:8081**

Endpoints:
- `POST /api/session` → Host creates/receives AES key  
- `POST /api/join` → Viewer loads the same key  
- Keys stored in memory, returned as Base64 (`aesKeyB64`)

###  Hybrid Crypto Architecture
- AES-256-GCM for all encrypted data  
- Java backend manages per-session keys  
- Browser performs all crypto operations  
- WebSocket relay only forwards ciphertext

---

#  Project Structure

```
secure-frontend/
│
├── backend/
│   └── java-service/
│       └── src/
│           └── crypto/
│               └── SessionKeyServer.java
│
└── src/
    ├── App.jsx
    └── components/
        ├── LoginScreen.jsx
        └── SecureStreamingApp.jsx
```

---

# Requirements

You will need:

- **Node.js + npm**
- **Java JDK 17+**  
  Example install:  
  `winget install --id Microsoft.OpenJDK.17 -e`
- **Git**

---

# Running the Entire System

## **1️⃣ Start the Java Key Server**

Open a new terminal:

```powershell
cd secure-frontend/backend/java-service
javac -d out src/crypto/SessionKeyServer.java
java -cp out crypto.SessionKeyServer
```

You should see:

```
SessionKeyServer running on port 8081
```

Leave it running.

---

## **2️⃣ Start the React Frontend**

Open a second terminal:

```powershell
cd secure-frontend
npm install
npm run dev
```

Navigate to:

```
http://localhost:5173/
```

---

# How to Use the App

## **HOST SETUP**
1. Login  
2. Select **Host (Streamer)**  
3. Enter a **Session ID** (example: `cis-demo-1`)  
4. Click **Host: Get Key from Backend**  
5. The AES key loads + logs confirm it

## **VIEWER SETUP**
1. Open a second browser window  
2. Login  
3. Select **Viewer**  
4. Use the **exact same Session ID**  
5. Click **Viewer: Join & Load Key**  
6. Viewer imports the same AES key

Now both clients share an AES-256-GCM key.

## **Secure Chat**
- Type message  
- Browser encrypts with AES-GCM  
- C++ WebSocket (future) relays ciphertext  
- Both sides decrypt locally

---

# Optional Backend Testing (No Browser Needed)

### Create/Get Session Key
```powershell
Invoke-WebRequest -Uri "http://localhost:8081/api/session" `
  -Method POST `
  -Headers @{ "Content-Type" = "application/json" } `
  -Body '{"sessionId":"demo"}'
```

### Viewer Join Session
```powershell
Invoke-WebRequest -Uri "http://localhost:8081/api/join" `
  -Method POST `
  -Headers @{ "Content-Type" = "application/json" } `
  -Body '{"sessionId":"demo"}'
```