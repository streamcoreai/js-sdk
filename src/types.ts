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

/**
 * Which recovery mechanism an attempt used.
 *
 * - `ice-restart` keeps the existing transport alive. Only possible while the
 *   connection is `disconnected`; nothing above the transport notices.
 * - `resume` rebuilds the transport and reattaches it to the same server-side
 *   conversation. The only option once the connection has `failed`.
 */
export type ReconnectPhase = "ice-restart" | "resume";

export interface ReconnectEvent {
  /** 1-based attempt number, counted within the phase. */
  attempt: number;
  /** Total attempts this phase will make before moving on or giving up. */
  maxAttempts: number;
  /** Which mechanism this attempt used. */
  phase: ReconnectPhase;
  /**
   * "attempting" while in flight, then the outcome.
   *
   * `recovered-without-history` deserves handling rather than logging: the
   * call works, but the server could not resume the session, so the agent has
   * forgotten the conversation and will not know what was already said.
   */
  outcome: "attempting" | "recovered" | "recovered-without-history" | "failed";
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

  /**
   * How many times to redial with the session's resume token after ICE
   * restart is no longer possible — which is the case as soon as the
   * connection reaches `failed`, and the only case for a client that was
   * suspended or offline longer than ICE tolerates.
   *
   * A redial builds a new transport but reattaches to the same conversation,
   * so history and the agent's memory survive. The deadline is the server's
   * `session_grace_ms` (30s by default) measured from the drop, and the ICE
   * restart phase spends from the same budget. Defaults to 2. Set to 0 to
   * give up once ICE restart fails.
   */
  resumeAttempts?: number;

  /**
   * Delay before the first resume redial, doubling for each retry.
   * Shorter than `reconnectDelayMs` because by this point the connection is
   * known dead — there is nothing left to wait out. Defaults to 1000.
   */
  resumeDelayMs?: number;
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
