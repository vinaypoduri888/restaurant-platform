import { categoryElementId, type PublicMenuCategory } from "@/lib/api/menu";
import { MenuItemRow } from "./menu-item-row";

/**
 * One section of the menu — "Starters", "Mains".
 *
 * The heading is an `h3`: the page runs h1 (restaurant) → h2 ("Menu") → h3
 * (section), so a screen-reader user can jump through the menu by heading in
 * the order the sections actually appear.
 *
 * Items are a real `<ul>`. That is not pedantry — assistive technology
 * announces "list, 8 items", which is exactly the orientation a customer
 * scanning a menu needs and which a stack of `<div>`s cannot provide.
 */
export function MenuCategorySection({ category }: { category: PublicMenuCategory }) {
  const headingId = `${categoryElementId(category)}-heading`;

  return (
    <section
      id={categoryElementId(category)}
      aria-labelledby={headingId}
      /*
        Anchor jumps must not land under the sticky category bar. `scroll-mt`
        offsets the scroll position by roughly the bar's height, so the heading
        stays visible after a jump.
      */
      className="scroll-mt-20 sm:scroll-mt-24"
    >
      <h3 id={headingId} className="text-lg font-semibold tracking-tight sm:text-xl">
        {category.name}
      </h3>

      {category.description ? (
        <p className="mt-1 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
          {category.description}
        </p>
      ) : null}

      <ul className="mt-2 divide-y divide-border">
        {category.menuItems.map((item) => (
          <MenuItemRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}
