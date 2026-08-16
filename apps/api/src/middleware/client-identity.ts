/**
 * Resolving *who* a request came from, safely.
 *
 * `X-Forwarded-For` is set by the client on a direct connection, so trusting it
 * unconditionally lets anyone defeat a per-client rate limit by rotating the
 * header. It is only meaningful when the request genuinely arrived through a
 * proxy we control, and only for the hops that proxy actually appended.
 */

/** Parses "10.0.0.0/8" into a network/mask pair; returns null if not IPv4 CIDR. */
function parseIpv4Cidr(value: string): { network: number; mask: number } | null {
  const [address, bitsRaw] = value.split("/");
  if (!address || bitsRaw === undefined) return null;

  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;

  const network = ipv4ToInt(address);
  if (network === null) return null;

  // `>>> 0` keeps the result an unsigned 32-bit value; a /0 mask must be 0.
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: (network & mask) >>> 0, mask };
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

/** Strips an IPv6-mapped IPv4 prefix and any surrounding brackets/port. */
export function normalizeAddress(address: string): string {
  let value = address.trim();
  if (value.startsWith("::ffff:")) value = value.slice(7);
  if (value.startsWith("[")) value = value.slice(1, value.indexOf("]") > 0 ? value.indexOf("]") : undefined);
  return value.toLowerCase();
}

/** True when `address` matches a trusted-proxy entry (exact IP or IPv4 CIDR). */
export function isTrustedProxy(address: string, trustedProxies: readonly string[]): boolean {
  const candidate = normalizeAddress(address);
  if (!candidate) return false;

  for (const entry of trustedProxies) {
    const trusted = entry.trim();
    if (!trusted) continue;

    if (trusted.includes("/")) {
      const cidr = parseIpv4Cidr(trusted);
      const candidateInt = ipv4ToInt(candidate);
      if (cidr && candidateInt !== null && ((candidateInt & cidr.mask) >>> 0) === cidr.network) {
        return true;
      }
      continue;
    }

    if (normalizeAddress(trusted) === candidate) return true;
  }

  return false;
}

export interface ClientIdentityInput {
  /** The actual TCP peer address, or undefined when it cannot be determined. */
  peerAddress: string | undefined;
  /** Raw `X-Forwarded-For` header value, if any. */
  forwardedFor: string | undefined;
  /** Configured trusted proxy addresses/CIDRs. Empty means "trust nothing". */
  trustedProxies: readonly string[];
}

/**
 * Returns the identity used for rate limiting.
 *
 * Rules:
 *  - If the immediate peer is **not** a configured trusted proxy, the peer
 *    address is the identity and `X-Forwarded-For` is ignored entirely. This is
 *    the local-development and direct-connection case.
 *  - If the peer **is** trusted, walk `X-Forwarded-For` from the right, discarding
 *    hops that are themselves trusted proxies, and take the first address that is
 *    not. That is the closest address our infrastructure actually observed; any
 *    entries the client forged sit further left and are never reached.
 *  - If the peer cannot be determined at all, fall back to a single shared
 *    bucket. Deliberately conservative: unknown callers share a limit rather
 *    than each inventing their own.
 */
export function resolveClientIdentity({
  peerAddress,
  forwardedFor,
  trustedProxies,
}: ClientIdentityInput): string {
  const peer = peerAddress ? normalizeAddress(peerAddress) : "";

  if (!peer) return "unknown";
  if (!isTrustedProxy(peer, trustedProxies)) return peer;

  const hops = (forwardedFor ?? "")
    .split(",")
    .map((hop) => normalizeAddress(hop))
    .filter((hop) => hop.length > 0);

  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index];
    if (hop && !isTrustedProxy(hop, trustedProxies)) return hop;
  }

  // Every hop was a trusted proxy (or the header was absent) — fall back to the
  // peer rather than inventing an identity.
  return peer;
}
