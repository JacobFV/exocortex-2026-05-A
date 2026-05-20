import type { AgentSessionArtifact } from "./artifact.js";
import type { BrowserAction, BrowserProjectionFrame } from "./browser.js";
import type { ComputerAction, ComputerProjectionFrame } from "./computer.js";
import type {
  AgentSessionArtifactId,
  AgentSessionEventId,
  AgentSessionId,
  AgentSessionModalityId,
  BrowserSessionId,
  ComputerSessionId,
  ToolCallId
} from "./id.js";
import type { ModalityBindingPolicy } from "./modality.js";
import type { AgentRuntimeRef, AgentSessionState } from "./session.js";

export interface EventBase {
  id: AgentSessionEventId;
  sessionId: AgentSessionId;
  sequence: number;
  createdAt: string;
  modalityId?: AgentSessionModalityId;
  metadata?: Record<string, unknown>;
}

export type AgentSessionEvent =
  | (EventBase & { type: "session.created"; goal: string; runtime?: AgentRuntimeRef })
  | (EventBase & { type: "session.modality_bound"; bindingId: AgentSessionModalityId; key: string })
  | (EventBase & { type: "session.modality_policy_changed"; bindingId: AgentSessionModalityId; key: string; previousPolicy: ModalityBindingPolicy; nextPolicy: ModalityBindingPolicy })
  | (EventBase & { type: "session.state_changed"; previousState: AgentSessionState; nextState: AgentSessionState })
  | (EventBase & { type: "message.delta"; role: "assistant" | "user" | "system"; text: string; source?: string })
  | (EventBase & { type: "message.completed"; role: "assistant" | "user" | "system"; text: string; source?: string })
  | (EventBase & { type: "tool_call.started"; toolCallId: ToolCallId; name: string; input?: unknown })
  | (EventBase & { type: "tool_call.delta"; toolCallId: ToolCallId; delta: unknown })
  | (EventBase & { type: "tool_call.completed"; toolCallId: ToolCallId; output: unknown })
  | (EventBase & { type: "tool_call.failed"; toolCallId: ToolCallId; code: string; message: string })
  | (EventBase & { type: "artifact.created"; artifactId: AgentSessionArtifactId; artifact: AgentSessionArtifact })
  | (EventBase & { type: "modality.observation"; bindingId: AgentSessionModalityId; observationType: string; value: unknown; sourceTimestamp?: string })
  | (EventBase & { type: "modality.action"; bindingId: AgentSessionModalityId; actionType: string; value: unknown })
  | (EventBase & { type: "browser.created"; browserSessionId: BrowserSessionId })
  | (EventBase & { type: "browser.projection_frame"; frame: BrowserProjectionFrame })
  | (EventBase & { type: "browser.action"; browserSessionId: BrowserSessionId; action: BrowserAction })
  | (EventBase & { type: "computer.created"; computerSessionId: ComputerSessionId })
  | (EventBase & { type: "computer.projection_frame"; frame: ComputerProjectionFrame })
  | (EventBase & { type: "computer.action"; computerSessionId: ComputerSessionId; action: ComputerAction })
  | (EventBase & { type: "confirm.requested"; prompt: string; requestId: string })
  | (EventBase & { type: "answer.requested"; question: string; requestId: string })
  | (EventBase & { type: "session.finished"; success: boolean; summary?: string })
  | (EventBase & { type: "session.error"; code: string; message: string; recoverable?: boolean });

export type AgentSessionEventPayload = AgentSessionEvent extends infer Event
  ? Event extends AgentSessionEvent
    ? Omit<Event, "id" | "sessionId" | "sequence" | "createdAt">
    : never
  : never;

export interface AgentSessionCommand {
  sessionId: AgentSessionId;
  command: "start" | "pause" | "resume" | "stop" | "answer" | "confirm" | "inject_observation";
  value?: unknown;
  modalityId?: AgentSessionModalityId;
}
