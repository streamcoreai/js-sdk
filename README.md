# @streamcore/js-sdk

**English** | [简体中文](./README.zh-CN.md)

Framework-agnostic TypeScript SDK for connecting to a [StreamCoreAI](https://github.com/streamcoreai/streamcore-server) server via WebRTC + WHIP.

## Installation

```bash
npm install @streamcore/js-sdk
```

## Quick Start

```ts
import { StreamCoreAIClient } from "@streamcore/js-sdk";

const agent = new StreamCoreAIClient(
  { whipUrl: "http://localhost:8080/whip" },
  {
    onStatusChange: (status) => console.log("Status:", status),
    onTranscript: (entry, all) => console.log("Transcript:", entry),
    onAudioLevel: (level) => console.log("Audio level:", level),
    onAgentStateChange: (state) => console.log("Agent:", state),
    onError: (err) => console.error("Error:", err),
  }
);

// Connect (requests microphone permission, establishes WebRTC session)
await agent.connect();

// Mute / unmute
agent.toggleMute();
console.log("Muted:", agent.isMuted);

// Disconnect
agent.disconnect();
```

## API

### `new StreamCoreAIClient(config?, events?)`

Creates a new client instance.

#### `StreamCoreAIConfig`

| Property           | Type                   | Default                              | Description                          |
| ------------------ | ---------------------- | ------------------------------------ | ------------------------------------ |
| `whipUrl`          | `string`               | `"http://localhost:8080/whip"`       | WHIP signaling endpoint URL          |
| `token`            | `string`               | —                                    | Pre-fetched JWT, sent as `Authorization: Bearer` on the WHIP request |
| `tokenUrl`         | `string`               | —                                    | Endpoint the SDK `POST`s to for a short-lived token during `connect()` |
| `apiKey`           | `string`               | —                                    | Sent as `Authorization: Bearer` when calling `tokenUrl` |
| `iceServers`       | `RTCIceServer[]`       | `[{ urls: "stun:stun.l.google.com:19302" }]` | ICE server configuration |
| `audioConstraints` | `MediaTrackConstraints`| `{ echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true, channelCount: 1 }` | Microphone constraints |

#### `StreamCoreAIEvents`

| Event                | Signature                                              | Description                        |
| -------------------- | ------------------------------------------------------ | ---------------------------------- |
| `onStatusChange`     | `(status: ConnectionStatus) => void`                   | Fired when connection status changes |
| `onTranscript`       | `(entry: TranscriptEntry, all: TranscriptEntry[]) => void` | Fired on new or updated transcript |
| `onAudioLevel`       | `(level: number) => void`                              | Fired every animation frame with mic level (0–1) |
| `onAgentStateChange` | `(state: AgentState) => void`                          | Fired when the agent starts listening, thinking, or speaking |
| `onError`            | `(error: Error) => void`                               | Fired on connection or server errors |
| `onTiming`           | `(event: TimingEvent) => void`                         | Fired with server-side pipeline timing info |

### Instance Methods

| Method          | Returns         | Description                                       |
| --------------- | --------------- | ------------------------------------------------- |
| `connect()`     | `Promise<void>` | Request mic, establish WebRTC + WHIP session       |
| `disconnect()`  | `void`          | Tear down connection, stop mic, free resources     |
| `toggleMute()`  | `void`          | Toggle microphone mute                             |
| `on(event, fn)` | `void`          | Register an event listener after construction      |

### Instance Properties (read-only)

| Property     | Type                 | Description                          |
| ------------ | -------------------- | ------------------------------------ |
| `status`     | `ConnectionStatus`   | `"idle" \| "connecting" \| "connected" \| "error" \| "disconnected"` |
| `transcript` | `TranscriptEntry[]`  | Full conversation history            |
| `audioLevel` | `number`             | Current mic audio level (0–1)        |
| `isMuted`    | `boolean`            | Whether the mic is muted             |
| `localStream`| `MediaStream \| null` | Local microphone stream (after connect) |
| `remoteStream`| `MediaStream \| null`| Remote agent audio stream (after connect) |

### Types

```ts
type ConnectionStatus = "idle" | "connecting" | "connected" | "error" | "disconnected";

type AgentState = "listening" | "thinking" | "speaking";

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  partial?: boolean;
}

interface TimingEvent {
  stage: string;
  ms: number;
}

type DataChannelMessage =
  | { type: "transcript"; text: string; final: boolean }
  | { type: "response"; text: string }
  | { type: "error"; message: string }
  | { type: "timing"; stage: string; ms: number }
  | { type: "state"; state: AgentState };
```

### Reconnection

A network change mid-call — Wi-Fi to cellular, a VPN toggle, a laptop moving networks — kills the transport without ending the call. The SDK recovers it with an ICE restart, which keeps the *same* server session: the conversation history, the rolling summary, and the agent's state all survive, and there is no repeated greeting. This is automatic; nothing is required of your app.

Status goes `connected` → `reconnecting` → `connected`. Subscribe to `onReconnect` if you want per-attempt detail:

```ts
const agent = new StreamCoreAIClient(
  { whipUrl, reconnectAttempts: 3, reconnectDelayMs: 2000 },
  {
    onStatusChange: (s) => setBanner(s === "reconnecting" ? "Reconnecting…" : ""),
    onReconnect: ({ attempt, maxAttempts, outcome }) => {
      console.log(`ICE restart ${attempt}/${maxAttempts}: ${outcome}`);
    },
  }
);
```

Two details worth knowing:

- **The first attempt is deliberately delayed** (`reconnectDelayMs`, default 2s). Most drops are brief packet loss that ICE repairs unaided, and patching immediately would spend a restart on a connection that was about to recover by itself.
- **The whole sequence must finish within ~25 seconds.** That is how long WebRTC takes to escalate from `disconnected` to `failed`, at which point the server closes the peer and the session is gone for good. The defaults (3 attempts at 2s, 4s, 8s) fit inside that window — if you raise `reconnectAttempts`, keep the total under it, or the last attempts are wasted.

If every attempt fails, or the server reports the session is gone (404/409), the status becomes `disconnected` and recovery is up to your app: call `connect()` again for a fresh session.

Set `reconnectAttempts: 0` to disable and handle drops yourself.

### Low-level helpers

The package also exports the raw WHIP calls, for building a custom client:

```ts
import {
  whipOffer,
  whipDelete,
  whipRestartIce,
  iceFragmentFromSdp,
  applyIceFragment,
} from "@streamcore/js-sdk";

const { answerSDP, sessionURL, etag } = await whipOffer(whipUrl, offerSDP, token?);

// ICE restart (RFC 9725 §4.4): PATCH a fragment, fold the reply back in.
const { fragment, etag: newEtag } = await whipRestartIce(
  sessionURL,
  iceFragmentFromSdp(pc.localDescription.sdp),
  etag,
  token
);
const answerSdp = applyIceFragment(pc.currentRemoteDescription.sdp, fragment);

await whipDelete(sessionURL, token?);
```

Most applications should use `StreamCoreAIClient` instead — it handles peer setup, ICE gathering, the `events` DataChannel, audio metering, and teardown.

## Authentication

When the server sets `jwt_secret`, `/whip` requires a bearer token. Do not put provider API keys in the browser — they belong in the server's `config.toml`. Instead, have the client fetch a short-lived token:

```ts
const agent = new StreamCoreAIClient({
  whipUrl: "https://agent.example.com/whip",
  tokenUrl: "https://api.example.com/agent-token",
  apiKey: process.env.NEXT_PUBLIC_APP_KEY,
});
```

During `connect()`, the SDK `POST`s to `tokenUrl` (sending `apiKey` as a bearer token if provided) and expects `{ "token": "..." }` back. If both `token` and `tokenUrl` are set, `tokenUrl` wins. The token is cached so `disconnect()` can authenticate the WHIP `DELETE`.

## Building from Source

```bash
cd typescript-sdk
npm install
npm run build
```

The compiled output is written to `dist/`.

## Usage with Bundlers

The SDK ships as ES modules with TypeScript declarations. It works out of the box with Vite, webpack, Next.js, esbuild, and other modern bundlers.

## License

Apache2.0
