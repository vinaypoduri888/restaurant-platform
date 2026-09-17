import type { Metadata } from "next";
import Link from "next/link";
import { RestaurantCreateForm } from "./restaurant-create-form";

export const metadata: Metadata = { title: "Add a restaurant" };

export default function NewRestaurantPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8 sm:px-6 sm:py-10">
      <nav aria-label="Breadcrumb">
        <Link
          href="/"
          className="rounded-md text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          ← Your restaurants
        </Link>
      </nav>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Add a restaurant</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;ll become its owner. Everything except the name can be changed
          later.
        </p>
      </header>

      <RestaurantCreateForm />
    </div>
  );
}
