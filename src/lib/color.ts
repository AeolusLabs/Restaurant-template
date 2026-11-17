// Just enough colour maths to check that a brand colour written in config can carry white text.
// Only oklch() is accepted, so there is one syntax to document and one conversion to get right.

export type Oklch = { l: number; c: number; h: number };

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
const OKLCH = new RegExp(String.raw`^oklch\(\s*(${NUMBER})(%?)\s+(${NUMBER})\s+(${NUMBER})(?:deg)?\s*(?:/\s*${NUMBER}%?\s*)?\)$`, "i");

/** Reads `oklch(55% 0.15 40)` or `oklch(0.55 0.15 40)`. Returns null for anything else. */
export function parseOklch(input: string): Oklch | null {
  const m = OKLCH.exec(input.trim());
  if (!m) return null;
  const l = m[2] === "%" ? Number(m[1]) / 100 : Number(m[1]);
  const c = Number(m[3]);
  const h = Number(m[4]);
  if (![l, c, h].every(Number.isFinite) || l < 0 || l > 1 || c < 0) return null;
  return { l, c, h };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** WCAG relative luminance of an oklch colour, clipped to the sRGB gamut. */
function luminance({ l, c, h }: Oklch): number {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = clamp01(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
  const g = clamp01(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
  const bl = clamp01(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

/** WCAG contrast ratio between the colour and white (1 to 21). Text needs 4.5 at normal size. */
export function contrastWithWhite(color: Oklch): number {
  return 1.05 / (luminance(color) + 0.05);
}
