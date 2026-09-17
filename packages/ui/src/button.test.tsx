import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { Button } from "./button.tsx";

afterEach(cleanup);

describe("Button", () => {
  test("renders its children", () => {
    render(<Button>Save changes</Button>);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
  });

  /**
   * Guards the classic bug where a button inside a form submits it because the
   * HTML default for `type` is "submit".
   */
  test("defaults to type=button rather than submit", () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  test("allows an explicit submit type", () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });

  test("forwards disabled state", () => {
    render(<Button disabled>Disabled</Button>);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  test("applies variant classes", () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole("button").className).toContain("bg-destructive");
  });

  test("caller className overrides conflicting base utilities", () => {
    render(<Button className="px-8">Wide</Button>);
    const classes = screen.getByRole("button").className;
    expect(classes).toContain("px-8");
    expect(classes).not.toContain("px-4");
  });

  /**
   * 44px is the minimum comfortable touch target. The default size is used on
   * customer-facing surfaces, so this is a real accessibility guarantee rather
   * than a styling preference.
   */
  test("default size meets the 44px touch-target floor", () => {
    render(<Button>Tap</Button>);
    expect(screen.getByRole("button").className).toContain("h-11");
  });

  test("always renders a visible focus ring for keyboard users", () => {
    render(<Button>Focus</Button>);
    expect(screen.getByRole("button").className).toContain("focus-visible:ring-2");
  });

  test("forwards arbitrary props such as aria-label", () => {
    render(<Button aria-label="Close dialog">×</Button>);
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeDefined();
  });
});
