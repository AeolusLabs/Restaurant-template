// The address a staff screen comes back to after an action: a message to show, and (when something was refused)
// what the person had typed, so the form is not wiped. Pure, so it is tested without a browser.

export type NoticeMessage = { notice?: string; error?: string; values?: Record<string, string> };

const MAX_VALUE = 500;

export function buildNoticeUrl(path: string, message: NoticeMessage): string {
  const params = new URLSearchParams();
  if (message.notice) params.set("notice", message.notice);
  if (message.error) params.set("error", message.error);
  for (const [key, value] of Object.entries(message.values ?? {})) params.set(`v_${key}`, value.slice(0, MAX_VALUE));
  const query = params.toString();
  return query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path;
}

/** The values a form should show again, read back from a page's search params. */
export function valuesFrom(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(params)) {
    if (!key.startsWith("v_")) continue;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string") out[key.slice(2)] = value;
  }
  return out;
}
