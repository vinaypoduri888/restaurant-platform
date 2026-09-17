import type { Metadata } from "next";
import { Badge } from "@repo/ui/badge";
import { Card, CardContent, CardTitle } from "@repo/ui/card";
import { ConfirmDelete } from "@/components/menu/confirm-delete";
import { MoveButtons } from "@/components/menu/move-buttons";
import { deleteCategoryAction, moveCategoryAction } from "@/lib/actions/menu-actions";
import { listCategories, type AdminCategory } from "@/lib/api/menu";
import { canDelete, getRestaurant } from "@/lib/api/restaurants";
import { CategoryCreateForm, CategoryEditForm } from "./category-forms";

export const metadata: Metadata = { title: "Categories" };

interface PageProps {
  params: Promise<{ restaurantId: string }>;
}

/**
 * Category management.
 *
 * A Server Component. The list, the counts, and every row render on the server;
 * only the forms and the destructive/reorder controls hydrate.
 *
 * Editing uses a native `<details>` disclosure rather than a modal dialog. It
 * is keyboard-operable and screen-reader-announced with no JavaScript at all,
 * cannot trap focus, and — unlike a dialog — several can be open at once, which
 * is genuinely useful when reordering a menu.
 */
export default async function CategoriesPage({ params }: PageProps) {
  const { restaurantId } = await params;

  const [{ role }, { items: categories }] = await Promise.all([
    // The caller's role decides which controls are shown. Presentation only —
    // the API re-authorizes every write regardless.
    getRestaurant(restaurantId),
    // Each row carries `menuItemCount`, counted by the database. Counting here
    // from a page of items under-reported every section past the first page.
    listCategories(restaurantId),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="categories-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="categories-heading" className="text-lg font-semibold tracking-tight">
            Menu sections
          </h2>
          <p className="text-sm text-muted-foreground">
            Customers see these in this order. Empty sections are not shown to them.
          </p>
        </div>

        {categories.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="flex flex-col gap-3">
            {categories.map((category, index) => (
              <li key={category.id}>
                <CategoryRow
                  restaurantId={restaurantId}
                  category={category}
                  itemCount={category.menuItemCount}
                  canDelete={canDelete(role)}
                  isFirst={index === 0}
                  isLast={index === categories.length - 1}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="add-category-heading">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <CardTitle as="h2" id="add-category-heading">
              Add a section
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              New sections are added to the end of the menu.
            </p>
            <div className="mt-5">
              <CategoryCreateForm restaurantId={restaurantId} />
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function CategoryRow({
  restaurantId,
  category,
  itemCount,
  canDelete,
  isFirst,
  isLast,
}: {
  restaurantId: string;
  category: AdminCategory;
  itemCount: number;
  canDelete: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-medium text-foreground">{category.name}</h3>
              {category.isActive ? null : <Badge variant="neutral">Hidden</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {itemCount === 1 ? "1 item" : `${itemCount} items`} · /{category.slug}
            </p>
          </div>

          <MoveButtons
            itemName={category.name}
            isFirst={isFirst}
            isLast={isLast}
            moveUp={moveCategoryAction.bind(null, restaurantId, category.id, "up")}
            moveDown={moveCategoryAction.bind(null, restaurantId, category.id, "down")}
          />
        </div>

        <details className="group">
          <summary className="inline-flex h-11 cursor-pointer list-none items-center rounded-md px-3 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <span className="group-open:hidden">Edit section</span>
            <span className="hidden group-open:inline">Close</span>
          </summary>

          <div className="mt-4 flex flex-col gap-6 border-t border-border pt-4">
            <CategoryEditForm restaurantId={restaurantId} category={category} />

            <div className="border-t border-border pt-4">
              <ConfirmDelete
                label="Delete section"
                canDelete={canDelete}
                allowForce
                confirmMessage={
                  itemCount === 0
                    ? `Delete “${category.name}”? It has no menu items.`
                    : `Delete “${category.name}”? It still holds ${itemCount === 1 ? "1 menu item" : `${itemCount} menu items`}, so this will be refused unless you also choose to delete them.`
                }
                action={deleteCategoryAction.bind(null, restaurantId, category.id)}
              />
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-2 p-6">
        <p className="text-base font-medium text-foreground">No sections yet</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          A menu is organised into sections — Starters, Mains, Drinks. Add your
          first one below, then start adding dishes to it.
        </p>
      </CardContent>
    </Card>
  );
}
