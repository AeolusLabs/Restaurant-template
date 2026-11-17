"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { deleteAccountAction, updateProfileAction } from "@/app/account/actions";
import { button, field, label } from "@/components/ui";

function Submit({ children, variant = "primary" }: { children: string; variant?: "primary" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={button[variant]} disabled={pending} aria-disabled={pending}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string }) {
  const [state, action] = useActionState(updateProfileAction, undefined);
  const fe = state?.fieldErrors ?? {};
  const v = state?.values;
  return (
    <form action={action} className="space-y-4" noValidate>
      <div>
        <label htmlFor="fullName" className={label}>
          Name
        </label>
        <input id="fullName" name="fullName" defaultValue={v?.fullName ?? fullName} key={`f${v?.fullName}`} autoComplete="name" className={field} required aria-invalid={!!fe.fullName} aria-describedby={fe.fullName ? "fullName-error" : undefined} />
        {fe.fullName && (
          <p id="fullName-error" className="mt-1 text-sm text-bad" role="alert">
            {fe.fullName}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="phone" className={label}>
          Phone number
        </label>
        <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={v?.phone ?? phone} key={`p${v?.phone}`} className={field} aria-invalid={!!fe.phone} aria-describedby={fe.phone ? "phone-error" : undefined} />
        {fe.phone && (
          <p id="phone-error" className="mt-1 text-sm text-bad" role="alert">
            {fe.phone}
          </p>
        )}
      </div>
      <div className="flex items-center gap-4">
        <Submit>Save changes</Submit>
        {fe.saved && (
          <p className="font-semibold text-ok" role="status">
            <span aria-hidden="true">&#10003; </span>
            {fe.saved}
          </p>
        )}
      </div>
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action] = useActionState(deleteAccountAction, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" name="confirm" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--bad)]" />
        <span>I understand this cannot be undone.</span>
      </label>
      {state?.fieldErrors?.confirm && (
        <p className="text-sm text-bad" role="alert">
          {state.fieldErrors.confirm}
        </p>
      )}
      {state?.error && (
        <p className="rounded-lg bg-bad-soft p-3 text-bad" role="alert">
          {state.error}
        </p>
      )}
      <Submit variant="danger">Delete my account</Submit>
    </form>
  );
}
