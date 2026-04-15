export interface WHIPResult {
  answerSDP: string;
  sessionURL: string;
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

  return { answerSDP, sessionURL };
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
