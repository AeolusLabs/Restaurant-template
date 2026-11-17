import type { Metadata } from "next";
import { StaffBar, StaffMain } from "@/components/staff/staff-bar";

export const metadata: Metadata = { title: { default: "Kitchen", template: "%s | Kitchen" }, robots: { index: false } };

export default function KitchenLayout({ children }: LayoutProps<"/kitchen">) {
  return (
    <>
      <StaffBar area="Kitchen" withNav={false} />
      <StaffMain wide>{children}</StaffMain>
    </>
  );
}
