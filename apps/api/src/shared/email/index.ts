import { config } from "../../config.ts";
import { ConsoleMailer } from "./console-mailer.ts";
import type { Mailer } from "./email.ts";

export type { EmailDriver, EmailMessage, Mailer } from "./email.ts";
export { normaliseEmail } from "./email.ts";
export { ConsoleMailer } from "./console-mailer.ts";

/**
 * Builds the mailer the configuration asks for.
 *
 * The one place that knows more than one implementation could exist.
 *
 * ─── The production guard ───────────────────────────────────────────────────
 *
 * `console` does not deliver anything. In production that is not a degraded
 * mode, it is a silent, total failure of every account-recovery path: password
 * resets and invitations would appear to succeed and simply never arrive, and
 * nothing would alert anyone, because sending "succeeded".
 *
 * So it is refused outright when `NODE_ENV=production` — at startup, alongside
 * the rest of the fail-fast configuration, rather than on the first send hours
 * later. Note the direction carefully: the environment is used to *forbid* an
 * unsafe choice, never to *pick* the driver. Picking stays explicit, per the
 * rule `STORAGE_DRIVER` established.
 */
export function createMailer(): Mailer {
  if (config.isProduction && config.email.driver === "console") {
    throw new Error(
      "EMAIL_DRIVER=console cannot be used in production: it prints messages " +
        "instead of delivering them, so password resets and invitations would " +
        "silently never arrive. Configure a real provider.",
    );
  }

  // Silent under test, where the outbox is read directly and printing every
  // message would bury the results.
  return new ConsoleMailer(config.isTest);
}

/**
 * The application's mailer, created once.
 *
 * A module-level singleton for the same reason as `storage`: implementations
 * are stateless handles, and the console driver's outbox has to be the same
 * object the tests read.
 */
export const mailer: Mailer = createMailer();
