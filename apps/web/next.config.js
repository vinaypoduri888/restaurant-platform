/**
 * Where branding images are served from.
 *
 * Media URLs are built by the API from whichever storage driver it runs — the
 * API itself for `local`, a CDN domain for `r2`. `next.config` is evaluated at
 * build time and cannot ask the API, so the origin has to be stated here too.
 * That is a genuine duplication of the API's `LOCAL_STORAGE_PUBLIC_BASE_URL` /
 * `R2_PUBLIC_BASE_URL`, and the two must agree or images will not render.
 *
 * The default matches the API's own default, so local development needs no
 * configuration at all.
 */
const MEDIA_PUBLIC_BASE_URL = process.env.MEDIA_PUBLIC_BASE_URL ?? "http://localhost:3001/media";

const mediaBase = new URL(MEDIA_PUBLIC_BASE_URL);

/**
 * Turns that base URL into a single, narrowly-scoped remote pattern.
 *
 * ─── Why this configuration is necessary, not convenient ────────────────────
 *
 * `next/image` refuses any remote `src` that is not explicitly allowed, and a
 * media URL is remote by construction: with the `local` driver it is served by
 * the API on a different port, which is a different origin. Verified against
 * the bundled Next 16 documentation and source rather than assumed.
 *
 * ─── Why it is scoped this tightly ──────────────────────────────────────────
 *
 * `hostname: "**"` would turn the image optimiser into an open proxy — anyone
 * could pass any URL and have this server fetch and re-serve it. So the
 * protocol, host, port *and* path prefix are all pinned, exactly as
 * `FRONTEND_SPEC.md` §17 requires. Nothing outside the media path is allowed,
 * even on the same host — verified: a foreign host and a non-media path on the
 * allowed host are both rejected with 400.
 */
function mediaRemotePattern() {
  const prefix = mediaBase.pathname.replace(/\/+$/, "");

  return {
    protocol: mediaBase.protocol.replace(":", ""),
    hostname: mediaBase.hostname,
    // An empty string means "the protocol's default port", which is what a
    // production CDN URL will have.
    port: mediaBase.port,
    pathname: `${prefix}/**`,
    // Requiring an empty query string is deliberate: omitting `search`
    // altogether would allow any query parameters, which lets a caller
    // optimise URLs that were never intended.
    search: "",
  };
}

/**
 * Whether the configured media host is a loopback address.
 *
 * ─── The problem this solves, and how it was found ──────────────────────────
 *
 * Next 16's optimiser resolves every upstream hostname and refuses private or
 * loopback IPs. That is good SSRF protection: without it, an allowed image URL
 * could be used to make this server fetch things on its own private network.
 *
 * But in development the media host *is* loopback — the API on
 * `localhost:3001` — so the guard blocked every branding image. It fails with
 * the *same* `"url" parameter is not allowed` message as a pattern mismatch,
 * which sent the investigation to the wrong place twice. The real cause only
 * appears in the server log as `resolved to private ip ["::1","127.0.0.1"]`,
 * confirmed by reading `image-optimizer.js` and reproducing it against a
 * production build.
 *
 * ─── Why relaxing it here is not "disabling image security" ─────────────────
 *
 * The guard is relaxed **only when the configured media host is itself local**.
 * With `r2` in production the host is a public CDN domain, this returns false,
 * and the protection stays fully on. The `remotePatterns` allow-list above
 * still applies in every case, so even in development the optimiser will only
 * fetch the media path on the one configured origin.
 */
function mediaHostIsLocal() {
  const host = mediaBase.hostname.toLowerCase();

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost")
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [mediaRemotePattern()],
    // Scoped to local development by the check above; false for any public
    // media host, which is what a production R2 deployment has.
    dangerouslyAllowLocalIP: mediaHostIsLocal(),
  },
};

export default nextConfig;
