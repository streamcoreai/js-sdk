export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  /**
   * The transport dropped and an ICE restart is in flight. The session, and
   * with it the conversation, is still alive on the server — this is not a
   * terminal state and usually resolves back to "connected".
   */
  | "reconnecting"
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

export interface ReconnectEvent {
  /** 1-based attempt number. */
  attempt: number;
  /** Total attempts that will be made before giving up. */
  maxAttempts: number;
  /** "attempting" while in flight, then the outcome. */
  outcome: "attempting" | "recovered" | "failed";
  /** Why the last attempt failed, when `outcome` is "failed". */
  error?: Error;
}

export type DataChannelMessage =
  | { type: "transcript"; text: string; final: boolean }
  | { type: "response"; text: string }
  | { type: "error"; message: string }
  | { type: "timing"; stage: string; ms: number }
  | { type: "state"; state: AgentState }
  | { type: "connection"; state: "reconnecting" | "connected" };

export interface StreamCoreAIConfig {
  whipUrl?: string;
  token?: string;
  tokenUrl?: string;
  apiKey?: string;
  iceServers?: RTCIceServer[];
  audioConstraints?: MediaTrackConstraints;

  /**
   * How many ICE restarts to attempt before giving up on a dropped
   * connection. Attempts are spaced by `reconnectDelayMs` doubling each
   * time, and the whole sequence must finish inside the ~25 seconds it takes
   * the connection to go from `disconnected` to `failed` — past that the
   * server has closed the peer and only a fresh `connect()` recovers.
   * Defaults to 3. Set to 0 to disable automatic reconnection.
   */
  reconnectAttempts?: number;

  /**
   * Delay before the first ICE restart attempt, doubling for each retry.
   * The initial wait matters: most `disconnected` transitions are brief
   * packet loss that ICE repairs on its own, and patching immediately would
   * spend a restart on a connection that was about to recover by itself.
   * Defaults to 2000.
   */
  reconnectDelayMs?: number;
}

export interface StreamCoreAIEvents {
  onStatusChange?: (status: ConnectionStatus) => void;
  /**
   * Fired for each ICE restart attempt and once when the outcome is known.
   * Useful for a "reconnecting…" indicator that distinguishes a recoverable
   * drop from a lost call.
   */
  onReconnect?: (info: ReconnectEvent) => void;
  onTranscript?: (entry: TranscriptEntry, all: TranscriptEntry[]) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
  onTiming?: (event: TimingEvent) => void;
  onAgentStateChange?: (state: AgentState) => void;
}
