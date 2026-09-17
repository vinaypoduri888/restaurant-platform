import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { BrandingImage, PublicRestaurant } from "@/lib/api/restaurants";
import { RestaurantHeader } from "./restaurant-header";
import { buildRestaurantJsonLd, serializeJsonLd } from "./restaurant-json-ld";

afterEach(cleanup);

const logo: BrandingImage = {
  url: "http://localhost:3001/media/restaurants/r1/media/m1/original.png",
  width: 512,
  height: 512,
};

const banner: BrandingImage = {
  url: "http://localhost:3001/media/restaurants/r1/media/m2/original.png",
  width: 1600,
  height: 600,
};

function restaurant(overrides: Partial<PublicRestaurant> = {}): PublicRestaurant {
  return {
    id: "r1",
    name: "Pizza Palace",
    slug: "pizza-palace",
    description: null,
    address: null,
    city: null,
    country: null,
    currency: "INR",
    timeZone: "Asia/Kolkata",
    status: "unknown",
    hours: [],
    branding: { logo: null, banner: null },
    ...overrides,
  };
}

/**
 * `next/image` rewrites `src` through the optimiser, so assertions check that
 * the original URL is *referenced* rather than that it is the literal `src`.
 */
function imageReferencing(container: HTMLElement, url: string): HTMLImageElement | null {
  for (const img of container.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    const srcset = img.getAttribute("srcset") ?? "";
    if (src.includes(encodeURIComponent(url)) || src.includes(url) || srcset.includes(encodeURIComponent(url))) {
      return img;
    }
  }
  return null;
}

describe("no branding", () => {
  /**
   * The default state, and per `FRONTEND_SPEC.md` §17 a fully-supported one —
   * not a degraded fallback. A restaurant that has uploaded nothing must render
   * a complete, correct page.
   */
  test("renders no images at all", () => {
    const { container } = render(<RestaurantHeader restaurant={restaurant()} />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  test("still renders the name and the brand band", () => {
    const { container } = render(<RestaurantHeader restaurant={restaurant()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Pizza Palace" })).toBeDefined();
    // The slim band stands in for a banner, and is decorative.
    expect(container.querySelector('[aria-hidden="true"].bg-primary')).not.toBeNull();
  });

  /** No empty box, no spinner, no "image missing" placeholder. */
  test("shows no broken-image or placeholder UI", () => {
    const { container } = render(<RestaurantHeader restaurant={restaurant()} />);
    const text = (container.textContent ?? "").toLowerCase();

    expect(text).not.toContain("no image");
    expect(text).not.toContain("logo");
    expect(text).not.toContain("failed");
  });
});

describe("logo only", () => {
  test("renders the logo", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo, banner: null } })} />,
    );

    expect(imageReferencing(container, logo.url)).not.toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  /**
   * A logo carries identity, so it is announced — but not as the bare name,
   * which would read the restaurant's name twice beside the `<h1>`.
   */
  test("the logo has meaningful alt text naming the restaurant", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo, banner: null } })} />,
    );

    const img = imageReferencing(container, logo.url)!;
    expect(img.getAttribute("alt")).toBe("Pizza Palace logo");
  });

  test("the logo carries its intrinsic dimensions so space is reserved", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo, banner: null } })} />,
    );

    const img = imageReferencing(container, logo.url)!;
    expect(img.getAttribute("width")).toBe("512");
    expect(img.getAttribute("height")).toBe("512");
  });

  test("the brand band still renders when there is no banner", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo, banner: null } })} />,
    );

    expect(container.querySelector('[aria-hidden="true"].bg-primary')).not.toBeNull();
  });
});

describe("banner only", () => {
  test("renders the banner", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo: null, banner } })} />,
    );

    expect(imageReferencing(container, banner.url)).not.toBeNull();
  });

  /**
   * A banner is decorative: the page states the restaurant's name in its `<h1>`
   * immediately below, so alt text here would duplicate what the reader has.
   * Empty `alt` tells a screen reader to skip it; omitting the attribute would
   * make some readers announce the filename instead.
   */
  test("the banner has an explicitly empty alt", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo: null, banner } })} />,
    );

    const img = imageReferencing(container, banner.url)!;
    expect(img.getAttribute("alt")).toBe("");
  });

  /**
   * The banner sits above the fold and pushes the menu down as it loads, so the
   * aspect ratio must be reserved from the API's dimensions.
   */
  test("the banner container reserves its aspect ratio before loading", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo: null, banner } })} />,
    );

    const reserved = container.querySelector<HTMLElement>('[style*="aspect-ratio"]');
    expect(reserved).not.toBeNull();
    expect(reserved!.style.aspectRatio.replace(/\s/g, "")).toBe("1600/600");
  });

  test("the banner replaces the brand band rather than stacking with it", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo: null, banner } })} />,
    );

    expect(container.querySelector('[aria-hidden="true"].bg-primary')).toBeNull();
  });
});

