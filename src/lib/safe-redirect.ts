/**
 * Where to send someone after signing in. Only a same-site path is allowed, so a crafted link such as
 * /sign-in?next=https://evil.example cannot bounce a customer to another site.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\r\n\t]/.test(next)) return "/";
  return next;
}
