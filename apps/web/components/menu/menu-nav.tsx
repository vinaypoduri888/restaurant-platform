"use client";

import { useEffect, useState } from "react";
import { categoryElementId, type PublicMenuCategory } from "@/lib/api/menu";

/**
 * In-page navigation between menu sections.
 *
 * ─── Why these are real anchors ──────────────────────────────────────────────
 *
 * Every entry is an `<a href="#section-id">`. Browsers handle that natively:
 * it works before hydration, with JavaScript disabled, and on a phone whose
 * connection dropped after the HTML arrived — which is a realistic state in a
 * restaurant. The Client Component boundary exists *only* to add the
 * highlighting below; it is an enhancement layered on working markup, not the
 * mechanism that makes navigation work.
 *
 * `scroll-behavior: smooth` is not set here on purpose — the shared theme
 * already disables smooth scrolling under `prefers-reduced-motion`, and an
 * instant jump is the safer default for a purely functional navigation.
 */
export function MenuNav({ categories }: { categories: PublicMenuCategory[] }) {
  const activeId = useActiveSection(categories);

  // One section needs no navigation; a single-item list would be pure noise.
  if (categories.length < 2) return null;

  return (
    <nav
      aria-label="Menu sections"
      className="sticky top-0 z-10 -mx-5 border-b border-border bg-background/95 px-5 py-2 backdrop-blur sm:-mx-8 sm:px-8"
    >
      {/*
        Horizontally scrollable rather than wrapped: a menu with ten sections
        would otherwise push the first dish far below the fold on a 360px
        screen. `scrollbar` is left visible on platforms that show one, since
        hiding it removes the only affordance that more sections exist.
      */}
      <ul className="flex gap-2 overflow-x-auto">
        {categories.map((category) => {
          const id = categoryElementId(category);
          const isActive = id === activeId;

          return (
            <li key={category.id} className="shrink-0">
              <a
                href={`#${id}`}
                // Communicates the current section to assistive technology,
                // which cannot perceive the visual highlight.
                aria-current={isActive ? "location" : undefined}
                className={[
                  "inline-flex h-11 items-center rounded-full px-4 text-sm font-medium",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                ].join(" ")}
              >
                {category.name}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Tracks which section is currently in view.
 *
 * Uses `IntersectionObserver` rather than a scroll listener: the browser does
 * the work off the main thread, so scrolling a long menu on a mid-range phone
 * stays smooth. The top root margin pushes the trigger line below the sticky
 * bar so the highlighted entry matches the heading a customer can actually see.
 *
 * Returns `null` before hydration and on browsers without the API, in which
 * case nothing is highlighted and the navigation still works.
 */
function useActiveSection(categories: PublicMenuCategory[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Depend on the ids, not the array identity: a new array each render would
  // otherwise tear down and rebuild the observer on every render.
  const ids = categories.map(categoryElementId).join(",");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const elements = ids
      .split(",")
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Several sections can be visible at once on a tall screen; the one
        // nearest the top of the viewport is the one the customer is reading.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-72px 0px -60% 0px", threshold: 0 },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [ids]);

  return activeId;
}
