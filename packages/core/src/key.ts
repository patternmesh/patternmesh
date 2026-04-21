/** Join key segments with `#`. Values must not contain `#` in v0.1 (documented limitation). */
export function key(...parts: Array<string | number | boolean>): string {
  return parts.map(String).join("#");
}
