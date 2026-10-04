import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  // A reset link is a bearer credential. Even though it only works once and
  // only for an hour, there is no reason for it to be indexed or followed.
  robots: { index: false, follow: false },
};

interface PageProps {
  // Next 16 delivers route params as a Promise; they must be awaited.
  params: Promise<{ token: string }>;
}

/**
 * Completes a password reset.
 *
 * The token is **not validated here**. There is no endpoint to check one
 * without consuming it, and adding a "is this token real" probe would be an
 * oracle for guessing tokens. So the form is shown, and the single attempt
 * either works or returns the "no longer valid" explanation.
 *
 * The token stays in the server component and is bound into the action, so it
 * is never rendered into a form field the browser could expose.
 */
export default async function ResetPasswordPage({ params }: PageProps) {
  const { token } = await params;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">
          You will be signed out everywhere else, on every device.
        </p>
      </header>

      <ResetPasswordForm token={token} />

      <p className="text-sm text-muted-foreground">
        Link expired?{" "}
        <Link
          href="/forgot-password"
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Request a new one
        </Link>
      </p>
    </div>
  );
}
