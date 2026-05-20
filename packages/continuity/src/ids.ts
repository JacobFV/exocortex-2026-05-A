export function continuityId(prefix: string, ...parts: Array<string | number | undefined>): string {
  const cleaned = parts
    .filter((part): part is string | number => part !== undefined)
    .map((part) =>
      String(part)
        .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
        .replace(/^_+|_+$/g, "")
    )
    .filter(Boolean);
  return `${prefix}_${cleaned.join("_")}`;
}

export function stableHash(value: unknown): string {
  const json = JSON.stringify(value, Object.keys(value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}).sort());
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
