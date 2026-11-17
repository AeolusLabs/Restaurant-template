// Class recipes shared by the customer screens. Plain strings, so they work on <button>, <a> and <Link>.

const base =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-base font-semibold " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const button = {
  primary: `${base} bg-brand text-on-brand hover:brightness-110 active:brightness-95`,
  secondary: `${base} border border-line-strong bg-surface text-ink hover:bg-brand-soft`,
  quiet: `${base} text-brand underline-offset-4 hover:underline`,
  danger: `${base} border border-bad text-bad hover:bg-bad-soft`,
} as const;

export const field =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-ink placeholder:text-muted";

export const label = "mb-1 block text-sm font-semibold text-ink";

export const card = "rounded-xl border border-line bg-surface";
