import { signOutAction } from "@/lib/auth/actions";

/**
 * Sign out.
 *
 * A real `<form>` posting to a Server Action rather than a link, because
 * signing out changes server state — a `GET` that ends a session can be
 * triggered by a prefetch, a link scanner, or a browser preloading on hover.
 *
 * A Server Component: no client JavaScript is involved, and the form works
 * without it.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Sign out
      </button>
    </form>
  );
}
