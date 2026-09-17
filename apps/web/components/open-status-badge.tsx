import { STATUS_LABELS, type OpenStatus } from "@repo/ui/lib/opening-hours";

/**
 * The open/closed indicator.
 *
 * Shown twice on the page — beside the restaurant name, where someone who has
 * just scanned a code looks first, and above the full week — so it lives in one
 * file rather than being written twice with two sets of colours.
 *
 * Colour is an accent, never the message (WCAG 1.4.1): every state carries the
 * word as well, so it survives greyscale, colour blindness, and being read
 * aloud. The dot is `aria-hidden` decoration.
 *
 * The status itself is computed by the API from the restaurant's own time zone.
 * Nothing here recomputes it, and nothing here reads the visitor's clock.
 */
export function OpenStatusBadge({ status }: { status: OpenStatus }) {
  // `unknown` renders nothing: no hours are configured, so there is no honest
  // claim to make, and "Closed" would be a guess presented as a fact.
  if (status === "unknown") return null;

  const styles: Record<Exclude<OpenStatus, "unknown">, { pill: string; dot: string }> = {
    open: { pill: "border-success/40 bg-success/10 text-foreground", dot: "bg-success" },
    closed: { pill: "border-border bg-secondary text-foreground", dot: "bg-muted-foreground" },
  };

  return (
    <p
      // Polite, not assertive: this is orientation, not an alert.
      role="status"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${styles[status].pill}`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${styles[status].dot}`} />
      {STATUS_LABELS[status]}
    </p>
  );
}
