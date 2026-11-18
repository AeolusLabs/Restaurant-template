import { describeStatus, staffLabel, type Tone } from "@/domain/orders/presentation";
import type { OrderStatus } from "@/domain/orders/statuses";

const TONE: Record<Tone, string> = {
  info: "border-line-strong bg-surface text-ink",
  ok: "border-ok bg-ok-soft text-ink",
  warn: "border-warn bg-warn-soft text-ink",
  bad: "border-bad bg-bad-soft text-ink",
};
const MARK: Record<Tone, string> = { info: "•", ok: "✓", warn: "!", bad: "✕" };

/** The status as a word plus a symbol, so it never depends on colour alone. */
export function StatusBadge({ status }: { status: OrderStatus }) {
  const tone = describeStatus(status).tone;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-sm font-semibold ${TONE[tone]}`}>
      <span aria-hidden="true">{MARK[tone]}</span>
      {staffLabel(status)}
    </span>
  );
}
