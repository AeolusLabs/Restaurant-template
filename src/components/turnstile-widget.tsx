import Script from "next/script";

/**
 * The Turnstile check, shown only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. Cloudflare's script puts its
 * answer into the form as "cf-turnstile-response", and the server action verifies it.
 */
export function TurnstileWidget() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="light" />
    </>
  );
}
