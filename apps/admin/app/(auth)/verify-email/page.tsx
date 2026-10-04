import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@repo/ui/alert";
import { ResendVerificationForm } from "./resend-verification-form";

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

/**
 * Where the verification link lands.
 *
 * The API's `/verify-email` endpoint does the work and redirects here, so by
 * the time anyone reads this the outcome is already decided — this page only
 * reports it. On success Better Auth also issues a session, so the dashboard
 * is one click away; the auth layout will forward an already-signed-in visitor
 * there automatically.
 *
 * The failure branch is reached when the link has expired or was already used.
 * Both get the same copy, because both have the same fix.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const failed = Boolean(error);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {failed ? "That link didn't work" : "Email confirmed"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {failed
            ? "Confirmation links expire and can only be used once. Enter your address and we will send a new one."
            : "Your address is confirmed. You can sign in now."}
        </p>
      </header>

      {failed ? (
        <>
          <Alert variant="destructive">This confirmation link is expired or already used.</Alert>
          <ResendVerificationForm />
        </>
      ) : (
        <Alert variant="success">Thanks — that&apos;s all we needed.</Alert>
      )}

      <p className="text-sm text-muted-foreground">
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Go to sign in
        </Link>
      </p>
    </div>
  );
}
