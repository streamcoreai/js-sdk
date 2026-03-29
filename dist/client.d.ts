import type { ConnectionStatus, TranscriptEntry, StreamCoreAIConfig, StreamCoreAIEvents } from "./types.js";
/**
 * Framework-agnostic voice agent client.
 *
 * Manages a WebRTC peer connection with WHIP signaling, microphone capture,
 * remote audio playback, data-channel transcript/response events, and
 * real-time audio-level metering.
 */
export declare class StreamCoreAIClient {
    private config;
    private events;
    private pc;
    private sessionURL;
    private stream;
    private _remoteStream;
    private remoteAudio;
    private audioCtx;
    private analyser;
    private animFrame;
    private assistantBuf;
    private _status;
    private _transcript;
    private _audioLevel;
    private _isMuted;
    constructor(config?: StreamCoreAIConfig, events?: StreamCoreAIEvents);
    get status(): ConnectionStatus;
    get transcript(): TranscriptEntry[];
    get audioLevel(): number;
    get isMuted(): boolean;
    get localStream(): MediaStream | null;
    get remoteStream(): MediaStream | null;
    connect(): Promise<void>;
    disconnect(): void;
    toggleMute(): void;
    /** Register an event listener after construction. */
    on<K extends keyof StreamCoreAIEvents>(event: K, handler: StreamCoreAIEvents[K]): void;
    private setStatus;
    private handleDataChannelMessage;
    private startAudioLevelMonitoring;
    private cleanupAudioLevel;
}
//# sourceMappingURL=client.d.ts.map