"use client";

import { useEffect, useRef, useState } from "react";
import { quoteCartAction, type Quote } from "@/app/cart/actions";
import type { StoredLine } from "./store";

/** Asks the server to price the cart whenever it changes. Only the latest answer is kept. */
export function useQuote(lines: StoredLine[]): { quote: Quote | null; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ quote: Quote | null; loading: boolean; failed: boolean }>({ quote: null, loading: true, failed: false });
  const latest = useRef(0);
  const signature = JSON.stringify(lines);

  useEffect(() => {
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
  }, [signature]);

  return state;
}
