import { redirect } from "next/navigation";
import { buildNoticeUrl, type NoticeMessage } from "./notice-url";

/**
 * Sends the person back to a screen with a short message to show there ("Order accepted", or what went wrong),
 * and, when something was refused, what they had typed. Staff actions use this instead of client state, so every
 * button works as a plain form and the page always shows the real, current data after the change.
 */
export function redirectWith(path: string, message: NoticeMessage): never {
  redirect(buildNoticeUrl(path, message));
}
