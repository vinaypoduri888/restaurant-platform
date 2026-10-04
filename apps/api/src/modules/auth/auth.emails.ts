import { config } from "../../config.ts";
import type { EmailMessage } from "../../shared/email/index.ts";

/**
 * The wording of account emails.
 *
 * Kept apart from `auth.config.ts` so that file stays a description of policy
 * — what is required, how long tokens live — rather than half prose. These are
 * also the messages most likely to be edited by someone who is not changing
 * behaviour, and a copy change should not mean touching authentication config.
 *
 * ─── Why plain text, and why both parts say the same thing ──────────────────
 *
 * `text` is not a fallback here, it is the message. A verification link that
 * only renders in an HTML-capable client is an account its owner cannot open,
 * and corporate mail filters strip HTML far more often than people expect. The
 * HTML part adds a clickable link and nothing else — no images, no tracking
 * pixel, no remote CSS, all of which get a message classified as marketing and
 * routed away from the inbox the recipient is actually watching.
 */

/**
 * Minimal HTML escaping for values interpolated into the HTML part.
 *
 * Only the URL is interpolated today, and it is built from server-controlled
 * values — but "it is safe at the moment" is how injection arrives later, and
 * escaping costs nothing.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function layout(paragraphs: string[], url: string, action: string): string {
  const body = paragraphs.map((p) => `    <p>${escapeHtml(p)}</p>`).join("\n");
  const safeUrl = escapeHtml(url);

  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <body>",
    body,
    `    <p><a href="${safeUrl}">${escapeHtml(action)}</a></p>`,
    `    <p>${escapeHtml("If the link does not work, copy this address into your browser:")}</p>`,
    `    <p>${safeUrl}</p>`,
    "  </body>",
    "</html>",
  ].join("\n");
}

export function renderVerifyEmail({ to, url }: { to: string; url: string }): EmailMessage {
  const paragraphs = [
    "Confirm this address to finish setting up your account.",
    "If you did not create an account, you can ignore this message — nothing will happen until the link is used.",
  ];

  return {
    to,
    subject: "Confirm your email address",
    text: [...paragraphs, "", "Confirm your address:", url].join("\n"),
    html: layout(paragraphs, url, "Confirm your address"),
    // `from` is applied by the mailer, which owns the configured sender.
  } satisfies EmailMessage;
}

export function renderPasswordReset({ to, url }: { to: string; url: string }): EmailMessage {
  const paragraphs = [
    "Use the link below to choose a new password. It expires in one hour.",
    /*
     * Said explicitly because this is the message a person reads when they did
     * *not* ask for it — the one case where the mail itself is the warning
     * that someone is probing their account. "Your password has not changed"
     * is the reassurance that matters; telling them to act only if they are
     * worried avoids implying every such mail is an attack.
     */
    "If you did not ask for this, you can ignore it. Your password has not changed, and it will not change unless the link is used.",
  ];

  return {
    to,
    subject: "Reset your password",
    text: [...paragraphs, "", "Choose a new password:", url].join("\n"),
    html: layout(paragraphs, url, "Choose a new password"),
  } satisfies EmailMessage;
}

export function renderInvitation({
  to,
  url,
  restaurantName,
  invitedByName,
}: {
  to: string;
  url: string;
  restaurantName: string;
  invitedByName: string | null;
}): EmailMessage {
  /*
   * The inviter is named when known, because an unexplained invitation to a
   * business account reads like phishing. It is omitted rather than guessed
   * when the name is absent.
   */
  const opening = invitedByName
    ? `${invitedByName} has invited you to help manage ${restaurantName}.`
    : `You have been invited to help manage ${restaurantName}.`;

  const paragraphs = [
    opening,
    `This link expires in ${config.invitations.ttlHours / 24} days and can be used once.`,
    /*
     * Deliberately does not say whether an account already exists for this
     * address — that would turn a forwarded invitation into an account
     * oracle. Both paths are described as one instruction.
     */
    "Open the link to accept. You will be asked to sign in, or to create an account if you do not have one.",
    "If you were not expecting this, you can ignore it. Nothing is shared with you unless you accept.",
  ];

  return {
    to,
    subject: `You have been invited to ${restaurantName}`,
    text: [...paragraphs, "", "Accept the invitation:", url].join("\n"),
    html: layout(paragraphs, url, "Accept the invitation"),
  } satisfies EmailMessage;
}
