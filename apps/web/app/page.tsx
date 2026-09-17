import { Card, CardContent, CardDescription, CardTitle } from "@repo/ui/card";

/**
 * Platform landing page.
 *
 * Intentionally minimal: the customer-facing product lives at `/r/[slug]`
 * (see FRONTEND_SPEC.md §2), which cannot be built until the menu models exist
 * in the backend. This page exists so the app has a valid, styled root.
 */
export default function Page() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-4 py-16 sm:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Restaurant Platform
        </h1>
        <p className="text-base text-muted-foreground">
          Digital menus customers reach by scanning a code at the table — no app
          to install and no account to create.
        </p>
      </header>

      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <CardTitle as="h2">Menus are not published yet</CardTitle>
          <CardDescription className="mt-2">
            Public restaurant pages arrive once menu management is available.
          </CardDescription>
        </CardContent>
      </Card>
    </div>
  );
}
