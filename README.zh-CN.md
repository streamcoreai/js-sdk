# @streamcore/js-sdk

[English](./README.md) | **简体中文**

框架无关的 TypeScript SDK，通过 WebRTC + WHIP 连接 [StreamCoreAI](https://github.com/streamcoreai/streamcore-server) 服务端。

## 安装

```bash
npm install @streamcore/js-sdk
```

## 快速开始

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

创建一个新的客户端实例。

#### `StreamCoreAIConfig`

| 属性           | 类型                   | 默认值                              | 说明                          |
| ------------------ | ---------------------- | ------------------------------------ | ------------------------------------ |
| `whipUrl`          | `string`               | `"http://localhost:8080/whip"`       | WHIP 信令端点 URL          |
| `token`            | `string`               | —                                    | 预先获取的 JWT，在 WHIP 请求中以 `Authorization: Bearer` 发送 |
| `tokenUrl`         | `string`               | —                                    | `connect()` 期间 SDK `POST` 获取短时效 token 的端点 |
| `apiKey`           | `string`               | —                                    | 调用 `tokenUrl` 时以 `Authorization: Bearer` 发送 |
| `iceServers`       | `RTCIceServer[]`       | `[{ urls: "stun:stun.l.google.com:19302" }]` | ICE 服务器配置 |
| `audioConstraints` | `MediaTrackConstraints`| `{ echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true, channelCount: 1 }` | 麦克风约束 |

#### `StreamCoreAIEvents`

| 事件                | 签名                                              | 说明                        |
| -------------------- | ------------------------------------------------------ | ---------------------------------- |
| `onStatusChange`     | `(status: ConnectionStatus) => void`                   | 连接状态变化时触发 |
| `onTranscript`       | `(entry: TranscriptEntry, all: TranscriptEntry[]) => void` | 有新的或更新的转写时触发 |
| `onAudioLevel`       | `(level: number) => void`                              | 每一帧动画触发一次，携带麦克风电平（0–1） |
| `onAgentStateChange` | `(state: AgentState) => void`                          | 智能体开始聆听、思考或说话时触发 |
| `onError`            | `(error: Error) => void`                               | 连接或服务端错误时触发 |
| `onTiming`           | `(event: TimingEvent) => void`                         | 携带服务端流水线耗时信息 |

### 实例方法

| 方法          | 返回值         | 说明                                       |
| --------------- | --------------- | ------------------------------------------------- |
| `connect()`     | `Promise<void>` | 请求麦克风权限，建立 WebRTC + WHIP 会话       |
| `disconnect()`  | `void`          | 拆除连接、停止麦克风、释放资源     |
| `toggleMute()`  | `void`          | 切换麦克风静音                             |
| `on(event, fn)` | `void`          | 在构造之后注册事件监听器      |

### 实例属性（只读）

| 属性     | 类型                 | 说明                          |
| ------------ | -------------------- | ------------------------------------ |
| `status`     | `ConnectionStatus`   | `"idle" \| "connecting" \| "connected" \| "error" \| "disconnected"` |
| `transcript` | `TranscriptEntry[]`  | 完整对话历史            |
| `audioLevel` | `number`             | 当前麦克风音频电平（0–1）        |
| `isMuted`    | `boolean`            | 麦克风是否静音             |
| `localStream`| `MediaStream \| null` | 本地麦克风流（connect 之后） |
| `remoteStream`| `MediaStream \| null`| 远端智能体音频流（connect 之后） |

### 类型

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

### 底层辅助函数

包中也导出了原始的 WHIP 调用，便于构建自定义客户端：

```ts
import { whipOffer, whipDelete } from "@streamcore/js-sdk";

const { answerSDP, sessionURL } = await whipOffer(whipUrl, offerSDP, token?);
await whipDelete(sessionURL, token?);
```

大多数应用应改用 `StreamCoreAIClient` —— 它会处理 peer 建立、ICE 收集、`events` DataChannel、音频电平计量和拆除。

## 鉴权

当服务端设置了 `jwt_secret` 时，`/whip` 需要 bearer token。不要把服务商 API key 放进浏览器 —— 它们属于服务端的 `config.toml`。正确做法是让客户端去取一个短时效 token：

```ts
const agent = new StreamCoreAIClient({
  whipUrl: "https://agent.example.com/whip",
  tokenUrl: "https://api.example.com/agent-token",
  apiKey: process.env.NEXT_PUBLIC_APP_KEY,
});
```

在 `connect()` 期间，SDK 会 `POST` 到 `tokenUrl`（若提供了 `apiKey` 则作为 bearer token 发送），并期望返回 `{ "token": "..." }`。如果同时设置了 `token` 和 `tokenUrl`，以 `tokenUrl` 为准。token 会被缓存，以便 `disconnect()` 能对 WHIP `DELETE` 完成鉴权。

## 从源码构建

```bash
cd typescript-sdk
npm install
npm run build
```

编译产物输出到 `dist/`。

## 配合打包工具使用

SDK 以 ES module 形式发布并附带 TypeScript 声明文件。它在 Vite、webpack、Next.js、esbuild 及其他现代打包工具中开箱即用。

## 许可证

Apache 2.0
