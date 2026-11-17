/** One readable line per validation problem, each starting with the dotted path of the bad field. */
export function formatIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `  ${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("\n");
}
