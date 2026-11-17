/** The password reset email: plain text, short, and clear about what to do and when the link stops working. */
export function buildResetEmail(input: { name: string; url: string; appName: string }): { subject: string; text: string } {
  return {
    subject: `Reset your ${input.appName} password`,
    text: [
      `Hello ${input.name},`,
      "",
      `Someone asked to reset the password for your ${input.appName} account. To choose a new password, open this link:`,
      "",
      input.url,
      "",
      "The link works once and expires in 1 hour.",
      "",
      "If you did not ask for this, ignore this email. Your password stays as it is.",
    ].join("\n"),
  };
}
