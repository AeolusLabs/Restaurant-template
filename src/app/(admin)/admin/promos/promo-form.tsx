import { restaurantConfig } from "../../../../../config/restaurant";
import { button, card, field, label } from "@/components/ui";
import type { PromoFormValues } from "@/domain/promos/form";

const hint = "mt-1 text-sm text-muted";

/** The promo form, used to create and to edit. A plain server form: every box is always shown, with a note on when it applies. */
export function PromoForm({
  action,
  values,
  id,
  submit,
}: {
  action: (form: FormData) => Promise<void>;
  values: PromoFormValues;
  id?: string;
  submit: string;
}) {
  const cur = restaurantConfig.currency.code;
  return (
    <form action={action} className={`${card} max-w-xl space-y-5 p-5`}>
      {id && <input type="hidden" name="id" value={id} />}

      <div>
        <label htmlFor="code" className={label}>
          Code
        </label>
        <input id="code" name="code" defaultValue={values.code} required maxLength={20} autoCapitalize="characters" autoComplete="off" spellCheck={false} className={`${field} uppercase`} aria-describedby="code-help" />
        <p id="code-help" className={hint}>
          What customers type. 3 to 20 letters, digits, hyphens or underscores. Capital letters do not matter.
        </p>
      </div>

      <div>
        <label htmlFor="description" className={label}>
          Note for yourself <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id="description" name="description" defaultValue={values.description} maxLength={200} className={field} />
        <p className={hint}>Customers do not see this.</p>
      </div>

      <div>
        <label htmlFor="kind" className={label}>
          What it does
        </label>
        <select id="kind" name="kind" defaultValue={values.kind} className={field}>
          <option value="percent">Percentage off the items</option>
          <option value="fixed">Fixed amount off the items</option>
          <option value="free_delivery">Free delivery</option>
        </select>
        <p className={hint}>The discount comes off the items before the service charge and tax. Free delivery is for delivery orders only. One code per order; codes never combine.</p>
      </div>

      <fieldset className="space-y-4 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold">How much</legend>
        <div>
          <label htmlFor="percent" className={label}>
            Percentage <span className="font-normal text-muted">(for percentage off)</span>
          </label>
          <input id="percent" name="percent" defaultValue={values.percent} inputMode="decimal" className={field} aria-describedby="percent-help" />
          <p id="percent-help" className={hint}>
            For example 10 or 12.5.
          </p>
        </div>
        <div>
          <label htmlFor="maxDiscount" className={label}>
            Cap, in {cur} <span className="font-normal text-muted">(optional, for percentage off)</span>
          </label>
          <input id="maxDiscount" name="maxDiscount" defaultValue={values.maxDiscount} inputMode="decimal" className={field} aria-describedby="cap-help" />
          <p id="cap-help" className={hint}>
            The most one order can save, so 20% off cannot become a very large discount. Empty means no cap.
          </p>
        </div>
        <div>
          <label htmlFor="amount" className={label}>
            Amount, in {cur} <span className="font-normal text-muted">(for fixed amount off)</span>
          </label>
          <input id="amount" name="amount" defaultValue={values.amount} inputMode="decimal" className={field} aria-describedby="amount-help" />
          <p id="amount-help" className={hint}>
            For example 500 or 1,250.50. An order is never discounted below nothing.
          </p>
        </div>
      </fieldset>

      <div>
        <label htmlFor="minOrder" className={label}>
          Minimum order, in {cur} <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id="minOrder" name="minOrder" defaultValue={values.minOrder} inputMode="decimal" className={field} aria-describedby="min-help" />
        <p id="min-help" className={hint}>
          Measured on the items, before the discount. Empty means any order.
        </p>
      </div>

      <fieldset className="space-y-4 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold">When</legend>
        <div>
          <label htmlFor="startsAt" className={label}>
            Starts <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="startsAt" name="startsAt" type="datetime-local" defaultValue={values.startsAt} className={field} />
        </div>
        <div>
          <label htmlFor="expiresAt" className={label}>
            Ends <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="expiresAt" name="expiresAt" type="datetime-local" defaultValue={values.expiresAt} className={field} aria-describedby="when-help" />
          <p id="when-help" className={hint}>
            Times are the restaurant&apos;s own ({restaurantConfig.timezone}).
          </p>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold">How often</legend>
        <div>
          <label htmlFor="maxPerCustomer" className={label}>
            Uses per customer
          </label>
          <input id="maxPerCustomer" name="maxPerCustomer" defaultValue={values.maxPerCustomer} inputMode="numeric" className={field} aria-describedby="per-help" />
          <p id="per-help" className={hint}>
            1 means each customer can use it once. Empty means as often as they like.
          </p>
        </div>
        <div>
          <label htmlFor="maxRedemptions" className={label}>
            Total uses <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="maxRedemptions" name="maxRedemptions" defaultValue={values.maxRedemptions} inputMode="numeric" className={field} aria-describedby="total-help" />
          <p id="total-help" className={hint}>
            After this many orders the code stops working. An order that is cancelled before it is paid gives its use back.
          </p>
        </div>
      </fieldset>

      <label className="flex min-h-11 items-center gap-3 font-semibold">
        <input type="checkbox" name="active" defaultChecked={values.active === "on"} className="h-5 w-5" />
        Switched on
      </label>

      <button type="submit" className={button.primary}>
        {submit}
      </button>
    </form>
  );
}
