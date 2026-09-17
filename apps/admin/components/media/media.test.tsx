import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { AdminMedia } from "@/lib/api/media";
import { findByPurpose } from "@/lib/api/media";
import {
  ACCEPTED_MIME_TYPES,
  MEDIA_MAX_BYTES,
  formatMaxSize,
  preCheckFile,
} from "@/lib/api/media-constraints";
import { BrandingSection } from "./branding-section";
import { MediaSlot } from "./media-slot";

afterEach(cleanup);

function media(overrides: Partial<AdminMedia> = {}): AdminMedia {
  return {
    id: "m1",
    restaurantId: "r1",
    purpose: "LOGO",
    url: "http://localhost:3001/media/restaurants/r1/media/m1/original.png",
    originalName: "my-logo.png",
    mimeType: "image/png",
    sizeBytes: 24_000,
    width: 512,
    height: 512,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

function file(name: string, type: string, size: number): File {
  // A File whose reported size is what matters; the bytes are irrelevant to a
  // pre-check that deliberately does not sniff them.
  const f = new File([new Uint8Array(Math.min(size, 1024))], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("findByPurpose", () => {
  test("picks the requested slot out of a flat list", () => {
    const items = [media({ id: "a", purpose: "LOGO" }), media({ id: "b", purpose: "BANNER" })];

    expect(findByPurpose(items, "LOGO")?.id).toBe("a");
    expect(findByPurpose(items, "BANNER")?.id).toBe("b");
  });

  test("returns null rather than undefined for an empty slot", () => {
    expect(findByPurpose([], "LOGO")).toBeNull();
  });
});

describe("client-side pre-check", () => {
  /**
   * Fast feedback only. The API re-reads the bytes and is the authority; these
   * checks exist so a person hears "too large" before a 5 MB upload, not after.
   */
  test("accepts a plausible image", () => {
    expect(preCheckFile(file("logo.png", "image/png", 200_000))).toBeNull();
    expect(preCheckFile(file("logo.webp", "image/webp", 200_000))).toBeNull();
  });

  test("rejects an empty file", () => {
    expect(preCheckFile(file("logo.png", "image/png", 0))).toContain("empty");
  });

  test("rejects a file over the size limit and names the limit", () => {
    const message = preCheckFile(file("big.png", "image/png", MEDIA_MAX_BYTES + 1));

    expect(message).toContain(formatMaxSize());
  });

  /**
   * The browser's type comes from the extension on most platforms, so a
   * mismatch is worth catching — but a match proves nothing, which is exactly
   * why the API sniffs the real bytes.
   */
  test("rejects a declared type the API does not accept", () => {
    expect(preCheckFile(file("logo.gif", "image/gif", 1000))).toContain("Accepted formats");
    expect(preCheckFile(file("doc.pdf", "application/pdf", 1000))).toContain("Accepted formats");
  });

  /** SVG is refused by the API because it is XML that can carry script. */
  test("does not offer SVG", () => {
    expect(ACCEPTED_MIME_TYPES).not.toContain("image/svg+xml" as never);
    expect(preCheckFile(file("logo.svg", "image/svg+xml", 1000))).toContain("Accepted formats");
  });

  /** A file with no reported type is left to the API rather than pre-rejected. */
  test("passes a typeless file through to the server", () => {
    expect(preCheckFile(file("logo", "", 1000))).toBeNull();
  });
});

describe("MediaSlot — empty", () => {
  function renderEmpty(canDelete = true) {
    return render(
      <MediaSlot
        restaurantId="r1"
        purpose="LOGO"
        heading="Logo"
        guidance="Shown beside your name."
        media={null}
        canDelete={canDelete}
      />,
    );
  }

  test("says the slot is not set, in words", () => {
    renderEmpty();
    expect(screen.getByText("Not set")).toBeDefined();
  });

  /** The absence of an image is a supported state, not a failure. */
  test("reassures rather than warning, and offers no delete", () => {
    renderEmpty();

    expect(screen.getByText(/renders correctly without it/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  test("shows no image and no broken preview", () => {
    const { container } = renderEmpty();
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  test("offers an upload control labelled for a first upload", () => {
    renderEmpty();
    expect(screen.getByLabelText("Upload image")).toBeDefined();
    expect(screen.getByRole("button", { name: "Upload" })).toBeDefined();
  });

  /** The constraints must be stated before a file is chosen, not after. */
  test("states the accepted formats, size and dimension limits up front", () => {
    renderEmpty();
    const hint = screen.getByText(/PNG, JPEG or WebP/);

    expect(hint.textContent).toContain(formatMaxSize());
    expect(hint.textContent).toContain("4096");
  });
});

describe("MediaSlot — populated", () => {
  function renderFull(canDelete = true, overrides: Partial<AdminMedia> = {}) {
    return render(
      <MediaSlot
        restaurantId="r1"
        purpose="LOGO"
        heading="Logo"
        guidance="Shown beside your name."
        media={media(overrides)}
        canDelete={canDelete}
      />,
    );
  }

  test("says the slot is set, in words", () => {
    renderFull();
    expect(screen.getByText("Set")).toBeDefined();
  });

  test("previews the current image with descriptive alt text", () => {
    renderFull();
    const img = screen.getByRole("img");

    expect(img.getAttribute("src")).toBe(media().url);
    expect(img.getAttribute("alt")).toBe("Current logo");
  });

  /** Reserved space, so the panel does not jump as the preview loads. */
  test("the preview carries its intrinsic dimensions", () => {
    renderFull();
    const img = screen.getByRole("img");

    expect(img.getAttribute("width")).toBe("512");
    expect(img.getAttribute("height")).toBe("512");
  });

  test("shows dimensions, size and the owner's own filename", () => {
    renderFull();

    expect(screen.getByText("512×512")).toBeDefined();
    expect(screen.getByText("24 kB")).toBeDefined();
    expect(screen.getByText("my-logo.png")).toBeDefined();
  });

  test("labels the control as a replacement and warns that it overwrites", () => {
    renderFull();

    expect(screen.getByLabelText("Replace image")).toBeDefined();
    expect(screen.getByRole("button", { name: "Replace" })).toBeDefined();
    expect(screen.getByText(/replaces the current image/i)).toBeDefined();
  });

  /**
   * Destructive, so it takes two steps and says what will happen — and points
   * at the reversible alternative.
   */
  test("an owner is offered removal behind a confirmation", () => {
    renderFull(true);

    const remove = screen.getByRole("button", { name: /remove logo/i });
    expect(remove).toBeDefined();
    // Not destroyed by one click: the confirmation copy is not yet on screen.
    expect(screen.queryByText(/deleted permanently/i)).toBeNull();
  });

  /**
   * `media:delete` is OWNER-only. A staff member is told why and pointed at
   * what they *can* do, rather than shown a button that always refuses.
   */
  test("a staff member is told only an owner can remove it", () => {
    renderFull(false);

    expect(screen.queryByRole("button", { name: /remove logo/i })).toBeNull();
    expect(screen.getByText(/only an owner can delete this/i)).toBeDefined();
  });

  test("a staff member can still replace the image", () => {
    renderFull(false);
    expect(screen.getByRole("button", { name: "Replace" })).toBeDefined();
  });
});

describe("no internal metadata or secrets are rendered", () => {
  test("the slot exposes no storage key", () => {
    const { container } = render(
      <MediaSlot
        restaurantId="r1"
        purpose="LOGO"
        heading="Logo"
        guidance="g"
        media={media()}
        canDelete
      />,
    );

    expect(container.innerHTML).not.toContain("storageKey");
    expect(container.innerHTML).not.toContain("/media/restaurants/r1/media/m1/original.png".replace("/media", "STORAGEKEY"));
  });

  test("no filesystem path or credential appears", () => {
    const { container } = render(
      <MediaSlot
        restaurantId="r1"
        purpose="BANNER"
        heading="Banner"
        guidance="g"
        media={media({ purpose: "BANNER" })}
        canDelete
      />,
    );
    const html = container.innerHTML.toLowerCase();

    expect(html).not.toContain("storage/uploads");
    expect(html).not.toMatch(/[a-z]:\\/);
    for (const secret of ["r2_", "secret", "access_key", "cloudflarestorage", "storage_driver"]) {
      expect(html).not.toContain(secret);
    }
  });
});

describe("BrandingSection", () => {
  function renderSection(items: AdminMedia[], canDelete = true) {
    return render(
      <BrandingSection restaurantId="r1" media={items} canDelete={canDelete} />,
    );
  }

  test("renders exactly the two slots the product supports", () => {
    renderSection([]);

    expect(screen.getByRole("heading", { level: 3, name: "Logo" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: "Banner" })).toBeDefined();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
  });

  test("both slots read as not set when nothing is uploaded", () => {
    renderSection([]);
    expect(screen.getAllByText("Not set")).toHaveLength(2);
  });

  test("shows a logo without implying the banner is broken", () => {
    renderSection([media({ purpose: "LOGO" })]);

    expect(screen.getByText("Set")).toBeDefined();
    expect(screen.getByText("Not set")).toBeDefined();
  });

  test("shows both when both are uploaded", () => {
    renderSection([
      media({ id: "a", purpose: "LOGO" }),
      media({ id: "b", purpose: "BANNER", width: 1600, height: 600 }),
    ]);

    expect(screen.getAllByText("Set")).toHaveLength(2);
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  /** Both are optional, and the copy has to say so rather than imply a gap. */
  test("says both are optional", () => {
    renderSection([]);
    expect(screen.getByText(/both are optional/i)).toBeDefined();
  });

  test("each slot is its own labelled region", () => {
    renderSection([media({ purpose: "LOGO" })]);

    const logoRegion = screen.getByRole("region", { name: "Logo" });
    expect(within(logoRegion).getByRole("img")).toBeDefined();
    // The banner region must not contain the logo's preview.
    expect(within(screen.getByRole("region", { name: "Banner" })).queryByRole("img")).toBeNull();
  });

  test("staff see no removal controls in either slot", () => {
    renderSection(
      [media({ id: "a", purpose: "LOGO" }), media({ id: "b", purpose: "BANNER" })],
      false,
    );

    expect(screen.queryAllByRole("button", { name: /remove/i })).toHaveLength(0);
    expect(screen.getAllByText(/only an owner can delete this/i)).toHaveLength(2);
  });
});
