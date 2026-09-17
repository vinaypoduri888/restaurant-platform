import Link from "next/link";
import { Card, CardContent, CardTitle } from "@repo/ui/card";
import type { RestaurantQr } from "@/lib/api/qr";
import { QrDownloadButton } from "./qr-download-button";

/**
 * The owner-facing QR surface: the public URL, the code, and how to get it out
 * of the browser.
 *
 * A Server Component. Only the download control hydrates.
 */
export function QrPanel({
  restaurantId,
  restaurantName,
  qr,
}: {
  restaurantId: string;
  restaurantName: string;
  qr: RestaurantQr;
}) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <CardTitle as="h2" id="qr-heading">
          Menu QR code
        </CardTitle>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Print this and put it on your tables. Scanning it opens your menu — no
          app, no account, nothing to install.
        </p>

        <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
          <QrImage svg={qr.svg} restaurantName={restaurantName} />

          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h3 className="text-sm font-medium text-foreground">Where it points</h3>
              {/*
                Shown in full and as a working link, so an owner can check it
                before committing it to print. `break-all` because a long slug
                would otherwise push the card wider than a phone.
              */}
              <Link
                href={qr.targetUrl}
                className="break-all rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {qr.targetUrl}
              </Link>
            </div>

            <div className="flex flex-col gap-3">
              <QrDownloadButton svg={qr.svg} fileName={qr.fileName} />

              <Link
                href={`/restaurants/${restaurantId}/qr/print`}
                className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Open print sheet
              </Link>
            </div>

            {/*
              The single most useful thing to tell an owner here, because it is
              the opposite of what they will assume about a printed code.
            */}
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <h3 className="text-sm font-medium text-foreground">
                Renaming your menu URL is safe
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                If you change your web address later, codes you have already
                printed keep working — visitors are forwarded to the new one. The
                old address stays reserved to you and cannot be taken by another
                restaurant.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The code itself.
 *
 * Rendered as an `<img>` carrying a data URI rather than injected as inline
 * markup. Inlining would mean `dangerouslySetInnerHTML` on a document built
 * server-side — and although the API escapes the one interpolated value (the
 * restaurant's own name), an SVG in the DOM can carry script, so a single
 * escaping mistake would become stored XSS in the console. An `<img>` cannot
 * execute script whatever the document contains, which removes the question
 * rather than answering it.
 *
 * Base64 rather than a URL-encoded data URI: a restaurant name can contain
 * characters outside ASCII, and base64 sidesteps the encoding entirely.
 */
export function QrImage({
  svg,
  restaurantName,
  className,
}: {
  svg: string;
  restaurantName: string;
  className?: string;
}) {
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;

  return (
    <div className="rounded-lg border border-border bg-white p-3">
      {/*
        A white plate under the code regardless of theme. The SVG paints its own
        light background, but the border and padding have to sit on light too —
        a dark frame tight against the quiet zone is what makes a code fail to
        scan.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUri}
        alt={`QR code linking to the ${restaurantName} menu`}
        width={512}
        height={512}
        className={className ?? "size-40 sm:size-48"}
      />
    </div>
  );
}
