export interface WHIPResult {
    answerSDP: string;
    sessionURL: string;
}
/**
 * Perform a WHIP signaling exchange per RFC 9725 §4.2:
 * POST an SDP offer, receive a 201 Created with SDP answer and Location header.
 * The server generates a unique sessionId (UUID) for each new session.
 */
export declare function whipOffer(whipUrl: string, offerSDP: string): Promise<WHIPResult>;
/**
 * Terminate a WHIP session per RFC 9725 §4.2:
 * Send HTTP DELETE to the WHIP session URL.
 */
export declare function whipDelete(sessionURL: string): Promise<void>;
//# sourceMappingURL=whip.d.ts.map