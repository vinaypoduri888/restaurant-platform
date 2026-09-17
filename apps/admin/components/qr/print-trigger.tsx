"use client";

import { Button } from "@repo/ui/button";

/**
 * Opens the browser's print dialog.
 *
 * A Client Component because printing is a browser action with no server side
 * to it. Hidden in the printed output, since a button on paper is a mistake.
 *
 * Deliberately not the only route to paper: the browser's own print command
 * works on this page whether or not this button does, which is why it needs no
 * failure state.
 */
export function PrintTrigger() {
  return (
    <Button type="button" variant="primary" className="print:hidden" onClick={() => window.print()}>
      Print this sheet
    </Button>
  );
}
