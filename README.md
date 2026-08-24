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
| `reconnectAttempts`| `number`               | `3`                                  | ICE restarts to attempt while the connection is `disconnected`. `0` disables the phase. See [Reconnection](#reconnection) |
| `reconnectDelayMs` | `number`               | `2000`                               | Wait before the first ICE restart, doubling each retry |
| `resumeAttempts`   | `number`               | `2`                                  | Resume redials to attempt once the connection has `failed`. `0` disables the phase |
| `resumeDelayMs`    | `number`               | `1000`                               | Wait before the first redial, doubling each retry |

#### `StreamCoreAIEvents`

| Event                | Signature                                              | Description                        |
| -------------------- | ------------------------------------------------------ | ---------------------------------- |
| `onStatusChange`     | `(status: ConnectionStatus) => void`                   | Fired when connection status changes |
| `onTranscript`       | `(entry: TranscriptEntry, all: TranscriptEntry[]) => void` | Fired on new or updated transcript |
| `onAudioLevel`       | `(level: number) => void`                              | Fired every animation frame with mic level (0–1) |
| `onAgentStateChange` | `(state: AgentState) => void`                          | Fired when the agent starts listening, thinking, or speaking |
| `onError`            | `(error: Error) => void`                               | Fired on connection or server errors |
| `onTiming`           | `(event: TimingEvent) => void`                         | Fired with server-side pipeline timing info |
| `onReconnect`        | `(info: ReconnectEvent) => void`                       | Fired per recovery attempt and once on the outcome. Watch for `recovered-without-history` |
| `onDataChannelMessage` | `(message: DataChannelMessage) => void`              | Fired for every raw data-channel message, before the typed callbacks |
| `onData`             | `(topic: string, payload: Uint8Array) => void`         | Fire-and-forget server data packet, payload already base64-decoded (`movement.command` carries locomotion commands) |

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
| `status`     | `ConnectionStatus`   | `"idle" \| "connecting" \| "connected" \| "reconnecting" \| "error" \| "disconnected"` |
| `transcript` | `TranscriptEntry[]`  | Full conversation history            |
| `audioLevel` | `number`             | Current mic audio level (0–1)        |
| `isMuted`    | `boolean`            | Whether the mic is muted             |
| `localStream`| `MediaStream \| null` | Local microphone stream (after connect) |
| `remoteStream`| `MediaStream \| null`| Remote agent audio stream (after connect) |

### Types

```ts
type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  // The transport dropped and recovery is in flight. Not terminal — the
  // session, and with it the conversation, is still alive on the server.
  | "reconnecting"
  | "error"
  | "disconnected";

type AgentState = "listening" | "thinking" | "speaking";

// Which mechanism a recovery attempt used. See Reconnection below.
type ReconnectPhase = "ice-restart" | "resume";

interface ReconnectEvent {
  attempt: number;      // 1-based, counted within the phase
  maxAttempts: number;
  phase: ReconnectPhase;
  // "recovered-without-history" means the call works but the agent has
  // forgotten the conversation — worth surfacing, not just logging.
  outcome: "attempting" | "recovered" | "recovered-without-history" | "failed";
  error?: Error;
}

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
  | { type: "state"; state: AgentState }
  | { type: "connection"; state: "reconnecting" | "connected" };
```

### Reconnection

A network change mid-call — Wi-Fi to cellular, a VPN toggle, a laptop moving
networks, a phone asleep in a pocket — kills the transport without ending the
call. The SDK recovers it automatically and the conversation survives: the
agent still knows who you are and does not replay its greeting.

Recovery runs as a **ladder of two phases**, because they are good at different
things:

| Phase | When | Cost |
|-------|------|------|
| **ICE restart** | While the connection is `disconnected` | Invisible. Same peer connection, same DTLS, same tracks — just new candidates. |
| **Resume redial** | Once the connection has `failed` | A full renegotiation and a moment of silence, but the server reattaches you to the same conversation. |

ICE restart is tried first because it costs nothing. It stops being possible
the moment the connection reaches `failed` — the server has closed its peer by
then — which is exactly where a backgrounded tab or a laptop that slept lands.
That is what the resume phase is for.

Status goes `connected` → `reconnecting` → `connected` throughout. Subscribe to
`onReconnect` for per-attempt detail:

```ts
const agent = new StreamCoreAIClient(
  {
    whipUrl,
    reconnectAttempts: 3,   // ICE restarts,  2s → 4s → 8s
    reconnectDelayMs: 2000,
    resumeAttempts: 2,      // then redials,  1s → 2s
    resumeDelayMs: 1000,
  },
  {
    onStatusChange: (s) => setBanner(s === "reconnecting" ? "Reconnecting…" : ""),
    onReconnect: ({ phase, attempt, maxAttempts, outcome }) => {
      console.log(`${phase} ${attempt}/${maxAttempts}: ${outcome}`);
      if (outcome === "recovered-without-history") {
        toast("Reconnected, but I've lost track of our conversation.");
      }
    },
  }
);
```

**Handle `recovered-without-history`.** It means the call is working but the
server could not resume the session — usually because the client was away
longer than `session_grace_ms` — so the agent has no memory of anything said
before. Everything still functions, which is precisely why users will not
notice until the agent asks a question it was already answered. Say so in the
UI.

Two details worth knowing:

- **The first ICE restart is deliberately delayed** (`reconnectDelayMs`,
  default 2s). Most drops are brief packet loss that ICE repairs unaided, and
  patching immediately would spend an attempt on a connection that was about to
  recover by itself.
- **Both phases share one deadline.** `disconnected` becomes `failed` after
  roughly 25 seconds, and the server then holds the conversation for
  `session_grace_ms` (30s by default). The defaults fit comfortably; if you
  raise `reconnectAttempts`, you are spending budget the resume phase would
  otherwise have.

If every phase fails, or the session is gone (404/409), the status becomes
`disconnected` and recovery is up to your app: call `connect()` again for a
fresh conversation. Set `reconnectAttempts: 0` to skip ICE restart,
`resumeAttempts: 0` to skip redials, or both to handle drops yourself.

The microphone stream is reused across a redial, so no second permission prompt
and no device re-acquisition.

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

### Caller identity

If you use an external agent and want it to remember a user across separate calls, it needs to know who is calling. This SDK has no `resourceId` option, and that is deliberate — a browser asserting its own identity is a claim anyone can edit in devtools.

Set it on the **server** that backs your `tokenUrl` instead. That endpoint already knows which user is signed in, and it holds the API key that StreamCore's `/token` requires:

```ts
// your backend, at POST /agent-token
const res = await fetch("https://agent.example.com/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.STREAMCORE_API_KEY}`,
  },
  body: JSON.stringify({ resource_id: session.user.id }),
});
return Response.json(await res.json()); // { token } — hand it to the browser
```

StreamCore signs the identity into the token, then forwards it to your agent as `resource_id` on every turn. See [Protocol → Caller identity](../server/docs/protocol.md#caller-identity) and [Bring your own agent](../server/docs/bring-your-own-agent.md).

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
