/**
 * Shown when the restaurant loaded but its menu did not.
 *
 * This is a partial failure, and it is handled inline rather than by throwing
 * to the route's error boundary. The customer scanned a code and is standing at
 * a table: showing them the restaurant they are in, plus an honest note about
 * the menu, is materially more useful than replacing the whole page with an
 * error. It also means one flaky request cannot take down a page that was
 * already 90% successful.
 *
 * `role="alert"` is correct here — unlike the empty state, something genuinely
 * did fail, and a screen-reader user needs to be told rather than left waiting
 * for content that is not coming.
 */
export function MenuError() {
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/40 bg-destructive/10 px-6 py-8 text-center"
    >
      <p className="text-base font-medium text-foreground">
        The menu couldn&apos;t be loaded
      </p>
      <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
        This is a problem on our side, not yours. Refreshing the page usually
        fixes it — otherwise a member of staff can help.
      </p>
    </div>
  );
}
