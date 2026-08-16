import { config } from "../config.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  [key: string]: unknown;
}

/**
 * The logging surface the rest of the application is allowed to depend on.
 *
 * Business code imports this interface, never a logging library. Swapping the
 * implementation (for pino, or a hosted log shipper) means replacing the
 * factory below and nothing else.
 */
export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Returns a logger that stamps `bindings` onto every subsequent entry. */
  child(bindings: LogContext): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Keys whose values are never written to logs, at any level, regardless of how
 * deeply they are nested. Matching is case-insensitive and substring-based so
 * that `authorization`, `Auth-Token`, and `userPassword` are all caught.
 */
const REDACTED_KEY_PATTERNS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "credential",
  "databaseurl",
  "database_url",
  "connectionstring",
  "connection_string",
  "sessionid",
  "session_id",
];

const REDACTED = "[REDACTED]";

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-\s]/g, "");
  return REDACTED_KEY_PATTERNS.some((pattern) => normalized.includes(pattern.replace(/_/g, "")));
}

/**
 * Exact secret values that must never appear in output, wherever they occur.
 *
 * Key-based redaction only helps when a secret sits under a recognisable key.
 * A database driver that fails to connect typically embeds the whole DSN in its
 * error *message*, where no key check applies — hence this second pass.
 */
const SECRET_VALUES: readonly string[] = [config.databaseUrl, config.auth.secret].filter(
  (value): value is string => typeof value === "string" && value.length >= 8,
);

/**
 * Credentials inside any URI, e.g. `postgresql://user:password@host/db`.
 * Only the password is removed — the scheme, user, host, and database remain,
 * because those are what make a connection error diagnosable.
 */
const URI_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi;

/** Removes secret material from a string while keeping it useful to read. */
function scrubSecrets(value: string): string {
  let output = value;

  // Exact known secrets first, so a full DSN collapses entirely rather than
  // being partially rewritten by the pattern below.
  for (const secret of SECRET_VALUES) {
    if (output.includes(secret)) output = output.split(secret).join(REDACTED);
  }

  return output.replace(URI_CREDENTIALS, `$1$2:${REDACTED}@`);
}

function redact(value: unknown, depth = 0): unknown {
  // Guard against cyclic or pathologically nested structures.
  if (depth > 6) return "[TRUNCATED]";

  if (typeof value === "string") return scrubSecrets(value);

  if (value === null || typeof value !== "object") return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      // Both message and stack are scrubbed: a driver error commonly embeds
      // the connection string in the message, which then repeats in the stack.
      message: scrubSecrets(value.message),
      // Stack traces are useful in logs (server-side only) but never in responses.
      stack: value.stack ? scrubSecrets(value.stack) : value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(nested, depth + 1);
  }
  return output;
}

function write(level: LogLevel, message: string, bindings: LogContext, context?: LogContext) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[config.logLevel]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(redact({ ...bindings, ...context }) as LogContext),
  };

  const serialized = JSON.stringify(entry);

  // Route warn/error to stderr so log collectors and shells can separate them.
  if (level === "error" || level === "warn") {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

function createLogger(bindings: LogContext = {}): Logger {
  return {
    debug: (message, context) => write("debug", message, bindings, context),
    info: (message, context) => write("info", message, bindings, context),
    warn: (message, context) => write("warn", message, bindings, context),
    error: (message, context) => write("error", message, bindings, context),
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }),
  };
}

/** Application-wide logger. Request-scoped loggers come from `c.get("logger")`. */
export const logger = createLogger();
