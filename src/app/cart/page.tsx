import type { Metadata } from "next";
import { CartView } from "@/components/cart/cart-view";

export const metadata: Metadata = { title: "Your cart" };

export default function CartPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Your cart</h1>
      <CartView />
    </div>
  );
}
