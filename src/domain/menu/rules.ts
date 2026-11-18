// Small pure rules for the menu: readable slugs, and a check that a choice group can actually be satisfied.

/** A short lower-case slug for a URL: "Jollof Rice & Chicken!" becomes "jollof-rice-chicken". */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "item";
}

type GroupLike = { minSelect: number; modifiers: { available: boolean }[] };

/**
 * Plain words for a group customers could never satisfy (it requires more choices than are available), or null.
 * Such an item cannot be ordered, so the staff menu warns about it.
 */
export function groupProblem(group: GroupLike): string | null {
  const available = group.modifiers.filter((m) => m.available).length;
  if (group.minSelect <= available) return null;
  const choices = group.minSelect === 1 ? "choice" : "choices";
  return `This group needs at least ${group.minSelect} ${choices} but ${available === 0 ? "none are available" : `only ${available} available`}, so customers cannot order the item.`;
}
