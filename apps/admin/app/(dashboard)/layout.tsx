import Link from "next/link";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { requireSession } from "@/lib/auth/session";

/**
 * The authenticated shell.
 *
 * `requireSession` here is the **authoritative** access check for everything in
 * this route group: it asks the API who the caller is and redirects to sign-in
 * if the answer is nobody. `proxy.ts` also redirects signed-out visitors, but
 * only optimistically, by looking for a cookie — a forged one gets past it and
 * is stopped here.
 *
 * Putting the check in the layout rather than in each page means a new page
 * cannot be added unprotected by omission.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-card print:hidden">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-3 sm:px-6">
          <Link
            href="/"
            className="rounded-md text-sm font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Restaurant admin
          </Link>

          <div className="flex items-center gap-2">
            {/*
              The email identifies which account is active — genuinely useful
              when someone has both an owner and a staff account. Hidden on
              narrow screens where it would crowd out the sign-out control.
            */}
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session.user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
