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
  whipUrl?: string;
  token?: string;
  tokenUrl?: string;
  apiKey?: string;
  iceServers?: RTCIceServer[];
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
