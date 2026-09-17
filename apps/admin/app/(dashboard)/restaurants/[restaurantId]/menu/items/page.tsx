import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@repo/ui/badge";
import { Card, CardContent, CardTitle } from "@repo/ui/card";
import { formatMinor } from "@repo/ui/lib/money";
import { AvailabilityToggle } from "@/components/menu/availability-toggle";
import { ConfirmDelete } from "@/components/menu/confirm-delete";
import { MoveButtons } from "@/components/menu/move-buttons";
import {
  deleteMenuItemAction,
  moveMenuItemAction,
  toggleMenuItemAvailabilityAction,
} from "@/lib/actions/menu-actions";
import {
  listCategories,
  listMenuItems,
  type AdminCategory,
  type AdminMenuItem,
} from "@/lib/api/menu";
import { canDelete, getRestaurant } from "@/lib/api/restaurants";
import { MenuItemFilters } from "./menu-item-filters";
import { MenuItemCreateForm, MenuItemEditForm } from "./menu-item-forms";

export const metadata: Metadata = { title: "Menu items" };

const PAGE_SIZE = 20;

interface PageProps {
  params: Promise<{ restaurantId: string }>;
  // Next 16 delivers search params as a Promise, like route params.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Reads one query parameter, ignoring the repeated-key form. */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The API accepts exactly "true"/"false"; anything else is rejected, not guessed. */
function booleanParam(value: string | string[] | undefined): boolean | undefined {
  const raw = single(value);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

export default async function MenuItemsPage({ params, searchParams }: PageProps) {
  const { restaurantId } = await params;
  const query = await searchParams;

  const page = Math.max(1, Number(single(query.page) ?? 1) || 1);
  const categoryId = single(query.categoryId);

  const [{ restaurant, role }, { items: categories }] = await Promise.all([
    getRestaurant(restaurantId),
    listCategories(restaurantId),
  ]);

  // Filtering and pagination are done by the API, not in the browser — with
  // more than one page of items, client-side filtering would quietly show the
  // wrong results.
  const items = await listMenuItems(restaurantId, {
    page,
    limit: PAGE_SIZE,
    categoryId,
    isActive: booleanParam(query.isActive),
    isAvailable: booleanParam(query.isAvailable),
  });

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const pageCount = Math.max(1, Math.ceil(items.total / items.limit));

  // An item must belong to a section, so there is nothing useful to do here
  // until one exists. Saying so beats rendering a form that cannot be
  // submitted.
  if (categories.length === 0) {
    return <NoCategoriesState restaurantId={restaurantId} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="items-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="items-heading" className="text-lg font-semibold tracking-tight">
            Menu items
          </h2>
          <p className="text-sm text-muted-foreground">
            {items.total === 1 ? "1 item" : `${items.total} items`}
            {categoryId ? " in this section" : ""} · prices in {restaurant.currency}
          </p>
        </div>

        <MenuItemFilters categories={categories} />

        {items.items.length === 0 ? (
          <EmptyState hasFilters={Boolean(categoryId || query.isActive || query.isAvailable)} />
        ) : (
          <ul className="flex flex-col gap-3">
            {items.items.map((item, index) => (
              <li key={item.id}>
                <MenuItemRow
                  restaurantId={restaurantId}
                  item={item}
                  categories={categories}
                  currency={restaurant.currency}
                  categoryName={categoryNames.get(item.categoryId) ?? "Unknown section"}
                  canDelete={canDelete(role)}
                  // Reordering acts within a section, so it is only offered
                  // when the list is filtered to one — otherwise "up" would
                  // mean something different from what the screen shows.
                  reorderable={Boolean(categoryId)}
                  isFirst={index === 0}
                  isLast={index === items.items.length - 1}
                />
              </li>
            ))}
          </ul>
        )}

        <Pagination page={items.page} pageCount={pageCount} query={query} />
      </section>

      <section aria-labelledby="add-item-heading">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <CardTitle as="h2" id="add-item-heading">
              Add an item
            </CardTitle>
            <div className="mt-5">
              <MenuItemCreateForm
                restaurantId={restaurantId}
                categories={categories}
                currency={restaurant.currency}
                defaultCategoryId={categoryId}
              />
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MenuItemRow({
  restaurantId,
  item,
  categories,
  currency,
  categoryName,
  canDelete,
  reorderable,
  isFirst,
  isLast,
}: {
  restaurantId: string;
  item: AdminMenuItem;
  categories: AdminCategory[];
  currency: string;
  categoryName: string;
  canDelete: boolean;
  reorderable: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-medium text-foreground">{item.name}</h3>
              {/* Both states are words, never colour alone — WCAG 1.4.1. */}
              {item.isActive ? null : <Badge variant="neutral">Hidden</Badge>}
              {item.isAvailable ? null : <Badge variant="warning">Sold out</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {formatMinor(item.priceMinor, currency)} · {categoryName}
            </p>
          </div>

          {reorderable ? (
            <MoveButtons
              itemName={item.name}
              isFirst={isFirst}
              isLast={isLast}
              moveUp={moveMenuItemAction.bind(
                null,
                restaurantId,
                item.id,
                item.categoryId,
                "up",
              )}
              moveDown={moveMenuItemAction.bind(
                null,
                restaurantId,
                item.id,
                item.categoryId,
                "down",
              )}
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AvailabilityToggle
            itemName={item.name}
            isAvailable={item.isAvailable}
            action={toggleMenuItemAvailabilityAction.bind(
              null,
              restaurantId,
              item.id,
              !item.isAvailable,
            )}
          />
        </div>

        <details className="group">
          <summary className="inline-flex h-11 cursor-pointer list-none items-center rounded-md px-3 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <span className="group-open:hidden">Edit item</span>
            <span className="hidden group-open:inline">Close</span>
          </summary>

          <div className="mt-4 flex flex-col gap-6 border-t border-border pt-4">
            <MenuItemEditForm
              restaurantId={restaurantId}
              item={item}
              categories={categories}
              currency={currency}
            />

            <div className="border-t border-border pt-4">
              <ConfirmDelete
                label="Delete item"
                canDelete={canDelete}
                confirmMessage={`Delete “${item.name}”? This cannot be undone. To take it off the menu temporarily, uncheck “On the published menu” instead.`}
                action={deleteMenuItemAction.bind(null, restaurantId, item.id)}
              />
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

/**
 * Page links, as real anchors carrying the current filters.
 *
 * Anchors rather than buttons so a page can be opened in a new tab, shared, and
 * reached by the back button — and so pagination works without JavaScript.
 */
function Pagination({
  page,
  pageCount,
  query,
}: {
  page: number;
  pageCount: number;
  query: Record<string, string | string[] | undefined>;
}) {
  if (pageCount <= 1) return null;

  function href(target: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    params.set("page", String(target));
    return `?${params.toString()}`;
  }

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
      {page > 1 ? (
        <PageLink href={href(page - 1)}>← Previous</PageLink>
      ) : (
        <span aria-hidden="true" />
      )}

      <p className="text-sm text-muted-foreground" aria-live="polite">
        Page {page} of {pageCount}
      </p>

      {page < pageCount ? (
        <PageLink href={href(page + 1)}>Next →</PageLink>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}

function PageLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center rounded-md border border-input px-3 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {children}
    </Link>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-2 p-6">
        <p className="text-base font-medium text-foreground">
          {hasFilters ? "No items match these filters" : "No menu items yet"}
        </p>
        <p className="max-w-prose text-sm text-muted-foreground">
          {hasFilters
            ? "Try widening the filters above — the item may be in another section, or hidden."
            : "Add your first dish below. It will appear on the customer menu straight away."}
        </p>
      </CardContent>
    </Card>
  );
}

function NoCategoriesState({ restaurantId }: { restaurantId: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 p-6">
        <CardTitle as="h2">Add a section first</CardTitle>
        <p className="max-w-prose text-sm text-muted-foreground">
          Every item belongs to a section of the menu — Starters, Mains, Drinks —
          so there needs to be at least one before you can add a dish.
        </p>
        <Link
          href={`/restaurants/${restaurantId}/menu`}
          className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Go to sections
        </Link>
      </CardContent>
    </Card>
  );
}
