/**
 * Where to send someone after they sign in.
 *
 * ─── Why this is its own module ─────────────────────────────────────────────
 *
 * `actions.ts` carries `"use server"`, and every export from such a module must
 * be an async function — the directive turns exports into callable server
 * endpoints. A synchronous helper there fails the build, which is the correct
 * outcome rather than an inconvenience: it would otherwise be published as an
 * endpoint nobody intended.
 *
 * ─── What it defends against ────────────────────────────────────────────────
 *
 * `proxy.ts` puts the attempted path in `?next=` so an anonymous visitor
 * returns to where they were headed — the case that matters is an invitation
 * link. That value arrives from the URL, so it is attacker-supplied.
 *
 * An unchecked redirect here would be an open redirect on the one page where
 * it is most convincing: the victim really did just authenticate, so a bounce
 * straight to a lookalike site is about as credible as phishing gets. Only a
 * same-site path is ever accepted.
 */
export function safeNextPath(next: string | undefined): string {
  // Must be a path, not a URL. `https://evil.test` fails this outright.
  if (!next || !next.startsWith("/")) return "/";

  // `//evil.test` is protocol-relative: browsers treat it as another origin.
  if (next.startsWith("//")) return "/";

  // Some browsers normalise backslashes to slashes while resolving, so
  // `/\evil.test` can become `//evil.test` after this check would have passed.
  if (next.includes("\\")) return "/";

  return next;
}
