// Axis helpers for the dashboard charts. Pure.

/** Rounds up to 1, 2 or 5 times a power of ten, so an axis ends on a clean number. */
export function niceCeil(max: number): number {
  if (max <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) if (max <= step * power) return step * power;
  return 10 * power;
}

/** Zero, the middle and the top of an axis that ends at `top`. */
export const ticks = (top: number): number[] => [0, top / 2, top];

/**
 * Which of `count` labels to show so no more than `max` are drawn, evenly spaced, ending on the last one
 * (the most recent day is the one people look for). Everything is kept when it fits.
 */
export function thinLabels(count: number, max: number): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const gap = Math.ceil((count - 1) / (max - 1));
  const kept: number[] = [];
  for (let i = count - 1; i >= 0; i -= gap) kept.unshift(i);
  return kept;
}
