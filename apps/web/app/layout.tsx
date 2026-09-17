import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SkipLink } from "@repo/ui/skip-link";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  // Show fallback text immediately rather than blocking on the font file —
  // customers should be able to read a menu before webfonts finish loading.
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Restaurant Platform",
    template: "%s · Restaurant Platform",
  },
  description: "Browse restaurant menus instantly — no app, no account.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Deliberately NOT setting maximumScale or userScalable: blocking pinch-zoom
  // fails WCAG 1.4.4, and low-vision users rely on it.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <SkipLink />
        {/* tabIndex={-1} makes the skip link move focus, not merely scroll. */}
        <main id="main-content" tabIndex={-1} className="min-h-dvh">
          {children}
        </main>
      </body>
    </html>
  );
}
