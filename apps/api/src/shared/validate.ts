import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

export type ValidationTarget = "json" | "param" | "query";

/**
 * Wraps `zValidator` so every module reports validation failures identically:
 * status 400, the standard error envelope, the request id for correlation,
 * and Zod's field-level issues so a client can highlight the offending input.
 */
export function validate(target: ValidationTarget, schema: ZodType) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false as const,
          error: {
            message: "Validation failed",
            requestId: c.get("requestId"),
            issues: result.error.issues,
          },
        },
        400,
      );
    }
  });
}
