"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { CheckboxField, TextAreaField, TextField } from "@/components/forms/text-field";
import { updateRestaurantAction } from "@/lib/actions/restaurant-actions";
import type { AdminRestaurant } from "@/lib/api/restaurants";
import { idleFormState } from "@/lib/forms/state";

/**
 * Editing one restaurant's profile.
 *
 * The restaurant id is bound to the action here rather than sent as a hidden
 * input: a hidden field can be edited in devtools, a bound argument cannot. The
 * API re-checks membership on every request either way, so this is defence in
 * depth rather than the boundary itself.
 */
export function RestaurantProfileForm({ restaurant }: { restaurant: AdminRestaurant }) {
  const [state, formAction] = useActionState(
    updateRestaurantAction.bind(null, restaurant.id),
    idleFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />

      <TextField
        name="name"
        label="Restaurant name"
        required
        maxLength={255}
        defaultValue={restaurant.name}
        error={state.fieldErrors?.name}
      />

      <TextAreaField
        name="description"
        label="Description"
        maxLength={2000}
        defaultValue={restaurant.description ?? ""}
        hint="Shown under the name on the customer menu."
        error={state.fieldErrors?.description}
      />

      <TextField
        name="address"
        label="Address"
        maxLength={500}
        defaultValue={restaurant.address ?? ""}
        error={state.fieldErrors?.address}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          name="city"
          label="City"
          maxLength={120}
          defaultValue={restaurant.city ?? ""}
          error={state.fieldErrors?.city}
        />
        <TextField
          name="country"
          label="Country"
          maxLength={120}
          defaultValue={restaurant.country ?? ""}
          error={state.fieldErrors?.country}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          name="email"
          label="Contact email"
          type="email"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={restaurant.email ?? ""}
          // Worth stating: an owner filling in a "contact" field reasonably
          // assumes customers will see it, and here they will not.
          hint="For your records. Not shown on the customer menu."
          error={state.fieldErrors?.email}
        />
        <TextField
          name="phone"
          label="Contact phone"
          type="tel"
          maxLength={30}
          defaultValue={restaurant.phone ?? ""}
          hint="For your records. Not shown on the customer menu."
          error={state.fieldErrors?.phone}
        />
      </div>

      <TextField
        name="currency"
        label="Currency"
        maxLength={3}
        defaultValue={restaurant.currency}
        autoCapitalize="characters"
        spellCheck={false}
        hint="Three-letter code. Changing it re-labels existing prices without converting them."
        error={state.fieldErrors?.currency}
      />

      <TextField
        name="timeZone"
        label="Time zone"
        maxLength={64}
        defaultValue={restaurant.timeZone}
        spellCheck={false}
        // Named zones only. A fixed offset such as +05:30 cannot express
        // daylight saving, so opening hours stored against one would be an hour
        // wrong for half the year.
        hint="IANA identifier, e.g. Asia/Kolkata, Europe/Amsterdam, America/New_York. Opening hours are in this zone."
        error={state.fieldErrors?.timeZone}
      />

      <CheckboxField
        name="isActive"
        label="Visible to customers"
        description="When unchecked, the public menu page returns 'not found' — nothing is deleted."
        defaultChecked={restaurant.isActive}
      />

      <div>
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </form>
  );
}
