import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Forgot your password" };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-bold leading-tight">Forgot your password?</h1>
        <p className="mt-1 text-muted">Enter the email you signed up with and we will send you a link to choose a new one.</p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
