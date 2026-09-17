import type { InputHTMLAttributes, ReactNode } from "react";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { FieldError } from "./form-feedback";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  name: string;
  label: string;
  /** Server-side error for this field, from the action's `FormState`. */
  error?: string;
  /** Static guidance shown under the input, e.g. a format hint. */
  hint?: ReactNode;
}

/**
 * A labelled text input with hint and error wiring.
 *
 * Exists so that no form has to remember to connect `htmlFor`, `id`,
 * `aria-describedby`, and `aria-invalid` by hand — those are exactly the four
 * things that get forgotten, and each omission breaks the field for screen
 * reader users while looking perfectly fine on screen.
 *
 * A Server Component: it renders markup and ships no JavaScript. Interactivity
 * comes from the browser's own form handling and from the `SubmitButton`
 * island.
 */
export function TextField({ name, label, error, hint, required, ...props }: TextFieldProps) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name} required={required}>
        {label}
      </Label>

      <Input
        id={name}
        name={name}
        required={required}
        invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        {...props}
      />

      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}

      <FieldError id={errorId} message={error} />
    </div>
  );
}

interface TextAreaFieldProps {
  name: string;
  label: string;
  defaultValue?: string;
  error?: string;
  hint?: ReactNode;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
}

/** The multi-line counterpart, with the same labelling guarantees. */
export function TextAreaField({
  name,
  label,
  defaultValue,
  error,
  hint,
  maxLength,
  rows = 3,
  placeholder,
}: TextAreaFieldProps) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>

      <textarea
        id={name}
        name={name}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={[
          "w-full rounded-md border border-input bg-background px-3 py-2",
          // 16px minimum: iOS Safari zooms the viewport on focus below that,
          // which reads as the page jumping.
          "text-base text-foreground placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "aria-invalid:border-destructive aria-invalid:ring-destructive",
        ].join(" ")}
      />

      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}

      <FieldError id={errorId} message={error} />
    </div>
  );
}

interface CheckboxFieldProps {
  name: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
}

/**
 * A checkbox with its label and explanation.
 *
 * The whole row is the label, so the touch target is the full width rather
 * than a 16px box — which is unusable on a phone and fails the 44px minimum.
 */
export function CheckboxField({ name, label, description, defaultChecked }: CheckboxFieldProps) {
  const descriptionId = `${name}-description`;

  return (
    <label
      htmlFor={name}
      className="flex min-h-11 cursor-pointer items-start gap-3 py-1"
    >
      <input
        type="checkbox"
        id={name}
        name={name}
        defaultChecked={defaultChecked}
        aria-describedby={description ? descriptionId : undefined}
        className="mt-1 size-4 shrink-0 rounded border-input accent-[var(--primary)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description ? (
          <span id={descriptionId} className="text-sm text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
