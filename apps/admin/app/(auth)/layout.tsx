import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

/**
 * Shell for the signed-out pages.
 *
 * Deliberately without the dashboard's navigation: there is nothing to navigate
 * to yet, and showing a sidebar of links that all bounce to sign-in is
 * disorienting.
 *
 * Someone already signed in is sent to the dashboard rather than being shown a
 * sign-in form — arriving at `/login` with a live session almost always means a
 * stale bookmark or a back-button press, not an intention to sign in again.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSession()) {
    redirect("/");
  }

  return (
    <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-6 sm:py-16">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
