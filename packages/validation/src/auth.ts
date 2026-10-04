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

/** Just an address — used by the forgot-password and resend-verification forms. */
export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "Email is required").email("Enter a valid email address"),
});

/**
 * A new password, entered twice.
 *
 * The confirmation is checked here rather than only in the browser so the rule
 * holds without JavaScript. The minimum matches what Better Auth is configured
 * to enforce — a form that accepts eleven characters and then fails at the API
 * wastes the attempt and tells the user nothing useful.
 */
export const resetPasswordSchema = z
  .object({
    password: z.string().min(12, "Use at least 12 characters").max(128),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Both passwords must match",
    // Attached to the second field, which is the one to correct.
    path: ["confirmPassword"],
  });

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
