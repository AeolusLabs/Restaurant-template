"use client";

import { button } from "@/components/ui";

/** Opens the browser's print dialog. The page hides everything but the code and its name when printed. */
export function PrintButton() {
  return (
    <button type="button" className={button.primary} onClick={() => window.print()}>
      Print
    </button>
  );
}
