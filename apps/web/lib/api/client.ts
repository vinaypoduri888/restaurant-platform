/**
 * The single place this app talks to the API over HTTP.
 *
 * Nothing else in `apps/web` should call `fetch` against the API directly.
 * Centralising it here means caching, revalidation tags, timeouts, and error
 * mapping are decided once rather than re-invented per component.
 *
 * Server-side only: these calls run inside Server Components, so no CORS is
 * involved, no cookies are sent, and the API base URL is never shipped to the
 * browser (which is why it is deliberately not a `NEXT_PUBLIC_` variable).
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

/** The API's success envelope. */
interface ApiSuccess<T> {
  success: true;
  data: T;
}

/**
 * Raised when the API reports the resource does not exist.
 *
 * The public API answers 404 both for "no such restaurant" and for one that has
 * been deactivated — that indistinguishability is deliberate on the backend, so
 * this error does not try to tell them apart either.
 */
export class ResourceNotFoundError extends Error {
  constructor(message = "Resource not found") {
    super(message);
    this.name = "ResourceNotFoundError";
  }
}

/**
 * Raised for every other failure: a 5xx, a network error, a timeout, or a
 * malformed body.
 *
 * The message is intentionally generic and safe to surface. Diagnostic detail
 * (status, request id, cause) is logged server-side and never travels to the
 * browser.
 */
export class ApiUnavailableError extends Error {
  constructor(message = "The service is temporarily unavailable") {
    super(message);
    this.name = "ApiUnavailableError";
  }
}

export interface ApiRequestOptions {
  /** Seconds before the cached response is considered stale. */
  revalidate?: number;
  /** Cache tags, so a future webhook can call `revalidateTag` on a mutation. */
  tags?: string[];
  /** Abort the request after this many milliseconds. */
  timeoutMs?: number;
}

/**
 * Performs a GET against the API and unwraps its response envelope.
 *
 * A slow API must not become a hanging page: the request is aborted after
 * `timeoutMs` so the route falls through to its error boundary rather than
 * holding the customer on a blank screen.
 */
export async function apiGet<T>(
  path: string,
  { revalidate = 60, tags = [], timeoutMs = 8000 }: ApiRequestOptions = {},
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      // Time-based revalidation keeps most requests off the API entirely.
      // `tags` makes on-demand invalidation possible later without changing
      // any calling code.
      next: { revalidate, tags },
    });
  } catch (cause) {
    // Network failure or timeout — never surfaced verbatim.
    console.error("[api] request failed", { path, cause });
    throw new ApiUnavailableError();
  }

  if (response.status === 404) {
    throw new ResourceNotFoundError();
  }

  if (!response.ok) {
    // The API returns a requestId on errors; capturing it server-side is what
    // makes a customer report traceable in the logs.
    const requestId = response.headers.get("x-request-id");
    console.error("[api] non-ok response", { path, status: response.status, requestId });
    throw new ApiUnavailableError();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    console.error("[api] malformed json", { path, cause });
    throw new ApiUnavailableError();
  }

  if (!isApiSuccess<T>(body)) {
    console.error("[api] unexpected response shape", { path });
    throw new ApiUnavailableError();
  }

  return body.data;
}

function isApiSuccess<T>(body: unknown): body is ApiSuccess<T> {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { success?: unknown }).success === true &&
    "data" in body
  );
}
