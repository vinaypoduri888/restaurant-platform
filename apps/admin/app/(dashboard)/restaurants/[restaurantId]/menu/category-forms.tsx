"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { CheckboxField, TextAreaField, TextField } from "@/components/forms/text-field";
import { createCategoryAction, updateCategoryAction } from "@/lib/actions/menu-actions";
import type { AdminCategory } from "@/lib/api/menu";
import { idleFormState } from "@/lib/forms/state";

/**
 * Create and edit forms for a category.
 *
 * Both are Client Components so they can render the action's result inline.
 * The inputs are ordinary form controls, so the browser's own autofill works
 * and the markup stays server-rendered.
 *
 * Note: a form in a Client Component requires JavaScript to submit — see the
 * measured note in `sign-in-form.tsx`. Acceptable for an authenticated
 * dashboard; it would not be for the public menu, which ships no forms at all.
 */

export function CategoryCreateForm({ restaurantId }: { restaurantId: string }) {
  const [state, formAction] = useActionState(
    createCategoryAction.bind(null, restaurantId),
    idleFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />

      <TextField
        name="name"
        label="Section name"
        required
        maxLength={120}
        placeholder="Starters"
        error={state.fieldErrors?.name}
      />

      <TextAreaField
        name="description"
        label="Description"
        rows={2}
        maxLength={500}
        hint="Shown under the section heading, e.g. “Served until 3pm”. Optional."
        error={state.fieldErrors?.description}
      />

      <div>
        <SubmitButton pendingLabel="Adding…">Add section</SubmitButton>
      </div>
    </form>
  );
}

export function CategoryEditForm({
  restaurantId,
  category,
}: {
  restaurantId: string;
  category: AdminCategory;
}) {
  const [state, formAction] = useActionState(
    updateCategoryAction.bind(null, restaurantId, category.id),
    idleFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />

      <TextField
        name="name"
        label="Section name"
        required
        maxLength={120}
        defaultValue={category.name}
        error={state.fieldErrors?.name}
      />

      <TextField
        name="slug"
        label="URL name"
        maxLength={120}
        defaultValue={category.slug}
        // Explaining the constraint up front is kinder than a 409 after the
        // fact — and the "within this restaurant" part matters, because the
        // uniqueness is per-restaurant rather than global.
        hint="Lowercase letters, numbers and hyphens. Must be unique within this restaurant."
        error={state.fieldErrors?.slug}
      />

      <TextAreaField
        name="description"
        label="Description"
        rows={2}
        maxLength={500}
        defaultValue={category.description ?? ""}
        error={state.fieldErrors?.description}
      />

      <CheckboxField
        name="isActive"
        label="Show on the customer menu"
        description="Unchecking hides the whole section and its items from customers. Nothing is deleted."
        defaultChecked={category.isActive}
      />

      <div>
        <SubmitButton>Save section</SubmitButton>
      </div>
    </form>
  );
}
