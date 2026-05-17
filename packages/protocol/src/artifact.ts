import type { AgentSessionArtifactId, AgentSessionId, AgentSessionModalityId } from "./id.js";

export type ArtifactKind =
  | "text"
  | "json"
  | "image"
  | "audio"
  | "video"
  | "file"
  | "transcript"
  | "screenshot"
  | "browser_recording"
  | "sensor_log"
  | "calibration";

export interface AgentSessionArtifact {
  id: AgentSessionArtifactId;
  sessionId: AgentSessionId;
  kind: ArtifactKind;
  title: string;
  createdAt: string;
  modalityId?: AgentSessionModalityId;
  mimeType?: string;
  uri?: string;
  bytes?: number;
  value?: unknown;
  metadata?: Record<string, unknown>;
}