describe("logo and banner together", () => {
  test("renders both", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo, banner } })} />,
    );

    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(imageReferencing(container, logo.url)).not.toBeNull();
    expect(imageReferencing(container, banner.url)).not.toBeNull();
  });

  /** Both images must still be sized, not just present. */
  test("both carry their own dimensions", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo, banner } })} />,
    );

    expect(imageReferencing(container, banner.url)!.getAttribute("width")).toBe("1600");
    expect(imageReferencing(container, logo.url)!.getAttribute("width")).toBe("512");
  });

  test("the name remains the single h1 and is not displaced by the logo", () => {
    render(<RestaurantHeader restaurant={restaurant({ branding: { logo, banner } })} />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Pizza Palace" })).toBeDefined();
  });

  /** Existing header content must survive the branding addition. */
  test("description, location and status still render alongside branding", () => {
    render(
      <RestaurantHeader
        restaurant={restaurant({
          branding: { logo, banner },
          description: "Wood-fired since 1998.",
          city: "Mumbai",
          status: "open",
        })}
      />,
    );

    expect(screen.getByText("Wood-fired since 1998.")).toBeDefined();
    expect(screen.getByText("Mumbai")).toBeDefined();
    expect(screen.getByText("Open now")).toBeDefined();
  });
});

describe("no internal metadata reaches the page", () => {
  /**
   * The API never sends a storage key, but this pins the guarantee at the
   * rendering boundary too: if the contract ever regressed, a key would be one
   * careless prop away from the HTML.
   */
  test("the rendered header exposes no storage key or filename", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo, banner } })} />,
    );
    const html = container.innerHTML;

    expect(html).not.toContain("storageKey");
    expect(html).not.toContain("originalName");
    expect(html).not.toContain("sizeBytes");
    expect(html).not.toContain("mimeType");
  });

  test("no filesystem path appears in the markup", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo, banner } })} />,
    );
    const html = container.innerHTML;

    expect(html).not.toContain("storage/uploads");
    expect(html).not.toMatch(/[A-Za-z]:\\/);
  });

  test("no storage credential or driver name is rendered", () => {
    const { container } = render(
      <RestaurantHeader restaurant={restaurant({ branding: { logo, banner } })} />,
    );
    const html = container.innerHTML.toLowerCase();

    for (const secret of ["r2_", "secret", "access_key", "cloudflarestorage", "storage_driver"]) {
      expect(html).not.toContain(secret);
    }
  });
});

describe("structured data", () => {
  /** schema.org `image` is the representative picture of the place — a logo. */
  test("emits the logo URL as image when a logo exists", () => {
    const payload = buildRestaurantJsonLd(
      restaurant({ branding: { logo, banner } }),
    ) as Record<string, unknown>;

    expect(payload.image).toBe(logo.url);
  });

  /**
   * The banner is chosen for how it looks across a page, is cropped, and may
   * not even show the restaurant — so it is not representative and is not
   * emitted.
   */
  test("does not emit the banner", () => {
    const payload = buildRestaurantJsonLd(
      restaurant({ branding: { logo: null, banner } }),
    ) as Record<string, unknown>;

    expect(payload).not.toHaveProperty("image");
  });

  test("omits image entirely when no logo exists", () => {
    const payload = buildRestaurantJsonLd(restaurant()) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("image");
  });

  test("emits no media metadata beyond the URL", () => {
    const serialized = serializeJsonLd(
      buildRestaurantJsonLd(restaurant({ branding: { logo, banner } })),
    );

    expect(serialized).not.toContain("512");
    expect(serialized).not.toContain("width");
    expect(serialized).not.toContain("storageKey");
  });

  /**
   * The escaping guarantee must still hold now that a URL is interpolated:
   * a crafted value must not be able to close the script tag.
   */
  test("a hostile URL cannot break out of the script tag", () => {
    const hostile = buildRestaurantJsonLd(
      restaurant({
        branding: {
          logo: { url: '</script><script>alert(1)</script>', width: 1, height: 1 },
          banner: null,
        },
      }),
    );

    const serialized = serializeJsonLd(hostile);

    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c");
  });
});
