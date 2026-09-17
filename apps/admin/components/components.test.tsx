import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * These components are Client Components that import Server Actions. The action
 * modules pull in `next/headers` and `next/cache`, neither of which exists
 * outside a request, so they are stubbed — the behaviour under test is the
 * rendering and the accessibility wiring, not the actions themselves.
 */
mock.module("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {}, delete: () => {} }),
}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));

const { TextField, TextAreaField, CheckboxField } = await import("./forms/text-field");
const { FormMessage, FieldError } = await import("./forms/form-feedback");
const { ConfirmDelete } = await import("./menu/confirm-delete");
const { AvailabilityToggle } = await import("./menu/availability-toggle");
const { MoveButtons } = await import("./menu/move-buttons");

afterEach(cleanup);

const noopAction = async () => ({ status: "idle" as const });

describe("TextField", () => {
  test("labels the input, so clicking the label focuses it", () => {
    render(<TextField name="city" label="City" />);

    const input = screen.getByLabelText("City");
    expect(input.getAttribute("name")).toBe("city");
  });

  /**
   * The four things that get forgotten when wiring a field by hand — and each
   * omission breaks it for screen reader users while looking fine on screen.
   */
  test("an error is announced with the field, not just shown near it", () => {
    render(<TextField name="name" label="Name" error="Name is required" />);

    const input = screen.getByLabelText("Name");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain("name-error");
    expect(screen.getByText("Name is required")).toBeDefined();
  });

  test("a hint is associated with the input too", () => {
    render(<TextField name="currency" label="Currency" hint="Three-letter code" />);

    expect(screen.getByLabelText("Currency").getAttribute("aria-describedby")).toContain(
      "currency-hint",
    );
  });

  test("a required field announces that it is required", () => {
    render(<TextField name="name" label="Name" required />);

    expect(screen.getByText("(required)")).toBeDefined();
  });

  test("a valid field carries no aria-invalid", () => {
    render(<TextField name="city" label="City" />);

    expect(screen.getByLabelText("City").getAttribute("aria-invalid")).toBeNull();
  });
});

