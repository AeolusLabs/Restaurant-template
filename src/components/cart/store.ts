"use client";

import { useCallback, useSyncExternalStore } from "react";
import { lineKey } from "@/domain/checkout/line-key";
import { MAX_LINE_QUANTITY } from "@/domain/pricing/price-cart";

// The cart lives in the browser (localStorage) as item ids, modifier ids and quantities, nothing else.
// The server prices it. Several tabs stay in step through the storage event.

export type StoredLine = { itemId: string; modifierIds: string[]; quantity: number };

const KEY = "cart:v1";
const MAX_LINES = 50;
const EMPTY: StoredLine[] = [];

let cachedRaw: string | null = null;
let cachedLines: StoredLine[] = EMPTY;
const listeners = new Set<() => void>();

function parse(raw: string | null): StoredLine[] {
  if (!raw) return EMPTY;
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return EMPTY;
    return data
      .filter(
        (l): l is StoredLine =>
          typeof l?.itemId === "string" &&
          Array.isArray(l.modifierIds) &&
          l.modifierIds.every((m: unknown) => typeof m === "string") &&
          Number.isInteger(l.quantity) &&
          l.quantity >= 1,
      )
      .slice(0, MAX_LINES);
  } catch {
    return EMPTY;
  }
}

function snapshot(): StoredLine[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Storage can be blocked (private modes). The cart then lasts until the page is closed.
    raw = cachedRaw;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedLines = parse(raw);
  }
  return cachedLines;
}

function write(lines: StoredLine[]): void {
  const raw = lines.length === 0 ? null : JSON.stringify(lines);
  cachedRaw = raw;
  cachedLines = lines.length === 0 ? EMPTY : lines;
  try {
    if (raw === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, raw);
  } catch {
    // Kept in memory only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCart() {
  const lines = useSyncExternalStore(subscribe, snapshot, () => EMPTY);

  const add = useCallback((line: StoredLine) => {
    const key = lineKey(line);
    const current = snapshot();
    const found = current.find((l) => lineKey(l) === key);
    if (found) {
      write(current.map((l) => (l === found ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, l.quantity + line.quantity) } : l)));
    } else if (current.length < MAX_LINES) {
      write([...current, { ...line, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity) }]);
    }
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    const current = snapshot();
    write(
      quantity < 1
        ? current.filter((l) => lineKey(l) !== key)
        : current.map((l) => (lineKey(l) === key ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, quantity) } : l)),
    );
  }, []);

  const remove = useCallback((key: string) => write(snapshot().filter((l) => lineKey(l) !== key)), []);
  const clear = useCallback(() => write([]), []);

  return { lines, count: lines.reduce((n, l) => n + l.quantity, 0), add, setQuantity, remove, clear };
}
