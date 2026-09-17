import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { Alert, AlertDescription, AlertTitle } from "./alert.tsx";
import { Badge } from "./badge.tsx";
import { Card, CardDescription, CardTitle } from "./card.tsx";
import { Input } from "./input.tsx";
import { Label } from "./label.tsx";
import { Skeleton } from "./skeleton.tsx";
import { SkipLink } from "./skip-link.tsx";
import { VisuallyHidden } from "./visually-hidden.tsx";

afterEach(cleanup);

describe("Input", () => {
  test("is reachable by its associated label", () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" />
      </>,
    );
    expect(screen.getByLabelText("Email")).toBeDefined();
  });

  test("sets aria-invalid when marked invalid", () => {
    render(<Input aria-label="Slug" invalid />);
    expect(screen.getByLabelText("Slug").getAttribute("aria-invalid")).toBe("true");
  });

  test("omits aria-invalid when valid, rather than sending false", () => {
    render(<Input aria-label="Slug" />);
    expect(screen.getByLabelText("Slug").getAttribute("aria-invalid")).toBeNull();
  });

  /**
   * Below 16px, iOS Safari zooms the viewport on focus — which on a phone reads
   * as the page lurching sideways.
   */
  test("uses a 16px font size to prevent iOS zoom-on-focus", () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByLabelText("Name").className).toContain("text-base");
  });
});

describe("Label", () => {
  test("announces required fields in words, not just with a glyph", () => {
    render(<Label htmlFor="name" required>Name</Label>);
    // The visible "*" is aria-hidden; the accessible name carries "(required)".
    expect(screen.getByText("(required)")).toBeDefined();
    expect(screen.getByText("*").getAttribute("aria-hidden")).toBe("true");
  });

  test("omits the required marker by default", () => {
    render(<Label htmlFor="name">Name</Label>);
    expect(screen.queryByText("(required)")).toBeNull();
  });
});

describe("Card", () => {
  test("renders a level-3 heading by default", () => {
    render(<CardTitle>Pizza Palace</CardTitle>);
    expect(screen.getByRole("heading", { level: 3, name: "Pizza Palace" })).toBeDefined();
  });

  /**
   * Cards appear at different depths, so the heading level must follow the
   * page outline rather than being fixed by the component.
   */
  test("heading level is overridable to keep document order correct", () => {
    render(<CardTitle as="h2">Section</CardTitle>);
    expect(screen.getByRole("heading", { level: 2, name: "Section" })).toBeDefined();
  });

  test("composes title and description", () => {
    render(
      <Card>
        <CardTitle>Title</CardTitle>
        <CardDescription>Description</CardDescription>
      </Card>,
    );
    expect(screen.getByText("Description")).toBeDefined();
  });
});

describe("Badge", () => {
  test("carries meaning as text, not colour alone", () => {
    render(<Badge variant="success">Active</Badge>);
    expect(screen.getByText("Active")).toBeDefined();
  });

  test("applies the variant class", () => {
    render(<Badge variant="destructive">Inactive</Badge>);
    expect(screen.getByText("Inactive").className).toContain("bg-destructive");
  });
});

describe("Skeleton", () => {
  /**
   * A skeleton has no information in it; announcing empty boxes is noise.
   */
  test("is hidden from assistive technology", () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Alert", () => {
  test("errors use an assertive live region", () => {
    render(<Alert variant="destructive">Something failed</Alert>);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  test("warnings also interrupt", () => {
    render(<Alert variant="warning">Careful</Alert>);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  test("informational messages are polite, not interrupting", () => {
    render(<Alert variant="info">Heads up</Alert>);
    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("composes title and description", () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Could not save</AlertTitle>
        <AlertDescription>Try again shortly.</AlertDescription>
      </Alert>,
    );
    expect(screen.getByText("Could not save")).toBeDefined();
    expect(screen.getByText("Try again shortly.")).toBeDefined();
  });
});

describe("VisuallyHidden", () => {
  test("stays in the accessibility tree while hidden visually", () => {
    render(<VisuallyHidden>Extra context</VisuallyHidden>);
    // Present in the DOM (so screen readers reach it) but visually clipped.
    expect(screen.getByText("Extra context").className).toContain("sr-only");
  });
});

describe("SkipLink", () => {
  test("points at the main content region by default", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(link.getAttribute("href")).toBe("#main-content");
  });

  test("target id is configurable", () => {
    render(<SkipLink targetId="menu">Skip to menu</SkipLink>);
    expect(screen.getByRole("link", { name: "Skip to menu" }).getAttribute("href")).toBe("#menu");
  });

  test("is hidden until focused", () => {
    render(<SkipLink />);
    const classes = screen.getByRole("link").className;
    expect(classes).toContain("sr-only");
    expect(classes).toContain("focus:not-sr-only");
  });
});
