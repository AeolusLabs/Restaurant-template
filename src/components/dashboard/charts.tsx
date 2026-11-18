import type { ReactNode } from "react";
import { heatStep, type HeatCell } from "@/domain/dashboard/rules";
import { niceCeil, thinLabels, ticks } from "@/domain/dashboard/scale";

// Server-rendered SVG and HTML charts for the dashboard. Thin marks, solid hairline grid, a 2px surface gap
// between touching marks, text in text colours (never the series colour), a legend wherever there are two
// series, the browser's own tooltip on hover (SVG titles), and a table view for every chart.

const W = 360; // drawn width: text is 11 to 12 units, so it stays about that size on a phone

/** A chart's data as a table, for anyone who would rather read numbers, and for screen readers. */
export function TableView({ caption, columns, rows }: { caption: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand underline underline-offset-4">Show as a table</summary>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line-strong">
              {columns.map((c, i) => (
                <th key={c} scope="col" className={`py-1 pr-3 font-semibold ${i > 0 ? "text-right" : ""}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-b border-line">
                {r.map((cell, ci) => (
                  <td key={ci} className={`py-1 pr-3 ${ci > 0 ? "text-right tabular-nums" : ""}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export type Column = { key: string; label: string; value: number; tooltip: string };

/** One series over time as columns. The axis starts at zero; the highest column carries its figure. */
export function ColumnChart({ data, format, ariaLabel }: { data: Column[]; format: (v: number) => string; ariaLabel: string }) {
  const H = 190;
  const left = 46;
  const right = 6;
  const top = 22;
  const bottom = 24;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const max = Math.max(0, ...data.map((d) => d.value));
  const axisTop = niceCeil(max) || 1;
  const slot = plotW / Math.max(1, data.length);
  const bw = Math.min(24, Math.max(2, slot * 0.7));
  const y = (v: number) => top + plotH - (v / axisTop) * plotH;
  const peak = max > 0 ? data.findIndex((d) => d.value === max) : -1;
  const shown = new Set(thinLabels(data.length, data.length <= 7 ? 7 : 6)); // a week shows every day

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="block h-auto w-full" style={{ color: "var(--viz-label)" }}>
      {ticks(axisTop).map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth="1" />
          <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--viz-muted)">
            {format(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = left + slot * i + (slot - bw) / 2;
        const h = (d.value / axisTop) * plotH;
        const r = Math.min(4, bw / 2, h);
        return (
          <g key={d.key}>
            {h > 0 && <path d={`M${x},${y(0)} V${y(d.value) + r} Q${x},${y(d.value)} ${x + r},${y(d.value)} H${x + bw - r} Q${x + bw},${y(d.value)} ${x + bw},${y(d.value) + r} V${y(0)} Z`} fill="var(--viz-1)" />}
            <rect x={left + slot * i} y={top} width={slot} height={plotH} fill="transparent">
              <title>{d.tooltip}</title>
            </rect>
            {shown.has(i) && (
              <text x={left + slot * i + slot / 2} y={H - 6} textAnchor={i === data.length - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize="12" fill="var(--viz-muted)">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
      {peak >= 0 && (
        <text x={Math.min(W - right, Math.max(left + 20, left + slot * peak + slot / 2))} y={y(max) - 5} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--viz-label)">
          {format(max)}
        </text>
      )}
    </svg>
  );
}

const HEAT = ["var(--viz-h0)", "var(--viz-h1)", "var(--viz-h2)", "var(--viz-h3)", "var(--viz-h4)"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Orders by weekday and hour: one blue ramp, darker where busier. Only the hours that have orders (with a margin) are drawn. */
export function Heatmap({ cells, hourLabel, ariaLabel }: { cells: HeatCell[]; hourLabel: (hour: number) => string; ariaLabel: string }) {
  const used = cells.filter((c) => c.orders > 0);
  const lo = Math.max(0, Math.min(...used.map((c) => c.hour)) - 1);
  const hi = Math.min(23, Math.max(...used.map((c) => c.hour)) + 1);
  const hours = Array.from({ length: Math.max(hi - lo + 1, 6) }, (_, i) => lo + i).filter((h) => h <= 23);
  const max = Math.max(0, ...used.map((c) => c.orders));
  const left = 34;
  const top = 6;
  const cell = Math.min(26, (W - left - 4) / hours.length);
  const gap = 2;
  const H = top + 7 * cell + 22;
  const count = new Map(used.map((c) => [`${c.weekday}-${c.hour}`, c.orders]));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="block h-auto w-full">
      {DAYS.map((d, i) => (
        <text key={d} x={left - 6} y={top + i * cell + cell / 2 + 4} textAnchor="end" fontSize="12" fill="var(--viz-muted)">
          {d}
        </text>
      ))}
      {DAYS.flatMap((d, di) =>
        hours.map((h, hi2) => {
          const n = count.get(`${di + 1}-${h}`) ?? 0;
          return (
            <rect key={`${d}-${h}`} x={left + hi2 * cell} y={top + di * cell} width={cell - gap} height={cell - gap} rx="3" fill={HEAT[heatStep(n, max)]}>
              <title>{`${d} ${hourLabel(h)}: ${n} ${n === 1 ? "order" : "orders"}`}</title>
            </rect>
          );
        }),
      )}
      {hours.map((h, i) => (i % 2 === 0 || hours.length <= 8) && (
        <text key={h} x={left + i * cell + (cell - gap) / 2} y={top + 7 * cell + 14} textAnchor="middle" fontSize="12" fill="var(--viz-muted)">
          {h}
        </text>
      ))}
    </svg>
  );
}

/** The key for the heatmap: fewer to more. */
export function HeatLegend() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted" aria-hidden="true">
      Fewer orders
      <span className="flex gap-0.5">
        {HEAT.map((c) => (
          <span key={c} className="h-3 w-5 rounded-sm" style={{ background: c }} />
        ))}
      </span>
      More
    </div>
  );
}

export type Bar = { key: string; label: string; value: number; figure: string; color?: "1" | "2" };

/** Horizontal bars on one shared scale, one hue unless a row says otherwise. The figure sits at the end of its row. */
export function RankedBars({ rows, ariaLabel }: { rows: Bar[]; ariaLabel: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <ul className="viz space-y-3" aria-label={ariaLabel}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1">
          <span className="min-w-0 break-words">{r.label}</span>
          <span className="font-semibold tabular-nums">{r.figure}</span>
          <span className="col-span-2 block h-2 rounded-full" style={{ background: "var(--viz-grid)" }}>
            <span className="block h-2 rounded-full" style={{ width: max > 0 ? `${Math.max(r.value > 0 ? 1 : 0, (r.value / max) * 100)}%` : "0%", background: r.color === "2" ? "var(--viz-2)" : "var(--viz-1)" }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export type Part = { key: string; label: string; value: number; color: "1" | "2" };

/** One whole split into parts, with the share printed on each block that is wide enough, and a legend naming them. */
export function SegmentedBar({ parts, ariaLabel }: { parts: Part[]; ariaLabel: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="viz space-y-2">
      <div className="flex h-7 gap-0.5" role="img" aria-label={ariaLabel}>
        {parts.map((p) => {
          const share = total > 0 ? (p.value / total) * 100 : 0;
          if (p.value <= 0) return null;
          return (
            <div key={p.key} className="flex items-center rounded px-2 text-sm font-semibold text-white" style={{ flex: `${p.value} 1 0`, background: p.color === "2" ? "var(--viz-2)" : "var(--viz-1)" }} title={`${p.label}: ${p.value} (${Math.round(share)}%)`}>
              {share >= 15 ? `${Math.round(share)}%` : ""}
            </div>
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-3 rounded-sm" style={{ background: p.color === "2" ? "var(--viz-2)" : "var(--viz-1)" }} />
            {p.label}: <span className="font-semibold tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
