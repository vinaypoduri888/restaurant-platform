import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { PublicMenu, PublicMenuCategory, PublicMenuItem } from "@/lib/api/menu";
import { MenuSection } from "../menu-section";
import { MenuError } from "./menu-error";
import { MenuItemRow } from "./menu-item-row";
import { MenuNav } from "./menu-nav";

afterEach(cleanup);

function item(overrides: Partial<PublicMenuItem> = {}): PublicMenuItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    name: "Margherita",
    description: "Tomato, mozzarella, basil",
    price: { amountMinor: 1250, currency: "USD", minorUnits: 2 },
    isAvailable: true,
    ...overrides,
  };
}

function category(overrides: Partial<PublicMenuCategory> = {}): PublicMenuCategory {
  return {
    id: `cat-${Math.random().toString(36).slice(2)}`,
    name: "Mains",
    slug: "mains",
    description: null,
    menuItems: [item()],
    ...overrides,
  };
}

function menu(categories: PublicMenuCategory[]): PublicMenu {
  return {
    restaurant: { id: "cms123", name: "Pizza Palace", slug: "pizza-palace" },
    categories,
  };
}

describe("MenuItemRow", () => {
  test("renders the name and the formatted price", () => {
    render(
      <ul>
        <MenuItemRow item={item({ name: "Margherita" })} />
      </ul>,
    );

    expect(screen.getByRole("heading", { name: "Margherita" })).toBeDefined();
    expect(screen.getByText("$12.50")).toBeDefined();
  });

  /**
   * A currency symbol is a visual shorthand; screen readers do not announce
   * every one of them reliably. A price a customer cannot hear correctly is a
   * real problem at a table, not a cosmetic one.
   */
  test("the price carries a spoken label alongside the symbol", () => {
    const { container } = render(
      <ul>
        <MenuItemRow item={item()} />
      </ul>,
    );

    expect(container.querySelector('[aria-label="12.50 US dollars"]')).not.toBeNull();
  });

  /**
   * The reason `minorUnits` travels with every price: assuming two decimal
   * places would render ¥1,200 as ¥12.00 on a live menu.
   */
  test("a zero-decimal currency is not rendered with decimals", () => {
    render(
      <ul>
        <MenuItemRow
          item={item({ price: { amountMinor: 1200, currency: "JPY", minorUnits: 0 } })}
        />
      </ul>,
    );

    expect(screen.getByText(/1,200/)).toBeDefined();
    expect(screen.queryByText(/12\.00/)).toBeNull();
  });

  test("renders the description when present", () => {
    render(
      <ul>
        <MenuItemRow item={item({ description: "Tomato, mozzarella, basil" })} />
      </ul>,
    );

    expect(screen.getByText("Tomato, mozzarella, basil")).toBeDefined();
  });

  test("an item with no description renders without an empty paragraph", () => {
    const { container } = render(
      <ul>
        <MenuItemRow item={item({ description: null })} />
      </ul>,
    );

    expect(container.querySelectorAll("p")).toHaveLength(1); // the price only
  });

  /**
   * WCAG 1.4.1. A state signalled only by dimming is invisible to a
   * colour-blind customer and to a screen reader; the words have to be there.
   */
  test("an unavailable item says so in text, not only by styling", () => {
    render(
      <ul>
        <MenuItemRow item={item({ isAvailable: false })} />
      </ul>,
    );

    expect(screen.getByText(/unavailable today/i)).toBeDefined();
  });

  test("an available item carries no availability notice", () => {
    render(
      <ul>
        <MenuItemRow item={item({ isAvailable: true })} />
      </ul>,
    );

    expect(screen.queryByText(/unavailable/i)).toBeNull();
  });

  /** A free item is a real menu entry, not a missing price. */
  test("a zero price renders as zero rather than blank", () => {
    render(
      <ul>
        <MenuItemRow
          item={item({
            name: "Tap Water",
            price: { amountMinor: 0, currency: "USD", minorUnits: 2 },
          })}
        />
      </ul>,
    );

    expect(screen.getByText("$0.00")).toBeDefined();
  });

  /**
   * Names and descriptions are owner-controlled. React escapes by default and
   * that default must never be overridden — this asserts it holds.
   */
  test("owner-supplied markup is rendered as text, never as HTML", () => {
    const { container } = render(
      <ul>
        <MenuItemRow item={item({ name: "<img src=x onerror=alert(1)>", description: null })} />
      </ul>,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeDefined();
  });
});

describe("MenuSection", () => {
  test("renders each category as a labelled section with its items", () => {
    render(
      <MenuSection
        menu={menu([
          category({ name: "Starters", slug: "starters", menuItems: [item({ name: "Soup" })] }),
          category({ name: "Mains", slug: "mains", menuItems: [item({ name: "Pizza" })] }),
        ])}
      />,
    );

    const starters = screen.getByRole("region", { name: "Starters" });
    expect(within(starters).getByRole("heading", { name: "Soup" })).toBeDefined();
    expect(within(starters).queryByRole("heading", { name: "Pizza" })).toBeNull();
  });

  /**
   * `<ul>`/`<li>` is not pedantry: assistive technology announces "list, N
   * items", which is exactly the orientation someone scanning a menu needs.
   */
  test("items are a real list so their count is announced", () => {
    render(
      <MenuSection
        menu={menu([
          category({ menuItems: [item({ name: "A" }), item({ name: "B" }), item({ name: "C" })] }),
        ])}
      />,
    );

    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(3);
  });

  /** h1 restaurant → h2 Menu → h3 section → h4 dish, with no level skipped. */
  test("headings nest without skipping a level", () => {
    render(<MenuSection menu={menu([category({ name: "Mains" })])} />);

    expect(screen.getByRole("heading", { level: 2, name: "Menu" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: "Mains" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 4, name: "Margherita" })).toBeDefined();
  });

  test("renders a category description when the restaurant wrote one", () => {
    render(
      <MenuSection menu={menu([category({ description: "Served until 3pm" })])} />,
    );

    expect(screen.getByText("Served until 3pm")).toBeDefined();
  });

  /**
   * A heading with nothing under it reads as a loading failure on a phone.
   */
  test("a category with no items is not rendered as a bare heading", () => {
    render(
      <MenuSection
        menu={menu([
          category({ name: "Starters", slug: "starters", menuItems: [item()] }),
          category({ name: "Empty Section", slug: "empty", menuItems: [] }),
        ])}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Empty Section" })).toBeNull();
  });

  /**
   * The empty/error distinction, which is the crux of this component. Nothing
   * failed, so it must not be announced as a failure.
   */
  test("a menu with only empty categories falls back to the empty state", () => {
    render(<MenuSection menu={menu([category({ menuItems: [] })])} />);

    expect(screen.getByText(/isn't published yet/i)).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a failed menu request is an error state, not an empty one", () => {
    render(<MenuSection menu={null} />);

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/couldn't be loaded/i)).toBeDefined();
    expect(screen.queryByText(/isn't published yet/i)).toBeNull();
  });

  test("the menu heading survives every state, so the page never loses its structure", () => {
    for (const state of [null, menu([]), menu([category()])]) {
      cleanup();
      render(<MenuSection menu={state} />);
      expect(screen.getByRole("heading", { level: 2, name: "Menu" })).toBeDefined();
    }
  });
});

describe("MenuError", () => {
  /** Something genuinely failed, so a screen reader must be told. */
  test("is announced assertively", () => {
    render(<MenuError />);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  test("leaks no internal detail", () => {
    const { container } = render(<MenuError />);
    const text = container.textContent ?? "";

    for (const leak of ["fetch", "500", "ECONNREFUSED", "localhost", "API"]) {
      expect(text).not.toContain(leak);
    }
  });
});

describe("MenuNav", () => {
  test("links to every section", () => {
    render(
      <MenuNav
        categories={[
          category({ name: "Starters", slug: "starters" }),
          category({ name: "Mains", slug: "mains" }),
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Starters" }).getAttribute("href")).toBe(
      "#menu-category-starters",
    );
    expect(screen.getByRole("link", { name: "Mains" }).getAttribute("href")).toBe(
      "#menu-category-mains",
    );
  });

  /**
   * Real anchors, so navigation works before hydration and with JavaScript
   * disabled — a realistic state on restaurant Wi-Fi. The Client Component
   * boundary only adds highlighting on top of markup that already works.
   */
  test("navigation is plain anchors rather than script-driven buttons", () => {
    render(
      <MenuNav
        categories={[category({ slug: "starters" }), category({ slug: "mains" })]}
      />,
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  test("is a labelled navigation landmark", () => {
    render(
      <MenuNav categories={[category({ slug: "a" }), category({ slug: "b" })]} />,
    );

    expect(screen.getByRole("navigation", { name: "Menu sections" })).toBeDefined();
  });

  /** One section needs no navigation; a single-entry list is pure noise. */
  test("renders nothing for a single category", () => {
    const { container } = render(<MenuNav categories={[category()]} />);
    expect(container.innerHTML).toBe("");
  });

  test("entries meet the 44px touch-target floor", () => {
    render(
      <MenuNav categories={[category({ slug: "a" }), category({ slug: "b" })]} />,
    );

    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("h-11");
    }
  });
});
