# @streamcore/js-sdk

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
| `iceServers`       | `RTCIceServer[]`       | `[{ urls: "stun:stun.l.google.com:19302" }]` | ICE server configuration |
| `audioConstraints` | `MediaTrackConstraints`| `{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }` | Microphone constraints |

#### `StreamCoreAIEvents`

| Event            | Signature                                              | Description                        |
| ---------------- | ------------------------------------------------------ | ---------------------------------- |
| `onStatusChange` | `(status: ConnectionStatus) => void`                   | Fired when connection status changes |
| `onTranscript`   | `(entry: TranscriptEntry, all: TranscriptEntry[]) => void` | Fired on new or updated transcript |
| `onAudioLevel`   | `(level: number) => void`                              | Fired every animation frame with mic level (0–1) |
| `onError`        | `(error: Error) => void`                               | Fired on connection or server errors |
| `onTiming`       | `(event: TimingEvent) => void`                         | Fired with server-side pipeline timing info |

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

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  partial?: boolean;
}

interface TimingEvent {
  stage: string;
  ms: number;
}
```

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
