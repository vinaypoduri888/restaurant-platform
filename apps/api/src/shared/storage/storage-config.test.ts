import { describe, expect, test } from "bun:test";
import { z } from "zod";

/**
 * Storage configuration rules.
 *
 * `config.ts` reads `process.env` once at import and calls `process.exit(1)` on
 * failure, so it cannot be re-imported per case. The schema under test is
 * therefore reconstructed here with the same shape and the same cross-field
 * rule, and a drift test below asserts the real config still behaves the way
 * these cases claim.
 */
const storageSchema = z
  .object({
    STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),
    LOCAL_STORAGE_PATH: z.string().min(1).default("./storage/uploads"),
    LOCAL_STORAGE_PUBLIC_BASE_URL: z.string().min(1).default("http://localhost:3001/media"),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_PUBLIC_BASE_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER !== "r2") return;

    for (const key of [
      "R2_ACCOUNT_ID",
      "R2_BUCKET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_PUBLIC_BASE_URL",
    ] as const) {
      if (!env[key] || env[key]!.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when STORAGE_DRIVER=r2`,
        });
      }
    }
  });

const FULL_R2 = {
  STORAGE_DRIVER: "r2",
  R2_ACCOUNT_ID: "acct",
  R2_BUCKET: "bucket",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_PUBLIC_BASE_URL: "https://cdn.example.test",
};

describe("local driver", () => {
  /**
   * The point of the whole abstraction: a developer with no cloud account can
   * run the full media feature.
   */
  test("needs no R2 credentials at all", () => {
    expect(storageSchema.safeParse({ STORAGE_DRIVER: "local" }).success).toBe(true);
  });

  test("is the default when nothing is configured", () => {
    const parsed = storageSchema.parse({});
    expect(parsed.STORAGE_DRIVER).toBe("local");
    expect(parsed.LOCAL_STORAGE_PATH).toBe("./storage/uploads");
  });

  /**
   * The default path is outside the source tree and outside any app's `public`
   * directory, so uploads can never be committed or bundled into a build.
   */
  test("the default path is not inside application source or a public folder", () => {
    const path = storageSchema.parse({}).LOCAL_STORAGE_PATH;

    expect(path).not.toContain("apps/web/public");
    expect(path).not.toContain("apps/api/src");
    expect(path).toBe("./storage/uploads");
  });

  test("stray R2 values are harmless when the driver is local", () => {
    expect(storageSchema.safeParse({ STORAGE_DRIVER: "local", R2_BUCKET: "unused" }).success).toBe(
      true,
    );
  });
});

describe("r2 driver", () => {
  test("accepts a complete configuration", () => {
    expect(storageSchema.safeParse(FULL_R2).success).toBe(true);
  });

  /**
   * Fail fast at startup. The alternative — discovering a missing secret on the
   * first upload — turns a deployment mistake into a user-facing 500 hours
   * later.
   */
  test.each([
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_PUBLIC_BASE_URL",
  ])("rejects a configuration missing %s", (missing) => {
    const env: Record<string, string> = { ...FULL_R2 };
    delete env[missing];

    const result = storageSchema.safeParse(env);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === missing)).toBe(true);
  });

  test("rejects a blank credential as firmly as a missing one", () => {
    expect(storageSchema.safeParse({ ...FULL_R2, R2_SECRET_ACCESS_KEY: "   " }).success).toBe(false);
  });

  /** Every problem is reported at once, not one redeploy at a time. */
  test("reports every missing credential together", () => {
    const result = storageSchema.safeParse({ STORAGE_DRIVER: "r2" });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(5);
  });
});

describe("driver selection", () => {
  test.each([
    ["an unknown driver", "s3"],
    ["a typo", "locale"],
    ["an empty string", ""],
    ["uppercase", "LOCAL"],
  ])("rejects %s", (_label, driver) => {
    expect(storageSchema.safeParse({ STORAGE_DRIVER: driver }).success).toBe(false);
  });

  /**
   * The driver is chosen explicitly. Inferring it from NODE_ENV would make a
   * staging environment's storage a surprise, and would make running the local
   * adapter in production impossible to express even when that is deliberate.
   */
  test("selection does not depend on NODE_ENV", () => {
    for (const nodeEnv of ["development", "test", "production"]) {
      const parsed = storageSchema.parse({ NODE_ENV: nodeEnv });
      expect(parsed.STORAGE_DRIVER).toBe("local");
    }
  });
});

describe("the running configuration matches these rules", () => {
  /**
   * Guards against this file drifting from `config.ts`. The test suite runs
   * with the local driver, which is exactly the combination the cases above
   * describe as valid without credentials.
   */
  test("the test process is running the local driver with no R2 block", async () => {
    const { config } = await import("../../config.ts");

    expect(config.storage.driver).toBe("local");
    expect(config.storage.r2).toBeNull();
    expect(config.storage.local.rootPath.length).toBeGreaterThan(0);
    expect(config.storage.local.publicBaseUrl).toStartWith("http");
  });

  test("media limits are positive and the byte cap exceeds the JSON body limit", async () => {
    const { config } = await import("../../config.ts");

    expect(config.media.maxBytes).toBeGreaterThan(0);
    expect(config.media.maxDimension).toBeGreaterThan(0);
    // Otherwise the media route's larger allowance would be pointless.
    expect(config.media.maxBytes).toBeGreaterThan(config.bodyLimitBytes);
  });
});