describe("TextAreaField", () => {
  test("is labelled and reports errors accessibly", () => {
    render(<TextAreaField name="description" label="Description" error="Too long" />);

    const field = screen.getByLabelText("Description");
    expect(field.tagName).toBe("TEXTAREA");
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("CheckboxField", () => {
  test("the whole row is the label, so the touch target is not a 16px box", () => {
    const { container } = render(
      <CheckboxField name="isActive" label="Visible to customers" description="Explanation" />,
    );

    expect(screen.getByLabelText(/Visible to customers/)).toBeDefined();
    expect(container.querySelector("label")?.className).toContain("min-h-11");
  });

  test("the description is announced with the checkbox", () => {
    render(<CheckboxField name="isActive" label="Visible" description="Explanation" />);

    expect(
      screen.getByLabelText(/Visible/).getAttribute("aria-describedby"),
    ).toBe("isActive-description");
  });
});

describe("FormMessage", () => {
  /**
   * Errors interrupt because the user's action did not do what they asked;
   * success does not, because they may already be typing in the next field.
   */
  test("an error is assertive", () => {
    render(<FormMessage state={{ status: "error", message: "That didn't work" }} />);

    expect(screen.getByRole("alert").textContent).toBe("That didn't work");
  });

  test("a success is polite", () => {
    render(<FormMessage state={{ status: "success", message: "Saved." }} />);

    expect(screen.getByRole("status").textContent).toBe("Saved.");
  });

  test("renders nothing when idle", () => {
    const { container } = render(<FormMessage state={{ status: "idle" }} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("FieldError", () => {
  test("renders nothing without a message, so no empty node is announced", () => {
    const { container } = render(<FieldError id="x-error" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ConfirmDelete", () => {
  /** Nothing is destroyed by a single click. */
  test("the first click reveals a confirmation rather than deleting", () => {
    render(
      <ConfirmDelete
        canDelete
        action={noopAction}
        label="Delete section"
        confirmMessage="Delete “Starters”? It has no menu items."
      />,
    );

    expect(screen.queryByRole("button", { name: /yes, delete/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete section" }));

    expect(screen.getByRole("button", { name: /yes, delete/i })).toBeDefined();
    expect(screen.getByText(/Delete .Starters.\? It has no menu items\./)).toBeDefined();
  });

  test("cancel returns to the safe state", () => {
    render(
      <ConfirmDelete canDelete action={noopAction} label="Delete item" confirmMessage="Delete this?" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("button", { name: /yes, delete/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete item" })).toBeDefined();
  });

  /**
   * The force option must never appear before the API has refused and
   * explained why — offering it up front turns the backend's 409 safeguard
   * into a one-click cascade.
   */
  test("the force option is not offered before the API refuses", () => {
    render(
      <ConfirmDelete
        canDelete
        action={noopAction}
        label="Delete section"
        confirmMessage="Delete this?"
        allowForce
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete section" }));

    expect(screen.queryByRole("button", { name: /and its items/i })).toBeNull();
  });

  /**
   * The console now knows the caller's role, so a staff member is no longer
   * offered a control that would always refuse. The explanation names the
   * reversible alternative, because "you can't" without "here's what you can"
   * is a dead end.
   */
  test("a caller who cannot delete is told why, and what to do instead", () => {
    render(
      <ConfirmDelete
        canDelete={false}
        action={noopAction}
        label="Delete section"
        confirmMessage="Delete this?"
      />,
    );

    expect(screen.queryByRole("button", { name: "Delete section" })).toBeNull();
    expect(screen.getByText(/only an owner can delete this/i)).toBeDefined();
    expect(screen.getByText(/hide it instead/i)).toBeDefined();
  });

  test("a caller who can delete still gets the control", () => {
    render(
      <ConfirmDelete
        canDelete
        action={noopAction}
        label="Delete section"
        confirmMessage="Delete this?"
      />,
    );

    expect(screen.getByRole("button", { name: "Delete section" })).toBeDefined();
  });

  /**
   * The warning is now about permanence rather than permission: anyone who
   * reaches this step is already known to hold the owner role, so repeating the
   * requirement here would be noise.
   */
  test("warns that deleting is permanent", () => {
    render(
      <ConfirmDelete canDelete action={noopAction} label="Delete item" confirmMessage="Delete this?" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));

    expect(screen.getByText(/permanent and cannot be undone/i)).toBeDefined();
  });
});

describe("AvailabilityToggle", () => {
  /**
   * A screen-reader user moving through twenty identical "Mark sold out"
   * buttons has no way to tell which row they are on.
   */
  test("each button names the dish it acts on", () => {
    render(
      <AvailabilityToggle action={noopAction} isAvailable itemName="Margherita" />,
    );

    expect(screen.getByRole("button", { name: "Mark Margherita as sold out" })).toBeDefined();
  });

  test("the label flips for a sold-out item", () => {
    render(
      <AvailabilityToggle action={noopAction} isAvailable={false} itemName="Soup" />,
    );

    expect(screen.getByRole("button", { name: "Mark Soup as available" })).toBeDefined();
  });

  test("meets the touch-target floor", () => {
    render(<AvailabilityToggle action={noopAction} isAvailable itemName="Soup" />);

    expect(screen.getByRole("button").className).toContain("h-11");
  });
});

describe("MoveButtons", () => {
  test("each button names what it moves and in which direction", () => {
    render(
      <MoveButtons
        moveUp={noopAction}
        moveDown={noopAction}
        itemName="Starters"
        isFirst={false}
        isLast={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Move Starters up" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Move Starters down" })).toBeDefined();
  });

  test("the first row cannot be moved up", () => {
    render(
      <MoveButtons
        moveUp={noopAction}
        moveDown={noopAction}
        itemName="Starters"
        isFirst
        isLast={false}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "Move Starters up" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Move Starters down" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  test("the last row cannot be moved down", () => {
    render(
      <MoveButtons moveUp={noopAction} moveDown={noopAction} itemName="Desserts" isFirst={false} isLast />,
    );

    expect(
      (screen.getByRole("button", { name: "Move Desserts down" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  /** Arrows are decoration; the accessible name carries the meaning. */
  test("the arrow glyphs are hidden from assistive technology", () => {
    const { container } = render(
      <MoveButtons
        moveUp={noopAction}
        moveDown={noopAction}
        itemName="Starters"
        isFirst={false}
        isLast={false}
      />,
    );

    for (const span of container.querySelectorAll("button span")) {
      expect(span.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
