import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import Error from "./error";
import Loading from "./loading";
import NotFound from "./not-found";

afterEach(cleanup);

describe("loading state", () => {
  test("announces itself once, politely", () => {
    render(<Loading />);
    // A single status message rather than a dozen announced empty boxes.
    expect(screen.getByRole("status").textContent).toContain("Loading restaurant");
  });

  test("marks the region busy", () => {
    const { container } = render(<Loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  /**
   * The skeleton has to mirror the real layout, otherwise it swaps a blank
   * screen for a layout shift — worse for CLS and visibly broken on a phone.
   */
  test("mirrors the page layout so content does not jump when it arrives", () => {
    const { container } = render(<Loading />);
    expect(container.querySelector("header")).not.toBeNull();
    expect(container.querySelector(".max-w-3xl")).not.toBeNull();
  });
});

describe("not-found state", () => {
  test("explains the situation with a top-level heading", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
    expect(screen.getByText(/isn't available/i)).toBeDefined();
  });

  /**
   * The API returns 404 for both "missing" and "deactivated" on purpose. Copy
   * that claimed either one would leak what the API withholds — and would be
   * wrong roughly half the time.
   */
  test("does not claim which of the two 404 causes occurred", () => {
    const { container } = render(<NotFound />);
    const text = (container.textContent ?? "").toLowerCase();

    expect(text).not.toContain("deactivated");
    expect(text).not.toContain("deleted");
    expect(text).not.toContain("does not exist");
  });

  test("tells the customer what to do next", () => {
    render(<NotFound />);
    expect(screen.getByText(/ask a member of staff/i)).toBeDefined();
  });

  test("offers a keyboard-reachable way out", () => {
    render(<NotFound />);
    expect(screen.getByRole("link", { name: /homepage/i })).toBeDefined();
  });
});

describe("error state", () => {
  const boom = Object.assign(new globalThis.Error("connect ECONNREFUSED 10.0.0.4:5432"), {
    digest: "abc123",
    stack: "at getRestaurant (/app/lib/api/client.ts:42)",
  });

  test("shows a friendly, non-alarming message", () => {
    render(<Error error={boom} reset={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
    expect(screen.getByText(/can't load this menu right now/i)).toBeDefined();
  });

  /**
   * Next.js strips error details in production builds, but relying on that
   * alone would make this page's safety a build-mode detail rather than a
   * property of the code.
   */
  test("leaks no internals: no stack, host, driver, or raw message", () => {
    const { container } = render(<Error error={boom} reset={() => {}} />);
    const text = container.textContent ?? "";

    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("10.0.0.4");
    expect(text).not.toContain("client.ts");
    expect(text).not.toContain("getRestaurant");
  });

  test("surfaces only the opaque digest, for support correlation", () => {
    render(<Error error={boom} reset={() => {}} />);
    expect(screen.getByText("abc123")).toBeDefined();
  });

  test("omits the reference line when there is no digest", () => {
    render(<Error error={new globalThis.Error("x")} reset={() => {}} />);
    expect(screen.queryByText(/^Reference:/)).toBeNull();
  });

  test("offers a retry that meets the touch-target floor", () => {
    render(<Error error={boom} reset={() => {}} />);
    const retry = screen.getByRole("button", { name: /try again/i });
    expect(retry.className).toContain("h-11");
  });

  test("retry invokes reset", () => {
    let called = false;
    render(<Error error={boom} reset={() => { called = true; }} />);
    (screen.getByRole("button", { name: /try again/i }) as HTMLButtonElement).click();
    expect(called).toBe(true);
  });
});
