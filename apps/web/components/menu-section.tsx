import { isMenuEmpty, visibleCategories, type PublicMenu } from "@/lib/api/menu";
import { MenuCategorySection } from "./menu/menu-category-section";
import { MenuError } from "./menu/menu-error";
import { MenuNav } from "./menu/menu-nav";
import { MenuUnavailable } from "./menu-unavailable";

interface MenuSectionProps {
  /** The fetched menu, or `null` when the menu request itself failed. */
  menu: PublicMenu | null;
}

/**
 * The menu region: the reason a customer scanned the code.
 *
 * Three distinct outcomes, deliberately not collapsed into two:
 *
 *   - **Failed** — the request errored. Something is broken; say so (`MenuError`).
 *   - **Empty** — the request succeeded and there is nothing published. Nothing
 *     is broken; say that instead (`MenuUnavailable`).
 *   - **Published** — render it.
 *
 * Conflating the first two is the common mistake, and it is user-hostile in
 * both directions: an error dressed as "no menu yet" hides a real outage, and
 * an empty menu dressed as an error alarms a customer over nothing.
 *
 * A Server Component. The menu is read-only content and ships no JavaScript;
 * only the section navigation crosses the client boundary, and only to add
 * highlighting to links that already work without it.
 */
export function MenuSection({ menu }: MenuSectionProps) {
  return (
    <section aria-labelledby="menu-heading" className="w-full">
      <h2 id="menu-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">
        Menu
      </h2>

      <div className="mt-4">
        <MenuBody menu={menu} />
      </div>
    </section>
  );
}

function MenuBody({ menu }: MenuSectionProps) {
  if (menu === null) {
    return <MenuError />;
  }

  // A menu whose every category is empty reads to a customer exactly like a
  // menu with no categories: there is nothing to look at.
  if (isMenuEmpty(menu)) {
    return <MenuUnavailable />;
  }

  const categories = visibleCategories(menu);

  return (
    <>
      <MenuNav categories={categories} />

      <div className="mt-6 flex flex-col gap-8 sm:gap-10">
        {categories.map((category) => (
          <MenuCategorySection key={category.id} category={category} />
        ))}
      </div>
    </>
  );
}
