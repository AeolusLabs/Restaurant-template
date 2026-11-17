import type { Metadata } from "next";
import { StaffBar, StaffMain } from "@/components/staff/staff-bar";

export const metadata: Metadata = { title: { default: "Admin", template: "%s | Admin" }, robots: { index: false } };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <>
      <StaffBar area="Admin" withNav />
      <StaffMain>{children}</StaffMain>
    </>
  );
}
