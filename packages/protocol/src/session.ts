import type { AgentSessionId, AgentSessionModalityId } from "./id.js";
import type { AgentSessionModalityBinding } from "./modality.js";

export type AgentSessionState =
  | "idle"
  | "starting"
  | "running"
  | "paused"
  | "waiting_confirm"
  | "waiting_answer"
  | "finished"
  | "stopped"
  | "error";

export interface AgentRuntimeRef {
  provider: "openai" | "anthropic" | "local" | "mock" | "custom";
  model?: string;
  driver?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentSession {
  id: AgentSessionId;
  title?: string;
  goal: string;
  state: AgentSessionState;
  runtime: AgentRuntimeRef;
  modalityBindingIds: AgentSessionModalityId[];
  modalityBindings?: AgentSessionModalityBinding[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: {
    code: string;
    message: string;
    recoverable?: boolean;
  };
  metadata?: Record<string, unknown>;
}
