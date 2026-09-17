"use server";

import { revalidatePath } from "next/cache";
import { createCategorySchema, updateCategorySchema } from "@repo/validation/category";
import { createMenuItemSchema, updateMenuItemSchema } from "@repo/validation/menu-item";
import { minorUnitsFor, parseMoneyInput } from "@repo/ui/lib/money";
import {
  createCategory,
  createMenuItem,
  deleteCategory,
  deleteMenuItem,
  listCategories,
  listMenuItems,
  updateCategory,
  updateMenuItem,
} from "../api/menu";
import { getRestaurant } from "../api/restaurants";
import {
  checkboxField,
  fieldErrorsFromIssues,
  formError,
  formSuccess,
  optionalField,
  textField,
  type FormState,
} from "../forms/state";
import { toFormState } from "./error-mapping";

/**
 * Category and menu-item mutations.
 *
 * The restaurant id is always a bound argument, never read from the submitted
 * form. A hidden input can be edited in devtools; a bound argument is fixed on
 * the server when the page renders. The API re-authorizes the membership on
 * every request regardless — this is defence in depth, not the boundary.
 */

/** Re-reads the whole restaurant view after a change. */
function revalidateMenu(restaurantId: string): void {
  revalidatePath(`/restaurants/${restaurantId}/menu`);
  revalidatePath(`/restaurants/${restaurantId}/menu/items`);
}

// --- Categories -------------------------------------------------------------

function readCategoryFields(formData: FormData) {
  return {
    name: textField(formData.get("name")),
    slug: optionalField(formData.get("slug")),
    description: optionalField(formData.get("description")),
  };
}

export async function createCategoryAction(
  restaurantId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createCategorySchema.safeParse(readCategoryFields(formData));

  if (!parsed.success) {
    return formError(
      "Please check the highlighted fields.",
      fieldErrorsFromIssues(parsed.error.issues),
    );
  }

  try {
    // `position` is deliberately not sent: the API appends new categories to
    // the end of the menu, which is what someone adding a section expects.
    await createCategory(restaurantId, parsed.data);
  } catch (error) {
    return toFormState(error);
  }

  revalidateMenu(restaurantId);
  return formSuccess(`"${parsed.data.name}" added.`);
}

export async function updateCategoryAction(
  restaurantId: string,
  categoryId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateCategorySchema.safeParse({
    ...readCategoryFields(formData),
    isActive: checkboxField(formData.get("isActive")),
  });

  if (!parsed.success) {
    return formError(
      "Please check the highlighted fields.",
      fieldErrorsFromIssues(parsed.error.issues),
    );
  }

  try {
    await updateCategory(restaurantId, categoryId, parsed.data);
  } catch (error) {
    return toFormState(error);
  }

  revalidateMenu(restaurantId);
  return formSuccess("Category saved.");
}

/**
 * Moves a category one place up or down the menu.
 *
 * ─── Why buttons and not drag-and-drop ──────────────────────────────────────
 *
 * The backend offers one-item `PATCH` and no bulk reorder endpoint, and adding
 * one was explicitly out of scope. Buttons fit that contract exactly — and they
 * are keyboard-operable and screen-reader-operable by default, which a drag
 * surface is not without substantial extra work.
 *
 * The neighbour is resolved *here*, from a fresh read, rather than being passed
 * in from the browser: a page rendered a minute ago may no longer reflect the
 * real order if someone else has been editing.
 *
 * The swap is two writes and is not atomic. A failure between them leaves two
 * categories sharing a position — which the API already handles, because its
 * ordering breaks ties by `createdAt` then `id`. The menu stays complete and
 * deterministically ordered; it does not become corrupt. That is what makes
 * this acceptable without a transaction.
 */
export async function moveCategoryAction(
  restaurantId: string,
  categoryId: string,
  direction: "up" | "down",
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const { items } = await listCategories(restaurantId);
    const index = items.findIndex((category) => category.id === categoryId);
    const neighbour = items[direction === "up" ? index - 1 : index + 1];
    const current = items[index];

    if (!current || !neighbour) {
      // Already at the end, or the list moved under us. Nothing to do, and
      // nothing worth alarming anyone about.
      return formSuccess("Order updated.");
    }

    // Equal positions would make the swap a no-op, so they are separated by
    // index instead — the list is already in the order the API returned.
    const [first, second] =
      current.position === neighbour.position
        ? [index, direction === "up" ? index - 1 : index + 1]
        : [neighbour.position, current.position];

    await updateCategory(restaurantId, current.id, { position: first });
    await updateCategory(restaurantId, neighbour.id, { position: second });
  } catch (error) {
    return toFormState(error);
  }

  revalidateMenu(restaurantId);
  return formSuccess("Order updated.");
}

/**
 * Deletes a category.
 *
 * `force` is read from the form and is only ever set by the explicit second
 * step of the confirmation UI. Sending it by default would turn the backend's
 * 409 — the safeguard that stops a mis-click destroying a whole section — into
 * a silent cascade.
 */
export async function deleteCategoryAction(
  restaurantId: string,
  categoryId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const force = checkboxField(formData.get("force"));

  try {
    await deleteCategory(restaurantId, categoryId, { force });
  } catch (error) {
    return toFormState(error);
  }

  revalidateMenu(restaurantId);
  return formSuccess(force ? "Category and its items deleted." : "Category deleted.");
}

