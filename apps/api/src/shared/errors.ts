import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Errors the application throws deliberately, each carrying the HTTP status it
 * should produce. The central error handler is the only place that turns these
 * into responses, so status codes never drift between endpoints.
 *
 * Anything NOT extending AppError is treated as unexpected and becomes a 500
 * with no internal detail leaked to the client.
 */
export abstract class AppError extends Error {
  abstract readonly status: ContentfulStatusCode;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** 400 — the request was understood but is not acceptable. */
export class BadRequestError extends AppError {
  readonly status = 400 as const;
}

/** 401 — the caller is not authenticated. */
export class UnauthorizedError extends AppError {
  readonly status = 401 as const;

  constructor(message = "Authentication required") {
    super(message);
  }
}

/** 403 — the caller is authenticated but not permitted. */
export class ForbiddenError extends AppError {
  readonly status = 403 as const;

  constructor(message = "You do not have access to this resource") {
    super(message);
  }
}

/** 404 — the requested resource does not exist. */
export class NotFoundError extends AppError {
  readonly status = 404 as const;
}

/** 409 — the request conflicts with existing state. */
export class ConflictError extends AppError {
  readonly status = 409 as const;
}

/** 429 — the caller has sent too many requests. */
export class TooManyRequestsError extends AppError {
  readonly status = 429 as const;

  constructor(message = "Too many requests, please try again later") {
    super(message);
  }
}
