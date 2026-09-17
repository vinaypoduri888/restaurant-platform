"use client";

import { useState } from "react";
import { Button } from "@repo/ui/button";

/**
 * Downloads the QR code as a file.
 *
 * ─── Why the file is built here rather than fetched ─────────────────────────
 *
 * The SVG is already on the page: the server fetched it to render the preview,
 * so the bytes are in hand. Turning them into a download is a Blob and an
 * anchor click — no second request, no cross-origin call carrying a session
 * cookie, and nothing that can fail after the page has loaded.
 *
 * The API does expose `GET .../qr/download` with a `Content-Disposition`
 * header, and it is the right thing for a script or an integration. For this
 * button it would mean a cross-origin navigation whose success depends on the
 * session cookie surviving the hop — strictly more that can go wrong for the
 * same result.
 *
 * The downloaded file is self-contained and works with no network and no
 * session, which is the actual requirement: it gets emailed to a print shop.
 */
export function QrDownloadButton({ svg, fileName }: { svg: string; fileName: string }) {
  // Only ever set on failure, so the control is silent when it works.
  const [failed, setFailed] = useState(false);

  function download() {
    try {
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();

      // Releasing immediately would race the browser's read of the blob in
      // some engines; a tick is enough and avoids leaking the object URL.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setFailed(false);
    } catch {
      // No detail is shown: there is nothing the owner can act on, and the
      // print page below is a working alternative.
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="primary" onClick={download}>
        Download SVG
      </Button>

      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          The download could not be started. You can use Print below instead.
        </p>
      ) : null}
    </div>
  );
}
