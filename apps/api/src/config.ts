import { z } from "zod";

/**
 * The single place this application reads `process.env`.
 *
 * Everything else imports `config`. That keeps environment access typed,
 * validated once at startup, and greppable — rather than scattered string
 * lookups that fail at an arbitrary later moment with `undefined`.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must be a PostgreSQL connection string",
    ),

  /** Comma-separated list of browser origins allowed to call this API. */
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3002"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),

  /**
   * Secret used to sign session cookies. Must be a long random string and must
   * differ per environment. There is deliberately no default: a predictable
   * signing secret is a full authentication bypass.
   */
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),

  /** Public base URL of this API, used to build auth callback URLs. */
  BETTER_AUTH_URL: z.string().min(1).default("http://localhost:3001"),

  /**
   * Public base URL of the *customer* site — where `/r/{slug}` is served.
   *
   * Needed because the API generates QR codes, and a QR code has to carry an
   * absolute URL: it is scanned by a phone that has no other context. The API
   * cannot derive this from its own origin (it runs on a different host and
   * port) nor from the request (an attacker-supplied `Host` or `Origin` header
   * would then choose what a printed code points at).
   *
   * Deliberately its own setting rather than reusing `CORS_ORIGINS[0]`: that
   * list is an allow-list of callers, which is a different question from "which
   * of these is the canonical public site", and quietly depending on its order
   * would make a CORS change silently repoint every QR code.
   */
  PUBLIC_WEB_BASE_URL: z.string().min(1).default("http://localhost:3000"),

  /** Sign-in/sign-up attempts allowed per client per window. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  /**
   * Comma-separated IPs / IPv4 CIDRs of proxies permitted to set
   * `X-Forwarded-For`. Empty (the default) means no proxy is trusted and the
   * header is ignored entirely — correct for direct local development.
   */
  TRUSTED_PROXY_IPS: z.string().default(""),

  /** Maximum accepted request body size, in bytes. */
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_000_000),

  /**
   * Which storage adapter serves uploaded media.
   *
   * Chosen explicitly, never inferred from NODE_ENV: "production implies R2"
   * would make a staging environment's storage a surprise, and would make
   * running the local adapter in production impossible to express even when
   * that is what someone deliberately wants.
   */
  STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),

  /** Where the `local` adapter writes. Outside the source tree, git-ignored. */
  LOCAL_STORAGE_PATH: z.string().min(1).default("./storage/uploads"),

  /**
   * Base URL the `local` adapter builds public media URLs from.
   *
   * Defaults to this API, because with the local adapter the API is what serves
   * the bytes. A frontend therefore receives a real URL and never learns a
   * filesystem is involved.
   */
  LOCAL_STORAGE_PUBLIC_BASE_URL: z.string().min(1).default("http://localhost:3001/media"),

  /**
   * R2 configuration. Optional here and required by the cross-field check
   * below only when `STORAGE_DRIVER=r2`, so local development needs no
   * credentials at all.
   */
  R2_ACCOUNT_ID: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  /** Public CDN/bucket domain objects are readable from. */
  R2_PUBLIC_BASE_URL: z.string().optional(),

  /**
   * Maximum accepted upload size, in bytes.
   *
   * Separate from `BODY_LIMIT_BYTES` on purpose: a 1 MB cap is right for JSON
   * and far too small for a banner image, but raising the global limit would
   * weaken every other endpoint. See `bodyLimitMiddleware`.
   */
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(5_000_000),

  /** Refuse absurd dimensions; a logo has no legitimate need to be huge. */
  MEDIA_MAX_DIMENSION: z.coerce.number().int().positive().default(4096),
})
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER !== "r2") return;

    /*
     * Fail fast, at startup, listing every missing key at once.
     *
     * The alternative — discovering a missing secret on the first upload — is
     * strictly worse: it turns a deployment mistake into a runtime 500 for a
     * user, hours after the deploy that caused it.
     */
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

type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Fail fast and loudly: a misconfigured process should never start and
    // then fall over later on the first request that happens to need the
    // missing value.
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    console.error(`Invalid environment configuration:\n${details}`);
    process.exit(1);
  }

  return parsed.data;
}

const env = loadEnv();

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",

  port: env.API_PORT,

  databaseUrl: env.DATABASE_URL,

  corsOrigins: env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),

  // Quieter by default in production, chattier while developing.
  logLevel: env.LOG_LEVEL ?? (env.NODE_ENV === "production" ? "info" : "debug"),

  bodyLimitBytes: env.BODY_LIMIT_BYTES,

  media: {
    maxBytes: env.MEDIA_MAX_BYTES,
    maxDimension: env.MEDIA_MAX_DIMENSION,
  },

  /** Where the customer-facing site lives, with any trailing slash removed. */
  publicWebBaseUrl: env.PUBLIC_WEB_BASE_URL.replace(/\/+$/, ""),

  storage: {
    driver: env.STORAGE_DRIVER,
    local: {
      rootPath: env.LOCAL_STORAGE_PATH,
      publicBaseUrl: env.LOCAL_STORAGE_PUBLIC_BASE_URL,
    },
    /*
     * Present only when the driver is `r2`, where the check above has already
     * proved every field is set — so the factory can read them without
     * re-validating, and nothing else can accidentally depend on half-filled
     * credentials.
     */
    r2:
      env.STORAGE_DRIVER === "r2"
        ? {
            accountId: env.R2_ACCOUNT_ID!,
            bucket: env.R2_BUCKET!,
            accessKeyId: env.R2_ACCESS_KEY_ID!,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
            publicBaseUrl: env.R2_PUBLIC_BASE_URL!,
          }
        : null,
  },

  trustedProxies: env.TRUSTED_PROXY_IPS.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0),

  auth: {
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.BETTER_AUTH_URL,
    rateLimit: {
      max: env.AUTH_RATE_LIMIT_MAX,
      windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    },
  },
} as const;

export type Config = typeof config;
