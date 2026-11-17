"use client";

import { createContext, useContext, type ReactNode } from "react";
import { formatMoney, type MoneyFormat } from "@/lib/money";

const MoneyContext = createContext<MoneyFormat | null>(null);

/** Gives client components the restaurant's currency format without importing the whole config. */
export function MoneyProvider({ format, children }: { format: MoneyFormat; children: ReactNode }) {
  return <MoneyContext value={format}>{children}</MoneyContext>;
}

export function useMoney(): (amountMinor: number) => string {
  const format = useContext(MoneyContext);
  if (!format) throw new Error("useMoney must be used inside MoneyProvider");
  return (amountMinor) => formatMoney(amountMinor, format);
}
