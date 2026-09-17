import { describe, expect, test } from "bun:test";
import {
  checkboxField,
  fieldErrorsFromIssues,
  formError,
  formSuccess,
  optionalField,
  textField,
} from "./state";

describe("fieldErrorsFromIssues", () => {
  test("maps each issue to the field it concerns", () => {
    expect(
      fieldErrorsFromIssues([
        { path: ["name"], message: "Name is required" },
        { path: ["currency"], message: "Must be 3 letters" },
      ]),
    ).toEqual({ name: "Name is required", currency: "Must be 3 letters" });
  });

  /** Three simultaneous complaints about one input is noise, not help. */
  test("keeps only the first issue per field", () => {
    expect(
      fieldErrorsFromIssues([
        { path: ["password"], message: "Too short" },
        { path: ["password"], message: "Also wrong somehow" },
      ]),
    ).toEqual({ password: "Too short" });
  });

  test("ignores issues with no addressable field", () => {
    expect(fieldErrorsFromIssues([{ path: [], message: "Whole-form problem" }])).toEqual({});
  });
});

describe("optionalField", () => {
  /**
   * An untouched input submits `""`, which is neither "leave unchanged" nor a
   * value worth storing. Returning `undefined` lets the caller omit the field.
   */
  test("treats empty and whitespace-only input as absent", () => {
    expect(optionalField("")).toBeUndefined();
    expect(optionalField("   ")).toBeUndefined();
    expect(optionalField(null)).toBeUndefined();
  });

  test("trims a real value", () => {
    expect(optionalField("  Mumbai  ")).toBe("Mumbai");
  });
});

describe("textField", () => {
  /** Required fields keep `""` so validation can reject it with a real message. */
  test("preserves empty input rather than dropping it", () => {
    expect(textField("")).toBe("");
    expect(textField(null)).toBe("");
  });

  test("does not trim, leaving that to the schema", () => {
    expect(textField("  spaced  ")).toBe("  spaced  ");
  });
});

describe("checkboxField", () => {
  /**
   * An HTML checkbox submits `"on"` when checked and *nothing at all* when
   * not — the absence is a real `false`, not a missing value. Getting this
   * wrong is how a "visible to customers" switch silently stops turning off.
   */
  test("an unchecked box is false, not undefined", () => {
    expect(checkboxField(null)).toBe(false);
  });

  test("a checked box is true", () => {
    expect(checkboxField("on")).toBe(true);
    expect(checkboxField("true")).toBe(true);
  });
});

describe("form states", () => {
  test("an error carries its message and field errors", () => {
    const state = formError("Check the fields", { name: "Required" });

    expect(state.status).toBe("error");
    expect(state.fieldErrors?.name).toBe("Required");
  });

  test("a success carries only a message", () => {
    expect(formSuccess("Saved.")).toEqual({ status: "success", message: "Saved." });
  });
});
