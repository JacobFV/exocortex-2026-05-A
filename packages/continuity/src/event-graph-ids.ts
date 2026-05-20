export class GraphIdGenerator {
  private readonly counters = new Map<string, number>();

  constructor(private readonly runId: string) {}

  next(prefix: string): string {
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    return `${prefix}_${this.runId}_${String(next).padStart(6, "0")}`;
  }

  observe(id: string): void {
    const parts = id.split("_");
    if (parts.length < 3) return;
    const prefix = parts[0]!;
    const value = Number(parts.at(-1));
    if (!Number.isFinite(value)) return;
    this.counters.set(prefix, Math.max(this.counters.get(prefix) ?? 0, value));
  }
}

export function createRunId(seed = new Date().toISOString()): string {
  return `run_${stableIdPart(seed)}`;
}

export function stableIdPart(value: unknown): string {
  return stableHash(value).slice(0, 16);
}

export function stableHash(value: unknown): string {
  const encoded = stableStringify(value);
  let hash = 2166136261;
  for (let i = 0; i < encoded.length; i += 1) {
    hash ^= encoded.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0") + String(encoded.length).padStart(8, "0");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
