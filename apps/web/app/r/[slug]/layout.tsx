import { redirect } from "next/navigation";
import { canonicalPathFor, getRestaurantBySlug } from "@/lib/api/restaurants";

/**
 * Sends a request that arrived on a retired slug to the canonical URL.
 *
 * ─── Why this is a layout and not part of the page ──────────────────────────
 *
 * It began in the page, and that produced the wrong kind of redirect. This
 * route has a `loading.tsx`, which wraps the page in a Suspense boundary — so
 * Next flushes the shell and the skeleton *before* the page's code runs. By the
 * time `redirect()` is reached the response has already started, and Next can
 * no longer send a redirect status; it falls back to injecting
 * `<meta http-equiv="refresh" content="1;url=…">` instead. Verified over real
 * HTTP: the page returned `200` with that tag rather than a redirect.
 *
 * For a customer who has just scanned a code, that is a second of blank screen
 * followed by a client-side jump — on the one path this whole feature exists to
 * serve. It is also a weaker signal to a search engine than a redirect status.
 *
 * A layout runs *outside* the page's Suspense boundary, so it resolves before
 * anything is flushed, and `redirect()` produces a genuine HTTP redirect.
 *
 * ─── Why it costs no extra request ──────────────────────────────────────────
 *
 * `getRestaurantBySlug` is wrapped in React `cache`, so the page and
 * `generateMetadata` share this very fetch rather than issuing their own. The
 * skeleton still covers the menu request, which is the slower of the two.
 *
 * ─── Why the redirect is temporary, not permanent ───────────────────────────
 *
 * A retired slug can become current again — a typo fix, or a rebrand that gets
 * reverted — and browsers and CDNs cache a permanent redirect indefinitely.
 * That would strand every scan of a reclaimed code on a URL that had moved
 * back. Search engines take the canonical URL from `alternates.canonical` in
 * the page's metadata, which always names the current slug.
 */
export default async function RestaurantSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  // Next 16 delivers route params as a Promise; they must be awaited.
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let restaurant;
  try {
    restaurant = await getRestaurantBySlug(slug);
  } catch {
    /*
     * Missing, deactivated, or the API is unavailable. Each already has a
     * correct answer in the page — `not-found.tsx` or `error.tsx` — and this
     * layout has no business choosing between them. Rendering the page lets it
     * decide, using the same cached failure rather than a second request.
     *
     * ─── A related defect this deliberately does NOT fix ────────────────────
     *
     * Because the page raises `notFound()` inside the Suspense boundary that
     * `loading.tsx` creates, the response status has already been sent by then:
     * an unknown slug renders the right page with `200` rather than `404`. That
     * is a soft 404, and it predates this phase.
     *
     * Raising `notFound()` here instead does produce a real `404` — confirmed
     * over real HTTP — but `notFound()` from a layout resolves its boundary
     * *above* that layout's own segment, so the route's `not-found.tsx` is
     * skipped and Next's default 404 page renders instead. Recovering the
     * custom page would mean restructuring this route's boundaries, which is
     * not this phase's work. Left as a reported finding.
     */
    return children;
  }

  // `redirect` works by throwing, so it must stay outside the `try` above.
  const canonicalPath = canonicalPathFor(slug, restaurant);
  if (canonicalPath) {
    redirect(canonicalPath);
  }

  return children;
}
