"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { AdminCategory } from "@/lib/api/menu";

/**
 * Filters for the item list.
 *
 * State lives in the **URL**, not in React state. That is deliberate: a
 * filtered view is then linkable, survives a refresh, works with the back
 * button, and — importantly here — is read on the server, so the filtering is
 * done by the API rather than by discarding rows in the browser. Client-side
 * filtering would silently break as soon as the list exceeds one page.
 *
 * Every filter maps to a query parameter the API already supports; none are
 * invented.
 */
export function MenuItemFilters({ categories }: { categories: AdminCategory[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function apply(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }

    // Any filter change invalidates the current page number — page 3 of an
    // unfiltered list is usually past the end of a filtered one.
    params.delete("page");

    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-3">
      <FilterSelect
        id="filter-category"
        label="Section"
        value={searchParams.get("categoryId") ?? ""}
        onChange={(value) => apply("categoryId", value)}
        options={[
          { value: "", label: "All sections" },
          ...categories.map((category) => ({ value: category.id, label: category.name })),
        ]}
      />

      <FilterSelect
        id="filter-active"
        label="Published"
        value={searchParams.get("isActive") ?? ""}
        onChange={(value) => apply("isActive", value)}
        options={[
          { value: "", label: "Any" },
          { value: "true", label: "On the menu" },
          { value: "false", label: "Hidden" },
        ]}
      />

      <FilterSelect
        id="filter-available"
        label="Availability"
        value={searchParams.get("isAvailable") ?? ""}
        onChange={(value) => apply("isAvailable", value)}
        options={[
          { value: "", label: "Any" },
          { value: "true", label: "Available" },
          { value: "false", label: "Sold out" },
        ]}
      />
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex min-w-40 flex-1 flex-col gap-1.5 sm:flex-none">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-md border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
