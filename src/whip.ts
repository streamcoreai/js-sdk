import { ICE_FRAGMENT_CONTENT_TYPE } from "./icerestart.js";

export interface WHIPResult {
  answerSDP: string;
  sessionURL: string;
  /** ETag identifying the ICE session (RFC 9725 §4.3.1); needed to PATCH it. */
  etag: string;
}

export async function whipOffer(
  whipUrl: string,
  offerSDP: string,
  token?: string
): Promise<WHIPResult> {
  const headers: Record<string, string> = { "Content-Type": "application/sdp" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(whipUrl, {
    method: "POST",
    headers,
    body: offerSDP,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WHIP request failed (${res.status}): ${body}`);
  }

  const answerSDP = await res.text();

  const location = res.headers.get("Location") ?? "";
  const sessionURL = location.startsWith("http")
    ? location
    : `${new URL(whipUrl).origin}${location}`;

  return { answerSDP, sessionURL, etag: res.headers.get("ETag") ?? "" };
}

export interface WHIPRestartResult {
  /** The server's reply fragment, to fold into the stored remote description. */
  fragment: string;
  /** The rotated ETag identifying the new ICE session. */
  etag: string;
}

/**
 * Thrown when a PATCH is rejected. `status` lets the caller tell a retryable
 * failure from a terminal one — a 404 or 409 means the session is gone and no
 * amount of retrying will bring it back.
 */
export class WHIPRestartError extends Error {
  readonly status: number;
  /** ETag the server reported as current, present on a 412. */
  readonly currentEtag: string;

  constructor(status: number, message: string, currentEtag = "") {
    super(message);
    this.name = "WHIPRestartError";
    this.status = status;
    this.currentEtag = currentEtag;
  }

  /** Whether another attempt against the same session could still succeed. */
  get retryable(): boolean {
    // 404 the session was reaped, 409 it has no peer to restart, 405 the
    // server declines restarts entirely. Only a redial recovers those.
    return this.status !== 404 && this.status !== 409 && this.status !== 405;
  }
}

/**
 * Sends an ICE restart to the session URL per RFC 9725 §4.4.2.
 *
 * `etag` is sent as `If-Match` so a restart racing another one is rejected
 * rather than applied to a generation that no longer exists.
 */
export async function whipRestartIce(
  sessionURL: string,
  fragment: string,
  etag?: string,
  token?: string
): Promise<WHIPRestartResult> {
  const headers: Record<string, string> = {
    "Content-Type": ICE_FRAGMENT_CONTENT_TYPE,
  };
  if (etag) headers["If-Match"] = etag;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(sessionURL, {
    method: "PATCH",
    headers,
    body: fragment,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new WHIPRestartError(
      res.status,
      `ICE restart failed (${res.status}): ${body}`,
      res.headers.get("ETag") ?? ""
    );
  }

  return {
    fragment: await res.text(),
    etag: res.headers.get("ETag") ?? etag ?? "",
  };
}

export async function whipDelete(sessionURL: string, token?: string): Promise<void> {
  if (!sessionURL) return;
  try {
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    await fetch(sessionURL, { method: "DELETE", headers });
  } catch {}
}
