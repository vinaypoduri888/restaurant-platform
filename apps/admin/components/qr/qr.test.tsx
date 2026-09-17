import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { canViewQr } from "@/lib/api/qr";
import type { RestaurantQr } from "@/lib/api/qr";
import { QrImage, QrPanel } from "./qr-panel";

afterEach(cleanup);

/**
 * A realistic payload. The SVG is a stand-in: what matters to these tests is
 * how the console presents it, not the encoder — which is proved separately,
 * by decoding, in `apps/api/src/shared/qr/qr.test.ts`.
 */
function qr(overrides: Partial<RestaurantQr> = {}): RestaurantQr {
  return {
    targetUrl: "http://localhost:3000/r/spice-house",
    fileName: "spice-house-menu-qr.svg",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 37" role="img"><rect width="37" height="37" fill="#ffffff"/><path fill="#000000" d="M4 4h1v1h-1z"/></svg>',
    ...overrides,
  };
}

describe("canViewQr", () => {
  /** Mirrors the backend's `qr:read`, which is OWNER only. */
  test("only an owner may view the QR code", () => {
    expect(canViewQr("OWNER")).toBe(true);
    expect(canViewQr("STAFF")).toBe(false);
  });
});

describe("QrPanel", () => {
  function renderPanel(overrides: Partial<RestaurantQr> = {}) {
    return render(
      <QrPanel restaurantId="r1" restaurantName="Spice House" qr={qr(overrides)} />,
    );
  }

  test("shows the public URL in full, as a working link", () => {
    renderPanel();

    const link = screen.getByRole("link", { name: "http://localhost:3000/r/spice-house" });
    expect(link.getAttribute("href")).toBe("http://localhost:3000/r/spice-house");
  });

  /**
   * An owner is about to commit this URL to print. Truncating it would hide
   * exactly the part most likely to be wrong — the slug at the end.
   */
  test("does not truncate the URL", () => {
    renderPanel({ targetUrl: "http://localhost:3000/r/a-rather-long-restaurant-slug-here" });

    expect(
      screen.getByText("http://localhost:3000/r/a-rather-long-restaurant-slug-here"),
    ).toBeDefined();
  });

  test("renders the code as one image with a descriptive name", () => {
    renderPanel();
    const image = screen.getByRole("img");

    expect(image.getAttribute("alt")).toBe("QR code linking to the Spice House menu");
  });

  /**
   * The code is an `<img src="data:...">`, not inline SVG markup. Inline markup
   * would mean `dangerouslySetInnerHTML`, and an SVG in the DOM can carry
   * script — so one escaping mistake in the API would become stored XSS here.
   * An image element cannot execute script whatever the document says.
   */
  test("embeds the code as an image source, never as live markup", () => {
    const { container } = renderPanel();

    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("img").getAttribute("src")).toStartWith(
      "data:image/svg+xml;base64,",
    );
  });

  test("the embedded image decodes back to the SVG it was given", () => {
    renderPanel();

    const src = screen.getByRole("img").getAttribute("src") ?? "";
    const decoded = Buffer.from(src.replace("data:image/svg+xml;base64,", ""), "base64").toString(
      "utf8",
    );

    expect(decoded).toBe(qr().svg);
  });

  test("offers a download and a print sheet", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: /download/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /print sheet/i }).getAttribute("href")).toBe(
      "/restaurants/r1/qr/print",
    );
  });

  /**
   * The single most counter-intuitive fact about a printed code, so the console
   * has to say it rather than leave an owner to fear renaming.
   */
  test("explains that renaming the URL will not break printed codes", () => {
    renderPanel();

    expect(screen.getByText(/renaming your menu url is safe/i)).toBeDefined();
    expect(screen.getByText(/keep working/i)).toBeDefined();
  });

  test("exposes no internal identifier or storage detail", () => {
    const { container } = renderPanel();
    const html = container.innerHTML.toLowerCase();

    for (const secret of [
      "storagekey",
      "restaurant_slugs",
      "localhost:3001",
      "/admin/restaurants",
      "r2_",
      "secret",
      "storage_driver",
    ]) {
      expect(html).not.toContain(secret);
    }
    // No filesystem path of any shape.
    expect(html).not.toMatch(/[a-z]:\\/);
  });

  test("is headed as a labelled section", () => {
    renderPanel();
    expect(screen.getByRole("heading", { level: 2, name: /menu qr code/i })).toBeDefined();
  });
});

describe("QrImage", () => {
  test("carries intrinsic dimensions so the layout does not jump", () => {
    render(<QrImage svg={qr().svg} restaurantName="Spice House" />);
    const image = screen.getByRole("img");

    expect(image.getAttribute("width")).toBe("512");
    expect(image.getAttribute("height")).toBe("512");
  });

  test("accepts a larger size for the print sheet", () => {
    render(<QrImage svg={qr().svg} restaurantName="Spice House" className="size-64" />);
    expect(screen.getByRole("img").className).toContain("size-64");
  });

  /**
   * A dark frame tight against the quiet zone is a classic reason a code will
   * not scan, so the plate under it is light regardless of theme.
   */
  test("sits on a light plate whatever the theme", () => {
    const { container } = render(<QrImage svg={qr().svg} restaurantName="Spice House" />);
    expect(container.querySelector(".bg-white")).not.toBeNull();
  });

  test("names the restaurant in the alternative text", () => {
    render(<QrImage svg={qr().svg} restaurantName="Café Ñandú" />);
    expect(screen.getByRole("img").getAttribute("alt")).toBe(
      "QR code linking to the Café Ñandú menu",
    );
  });

  /** Base64 is why a non-ASCII name cannot corrupt the data URI. */
  test("survives a name outside ASCII", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>Café Ñandú</title></svg>';
    render(<QrImage svg={svg} restaurantName="Café Ñandú" />);

    const src = screen.getByRole("img").getAttribute("src") ?? "";
    const decoded = Buffer.from(src.replace("data:image/svg+xml;base64,", ""), "base64").toString(
      "utf8",
    );

    expect(decoded).toBe(svg);
  });
});
