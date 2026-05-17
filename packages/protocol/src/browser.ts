import type { BrowserSessionId, ModalityInstanceId } from "./id.js";

export type BrowserSessionState = "created" | "starting" | "running" | "paused" | "stopped" | "error";

export interface BrowserSession {
  id: BrowserSessionId;
  modalityInstanceId: ModalityInstanceId;
  state: BrowserSessionState;
  currentUrl?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type BrowserAction =
  | { type: "navigate"; url: string }
  | { type: "click"; x: number; y: number; button?: "left" | "middle" | "right" }
  | { type: "type"; text: string }
  | { type: "key"; key: string; modifiers?: Array<"Alt" | "Control" | "Meta" | "Shift"> }
  | { type: "scroll"; deltaX?: number; deltaY?: number; x?: number; y?: number }
  | { type: "touch"; phase: "start" | "move" | "end" | "cancel"; points: Array<{ id: number; x: number; y: number }> }
  | { type: "evaluate"; expression: string };

export interface BrowserProjectionFrame {
  browserSessionId: BrowserSessionId;
  modalityInstanceId: ModalityInstanceId;
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg";
  data: string;
  capturedAt: string;
}
