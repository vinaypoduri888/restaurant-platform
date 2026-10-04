import type { Metadata } from "next";
import { Card, CardContent, CardTitle } from "@repo/ui/card";
import { InvitationRow } from "@/components/team/invitation-row";
import { InviteForm } from "@/components/team/invite-form";
import { MemberRow } from "@/components/team/member-row";
import { canManageTeam, getTeam, isLastOwner } from "@/lib/api/members";
import { getRestaurant } from "@/lib/api/restaurants";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Team" };

interface PageProps {
  // Next 16 delivers route params as a Promise; they must be awaited.
  params: Promise<{ restaurantId: string }>;
}

/**
 * Who can manage this restaurant.
 *
 * Staff can read the roster — knowing your colleagues is ordinary workplace
 * information — but are offered no controls. Every mutation is `member:manage`,
 * which is OWNER only and enforced by the API regardless of what renders here.
 */
export default async function TeamPage({ params }: PageProps) {
  const { restaurantId } = await params;

  // Issued together: the page is then as slow as the slowest, not their sum.
  const [{ role }, team, session] = await Promise.all([
    getRestaurant(restaurantId),
    getTeam(restaurantId),
    getSession(),
  ]);

  const canManage = canManageTeam(role);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="members-heading">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <CardTitle as="h2" id="members-heading">
              Team
            </CardTitle>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Owners can manage the team, delete the restaurant and see the QR code.
              Staff can edit the menu, profile and opening hours.
            </p>

            <ul className="mt-4">
              {team.members.map((member) => (
                <MemberRow
                  key={member.userId}
                  restaurantId={restaurantId}
                  member={member}
                  canManage={canManage}
                  isSelf={member.userId === session?.user.id}
                  isLastOwner={isLastOwner(team.members, member.userId)}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      {/*
        Pending invitations are part of the answer to "who is on this team" —
        a half-onboarded colleague is not invisible. Shown to staff too, since
        they can already see the roster; only the controls are withheld.
      */}
      {team.invitations.length > 0 ? (
        <section aria-labelledby="invitations-heading">
          <Card>
            <CardContent className="p-4 sm:p-6">
              <CardTitle as="h2" id="invitations-heading">
                Pending invitations
              </CardTitle>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                These people have been invited but have not joined yet.
              </p>

              <ul className="mt-4">
                {team.invitations.map((invitation) => (
                  <InvitationRow
                    key={invitation.id}
                    restaurantId={restaurantId}
                    invitation={invitation}
                    canManage={canManage}
                    hasExpired={invitation.hasExpired}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {canManage ? (
        <section aria-labelledby="invite-heading">
          <Card>
            <CardContent className="p-4 sm:p-6">
              <CardTitle as="h2" id="invite-heading">
                Invite someone
              </CardTitle>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                They will get an email with a link to join. It works whether or not
                they already have an account.
              </p>

              <div className="mt-6 max-w-md">
                <InviteForm restaurantId={restaurantId} />
              </div>
            </CardContent>
          </Card>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only an owner can invite people or change the team.
        </p>
      )}
    </div>
  );
}
