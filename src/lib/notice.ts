import { redirect } from "next/navigation";

/**
 * Sends the person back to a screen with a short message to show there ("Order accepted", or what went wrong).
 * Staff actions use this instead of client state, so every button works as a plain form and the page always shows
 * the real, current data after the change.
 */
export function redirectWith(path: string, message: { notice?: string; error?: string }): never {
  const params = new URLSearchParams();
  if (message.notice) params.set("notice", message.notice);
  if (message.error) params.set("error", message.error);
  const query = params.toString();
  redirect(query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path);
}
