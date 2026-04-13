export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnected";

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  partial?: boolean;
}

export interface TimingEvent {
  stage: string;
  ms: number;
}

export type AgentState = "listening" | "thinking" | "speaking";

export type DataChannelMessage =
  | { type: "transcript"; text: string; final: boolean }
  | { type: "response"; text: string }
  | { type: "error"; message: string }
  | { type: "timing"; stage: string; ms: number }
  | { type: "state"; state: AgentState };

export interface StreamCoreAIConfig {
  /** WHIP endpoint URL. Defaults to "http://localhost:8080/whip" */
  whipUrl?: string;
  /** JWT token for authenticating with the WHIP endpoint. */
  token?: string;
  /**
   * Token endpoint URL. If set, the client will POST to this URL to fetch
   * a JWT before each WHIP connection. Overrides `token` when both are set.
   */
  tokenUrl?: string;
  /** API key sent as Bearer header when fetching from `tokenUrl`. */
  apiKey?: string;
  /** ICE server configuration. Defaults to Google STUN server. */
  iceServers?: RTCIceServer[];
  /** Audio constraints for getUserMedia. */
  audioConstraints?: MediaTrackConstraints;
}

export interface StreamCoreAIEvents {
  onStatusChange?: (status: ConnectionStatus) => void;
  onTranscript?: (entry: TranscriptEntry, all: TranscriptEntry[]) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
  onTiming?: (event: TimingEvent) => void;
  onAgentStateChange?: (state: AgentState) => void;
}
