import { describe, expect, test } from "bun:test";
import { cn } from "./cn.ts";

describe("cn", () => {
  test("joins class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  test("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  test("supports conditional objects and arrays", () => {
    expect(cn(["a", { b: true, c: false }])).toBe("a b");
  });

  /**
   * The reason tailwind-merge is a dependency at all: without it a caller's
   * `className` would not reliably override a component's base utility, and
   * the winner would depend on stylesheet order.
   */
  test("later Tailwind utilities win over conflicting earlier ones", () => {
    expect(cn("px-4", "px-8")).toBe("px-8");
    expect(cn("bg-primary", "bg-destructive")).toBe("bg-destructive");
  });

  test("keeps non-conflicting utilities", () => {
    expect(cn("px-4", "py-2")).toBe("px-4 py-2");
  });
});