// --- Menu items -------------------------------------------------------------

/**
 * Reads the price a person typed and converts it to exact minor units.
 *
 * The form takes "12.50" because that is how a price is written; the API takes
 * 1250 because money must be an exact integer. `parseMoneyInput` does the
 * conversion by string manipulation rather than `parseFloat(x) * 100`, which
 * yields 1209.9999999999998 for "12.10" and leaves rounding to decide what a
 * customer is charged.
 *
 * The currency's exponent comes from the restaurant, so a JPY menu correctly
 * refuses "12.50" instead of silently storing 1250 yen.
 */
async function readPriceMinor(
  restaurantId: string,
  formData: FormData,
): Promise<{ ok: true; priceMinor: number } | { ok: false; state: FormState }> {
  const raw = textField(formData.get("price")).trim();

  if (raw.length === 0) {
    return { ok: false, state: formError("Please check the highlighted fields.", { price: "Price is required" }) };
  }

  const { restaurant } = await getRestaurant(restaurantId);
  const priceMinor = parseMoneyInput(raw, minorUnitsFor(restaurant.currency));

  if (priceMinor === null) {
    return {
      ok: false,
      state: formError("Please check the highlighted fields.", {
        price: `Enter an amount in ${restaurant.currency}, for example 12.50`,
      }),
    };
  }

  return { ok: true, priceMinor };
}

export async function createMenuItemAction(
  restaurantId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const price = await readPriceMinor(restaurantId, formData);
  if (!price.ok) return price.state;

  const parsed = createMenuItemSchema.safeParse({
    categoryId: textField(formData.get("categoryId")),
    name: textField(formData.get("name")),
    description: optionalField(formData.get("description")),
    priceMinor: price.priceMinor,
  });

  if (!parsed.success) {
    return formError(
      "Please check the highlighted fields.",
      fieldErrorsFromIssues(parsed.error.issues),
    );
  }

  try {
    await createMenuItem(restaurantId, parsed.data);
  } catch (error) {
    return toFormState(error);
  }

  revalidateMenu(restaurantId);
  return formSuccess(`"${parsed.data.name}" added.`);
}

export async function updateMenuItemAction(
  restaurantId: string,
  menuItemId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const price = await readPriceMinor(restaurantId, formData);
  if (!price.ok) return price.state;

  const parsed = updateMenuItemSchema.safeParse({
    categoryId: textField(formData.get("categoryId")),
    name: textField(formData.get("name")),
    description: optionalField(formData.get("description")),
    priceMinor: price.priceMinor,
    isAvailable: checkboxField(formData.get("isAvailable")),
    isActive: checkboxField(formData.get("isActive")),
  });

  if (!parsed.success) {
    return formError(
      "Please check the highlighted fields.",
      fieldErrorsFromIssues(parsed.error.issues),
    );
  }

  try {
    await updateMenuItem(restaurantId, menuItemId, parsed.data);
  } catch (error) {
    return toFormState(error);
  }

  revalidateMenu(restaurantId);
  return formSuccess("Menu item saved.");
}

/**
 * The single most-used control in a service: marking a dish sold out.
 *
 * Kept separate from the full edit form so it is one click from the list, and
 * it flips `isAvailable` only — the item stays on the published menu, marked,
 * because silently removing a dish makes customers think the menu is broken.
 */
export async function toggleMenuItemAvailabilityAction(
  restaurantId: string,
  menuItemId: string,
  isAvailable: boolean,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await updateMenuItem(restaurantId, menuItemId, { isAvailable });
  } catch (error) {
    return toFormState(error);
  }

  revalidateMenu(restaurantId);
  return formSuccess(isAvailable ? "Marked as available." : "Marked as sold out.");
}

/** Moves an item one place within its own category. See `moveCategoryAction`. */
export async function moveMenuItemAction(
  restaurantId: string,
  menuItemId: string,
  categoryId: string,
  direction: "up" | "down",
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    // Scoped to the item's own category: position is ordered within a section,
    // so the neighbour must come from that section and not from the whole menu.
    const { items } = await listMenuItems(restaurantId, { categoryId, limit: 100 });
    const index = items.findIndex((item) => item.id === menuItemId);
    const current = items[index];
    const neighbour = items[direction === "up" ? index - 1 : index + 1];

    if (!current || !neighbour) {
      return formSuccess("Order updated.");
    }

    const [first, second] =
      current.position === neighbour.position
        ? [index, direction === "up" ? index - 1 : index + 1]
        : [neighbour.position, current.position];

    await updateMenuItem(restaurantId, current.id, { position: first });
    await updateMenuItem(restaurantId, neighbour.id, { position: second });
  } catch (error) {
    return toFormState(error);
  }

  revalidateMenu(restaurantId);
  return formSuccess("Order updated.");
}

export async function deleteMenuItemAction(
  restaurantId: string,
  menuItemId: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await deleteMenuItem(restaurantId, menuItemId);
  } catch (error) {
    return toFormState(error);
  }

  revalidateMenu(restaurantId);
  return formSuccess("Menu item deleted.");
}
