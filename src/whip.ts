export interface WHIPResult {
  answerSDP: string;
  sessionURL: string;
}

/**
 * Perform a WHIP signaling exchange per RFC 9725 §4.2:
 * POST an SDP offer, receive a 201 Created with SDP answer and Location header.
 * The server generates a unique sessionId (UUID) for each new session.
 */
export async function whipOffer(
  whipUrl: string,
  offerSDP: string
): Promise<WHIPResult> {
  const res = await fetch(whipUrl, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: offerSDP,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WHIP request failed (${res.status}): ${body}`);
  }

  const answerSDP = await res.text();

  // RFC 9725 §4.2: Location header points to the WHIP session URL.
  const location = res.headers.get("Location") ?? "";
  const sessionURL = location.startsWith("http")
    ? location
    : `${new URL(whipUrl).origin}${location}`;

  return { answerSDP, sessionURL };
}

/**
 * Terminate a WHIP session per RFC 9725 §4.2:
 * Send HTTP DELETE to the WHIP session URL.
 */
export async function whipDelete(sessionURL: string): Promise<void> {
  if (!sessionURL) return;
  try {
    await fetch(sessionURL, { method: "DELETE" });
  } catch {
    // Best-effort teardown; connection may already be closed.
  }
}
