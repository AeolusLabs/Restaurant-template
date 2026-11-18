import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { restaurantConfig } from "../../config/restaurant";
import { DemoBanner } from "@/components/demo-banner";
import { MoneyProvider } from "@/components/money-context";
import { moneyFormat } from "@/lib/format";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: restaurantConfig.name, template: `%s | ${restaurantConfig.name}` },
  description: `Order from ${restaurantConfig.name} for pickup.`,
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: restaurantConfig.colors.primary };

/**
 * The frame shared by every area: tokens, branding from config, the skip link and the money format.
 * Each area (customer, admin, kitchen) adds its own header and <main id="main"> in its own layout.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  // Branding arrives here from config, as CSS variables. No component hard-codes a colour.
  const brand = { "--brand": restaurantConfig.colors.primary, "--accent": restaurantConfig.colors.accent } as CSSProperties;
  return (
    <html lang={restaurantConfig.locale} style={brand}>
      <body className="flex min-h-dvh flex-col">
        <MoneyProvider format={moneyFormat}>
          <a
            href="#main"
            className="absolute left-2 top-2 z-50 inline-flex min-h-11 -translate-y-20 items-center rounded-lg bg-brand px-4 py-2 font-semibold text-on-brand focus:translate-y-0"
          >
            Skip to content
          </a>
          <DemoBanner />
          {children}
        </MoneyProvider>
      </body>
    </html>
  );
}
