"use client";

import { useEffect, useRef, useState } from "react";
import { quoteCartAction, type Quote } from "@/app/(customer)/cart/actions";
import type { StoredLine } from "./store";

type State = { quote: Quote | null; loading: boolean; failed: boolean };
const IDLE: State = { quote: null, loading: false, failed: false };

/** Asks the server to price the cart whenever it (or the delivery zone) changes. Only the latest answer is kept. An empty cart is not sent. */
export function useQuote(lines: StoredLine[], opts: { zone?: string; fulfilment?: "pickup" | "delivery"; promoCode?: string } = {}): State {
  const { zone, fulfilment, promoCode } = opts;
  const [state, setState] = useState<State>({ quote: null, loading: true, failed: false });
  const latest = useRef(0);
  const signature = JSON.stringify(lines);
  const empty = lines.length === 0;

  useEffect(() => {
    if (empty) return;
    const id = ++latest.current;
    let cancelled = false;
    quoteCartAction(JSON.parse(signature), { zone, fulfilment, promoCode })
      .then((quote) => {
        if (!cancelled && id === latest.current) setState({ quote, loading: false, failed: false });
      })
      .catch(() => {
        if (!cancelled && id === latest.current) setState({ quote: null, loading: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [signature, empty, zone, fulfilment, promoCode]);

  return empty ? IDLE : state;
}
