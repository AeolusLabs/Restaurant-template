"use client";

import { useEffect, useRef, useState } from "react";
import { quoteCartAction, type Quote } from "@/app/(customer)/cart/actions";
import type { StoredLine } from "./store";

type State = { quote: Quote | null; loading: boolean; failed: boolean };
const IDLE: State = { quote: null, loading: false, failed: false };

/** Asks the server to price the cart whenever it changes. Only the latest answer is kept. An empty cart is not sent. */
export function useQuote(lines: StoredLine[]): State {
  const [state, setState] = useState<State>({ quote: null, loading: true, failed: false });
  const latest = useRef(0);
  const signature = JSON.stringify(lines);
  const empty = lines.length === 0;

  useEffect(() => {
    if (empty) return;
    const id = ++latest.current;
    let cancelled = false;
    quoteCartAction(JSON.parse(signature))
      .then((quote) => {
        if (!cancelled && id === latest.current) setState({ quote, loading: false, failed: false });
      })
      .catch(() => {
        if (!cancelled && id === latest.current) setState({ quote: null, loading: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [signature, empty]);

  return empty ? IDLE : state;
}
