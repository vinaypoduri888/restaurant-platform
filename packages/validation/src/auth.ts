import { z } from "zod";

/**
 * Credential shapes for the Better Auth endpoints the admin console drives.
 *
 * These mirror rules the API already enforces — they do not invent any. The
 * 12-character minimum is Better Auth's configured `minPasswordLength` and is
 * documented in the OpenAPI schema for `/api/auth/sign-up/email`.
 *
 * They exist so the console can reject a bad password *before* spending a
 * round trip, and so its error messages match what the API would have said.
 * The API remains the authority: it re-validates everything.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .email("Enter a valid email address");

/**
 * Length is the only rule. Composition requirements (a symbol, a digit, mixed
 * case) push people towards predictable substitutions and password reuse; a
 * long passphrase is both stronger and easier to remember. This also has to
 * stay in step with the API, which enforces length alone.
 */
const password = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be 128 characters or fewer");

export const signInSchema = z.object({
  email,
  // Deliberately not length-checked on sign-in: an existing account may predate
  // any rule change, and telling a caller their *entered* password is too short
  // reveals nothing useful while getting in the way of a legitimate sign-in.
  password: z.string().min(1, "Password is required"),
});

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email,
  password,
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
