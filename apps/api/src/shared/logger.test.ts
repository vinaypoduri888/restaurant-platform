import { describe, expect, test } from "bun:test";
import { config } from "../config.ts";
import { logger } from "./logger.ts";

/**
 * Captures what the logger actually writes, since the guarantee under test is
 * about emitted output rather than any internal state.
 */
function captureLog(emit: () => void): string {
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];
  const collect = (...args: unknown[]) => void lines.push(args.join(" "));

  console.log = collect;
  console.error = collect;
  try {
    emit();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return lines.join("\n");
}

describe("logger key-based redaction", () => {
  test("redacts sensitive keys at any depth", () => {
    const output = captureLog(() =>
      logger.error("test", {
        password: "hunter2",
        token: "tok_abc123",
        authorization: "Bearer xyz",
        nested: { dbPassword: "s3cr3t", deeper: { apiKey: "ak_live_123" } },
      }),
    );

    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("tok_abc123");
    expect(output).not.toContain("Bearer xyz");
    expect(output).not.toContain("s3cr3t");
    expect(output).not.toContain("ak_live_123");
    expect(output).toContain("[REDACTED]");
  });
});

/**
 * Regression coverage for the audit's MEDIUM finding: redaction was key-based
 * only, so a PostgreSQL DSN embedded in an Error *message* — the usual shape of
 * a driver connection failure — was written to logs verbatim.
 */
describe("logger value-based redaction", () => {
  test("strips credentials from a DSN inside an Error message", () => {
    const error = new Error(
      "connect ECONNREFUSED: postgresql://postgres:sup3rs3cret@localhost:5433/restaurant_platform",
    );

    const output = captureLog(() => logger.error("database failure", { err: error }));

    expect(output).not.toContain("sup3rs3cret");
    expect(output).toContain("[REDACTED]");
  });

  test("strips credentials from an Error stack as well as its message", () => {
    const error = new Error("failed: postgres://admin:p@ssw0rd-value@db.internal:5432/app");

    const output = captureLog(() => logger.error("database failure", { err: error }));

    expect(output).not.toContain("p@ssw0rd-value");
  });

  test("never emits the configured DATABASE_URL", () => {
    const output = captureLog(() =>
      logger.error("boom", { detail: `connecting to ${config.databaseUrl}` }),
    );

    expect(output).not.toContain(config.databaseUrl);
    expect(output).not.toContain("postgres:postgres@");
  });

  test("never emits the configured auth secret", () => {
    const output = captureLog(() =>
      logger.warn("suspicious", { note: `secret was ${config.auth.secret}` }),
    );

    expect(output).not.toContain(config.auth.secret);
  });

  test("redacts credentials in plain string fields, not just Errors", () => {
    const output = captureLog(() =>
      logger.info("outbound", { target: "amqp://svc:rabbitpass@broker:5672" }),
    );

    expect(output).not.toContain("rabbitpass");
  });

  test("keeps error messages diagnosable", () => {
    const error = new Error(
      "connect ECONNREFUSED: postgresql://postgres:sup3rs3cret@localhost:5433/restaurant_platform",
    );

    const output = captureLog(() => logger.error("database failure", { err: error }));

    // The parts an engineer needs in order to act on the error must survive.
    expect(output).toContain("ECONNREFUSED");
    expect(output).toContain("localhost:5433");
    expect(output).toContain("restaurant_platform");
    expect(output).toContain("database failure");
  });
});
