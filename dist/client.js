import { whipOffer, whipDelete } from "./whip.js";
const DEFAULT_WHIP_URL = "http://localhost:8080/whip";
const DEFAULT_ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
];
const DEFAULT_AUDIO_CONSTRAINTS = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
};
/**
 * Framework-agnostic voice agent client.
 *
 * Manages a WebRTC peer connection with WHIP signaling, microphone capture,
 * remote audio playback, data-channel transcript/response events, and
 * real-time audio-level metering.
 */
export class StreamCoreAIClient {
    constructor(config = {}, events = {}) {
        this.pc = null;
        this.sessionURL = "";
        this.stream = null;
        this._remoteStream = null;
        this.remoteAudio = null;
        this.audioCtx = null;
        this.analyser = null;
        this.animFrame = 0;
        this.assistantBuf = "";
        this._status = "idle";
        this._transcript = [];
        this._audioLevel = 0;
        this._isMuted = false;
        this.config = {
            whipUrl: config.whipUrl ?? DEFAULT_WHIP_URL,
            iceServers: config.iceServers ?? DEFAULT_ICE_SERVERS,
            audioConstraints: config.audioConstraints ?? DEFAULT_AUDIO_CONSTRAINTS,
        };
        this.events = events;
    }
    // ── Public getters ──────────────────────────────────────────────────
    get status() {
        return this._status;
    }
    get transcript() {
        return this._transcript;
    }
    get audioLevel() {
        return this._audioLevel;
    }
    get isMuted() {
        return this._isMuted;
    }
    get localStream() {
        return this.stream;
    }
    get remoteStream() {
        return this._remoteStream;
    }
    // ── Public API ──────────────────────────────────────────────────────
    async connect() {
        try {
            this.setStatus("connecting");
            this._transcript = [];
            this.assistantBuf = "";
            const pc = new RTCPeerConnection({
                iceServers: this.config.iceServers,
            });
            this.pc = pc;
            // Create a DataChannel for receiving events (transcript, response)
            // from the server. Must be created before the offer so it is
            // included in the SDP.
            const dc = pc.createDataChannel("events");
            dc.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    this.handleDataChannelMessage(msg);
                }
                catch {
                    console.error("[streamcoreai-sdk] failed to parse DC message", e.data);
                }
            };
            // Store the remote audio element so it doesn't get GC'd.
            pc.ontrack = (e) => {
                const remoteStream = e.streams[0] || new MediaStream([e.track]);
                this._remoteStream = remoteStream;
                const audioEl = new Audio();
                audioEl.srcObject = remoteStream;
                audioEl.autoplay = true;
                this.remoteAudio = audioEl;
                // Force play (handles browsers that gate autoplay)
                audioEl.play().catch(() => {
                    // Will retry on next user interaction
                });
            };
            pc.onconnectionstatechange = () => {
                const state = pc.connectionState;
                if (state === "connected") {
                    this.setStatus("connected");
                }
                else if (state === "failed" || state === "closed") {
                    this.setStatus("disconnected");
                    this.cleanupAudioLevel();
                }
            };
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: this.config.audioConstraints,
            });
            this.stream = stream;
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));
            this.startAudioLevelMonitoring(stream);
            // Create offer and gather all ICE candidates before sending.
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            // Wait for ICE gathering to complete so the offer contains all candidates.
            await new Promise((resolve) => {
                if (pc.iceGatheringState === "complete") {
                    resolve();
                    return;
                }
                const onGatherChange = () => {
                    if (pc.iceGatheringState === "complete") {
                        pc.removeEventListener("icegatheringstatechange", onGatherChange);
                        resolve();
                    }
                };
                pc.addEventListener("icegatheringstatechange", onGatherChange);
            });
            // WHIP exchange: POST offer SDP, receive answer SDP + session URL.
            const { answerSDP, sessionURL } = await whipOffer(this.config.whipUrl, pc.localDescription.sdp);
            this.sessionURL = sessionURL;
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answerSDP }));
        }
        catch (err) {
            console.error("[streamcoreai-sdk] connect error:", err);
            this.setStatus("error");
            this.events.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
    }
    disconnect() {
        this.cleanupAudioLevel();
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        this._remoteStream = null;
        if (this.remoteAudio) {
            this.remoteAudio.pause();
            this.remoteAudio.srcObject = null;
            this.remoteAudio = null;
        }
        this.audioCtx?.close();
        this.audioCtx = null;
        // RFC 9725 §4.2: DELETE the WHIP session to free server resources.
        whipDelete(this.sessionURL);
        this.sessionURL = "";
        this.pc?.close();
        this.pc = null;
        this.setStatus("idle");
        this.assistantBuf = "";
    }
    toggleMute() {
        if (!this.stream)
            return;
        const audioTrack = this.stream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            this._isMuted = !audioTrack.enabled;
        }
    }
    /** Register an event listener after construction. */
    on(event, handler) {
        this.events[event] = handler;
    }
    // ── Internal helpers ────────────────────────────────────────────────
    setStatus(status) {
        this._status = status;
        this.events.onStatusChange?.(status);
    }
    handleDataChannelMessage(msg) {
        switch (msg.type) {
            case "transcript": {
                if (msg.final) {
                    const pendingAssistant = this.assistantBuf;
                    this.assistantBuf = "";
                    let updated = this._transcript.filter((e) => !(e.role === "user" && e.partial) &&
                        !(e.role === "assistant" && e.partial));
                    if (pendingAssistant) {
                        updated = [
                            ...updated,
                            { role: "assistant", text: pendingAssistant },
                        ];
                    }
                    this._transcript = [
                        ...updated,
                        { role: "user", text: msg.text },
                    ];
                }
                else {
                    const updated = this._transcript.filter((e) => !(e.role === "user" && e.partial));
                    this._transcript = [
                        ...updated,
                        { role: "user", text: msg.text, partial: true },
                    ];
                }
                this.events.onTranscript?.(this._transcript[this._transcript.length - 1], this._transcript);
                break;
            }
            case "response": {
                this.assistantBuf += msg.text;
                const currentText = this.assistantBuf;
                const updated = this._transcript.filter((e) => !(e.role === "assistant" && e.partial));
                this._transcript = [
                    ...updated,
                    { role: "assistant", text: currentText, partial: true },
                ];
                this.events.onTranscript?.(this._transcript[this._transcript.length - 1], this._transcript);
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
        }
    }
    startAudioLevelMonitoring(stream) {
        const audioCtx = new AudioContext();
        this.audioCtx = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
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
    cleanupAudioLevel() {
        if (this.animFrame) {
            cancelAnimationFrame(this.animFrame);
            this.animFrame = 0;
        }
        this._audioLevel = 0;
        this.events.onAudioLevel?.(0);
    }
}
//# sourceMappingURL=client.js.map