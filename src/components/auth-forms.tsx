"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestResetAction, resetPasswordAction, signInAction, signUpAction } from "@/auth/actions";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { button, field, label } from "@/components/ui";

function Submit({ children, pending: pendingText }: { children: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`${button.primary} w-full`} disabled={pending} aria-disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-1 text-sm text-bad" role="alert">
      {message}
    </p>
  ) : null;
}

export function SignInForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action] = useActionState(signInAction, undefined);
  const fe = state?.fieldErrors ?? {};
  const v = state?.values ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      {notice && (
        <p className="rounded-lg bg-ok-soft p-3 font-semibold text-ok" role="status">
          <span aria-hidden="true">&#10003; </span>
          {notice}
        </p>
      )}
      <div>
        <label htmlFor="email" className={label}>
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={v.email} key={`e${v.email}`} className={field} required aria-invalid={!!fe.email} aria-describedby={fe.email ? "email-error" : undefined} />
        <FieldError id="email-error" message={fe.email} />
      </div>
      <div>
        <label htmlFor="password" className={label}>
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" className={field} required aria-invalid={!!fe.password} aria-describedby={fe.password ? "password-error" : undefined} />
        <FieldError id="password-error" message={fe.password} />
        <p className="mt-2">
          <Link href="/forgot-password" className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
            Forgot your password?
          </Link>
        </p>
      </div>
      {state?.error && (
        <p className="rounded-lg bg-bad-soft p-3 text-bad" role="alert">
          {state.error}
        </p>
      )}
      <TurnstileWidget />
      <Submit pending="Signing in…">Sign in</Submit>
      <p className="text-center text-muted">
        New here?{" "}
        <Link href={`/sign-up?next=${encodeURIComponent(next)}`} className="font-semibold text-brand underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUpAction, undefined);
  const fe = state?.fieldErrors ?? {};
  const v = state?.values ?? {};
  const box = "mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]";
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="name" className={label}>
          Your name
        </label>
        <input id="name" name="name" type="text" autoComplete="name" defaultValue={v.name} key={`n${v.name}`} className={field} required aria-invalid={!!fe.name} aria-describedby={fe.name ? "name-error" : undefined} />
        <FieldError id="name-error" message={fe.name} />
      </div>
      <div>
        <label htmlFor="email" className={label}>
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={v.email} key={`e${v.email}`} className={field} required aria-invalid={!!fe.email} aria-describedby={fe.email ? "email-error" : undefined} />
        <FieldError id="email-error" message={fe.email} />
      </div>
      <div>
        <label htmlFor="password" className={label}>
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="new-password" className={field} required minLength={8} aria-invalid={!!fe.password} aria-describedby={`password-help${fe.password ? " password-error" : ""}`} />
        <p id="password-help" className="mt-1 text-sm text-muted">
          At least 8 characters.
        </p>
        <FieldError id="password-error" message={fe.password} />
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">Before you continue</legend>
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" name="terms" defaultChecked={v.terms === "on"} key={`t${v.terms}`} className={box} aria-describedby={fe.terms ? "terms-error" : undefined} />
          <span>
            I accept the{" "}
            <Link href="/legal/terms" target="_blank" rel="noopener" className="font-semibold text-brand underline underline-offset-4">
              terms of use<span className="sr-only"> (opens in a new tab)</span>
            </Link>
            .
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" name="privacy" defaultChecked={v.privacy === "on"} key={`p${v.privacy}`} className={box} aria-describedby={fe.terms ? "terms-error" : undefined} />
          <span>
            I have read the{" "}
            <Link href="/legal/privacy" target="_blank" rel="noopener" className="font-semibold text-brand underline underline-offset-4">
              privacy policy<span className="sr-only"> (opens in a new tab)</span>
            </Link>{" "}
            and agree to my data being used to process my orders.
          </span>
        </label>
        <FieldError id="terms-error" message={fe.terms} />
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" name="marketing" defaultChecked={v.marketing === "on"} key={`m${v.marketing}`} className={box} />
          <span>
            Send me news and offers. <span className="text-muted">Optional. You can change this any time.</span>
          </span>
        </label>
      </fieldset>

      {state?.error && (
        <p className="rounded-lg bg-bad-soft p-3 text-bad" role="alert">
          {state.error}
        </p>
      )}
      <TurnstileWidget />
      <Submit pending="Creating your account…">Create account</Submit>
      <p className="text-center text-muted">
        Already have an account?{" "}
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="font-semibold text-brand underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestResetAction, undefined);
  const fe = state?.fieldErrors ?? {};
  if (state?.message) {
    return (
      <div className="space-y-4" role="status">
        <p className="rounded-lg bg-ok-soft p-4 text-ink">{state.message}</p>
        <Link href="/sign-in" className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-5" noValidate>
      <div>
        <label htmlFor="email" className={label}>
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={state?.values?.email} key={`e${state?.values?.email}`} className={field} required aria-invalid={!!fe.email} aria-describedby={fe.email ? "email-error" : undefined} />
        <FieldError id="email-error" message={fe.email} />
      </div>
      {state?.error && (
        <p className="rounded-lg bg-bad-soft p-3 text-bad" role="alert">
          {state.error}
        </p>
      )}
      <TurnstileWidget />
      <Submit pending="Sending\u2026">Send reset link</Submit>
      <p className="text-center">
        <Link href="/sign-in" className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <div>
        <label htmlFor="password" className={label}>
          New password
        </label>
        <input id="password" name="password" type="password" autoComplete="new-password" className={field} required minLength={8} aria-invalid={!!fe.password} aria-describedby={`password-help${fe.password ? " password-error" : ""}`} />
        <p id="password-help" className="mt-1 text-sm text-muted">
          At least 8 characters.
        </p>
        <FieldError id="password-error" message={fe.password} />
      </div>
      <div>
        <label htmlFor="confirm" className={label}>
          Type it again
        </label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" className={field} required aria-invalid={!!fe.confirm} aria-describedby={fe.confirm ? "confirm-error" : undefined} />
        <FieldError id="confirm-error" message={fe.confirm} />
      </div>
      {state?.error && (
        <p className="rounded-lg bg-bad-soft p-3 text-bad" role="alert">
          {state.error}{" "}
          <Link href="/forgot-password" className="font-semibold underline underline-offset-4">
            Get a new link
          </Link>
        </p>
      )}
      <Submit pending="Saving\u2026">Save new password</Submit>
    </form>
  );
}
