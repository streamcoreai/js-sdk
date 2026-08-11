// Run with `npm test` (builds first, then exercises the compiled output).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyIceFragment,
  iceFragmentFromSdp,
  parseIceDetails,
  bumpSdpOrigin,
} from "../dist/icerestart.js";

const REMOTE_ANSWER =
  "v=0\r\n" +
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1\r\n" +
  "s=-\r\n" +
  "t=0 0\r\n" +
  "a=group:BUNDLE 0 1\r\n" +
  "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" +
  "c=IN IP4 0.0.0.0\r\n" +
  "a=mid:0\r\n" +
  "a=ice-ufrag:oldU\r\n" +
  "a=ice-pwd:oldPassword0000000000\r\n" +
  "a=fingerprint:sha-256 AA:BB:CC\r\n" +
  "a=candidate:1 1 udp 2130706431 192.0.2.10 41000 typ host\r\n" +
  "a=end-of-candidates\r\n" +
  "a=rtpmap:111 opus/48000/2\r\n" +
  "a=ssrc:12345 cname:stream\r\n" +
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n" +
  "a=mid:1\r\n" +
  "a=ice-ufrag:oldU\r\n" +
  "a=ice-pwd:oldPassword0000000000\r\n";

const SERVER_FRAGMENT =
  "a=ice-ufrag:newU\r\n" +
  "a=ice-pwd:newPassword111111111\r\n" +
  "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" +
  "a=mid:0\r\n" +
  "a=candidate:1 1 udp 2130706431 198.51.100.1 39132 typ host\r\n";

test("parses credentials and candidates", () => {
  const { ufrag, pwd, candidates } = parseIceDetails(SERVER_FRAGMENT);
  assert.equal(ufrag, "newU");
  assert.equal(pwd, "newPassword111111111");
  assert.equal(candidates.length, 1);
  // The a=candidate: prefix is stripped, not kept.
  assert.ok(candidates[0].startsWith("1 1 udp"));
});

test("parses LF-only bodies", () => {
  const { ufrag, pwd } = parseIceDetails("a=ice-ufrag:newU\na=ice-pwd:pw\n");
  assert.equal(ufrag, "newU");
  assert.equal(pwd, "pw");
});

test("builds a fragment from the bundle master only", () => {
  const local =
    "v=0\r\n" +
    "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" +
    "a=mid:0\r\n" +
    "a=ice-ufrag:localU\r\n" +
    "a=ice-pwd:localPassword222222\r\n" +
    "a=candidate:1 1 udp 2130706431 198.51.100.7 51000 typ host\r\n" +
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n" +
    "a=mid:1\r\n" +
    "a=candidate:9 1 udp 1 10.0.0.1 1 typ host\r\n";

  const frag = iceFragmentFromSdp(local);

  for (const must of [
    "a=ice-ufrag:localU",
    "a=ice-pwd:localPassword222222",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=mid:0",
    "198.51.100.7",
  ]) {
    assert.ok(frag.includes(must), `fragment missing ${must}`);
  }
  assert.ok(frag.endsWith("a=end-of-candidates\r\n"));
  // Bundled sections are not described.
  assert.ok(!frag.includes("m=application"));
  assert.ok(!frag.includes("10.0.0.1"));
});

test("folds a fragment into the stored answer", () => {
  const applied = applyIceFragment(REMOTE_ANSWER, SERVER_FRAGMENT);

  assert.ok(!applied.includes("oldU"));
  assert.ok(!applied.includes("oldPassword0000000000"));
  // Both bundled sections must agree on the new credentials.
  assert.equal(applied.split("a=ice-ufrag:newU").length - 1, 2);
  assert.equal(applied.split("a=ice-pwd:newPassword111111111").length - 1, 2);

  // Stale candidates go, new ones arrive.
  assert.ok(!applied.includes("192.0.2.10"));
  assert.ok(
    applied.includes("a=candidate:1 1 udp 2130706431 198.51.100.1 39132 typ host")
  );

  // Everything the transport is not responsible for survives verbatim.
  for (const must of [
    "a=mid:0",
    "a=mid:1",
    "a=ssrc:12345 cname:stream",
    "a=fingerprint:sha-256 AA:BB:CC",
    "a=rtpmap:111 opus/48000/2",
    "a=group:BUNDLE 0 1",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  ]) {
    assert.ok(applied.includes(must), `rewrite dropped ${must}`);
  }

  // A new revision of the same session.
  assert.ok(applied.includes("o=- 4611731400430051336 3 IN IP4 127.0.0.1"));
});

test("candidates land in the first media section", () => {
  const applied = applyIceFragment(REMOTE_ANSWER, SERVER_FRAGMENT);
  const audio = applied.indexOf("m=audio");
  const app = applied.indexOf("m=application");
  const candidate = applied.indexOf("a=candidate:");
  assert.ok(audio < candidate && candidate < app);
});

test("rejects a fragment without credentials", () => {
  const trickle =
    "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" +
    "a=candidate:1 1 udp 1 1.2.3.4 1 typ host\r\n";
  assert.throws(() => applyIceFragment(REMOTE_ANSWER, trickle), /no ICE credentials/);
});

test("leaves a malformed origin alone", () => {
  assert.equal(bumpSdpOrigin("o=- 123"), "o=- 123");
  assert.equal(
    bumpSdpOrigin("o=- 123 abc IN IP4 127.0.0.1"),
    "o=- 123 abc IN IP4 127.0.0.1"
  );
});
