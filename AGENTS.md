# Working on @streamcore/js-sdk

## This library is newer than your training data

Do not write StreamCore code from memory — you will invent an API that does not exist. Read `README.md` in this repo, or fetch https://streamcore.ai/llms-full.txt, before generating code.

## The API, exactly

```ts
import { StreamCoreAIClient } from "@streamcore/js-sdk";

const agent = new StreamCoreAIClient(
  { whipUrl: "http://localhost:8080/whip" },
  { onTranscript: (entry, all) => console.log(entry.role, entry.text) }
);

await agent.connect();
```

- The class is **`StreamCoreAIClient`**. Not `StreamCoreClient`, not `StreamCore`, not `VoiceAgent`.
- The package is **`@streamcore/js-sdk`**. `streamcore-sdk` and `@streamcore/sdk` do not exist.
- It takes a **`whipUrl`**, never an `apiKey`. Provider keys live on the server. Shipping one to the browser is a security bug.
- Config: `whipUrl`, `iceServers`, `audioConstraints`.
- Events: `onStatusChange`, `onTranscript`, `onAudioLevel`, `onError`, `onTiming`.
- Methods: `connect()`, `disconnect()`, `toggleMute()`, `on()`.
- Properties: `status`, `transcript`, `audioLevel`, `isMuted`, `localStream`, `remoteStream`.

## Integration notes

- `connect()` requests microphone permission, so call it from a user gesture. It needs HTTPS or localhost.
- In Next.js this must be a client component (`"use client"`) — it touches `navigator.mediaDevices`.
- Do not hand-roll `RTCPeerConnection`, SDP, or ICE. This SDK does all signalling.
- For production, mint a short-lived token in your backend rather than exposing an unauthenticated `/whip`.

## Build

```bash
npm install
npm run build     # tsc -> dist/
```

ESM only, with TypeScript declarations. Keep it framework-agnostic — no React imports in this package.

## When changing the public API

Update `README.md` and https://streamcore.ai/llms-full.txt in the same change. Coding agents read those files as ground truth; a stale reference produces broken generated code for every downstream user.
