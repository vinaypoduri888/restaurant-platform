import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@repo/ui/alert";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

interface PageProps {
  // `next` is set by `proxy.ts` when an anonymous visitor is bounced from a
  // protected page — an invitation link being the case that matters most.
  searchParams: Promise<{ next?: string; reset?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { next, reset } = await searchParams;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Manage your restaurant profile and menu.
        </p>
      </header>

      {/* Set by the reset flow, which signs every session out on success. */}
      {reset ? (
        <Alert variant="success">
          Your password has been changed. Sign in with the new one.
        </Alert>
      ) : null}

      <SignInForm next={next} />

      <p className="text-sm text-muted-foreground">
        <Link
          href="/forgot-password"
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Forgotten your password?
        </Link>
      </p>

      <p className="text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
