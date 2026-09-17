import { formatMoney, formatMoneyLabel } from "@repo/ui/lib/money";
import type { PublicMenuItem } from "@/lib/api/menu";

/**
 * One dish or drink.
 *
 * The layout is a scanning aid rather than decoration: name and price on one
 * line so the eye can run down a price column, description beneath in a quieter
 * tone so it never competes with the name. That is how a printed menu works,
 * and it is what someone glances at for three seconds at a table wants.
 */
export function MenuItemRow({ item }: { item: PublicMenuItem }) {
  const price = formatMoney(item.price);
  const spokenPrice = formatMoneyLabel(item.price);

  return (
    <li
      className={
        // Unavailability is conveyed by the badge below; the dimming is a
        // secondary cue only, and is kept mild enough to stay readable.
        item.isAvailable ? "py-4" : "py-4 opacity-70"
      }
    >
      <div className="flex items-baseline justify-between gap-4">
        <h4 className="text-pretty text-base font-medium leading-snug text-foreground">
          {item.name}
        </h4>

        {/*
          The visible text keeps the currency symbol, which is compact and
          familiar. The label spells it out ("12.50 US dollars") because screen
          readers do not announce every symbol reliably — and a price a
          customer cannot hear correctly is a real problem, not a cosmetic one.
        */}
        <p
          aria-label={spokenPrice}
          className="shrink-0 text-base font-semibold tabular-nums text-foreground"
        >
          <span aria-hidden="true">{price}</span>
        </p>
      </div>

      {item.description ? (
        <p className="mt-1 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
          {item.description}
        </p>
      ) : null}

      {!item.isAvailable ? (
        /*
          Text, not colour and not an icon. WCAG 1.4.1: a state signalled only
          by a colour or a glyph is invisible to a colour-blind customer and to
          a screen reader. "Unavailable today" is unambiguous to everyone.
        */
        <p className="mt-2">
          <span className="inline-flex items-center rounded-full border border-input px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            Unavailable today
          </span>
        </p>
      ) : null}
    </li>
  );
}
