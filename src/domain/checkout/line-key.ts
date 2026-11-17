/** Identifies a cart line by what it is, so adding the same item with the same choices raises the quantity. */
export function lineKey(line: { itemId: string; modifierIds: readonly string[] }): string {
  return `${line.itemId}:${[...line.modifierIds].sort().join(",")}`;
}
