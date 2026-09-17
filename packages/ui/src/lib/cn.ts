import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names, resolving Tailwind conflicts in favour of the last value.
 *
 * `clsx` flattens conditionals and arrays; `tailwind-merge` then removes
 * earlier utilities that the later ones would fight with. Without the second
 * step, `<Button className="px-8">` would emit both `px-4` and `px-8` and the
 * winner would depend on stylesheet order rather than on the caller's intent —
 * which quietly makes every component's `className` prop unreliable.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
