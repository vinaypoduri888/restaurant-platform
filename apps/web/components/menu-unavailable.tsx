/**
 * Shown when a restaurant has no published menu.
 *
 * This is an *empty* state, not an error state, and the distinction is
 * deliberate. The customer did nothing wrong and nothing is broken — the
 * restaurant simply has not published yet. So it uses calm, neutral styling,
 * no warning colour, no alarming iconography, and crucially no `role="alert"`:
 * announcing this assertively would imply a failure that has not occurred.
 *
 * The copy tells the customer what to do next (ask a member of staff), because
 * a dead end with no suggested action is a poor experience at a table.
 */
export function MenuUnavailable() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-auto size-9 text-muted-foreground"
      >
        <path d="M4 4h16v16H4z" opacity="0.35" />
        <path d="M8 9h8M8 13h5" />
      </svg>

      <p className="mt-4 text-base font-medium text-foreground">
        The menu isn&apos;t published yet
      </p>
      <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
        This restaurant hasn&apos;t added its menu to the platform. Please ask a
        member of staff for today&apos;s options.
      </p>
    </div>
  );
}
