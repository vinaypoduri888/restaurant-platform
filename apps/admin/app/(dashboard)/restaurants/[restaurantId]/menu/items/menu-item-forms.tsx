"use client";

import { useActionState } from "react";
import { minorUnitsFor, toMoneyInput } from "@repo/ui/lib/money";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { CheckboxField, TextAreaField, TextField } from "@/components/forms/text-field";
import { createMenuItemAction, updateMenuItemAction } from "@/lib/actions/menu-actions";
import type { AdminCategory, AdminMenuItem } from "@/lib/api/menu";
import { idleFormState } from "@/lib/forms/state";

interface CategorySelectProps {
  categories: AdminCategory[];
  defaultValue?: string;
  error?: string;
}

/**
 * The section an item belongs to.
 *
 * A real `<select>` rather than a custom listbox: it is keyboard-operable,
 * screen-reader-correct, and on a phone it opens the platform's own picker,
 * which is far easier to use than any in-page dropdown.
 *
 * Hidden sections are marked in the label. An owner moving a dish into a hidden
 * section needs to know it will vanish from the customer menu — discovering
 * that afterwards looks like the save failed.
 */
function CategorySelect({ categories, defaultValue, error }: CategorySelectProps) {
  const errorId = "categoryId-error";

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="categoryId" className="text-sm font-medium text-foreground">
        Section
        <span aria-hidden="true" className="ml-0.5 text-destructive">
          *
        </span>
        <span className="sr-only"> (required)</span>
      </label>

      <select
        id="categoryId"
        name="categoryId"
        required
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="h-11 w-full rounded-md border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive"
      >
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
            {category.isActive ? "" : " (hidden)"}
          </option>
        ))}
      </select>

      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The price field.
 *
 * Takes a major-unit amount ("12.50") because that is how a price is written on
 * a menu; the action converts it to exact minor units before it reaches the
 * API. `inputMode="decimal"` gets the numeric keypad on a phone without the
 * spinner arrows and scroll-wheel hazards of `type="number"`.
 *
 * The step hint follows the currency: a JPY menu is told to enter whole
 * numbers, because yen has no minor unit and "12.50" would be rejected.
 */
function PriceField({
  currency,
  defaultValue,
  error,
}: {
  currency: string;
  defaultValue?: string;
  error?: string;
}) {
  const decimals = minorUnitsFor(currency);

  return (
    <TextField
      name="price"
      label={`Price (${currency})`}
      required
      inputMode="decimal"
      defaultValue={defaultValue}
      placeholder={decimals === 0 ? "1200" : "12.50"}
      hint={
        decimals === 0
          ? `${currency} has no decimal places — enter a whole number.`
          : `Up to ${decimals} decimal places, e.g. ${decimals === 2 ? "12.50" : "12.500"}.`
      }
      error={error}
    />
  );
}

export function MenuItemCreateForm({
  restaurantId,
  categories,
  currency,
  defaultCategoryId,
}: {
  restaurantId: string;
  categories: AdminCategory[];
  currency: string;
  defaultCategoryId?: string;
}) {
  const [state, formAction] = useActionState(
    createMenuItemAction.bind(null, restaurantId),
    idleFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />

      <TextField
        name="name"
        label="Item name"
        required
        maxLength={180}
        placeholder="Margherita"
        error={state.fieldErrors?.name}
      />

      <CategorySelect
        categories={categories}
        defaultValue={defaultCategoryId ?? categories[0]?.id}
        error={state.fieldErrors?.categoryId}
      />

      <PriceField currency={currency} error={state.fieldErrors?.price} />

      <TextAreaField
        name="description"
        label="Description"
        rows={2}
        maxLength={1000}
        hint="Ingredients or a short note. Optional."
        error={state.fieldErrors?.description}
      />

      <div>
        <SubmitButton pendingLabel="Adding…">Add item</SubmitButton>
      </div>
    </form>
  );
}

export function MenuItemEditForm({
  restaurantId,
  item,
  categories,
  currency,
}: {
  restaurantId: string;
  item: AdminMenuItem;
  categories: AdminCategory[];
  currency: string;
}) {
  const [state, formAction] = useActionState(
    updateMenuItemAction.bind(null, restaurantId, item.id),
    idleFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />

      <TextField
        name="name"
        label="Item name"
        required
        maxLength={180}
        defaultValue={item.name}
        error={state.fieldErrors?.name}
      />

      <CategorySelect
        categories={categories}
        defaultValue={item.categoryId}
        error={state.fieldErrors?.categoryId}
      />

      <PriceField
        currency={currency}
        // Rendered back from exact minor units, so the value shown is the value
        // stored — no rounding happens on the way into the form.
        defaultValue={toMoneyInput(item.priceMinor, minorUnitsFor(currency))}
        error={state.fieldErrors?.price}
      />

      <TextAreaField
        name="description"
        label="Description"
        rows={2}
        maxLength={1000}
        defaultValue={item.description ?? ""}
        error={state.fieldErrors?.description}
      />

      {/*
        Two separate switches, because they mean different things and the
        difference matters to a customer: available-but-sold-out stays on the
        menu marked, while inactive disappears from it entirely.
      */}
      <CheckboxField
        name="isAvailable"
        label="Available today"
        description="Unchecking shows it as “Unavailable today” on the customer menu — it stays listed."
        defaultChecked={item.isAvailable}
      />

      <CheckboxField
        name="isActive"
        label="On the published menu"
        description="Unchecking removes it from the customer menu entirely. Nothing is deleted."
        defaultChecked={item.isActive}
      />

      <div>
        <SubmitButton>Save item</SubmitButton>
      </div>
    </form>
  );
}
