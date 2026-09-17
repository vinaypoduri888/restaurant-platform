import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintTrigger } from "@/components/qr/print-trigger";
import { QrImage } from "@/components/qr/qr-panel";
import { ForbiddenError } from "@/lib/api/client";
import { getRestaurantQr } from "@/lib/api/qr";
import { getRestaurant } from "@/lib/api/restaurants";

export const metadata: Metadata = { title: "Print QR code" };

interface PageProps {
  // Next 16 delivers route params as a Promise; they must be awaited.
  params: Promise<{ restaurantId: string }>;
}

/**
 * A print sheet: the restaurant's name, the code, and the address it opens.
 *
 * ─── What is deliberately not here ──────────────────────────────────────────
 *
 * No dashboard chrome (the shell's header and tabs carry `print:hidden`), no
 * internal ids, no storage keys, no email address, no role, nothing about the
 * signed-in account. What reaches paper is exactly what a customer at a table
 * needs, because a printed sheet leaves the building.
 *
 * It is also not a flyer designer. One code, centred, at a size that scans,
 * with the address written out underneath for anyone whose camera will not
 * cooperate. Paper sizes, fonts, logos and layouts are a different product.
 */
export default async function PrintQrPage({ params }: PageProps) {
  const { restaurantId } = await params;

  const [{ restaurant }, qr] = await Promise.all([
    getRestaurant(restaurantId),
    loadQrOrNotFound(restaurantId),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 py-4 text-center">
      {/*
        On screen this is a page inside the console and needs a way back. On
        paper it is noise.
      */}
      <nav aria-label="Breadcrumb" className="self-start print:hidden">
        <Link
          href={`/restaurants/${restaurantId}/qr`}
          className="rounded-md text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          ← Back to QR code
        </Link>
      </nav>

      <div className="flex flex-col items-center gap-6 rounded-lg border border-border p-8 print:border-0 print:p-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground print:text-black">
          {restaurant.name}
        </h1>
        <p className="text-base text-muted-foreground print:text-black">Scan for our menu</p>

        {/* Larger than the preview: this one is measured in centimetres. */}
        <QrImage svg={qr.svg} restaurantName={restaurant.name} className="size-64 sm:size-80" />

        {/*
          The address in writing as well as in the code. A camera that will not
          focus, a cracked screen, or someone who simply prefers typing — all
          are solved by one line of text, and it costs nothing.
        */}
        <p className="break-all text-sm text-muted-foreground print:text-black">{qr.targetUrl}</p>
      </div>

      <PrintTrigger />
    </div>
  );
}

/**
 * Staff cannot print, and there is no useful half-sheet to show them.
 *
 * `notFound()` rather than an explanation: the QR page one level up already
 * explains who may print and why, and that is where a staff member arrives
 * from. Rendering a second refusal here would say the same thing twice.
 */
async function loadQrOrNotFound(restaurantId: string) {
  try {
    return await getRestaurantQr(restaurantId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      notFound();
    }
    throw error;
  }
}
