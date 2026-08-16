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
