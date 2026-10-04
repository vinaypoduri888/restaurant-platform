/**
 * Invitation tokens.
 *
 * An invitation token is a bearer credential: whoever presents it joins the
 * tenant it names. It is therefore treated the way a password is — generated
 * from a cryptographic source, shown to its owner exactly once, and stored only
 * as a hash.
 */

/**
 * 32 bytes, which is the point rather than a round number.
 *
 * The token is guessable only by brute force against a unique index, so the
 * search space has to make that hopeless: 256 bits is beyond reach regardless
 * of how long the invitation lives or how fast an attacker can ask. Shorter
 * values start to depend on rate limiting holding, and rate limiting here is
 * in-process and per-instance (Phase 10).
 */
const TOKEN_BYTES = 32;

/**
 * Mints a token.
 *
 * `crypto.getRandomValues` — a CSPRNG — never `Math.random`, which is seeded,
 * predictable from observed output, and has no security claim whatsoever.
 *
 * Encoded base64url so the value is safe in a URL path with no escaping: an
 * invitation link is pasted, forwarded and re-typed, and a token that changes
 * meaning when a mail client escapes it is a support ticket.
 */
export function generateInvitationToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);

  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
 * Hashes a token for storage and lookup.
 *
 * ─── Why plain SHA-256 and not bcrypt/argon2 ────────────────────────────────
 *
 * Password hashing is deliberately slow because passwords are low-entropy and
 * human-chosen, so an offline attacker can guess candidates. This token is 256
 * bits from a CSPRNG: there are no candidates to guess, and the slow hash would
 * buy nothing while making every acceptance measurably slower.
 *
 * What SHA-256 does buy is the property that matters here — a database read
 * yields no usable invitations, because the stored value cannot be presented.
 *
 * Synchronous (`createHash`) rather than `crypto.subtle.digest`: this is called
 * once per invitation and once per acceptance, and a hex string is what the
 * column stores.
 */
export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
