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

export type DataChannelMessage =
  | { type: "transcript"; text: string; final: boolean }
  | { type: "response"; text: string }
  | { type: "error"; message: string }
  | { type: "timing"; stage: string; ms: number };

export interface StreamCoreAIConfig {
  /** WHIP endpoint URL. Defaults to "http://localhost:8080/whip" */
  whipUrl?: string;
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
}
