/**
 * ICE restart support (RFC 9725 §4.4, RFC 8840).
 *
 * When a client's local address changes — Wi-Fi to cellular, a VPN toggle, a
 * laptop moving networks — the gathered candidates are dead and the connection
 * cannot heal on its own. Re-POSTing an offer would allocate a new session on
 * the server, losing the conversation history and replaying the greeting. An
 * ICE restart instead swaps only the ICE generation on the *existing* session,
 * so nothing above the transport notices.
 *
 * The wire format is an SDP fragment rather than a full description, so these
 * helpers translate in both directions: our new local offer becomes a fragment
 * to PATCH, and the server's reply fragment is folded back into the answer we
 * already have.
 */

/** Media type of an ICE restart body. */
export const ICE_FRAGMENT_CONTENT_TYPE = "application/trickle-ice-sdpfrag";

/** Splits an SDP or fragment into lines, tolerating LF-only bodies. */
export function splitSdpLines(sdp: string): string[] {
  return sdp
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0);
}

export interface IceDetails {
  ufrag: string;
  pwd: string;
  candidates: string[];
}

/**
 * Reads the ICE credentials and candidates out of an SDP or fragment.
 * Credentials may sit at session or media level; the first of each wins, which
 * is what a bundled description means anyway.
 */
export function parseIceDetails(sdp: string): IceDetails {
  let ufrag = "";
  let pwd = "";
  const candidates: string[] = [];

  for (const line of splitSdpLines(sdp)) {
    if (line.startsWith("a=ice-ufrag:")) {
      if (!ufrag) ufrag = line.slice("a=ice-ufrag:".length);
    } else if (line.startsWith("a=ice-pwd:")) {
      if (!pwd) pwd = line.slice("a=ice-pwd:".length);
    } else if (line.startsWith("a=candidate:")) {
      candidates.push(line.slice("a=candidate:".length));
    }
  }

  return { ufrag, pwd, candidates };
}

/**
 * Renders our new local offer as the sdpfrag to PATCH: the credentials, then
 * the bundle-master m-line with its mid and candidates. Shaped after the
 * request example in RFC 9725 §4.4.2.
 */
export function iceFragmentFromSdp(localSdp: string): string {
  let ufrag = "";
  let pwd = "";
  let mLine = "";
  let mid = "";
  const candidates: string[] = [];
  let mediaIndex = -1;

  for (const line of splitSdpLines(localSdp)) {
    if (line.startsWith("m=")) {
      mediaIndex++;
      if (mediaIndex === 0) mLine = line;
      continue;
    }
    // Session-level attributes and the first media section's are both usable;
    // later sections are bundled onto the first.
    if (mediaIndex > 0) continue;

    if (line.startsWith("a=ice-ufrag:")) {
      if (!ufrag) ufrag = line.slice("a=ice-ufrag:".length);
    } else if (line.startsWith("a=ice-pwd:")) {
      if (!pwd) pwd = line.slice("a=ice-pwd:".length);
    } else if (line.startsWith("a=mid:")) {
      if (!mid) mid = line.slice("a=mid:".length);
    } else if (line.startsWith("a=candidate:")) {
      candidates.push(line.slice("a=candidate:".length));
    }
  }

  const out: string[] = [];
  if (ufrag) out.push(`a=ice-ufrag:${ufrag}`);
  if (pwd) out.push(`a=ice-pwd:${pwd}`);
  if (mLine) out.push(mLine);
  if (mid) out.push(`a=mid:${mid}`);
  for (const c of candidates) out.push(`a=candidate:${c}`);
  out.push("a=end-of-candidates");

  return out.join("\r\n") + "\r\n";
}

/**
 * Folds the server's reply fragment into the answer we already hold, producing
 * a full SDP that `setRemoteDescription` will accept.
 *
 * Only the ICE generation changes: credentials are replaced wherever they
 * appear, stale candidates are dropped, and the new ones are inserted into the
 * first media section. Everything else — m-lines, payload types, the DTLS
 * fingerprint, SSRCs — is carried over verbatim, because the restart is not
 * meant to renegotiate any of it.
 *
 * Throws if the fragment carries no credentials, which would mean it is not a
 * restart reply at all.
 */
export function applyIceFragment(remoteSdp: string, fragment: string): string {
  const { ufrag, pwd, candidates } = parseIceDetails(fragment);
  if (!ufrag || !pwd) {
    throw new Error("ICE restart reply has no ICE credentials");
  }

  const out: string[] = [];
  let mediaIndex = -1;
  let inserted = false;

  const insertCandidates = () => {
    if (inserted) return;
    inserted = true;
    for (const c of candidates) out.push(`a=candidate:${c}`);
    if (candidates.length > 0) out.push("a=end-of-candidates");
  };

  for (const line of splitSdpLines(remoteSdp)) {
    if (line.startsWith("m=")) {
      // Leaving the first media section — the new candidates belong at its end.
      if (mediaIndex === 0) insertCandidates();
      mediaIndex++;
      out.push(line);
    } else if (line.startsWith("o=")) {
      out.push(bumpSdpOrigin(line));
    } else if (line.startsWith("a=ice-ufrag:")) {
      out.push(`a=ice-ufrag:${ufrag}`);
    } else if (line.startsWith("a=ice-pwd:")) {
      out.push(`a=ice-pwd:${pwd}`);
    } else if (line.startsWith("a=candidate:") || line === "a=end-of-candidates") {
      // Previous ICE generation — dropped.
    } else {
      out.push(line);
    }
  }
  insertCandidates();

  return out.join("\r\n") + "\r\n";
}

/** Increments the session version in an `o=` line, marking a new revision. */
export function bumpSdpOrigin(line: string): string {
  const fields = line.slice("o=".length).split(/\s+/);
  if (fields.length < 6) return line;
  const version = Number(fields[2]);
  if (!Number.isFinite(version)) return line;
  fields[2] = String(version + 1);
  return `o=${fields.join(" ")}`;
}
