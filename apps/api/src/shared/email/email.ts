/**
 * Transactional email, as a provider-neutral interface.
 *
 * ─── Why an interface rather than calling a provider directly ───────────────
 *
 * The same reasoning as `shared/storage`: the three things this application
 * sends — verification links, password resets, invitations — are domain
 * concerns, and which SaaS carries them is a deployment detail. Domain code
 * depends on `Mailer` and can never tell which implementation it was given, so
 * selecting a provider stays a configuration change.
 *
 * ─── Why the payload is this small ──────────────────────────────────────────
 *
 * `to`, `subject`, `text`, `html` is the intersection every provider supports.
 * Attachments, templates, tags, scheduling and batch sending are all deliberate
 * omissions: nothing in the product needs them, and an interface shaped around
 * one provider's extras stops being provider-neutral.
 */

export interface EmailMessage {
  /** A single recipient. Bulk send is not a product requirement. */
  to: string;
  subject: string;
  /**
   * Plain text. Required, never optional — a mail client that cannot or will
   * not render HTML must still show a usable message, and a verification link
   * nobody can read is a locked-out account.
   */
  text: string;
  /** Optional richer version. Providers fall back to `text` when absent. */
  html?: string;
}

/**
 * The drivers that actually exist.
 *
 * One, today. No production provider has been selected, and adding one means
 * installing a dependency — so rather than pretend otherwise with a union
 * member nothing implements, this union is the honest list and grows when an
 * adapter is really written. `config` validates against it, so a deployment
 * that sets an unimplemented driver fails at startup with the valid values
 * named, instead of booting and silently dropping every email.
 */
export type EmailDriver = "console";

export interface Mailer {
  /** Which implementation this is. Logged at startup; never used to branch. */
  readonly driver: EmailDriver;

  /**
   * Delivers one message.
   *
   * Rejects when the message could not be handed to the provider. Callers
   * decide whether that is fatal: a failed invitation email should surface,
   * while a failed "your password changed" notice should not undo the change.
   */
  send(message: EmailMessage): Promise<void>;
}

/**
 * Normalises an address for storage and comparison.
 *
 * Lowercasing only, applied at every boundary that accepts an address. The
 * local part of an address is technically case-sensitive per RFC 5321, but no
 * mail provider in practice treats `Owner@` and `owner@` as different people —
 * and treating them as different here would let the same person hold two
 * invitations, or let a second account shadow an existing one.
 *
 * Deliberately *not* doing provider-specific canonicalisation (stripping dots
 * or `+tag` suffixes for Gmail, say). That would be guessing at another
 * system's routing rules, and it would silently merge addresses their owner
 * considers distinct.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
