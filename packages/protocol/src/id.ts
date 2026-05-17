export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type AgentSessionId = Brand<string, "AgentSessionId">;
export type AgentSessionEventId = Brand<string, "AgentSessionEventId">;
export type AgentSessionArtifactId = Brand<string, "AgentSessionArtifactId">;
export type AgentSessionModalityId = Brand<string, "AgentSessionModalityId">;
export type BrowserSessionId = Brand<string, "BrowserSessionId">;
export type ToolCallId = Brand<string, "ToolCallId">;

export function createId<Id extends string>(prefix: string): Brand<string, Id> {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}` as Brand<string, Id>;
}
