import { whipOffer, whipDelete, whipRestartIce, WHIPRestartError } from "./whip.js";
import { applyIceFragment, iceFragmentFromSdp } from "./icerestart.js";
import type {
  ConnectionStatus,
  TranscriptEntry,
  DataChannelMessage,
  StreamCoreAIConfig,
  StreamCoreAIEvents,
} from "./types.js";

const DEFAULT_WHIP_URL = "http://localhost:8080/whip";
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];
const DEFAULT_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  voiceIsolation: true,
  channelCount: 1,
} as MediaTrackConstraints;
const DEFAULT_RECONNECT_ATTEMPTS = 3;
const DEFAULT_RECONNECT_DELAY_MS = 2000;
const ICE_GATHERING_TIMEOUT_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StreamCoreAIClient {
  private config: Required<Omit<StreamCoreAIConfig, "token" | "tokenUrl" | "apiKey">> & Pick<StreamCoreAIConfig, "token" | "tokenUrl" | "apiKey">;
  private events: StreamCoreAIEvents;

  private pc: RTCPeerConnection | null = null;
  private sessionURL = "";
  /**
   * Most recently used JWT (either the static `config.token` or one fetched
   * from `config.tokenUrl` during `connect`). `disconnect` reuses this so
   * the WHIP DELETE is properly authenticated; otherwise servers enforcing
   * Bearer auth on `/whip` reject the teardown and skip server-side
   * finalization (billing, transcript persistence, etc.).
   */
  private lastToken: string | undefined;
  /** ETag of the current ICE session, sent as `If-Match` on an ICE restart. */
  private etag = "";
  /** Set while an ICE restart sequence is running, so it is never doubled up. */
  private reconnecting = false;
  /** Bumped by disconnect() so an in-flight reconnect abandons itself. */
  private generation = 0;
  private stream: MediaStream | null = null;
  private meterStream: MediaStream | null = null;
  private _remoteStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrame = 0;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private assistantBuf = "";

  private _status: ConnectionStatus = "idle";
  private _transcript: TranscriptEntry[] = [];
  private _audioLevel = 0;
  private _isMuted = false;

  constructor(config: StreamCoreAIConfig = {}, events: StreamCoreAIEvents = {}) {
    this.config = {
      whipUrl: config.whipUrl ?? DEFAULT_WHIP_URL,
      token: config.token,
      tokenUrl: config.tokenUrl,
      apiKey: config.apiKey,
      iceServers: config.iceServers ?? DEFAULT_ICE_SERVERS,
      audioConstraints: config.audioConstraints ?? DEFAULT_AUDIO_CONSTRAINTS,
      reconnectAttempts: config.reconnectAttempts ?? DEFAULT_RECONNECT_ATTEMPTS,
      reconnectDelayMs: config.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
    };
    this.events = events;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get transcript(): TranscriptEntry[] {
    return this._transcript;
  }

  get audioLevel(): number {
    return this._audioLevel;
  }

  get isMuted(): boolean {
    return this._isMuted;
  }

  get localStream(): MediaStream | null {
    return this.stream;
  }

  get remoteStream(): MediaStream | null {
    return this._remoteStream;
  }

  async connect(): Promise<void> {
    try {
      this.setStatus("connecting");
      this._transcript = [];
      this.assistantBuf = "";

      const pc = new RTCPeerConnection({
        iceServers: this.config.iceServers,
        bundlePolicy: "max-bundle",
      });
      this.pc = pc;

      const dc = pc.createDataChannel("events");
      dc.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as DataChannelMessage;
          this.handleDataChannelMessage(msg);
        } catch {
          console.error("[streamcoreai-sdk] failed to parse DC message", e.data);
        }
      };

      pc.ontrack = (e) => {
        const remoteStream = new MediaStream([e.track]);
        this._remoteStream = remoteStream;

        const audioEl = new Audio();
        audioEl.srcObject = remoteStream;
        audioEl.autoplay = true;
        audioEl.muted = false;
        audioEl.volume = 1.0;
        this.remoteAudio = audioEl;

        const tryPlay = () => {
          audioEl.play().catch(() => {
            const resumeOnGesture = () => {
              audioEl.play().catch(() => {});
              document.removeEventListener("click", resumeOnGesture);
              document.removeEventListener("touchstart", resumeOnGesture);
            };
            document.addEventListener("click", resumeOnGesture, { once: true });
            document.addEventListener("touchstart", resumeOnGesture, { once: true });
          });
        };
        tryPlay();
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "connected") {
          this.setStatus("connected");
        } else if (state === "disconnected") {
          // Transient. ICE often repairs this on its own, so the restart
          // sequence waits before spending an attempt — but if the local
          // address changed it never will, and this is the only window in
          // which a restart can still work: at ~25s the server sees `failed`,
          // closes the peer, and the session becomes unrecoverable.
          void this.reconnect();
        } else if (state === "failed" || state === "closed") {
          this.setStatus("disconnected");
          this.cleanupAudioLevel();
        }
      };

      pc.onicecandidate = () => {};

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: this.config.audioConstraints,
      });
      this.stream = stream;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      this.startAudioLevelMonitoring(stream);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await this.waitForIceGathering(pc, true);

      let token = this.config.token;
      if (this.config.tokenUrl) {
        const tokenHeaders: Record<string, string> = {};
        if (this.config.apiKey) {
          tokenHeaders["Authorization"] = `Bearer ${this.config.apiKey}`;
        }
        const tokenRes = await fetch(this.config.tokenUrl, { method: "POST", headers: tokenHeaders });
        if (!tokenRes.ok) {
          throw new Error(`Token request failed (${tokenRes.status})`);
        }
        const tokenData = await tokenRes.json();
        token = tokenData.token;
      }

      // Cache the token so `disconnect` can authenticate the WHIP DELETE.
      this.lastToken = token;

      const { answerSDP, sessionURL, etag } = await whipOffer(
        this.config.whipUrl,
        pc.localDescription!.sdp,
        token
      );
      this.sessionURL = sessionURL;
      this.etag = etag;

      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: "answer", sdp: answerSDP })
      );
    } catch (err) {
      console.error("[streamcoreai-sdk] connect error:", err);
      this.setStatus("error");
      this.events.onError?.(
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  disconnect(): void {
    // Abandons any in-flight ICE restart: it would otherwise PATCH a session
    // this call is about to DELETE.
    this.generation++;
    this.cleanupAudioLevel();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this._remoteStream = null;

    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
      if (this.remoteAudio.parentElement) {
        this.remoteAudio.remove();
      }
      this.remoteAudio = null;
    }
    this.audioCtx?.close();
    this.audioCtx = null;

    // Resolve the token used for the WHIP DELETE. Prefer the cached token
    // captured during `connect` (which may have come from `tokenUrl`), fall
    // back to the static `config.token`, and as a last resort re-fetch from
    // `tokenUrl` so teardown still authenticates. Fire-and-forget.
    const sessionURL = this.sessionURL;
    const cached = this.lastToken;
    const cfg = this.config;
    void (async () => {
      let token = cached || cfg.token;
      if (!token && cfg.tokenUrl) {
        try {
          const headers: Record<string, string> = {};
          if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
          const res = await fetch(cfg.tokenUrl, { method: "POST", headers });
          if (res.ok) token = (await res.json()).token;
        } catch {}
      }
      await whipDelete(sessionURL, token);
    })();
    this.sessionURL = "";
    this.lastToken = undefined;
    this.etag = "";

    this.pc?.close();
    this.pc = null;
    this.setStatus("idle");
    this.assistantBuf = "";
  }

  toggleMute(): void {
    if (!this.stream) return;
    const audioTrack = this.stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      this._isMuted = !audioTrack.enabled;
    }
  }

  on<K extends keyof StreamCoreAIEvents>(
    event: K,
    handler: StreamCoreAIEvents[K]
  ): void {
    this.events[event] = handler;
  }

  private setStatus(status: ConnectionStatus): void {
    this._status = status;
    this.events.onStatusChange?.(status);
  }

  /**
   * Recovers a dropped transport with an ICE restart, keeping the session — and
   * therefore the conversation — alive on the server.
   *
   * Each attempt re-gathers candidates, PATCHes the resulting fragment to the
   * session URL, and folds the server's reply back into the remote
   * description. Between attempts it re-checks the connection state, because
   * plain ICE frequently repairs the drop unaided and a restart would then be
   * wasted work.
   */
  private async reconnect(): Promise<void> {
    const maxAttempts = this.config.reconnectAttempts ?? DEFAULT_RECONNECT_ATTEMPTS;
    if (this.reconnecting || maxAttempts <= 0) return;
    if (!this.pc || !this.sessionURL) return;

    this.reconnecting = true;
    const generation = this.generation;
    let delay = this.config.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;

    try {
      this.setStatus("reconnecting");

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await sleep(delay);
        delay *= 2;

        // disconnect() was called, or the connection healed by itself while
        // we waited — either way there is nothing left to restart.
        if (generation !== this.generation) return;
        const pc = this.pc;
        if (!pc || pc.connectionState === "closed") return;
        if (pc.connectionState === "connected") {
          this.setStatus("connected");
          this.events.onReconnect?.({ attempt, maxAttempts, outcome: "recovered" });
          return;
        }

        this.events.onReconnect?.({ attempt, maxAttempts, outcome: "attempting" });

        try {
          await this.restartIce(pc);
          // The restart is applied; ICE still has to complete its checks, so
          // the move back to "connected" comes from onconnectionstatechange.
          this.events.onReconnect?.({ attempt, maxAttempts, outcome: "recovered" });
          return;
        } catch (err) {
          const terminal = err instanceof WHIPRestartError && !err.retryable;
          if (terminal || attempt === maxAttempts) {
            this.setStatus("disconnected");
            this.cleanupAudioLevel();
            this.events.onReconnect?.({
              attempt,
              maxAttempts,
              outcome: "failed",
              error: err instanceof Error ? err : new Error(String(err)),
            });
            return;
          }
          // A 412 means another restart landed first; adopt the ETag the
          // server reported as current and try again against that generation.
          if (err instanceof WHIPRestartError && err.currentEtag) {
            this.etag = err.currentEtag;
          }
          console.warn(`[streamcoreai-sdk] ICE restart attempt ${attempt} failed:`, err);
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }

  /** One ICE restart round-trip against the existing peer connection. */
  private async restartIce(pc: RTCPeerConnection): Promise<void> {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    await this.waitForIceGathering(pc, false);

    const previousAnswer = pc.currentRemoteDescription?.sdp ?? pc.remoteDescription?.sdp;
    if (!previousAnswer) {
      throw new Error("no remote description to restart against");
    }

    const { fragment, etag } = await whipRestartIce(
      this.sessionURL,
      iceFragmentFromSdp(pc.localDescription?.sdp ?? offer.sdp ?? ""),
      this.etag,
      this.lastToken ?? this.config.token
    );
    this.etag = etag;

    // The offer left us in have-local-offer; the connection only returns to
    // stable once this answer is applied.
    await pc.setRemoteDescription(
      new RTCSessionDescription({
        type: "answer",
        sdp: applyIceFragment(previousAnswer, fragment),
      })
    );
  }

  /**
   * Resolves when ICE gathering finishes or the timeout elapses.
   *
   * `allowComplete` must be false for a restart: gathering is already
   * "complete" from the previous generation at the moment the restart offer is
   * applied, so trusting that flag would send the server the old candidates.
   * The end-of-candidates signal is per-generation and is the reliable one.
   */
  private waitForIceGathering(pc: RTCPeerConnection, allowComplete: boolean): Promise<void> {
    return new Promise<void>((resolve) => {
      if (allowComplete && pc.iceGatheringState === "complete") {
        resolve();
        return;
      }

      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        pc.onicecandidate = null;
        pc.removeEventListener("icegatheringstatechange", onGatherChange);
        resolve();
      };

      pc.onicecandidate = (e) => {
        if (e.candidate === null) done();
      };

      const onGatherChange = () => {
        if (pc.iceGatheringState === "complete") done();
      };
      pc.addEventListener("icegatheringstatechange", onGatherChange);

      const timer = setTimeout(() => {
        const sdp = pc.localDescription?.sdp ?? "";
        if (!sdp.includes("a=candidate:")) {
          console.warn("[streamcoreai-sdk] ICE gathering timed out with no candidates");
        }
        done();
      }, ICE_GATHERING_TIMEOUT_MS);
    });
  }

  private handleDataChannelMessage(msg: DataChannelMessage): void {
    switch (msg.type) {
      case "transcript": {
        if (msg.final) {
          const pendingAssistant = this.assistantBuf;
          this.assistantBuf = "";

          let updated = this._transcript.filter(
            (e) =>
              !(e.role === "user" && e.partial) &&
              !(e.role === "assistant" && e.partial)
          );
          if (pendingAssistant) {
            updated = [
              ...updated,
              { role: "assistant" as const, text: pendingAssistant },
            ];
          }
          this._transcript = [
            ...updated,
            { role: "user", text: msg.text },
          ];
        } else {
          const updated = this._transcript.filter(
            (e) => !(e.role === "user" && e.partial)
          );
          this._transcript = [
            ...updated,
            { role: "user", text: msg.text, partial: true },
          ];
        }
        this.events.onTranscript?.(
          this._transcript[this._transcript.length - 1],
          this._transcript
        );
        break;
      }
      case "response": {
        this.assistantBuf += msg.text;
        const currentText = this.assistantBuf;
        const updated = this._transcript.filter(
          (e) => !(e.role === "assistant" && e.partial)
        );
        this._transcript = [
          ...updated,
          { role: "assistant", text: currentText, partial: true },
        ];
        this.events.onTranscript?.(
          this._transcript[this._transcript.length - 1],
          this._transcript
        );
        break;
      }
      case "error": {
        console.error("[streamcoreai-sdk] server error:", msg.message);
        this.events.onError?.(new Error(msg.message));
        break;
      }
      case "timing": {
        this.events.onTiming?.({ stage: msg.stage, ms: msg.ms });
        break;
      }
      case "state": {
        this.events.onAgentStateChange?.(msg.state);
        break;
      }
      case "connection": {
        // The server noticed the drop first. Nothing to do — our own
        // connectionstatechange drives the restart — but surfacing it lets a
        // UI show "reconnecting…" a beat earlier.
        if (msg.state === "reconnecting" && this._status === "connected") {
          this.setStatus("reconnecting");
        }
        break;
      }
    }
  }

  private startAudioLevelMonitoring(stream: MediaStream): void {
    // Safari AEC breaks when mic streams are routed through AudioContext.
    if (this.isSafari()) {
      this.startStatsBasedAudioLevel();
      return;
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioCtx();
    this.audioCtx = audioCtx;

    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }

    const meterStream = stream.clone();
    this.meterStream = meterStream;
    const source = audioCtx.createMediaStreamSource(meterStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    this.analyser = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length / 255;
      this._audioLevel = avg;
      this.events.onAudioLevel?.(avg);
      this.animFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  private isSafari(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    return /Version\/.*Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
  }

  private startStatsBasedAudioLevel(): void {
    this.statsInterval = setInterval(async () => {
      if (!this.pc) return;
      try {
        const stats = await this.pc.getStats();
        let found = false;
        stats.forEach((report: any) => {
          if (found) return;
          if (report.type === "media-source" && report.kind === "audio" && typeof report.audioLevel === "number") {
            this._audioLevel = report.audioLevel;
            this.events.onAudioLevel?.(this._audioLevel);
            found = true;
          }
        });
      } catch {}

    }, 100);
  }

  private cleanupAudioLevel(): void {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = 0;
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.meterStream) {
      this.meterStream.getTracks().forEach((t) => t.stop());
      this.meterStream = null;
    }
    this._audioLevel = 0;
    this.events.onAudioLevel?.(0);
  }
}
