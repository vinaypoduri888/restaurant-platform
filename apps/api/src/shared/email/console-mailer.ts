import type { EmailMessage, Mailer } from "./email.ts";

/**
 * Development and test mailer. Prints messages instead of delivering them.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * The same reason `STORAGE_DRIVER=local` exists: the entire account lifecycle —
 * sign up, verify, forget password, reset, invite, accept — has to be
 * developable and testable with no credentials and no third-party account. A
 * provider that needs an API key to do anything would make every one of those
 * flows untestable locally, which is how they end up untested.
 *
 * ─── Why it deliberately prints the token ───────────────────────────────────
 *
 * A verification or reset link *is* a credential: anyone holding it can take
 * the action. Printing it to the log is normally exactly what the logger's
 * redaction is there to prevent.
 *
 * It is printed anyway, because the alternative is worse. Without the link
 * there is no way to complete a flow locally — the developer would have to read
 * it out of the database by hand, and the tests could not exercise acceptance
 * at all. The containment is that this driver **cannot run in production**:
 * `createMailer` refuses to build it there, as a startup error rather than a
 * runtime surprise. See `index.ts`.
 *
 * The message is therefore written through `console` directly rather than the
 * application logger, so it never travels through log shipping, and so nobody
 * later "fixes" the redaction layer to strip the one string that makes local
 * development work.
 */
export class ConsoleMailer implements Mailer {
  readonly driver = "console" as const;

  /**
   * Whether to print.
   *
   * The test suite creates a user per test, so printing every message would
   * bury the actual results under hundreds of emails. Tests read the outbox
   * instead — which is the real interface anyway — so printing is switched off
   * for them and left on everywhere else, where a human needs the link.
   */
  constructor(private readonly quiet = false) {}

  /**
   * Messages this process has sent, newest last.
   *
   * Exposed so tests can assert on what was sent and extract the token from a
   * link, which is what makes the verification, reset and invitation flows
   * testable end to end without a mail server.
   */
  private readonly outbox: EmailMessage[] = [];

  /**
   * Bounded so a long-running dev server cannot grow this without limit. The
   * oldest message is dropped; nothing depends on history beyond the last few.
   */
  private static readonly MAX_RETAINED = 50;

  send(message: EmailMessage): Promise<void> {
    this.outbox.push(message);
    if (this.outbox.length > ConsoleMailer.MAX_RETAINED) {
      this.outbox.shift();
    }

    if (this.quiet) {
      return Promise.resolve();
    }

    // Bracketed and on one block so it is greppable in a busy dev log.
    console.info(
      [
        "",
        "──────────────── email (console driver — not delivered) ────────────────",
        `to:      ${message.to}`,
        `subject: ${message.subject}`,
        "",
        message.text,
        "────────────────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );

    return Promise.resolve();
  }

  /** Every retained message. Tests read this; application code must not. */
  sent(): readonly EmailMessage[] {
    return this.outbox;
  }

  /** The most recent message to an address, or null. For tests. */
  lastTo(email: string): EmailMessage | null {
    const wanted = email.trim().toLowerCase();

    for (let i = this.outbox.length - 1; i >= 0; i -= 1) {
      const message = this.outbox[i];
      if (message && message.to.toLowerCase() === wanted) {
        return message;
      }
    }

    return null;
  }

  /** Forgets everything sent. Tests call this between cases. */
  clear(): void {
    this.outbox.length = 0;
  }
}
