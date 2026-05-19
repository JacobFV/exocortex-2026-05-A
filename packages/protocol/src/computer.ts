import type { ComputerSessionId, ModalityInstanceId } from "./id.js";

export type ComputerSessionState = "created" | "starting" | "running" | "paused" | "stopped" | "error";

export interface ComputerSession {
  id: ComputerSessionId;
  modalityInstanceId: ModalityInstanceId;
  state: ComputerSessionState;
  label?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type ComputerAction =
  | { type: "pointer_move"; x: number; y: number }
  | { type: "click"; x: number; y: number; button?: "left" | "middle" | "right" }
  | { type: "drag"; from: { x: number; y: number }; to: { x: number; y: number }; button?: "left" | "middle" | "right" }
  | { type: "type"; text: string }
  | { type: "key"; key: string; modifiers?: Array<"Alt" | "Control" | "Meta" | "Shift"> }
  | { type: "scroll"; deltaX?: number; deltaY?: number; x?: number; y?: number };

export interface ComputerProjectionFrame {
  computerSessionId: ComputerSessionId;
  modalityInstanceId: ModalityInstanceId;
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg";
  data: string;
  capturedAt: string;
}
