/** The hero's rotating word. */
export const HERO_WORDS = ["coffee", "beer", "tacos", "cold brew", "kolaches", "latte"];

/** "Latte" -> "a latte", "Taco plate" -> "a taco plate", "Pint of Lone Star" -> "a pint of Lone Star". */
export function withArticle(item: string): string {
  const lower = item.charAt(0).toLowerCase() + item.slice(1);
  return /^[aeiou]/i.test(item) ? `an ${lower}` : `a ${lower}`;
}

/** Shop initials for the counter header, e.g. "Barton Springs Coffee Co." -> "BS". */
export function initials(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return (words[0]?.[0] ?? "W").toUpperCase() + (words[1]?.[0] ?? "").toUpperCase();
}
