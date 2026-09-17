import { cookies } from "next/headers";

/**
 * The single place this app talks to the API over HTTP.
 *
 * Nothing else in `apps/admin` calls `fetch` against the API. Centralising it
 * means session forwarding, cache policy, and error mapping are decided once.
 *
 * **Server-only.** Every function here reads the session cookie through
 * `next/headers`, which only exists on the server. That is the point: the
 * session cookie is `httpOnly` and never touched by application JavaScript,
 * and `API_BASE_URL` is deliberately not a `NEXT_PUBLIC_` variable, so the
 * browser never learns where the API lives and makes no requests to it.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

/** Better Auth prefixes its cookie with `__Secure-` when secure cookies are on. */
const SESSION_COOKIE_MATCH = "better-auth";

// ---------------------------------------------------------------------------
// Errors
//
// One class per status the UI actually branches on. Anything else collapses
// into ApiUnavailableError with a generic message: the detail is logged
// server-side and never reaches a browser.
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 401 — no session, or it expired. The caller should send the user to sign in. */
export class AuthRequiredError extends ApiError {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message, 401);
  }
}

/**
 * 403 — authenticated but not permitted.
 *
 * The API returns this both for "you are not a member" and for "this id does
 * not exist", deliberately, so the two cannot be told apart by probing. UI copy
 * must therefore never imply the resource exists.
 */
export class ForbiddenError extends ApiError {
  constructor(message = "You don't have access to this restaurant.") {
    super(message, 403);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "That item no longer exists.") {
    super(message, 404);
  }
}

/** 409 — conflicts with existing state (duplicate slug, non-empty category). */
export class ConflictError extends ApiError {
  constructor(message: string) {
    super(message, 409);
  }
}
/**
 * 413 — the upload exceeded the API's configured maximum size.
 *
 * Given its own class rather than falling through to `ApiUnavailableError`:
 * "the service is temporarily unavailable" is actively misleading for a file
 * that will never be accepted however many times it is retried. The person
 * needs to know to pick a smaller file.
 */
export class PayloadTooLargeError extends ApiError {
  constructor(message = "That image is too large. Choose a smaller file.") {
    super(message, 413);
  }
}


export class RateLimitError extends ApiError {
  constructor(message = "Too many attempts. Please wait a moment and try again.") {
    super(message, 429);
  }
}

/** 400 — carries the API's field-level issues so a form can highlight inputs. */
export class ValidationError extends ApiError {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string>,
  ) {
    super(message, 400);
  }
}

/** Everything else: 5xx, a network failure, a timeout, or a malformed body. */
export class ApiUnavailableError extends ApiError {
  constructor(message = "The service is temporarily unavailable. Please try again.") {
    super(message, 503);
  }
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

interface ApiErrorBody {
  success: false;
  error: {
    message?: string;
    requestId?: string;
    issues?: { path: (string | number)[]; message: string }[];
  };
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON-serialised, unless it is `FormData`, which is passed through. */
  body?: unknown;
  /** Abort after this long so a stalled API never becomes a hung page. */
  timeoutMs?: number;
}

/**
 * Reads the session cookie for forwarding to the API.
 *
 * Filters by name rather than forwarding every cookie: the API has no business
 * receiving unrelated cookies this app might set later, and a prefix match
 * survives Better Auth's `__Secure-` rename in production.
 */
export async function sessionCookieHeader(): Promise<string | null> {
  const store = await cookies();
  const pairs = store
    .getAll()
    .filter((cookie) => cookie.name.includes(SESSION_COOKIE_MATCH))
    .map((cookie) => `${cookie.name}=${cookie.value}`);

  return pairs.length > 0 ? pairs.join("; ") : null;
}

/**
 * Performs an authenticated request and unwraps the API's response envelope.
 *
 * `cache: "no-store"` on every call is deliberate and is the opposite of the
 * public site's policy. An owner who has just changed a price must see that
 * price; serving them a cached copy of their own write reads as data loss and
 * invites them to make the edit twice.
 */
export async function apiRequest<T>(
  path: string,
  { method = "GET", body, timeoutMs = 10_000 }: ApiRequestOptions = {},
): Promise<T> {
  const cookieHeader = await sessionCookieHeader();
  /*
   * A FormData body must be passed through untouched, and its Content-Type
   * must be left unset so the runtime can append the multipart boundary. A
   * hand-written header produces a boundary-less content type that the API
   * cannot parse at all.
   */
  const isMultipart = body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined || isMultipart
          ? {}
          : { "Content-Type": "application/json" }),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: body === undefined ? undefined : isMultipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (cause) {
    console.error("[admin-api] request failed", { path, method, cause });
    throw new ApiUnavailableError();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    throw await toApiError(response, path, method);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    console.error("[admin-api] malformed json", { path, cause });
    throw new ApiUnavailableError();
  }

  if (!isSuccessEnvelope<T>(payload)) {
    console.error("[admin-api] unexpected response shape", { path });
    throw new ApiUnavailableError();
  }

  return payload.data;
}

/**
 * Maps an HTTP failure onto a typed error.
 *
 * The API's own `error.message` is surfaced for 400/409 because those messages
 * are written for humans and carry the detail that makes them actionable —
 * which slug clashed, how many items block a delete. For 5xx it is discarded:
 * an unexpected server error's message is not something to put in front of a
 * user, and the API already withholds internals anyway.
 */
async function toApiError(response: Response, path: string, method: string): Promise<ApiError> {
  const body = await readErrorBody(response);
  const message = body?.error?.message;

  switch (response.status) {
    case 400:
      return new ValidationError(message ?? "Please check the highlighted fields.", toFieldErrors(body));
    case 401:
      return new AuthRequiredError();
    case 403:
      return new ForbiddenError();
    case 404:
      return new NotFoundError();
    case 409:
      return new ConflictError(message ?? "That change conflicts with existing data.");
    case 413:
      return new PayloadTooLargeError(message ?? undefined);
    case 429:
      return new RateLimitError();
    default: {
      console.error("[admin-api] server error", {
        path,
        method,
        status: response.status,
        requestId: body?.error?.requestId ?? response.headers.get("x-request-id"),
      });
      return new ApiUnavailableError();
    }
  }
}

async function readErrorBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return null;
  }
}

/**
 * Flattens Zod issues into `{ field: message }` so a form can attach each one
 * to the input it belongs to instead of dumping a list at the top.
 */
function toFieldErrors(body: ApiErrorBody | null): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of body?.error?.issues ?? []) {
    const field = issue.path?.[0];
    if (typeof field === "string" && !errors[field]) {
      errors[field] = issue.message;
    }
  }

  return errors;
}

function isSuccessEnvelope<T>(body: unknown): body is { success: true; data: T } {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { success?: unknown }).success === true &&
    "data" in body
  );
}

/** Shape shared by every paginated admin list endpoint. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
