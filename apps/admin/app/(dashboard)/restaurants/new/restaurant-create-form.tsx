"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { TextAreaField, TextField } from "@/components/forms/text-field";
import { createRestaurantAction } from "@/lib/actions/restaurant-actions";
import { idleFormState } from "@/lib/forms/state";

export function RestaurantCreateForm() {
  const [state, formAction] = useActionState(createRestaurantAction, idleFormState);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />

      <TextField
        name="name"
        label="Restaurant name"
        required
        maxLength={255}
        // The API derives the public URL slug from the name, so saying so here
        // stops the slug appearing later as a surprise.
        hint="Used to generate the public menu address."
        error={state.fieldErrors?.name}
      />

      <TextAreaField
        name="description"
        label="Description"
        maxLength={2000}
        hint="Shown under the name on the customer menu. Optional."
        error={state.fieldErrors?.description}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          name="city"
          label="City"
          maxLength={120}
          error={state.fieldErrors?.city}
        />
        <TextField
          name="country"
          label="Country"
          maxLength={120}
          error={state.fieldErrors?.country}
        />
      </div>

      <TextField
        name="currency"
        label="Currency"
        maxLength={3}
        defaultValue="USD"
        autoCapitalize="characters"
        spellCheck={false}
        // Currency determines how every price on the menu is written and how
        // many decimal places a price may have, so it is worth explaining.
        hint="Three-letter code, e.g. USD, EUR, INR, JPY. All menu prices use it."
        error={state.fieldErrors?.currency}
      />

      <div>
        <SubmitButton pendingLabel="Creating…">Create restaurant</SubmitButton>
      </div>
    </form>
  );
}
