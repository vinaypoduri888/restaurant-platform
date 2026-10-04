import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@repo/ui/alert";
import { Card, CardContent } from "@repo/ui/card";
import { AcceptInvitationForm } from "./accept-invitation-form";
import { NotFoundError, ForbiddenError } from "@/lib/api/client";
import { describeInvitation, type InvitationSummary } from "@/lib/api/members";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Join a restaurant",
  // The URL contains a bearer token. Nothing here should be indexed.
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Accepting an invitation.
 *
 * ─── How a signed-out invitee gets here ─────────────────────────────────────
 *
 * This page lives in the dashboard group, so `requireSession` in the layout
 * sends an anonymous visitor to sign in — and `proxy.ts` carries the path in
 * `?next=`, so signing in or registering returns them here with the token
 * intact. That is the whole "they may not have an account yet" path: no second
 * token system, no invitation state in a cookie.
 *
 * ─── Why the address is shown ───────────────────────────────────────────────
 *
 * Acceptance requires the signed-in account to own the invited address. When
 * someone is signed in as the wrong account — easy, since many people have two
 * — the fix is to switch accounts, and they cannot work that out unless both
 * addresses are on screen. Showing it leaks nothing: it is their own
 * invitation email, quoted back.
 */
export default async function AcceptInvitationPage({ params }: PageProps) {
  const { token } = await params;
  const session = await getSession();

  let invitation: InvitationSummary | null = null;
  let unavailable = false;

  try {
    invitation = await describeInvitation(token);
  } catch (error) {
    /*
     * Unknown, expired and already-accepted are one case by design — the API
     * answers them identically so a token holder cannot learn whether it was
     * ever valid. A 403 is possible too if the session lapses between the
     * layout's check and this read.
     */
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      unavailable = true;
    } else {
      throw error;
    }
  }

  if (unavailable || !invitation) {
    return (
      <div className="mx-auto w-full max-w-md">
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <h1 className="text-xl font-semibold tracking-tight">This invitation isn&apos;t available</h1>
            <Alert variant="destructive">
              The link may have expired, already been used, or been withdrawn.
            </Alert>
            <p className="text-sm text-muted-foreground">
              Ask whoever invited you to send a new one.
            </p>
            <p className="text-sm">
              <Link
                href="/"
                className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Go to your restaurants
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const signedInAs = session?.user.email ?? "";
  const addressMatches = signedInAs.toLowerCase() === invitation.email.toLowerCase();

  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <h1 className="text-xl font-semibold tracking-tight">Join {invitation.restaurantName}</h1>

          <p className="text-sm text-muted-foreground">
            You have been invited to help manage{" "}
            <strong className="font-medium text-foreground">
              {invitation.restaurantName}
            </strong>{" "}
            as {invitation.role === "OWNER" ? "an owner" : "staff"}.
          </p>

          {addressMatches ? (
            <AcceptInvitationForm token={token} restaurantName={invitation.restaurantName} />
          ) : (
            <>
              {/*
                The one failure a person can actually fix themselves — and only
                if they can see both addresses.
              */}
              <Alert variant="warning">
                This invitation was sent to <strong>{invitation.email}</strong>, but you are
                signed in as <strong>{signedInAs}</strong>.
              </Alert>
              <p className="text-sm text-muted-foreground">
                Sign out and sign in as {invitation.email} to accept it.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
