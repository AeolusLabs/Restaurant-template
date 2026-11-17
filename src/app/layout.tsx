import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { restaurantConfig } from "../../config/restaurant";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { MoneyProvider } from "@/components/money-context";
import { moneyFormat } from "@/lib/format";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: restaurantConfig.name, template: `%s | ${restaurantConfig.name}` },
  description: `Order from ${restaurantConfig.name} for pickup.`,
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: restaurantConfig.colors.primary };

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Branding arrives here from config, as CSS variables. No component hard-codes a colour.
  const brand = { "--brand": restaurantConfig.colors.primary, "--accent": restaurantConfig.colors.accent } as CSSProperties;
  return (
    <html lang={restaurantConfig.locale} style={brand}>
      <body className="flex min-h-dvh flex-col">
        <MoneyProvider format={moneyFormat}>
          <a
            href="#main"
            className="absolute left-2 top-2 z-50 -translate-y-20 rounded-lg bg-brand px-4 py-2 font-semibold text-on-brand focus:translate-y-0"
          >
            Skip to content
          </a>
          <Header />
          <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-6 sm:pb-12">
            {children}
          </main>
          <Footer />
        </MoneyProvider>
      </body>
    </html>
  );
}
