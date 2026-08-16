import { describe, expect, test } from "bun:test";
import { isTrustedProxy, normalizeAddress, resolveClientIdentity } from "./client-identity.ts";

/**
 * Regression coverage for the audit's HIGH finding: the rate limiter keyed on a
 * client-supplied `X-Forwarded-For` header, so rotating it produced unlimited
 * buckets and defeated the limit entirely.
 */
describe("resolveClientIdentity", () => {
  test("ignores X-Forwarded-For when no proxy is trusted", () => {
    const identity = resolveClientIdentity({
      peerAddress: "203.0.113.5",
      forwardedFor: "1.2.3.4",
      trustedProxies: [],
    });

    expect(identity).toBe("203.0.113.5");
  });

  test("a rotating X-Forwarded-For cannot change the identity of a direct client", () => {
    const identities = new Set(
      ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"].map((forged) =>
        resolveClientIdentity({
          peerAddress: "203.0.113.5",
          forwardedFor: forged,
          trustedProxies: [],
        }),
      ),
    );

    // One peer must always collapse to one identity, whatever it claims.
    expect(identities.size).toBe(1);
    expect([...identities]).toEqual(["203.0.113.5"]);
  });

  test("honours X-Forwarded-For when the peer is a trusted proxy", () => {
    const identity = resolveClientIdentity({
      peerAddress: "10.0.0.1",
      forwardedFor: "198.51.100.7",
      trustedProxies: ["10.0.0.1"],
    });

    expect(identity).toBe("198.51.100.7");
  });

  test("takes the closest untrusted hop, not a client-forged leading entry", () => {
    // A client sending its own X-Forwarded-For puts forged values on the LEFT;
    // the proxy appends the address it actually saw on the right.
    const identity = resolveClientIdentity({
      peerAddress: "10.0.0.1",
      forwardedFor: "9.9.9.9, 198.51.100.7, 10.0.0.2",
      trustedProxies: ["10.0.0.1", "10.0.0.2"],
    });

    expect(identity).toBe("198.51.100.7");
  });

  test("falls back to the peer when every hop is a trusted proxy", () => {
    const identity = resolveClientIdentity({
      peerAddress: "10.0.0.1",
      forwardedFor: "10.0.0.2",
      trustedProxies: ["10.0.0.0/8"],
    });

    expect(identity).toBe("10.0.0.1");
  });

  test("supports IPv4 CIDR trusted ranges", () => {
    const identity = resolveClientIdentity({
      peerAddress: "10.4.5.6",
      forwardedFor: "198.51.100.7",
      trustedProxies: ["10.0.0.0/8"],
    });

    expect(identity).toBe("198.51.100.7");
  });

  test("an address outside the trusted CIDR is not trusted", () => {
    const identity = resolveClientIdentity({
      peerAddress: "11.4.5.6",
      forwardedFor: "198.51.100.7",
      trustedProxies: ["10.0.0.0/8"],
    });

    expect(identity).toBe("11.4.5.6");
  });

  test("an unknown peer collapses to a single shared bucket", () => {
    const first = resolveClientIdentity({
      peerAddress: undefined,
      forwardedFor: "1.1.1.1",
      trustedProxies: [],
    });
    const second = resolveClientIdentity({
      peerAddress: undefined,
      forwardedFor: "2.2.2.2",
      trustedProxies: [],
    });

    // Conservative by design: unknown callers share a limit rather than each
    // inventing a fresh one.
    expect(first).toBe(second);
  });

  test("normalises IPv6-mapped IPv4 addresses", () => {
    expect(normalizeAddress("::ffff:192.168.1.1")).toBe("192.168.1.1");
    expect(
      resolveClientIdentity({
        peerAddress: "::ffff:10.0.0.1",
        forwardedFor: "198.51.100.7",
        trustedProxies: ["10.0.0.1"],
      }),
    ).toBe("198.51.100.7");
  });
});

describe("isTrustedProxy", () => {
  test.each([
    ["10.0.0.1", ["10.0.0.1"], true],
    ["10.0.0.2", ["10.0.0.1"], false],
    ["10.1.2.3", ["10.0.0.0/8"], true],
    ["11.1.2.3", ["10.0.0.0/8"], false],
    ["192.168.1.5", ["192.168.0.0/16"], true],
    ["192.169.1.5", ["192.168.0.0/16"], false],
    ["1.2.3.4", [], false],
    ["not-an-ip", ["10.0.0.0/8"], false],
  ])("isTrustedProxy(%s, %p) === %p", (address, proxies, expected) => {
    expect(isTrustedProxy(address, proxies)).toBe(expected);
  });
});
