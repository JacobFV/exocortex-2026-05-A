import type { BrowserSessionManager } from "@exocortex/browser-session";
import type { AgentTool } from "./tool-router.js";
import type { BrowserAction, BrowserSession, BrowserSessionId } from "@exocortex/protocol";

export interface BrowserAgentToolOptions {
  manager: BrowserSessionManager;
  createSession?: () => Promise<BrowserSession>;
  defaultSessionId?: () => BrowserSessionId | undefined;
}

export function createBrowserAgentTools(options: BrowserAgentToolOptions): AgentTool[] {
  return [
    {
      definition: {
        name: "browser_create_session",
        description: "Create and start a projected browser session controlled by the agent.",
        parameters: { type: "object", properties: {} }
      },
      async execute() {
        const session = options.createSession ? await options.createSession() : await createWithoutHostSurface(options.manager);
        return {
          output: session,
          emittedEvents: [{ type: "browser.created", browserSessionId: session.id }]
        };
      }
    },
    {
      definition: {
        name: "browser_list_sessions",
        description: "List projected browser sessions available to the agent.",
        parameters: { type: "object", properties: {} }
      },
      execute() {
        return { output: options.manager.list() };
      }
    },
    browserActionTool("browser_navigate", "Navigate a browser session to a URL.", {
      type: "object",
      properties: { browserSessionId: { type: "string" }, url: { type: "string" } },
      required: ["url"]
    }, async (input) => ({ type: "navigate", url: requiredString(input, "url") })),
    browserActionTool("browser_click", "Click at projected browser coordinates.", {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "middle", "right"] }
      },
      required: ["x", "y"]
    }, async (input) => ({
      type: "click",
      x: requiredNumber(input, "x"),
      y: requiredNumber(input, "y"),
      button: optionalButton(input.button)
    })),
    browserActionTool("browser_type", "Type text into the focused browser element.", {
      type: "object",
      properties: { browserSessionId: { type: "string" }, text: { type: "string" } },
      required: ["text"]
    }, async (input) => ({ type: "type", text: requiredString(input, "text") })),
    browserActionTool("browser_key", "Send a keyboard key to a browser session.", {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        key: { type: "string" },
        modifiers: { type: "array", items: { type: "string", enum: ["Alt", "Control", "Meta", "Shift"] } }
      },
      required: ["key"]
    }, async (input) => ({ type: "key", key: requiredString(input, "key"), modifiers: optionalModifiers(input.modifiers) })),
    browserActionTool("browser_scroll", "Scroll a browser session.", {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        deltaX: { type: "number" },
        deltaY: { type: "number" },
        x: { type: "number" },
        y: { type: "number" }
      }
    }, async (input) => ({
      type: "scroll",
      deltaX: optionalNumber(input.deltaX),
      deltaY: optionalNumber(input.deltaY),
      x: optionalNumber(input.x),
      y: optionalNumber(input.y)
    })),
    browserActionTool("browser_evaluate", "Evaluate JavaScript in a browser session.", {
      type: "object",
      properties: { browserSessionId: { type: "string" }, expression: { type: "string" } },
      required: ["expression"]
    }, async (input) => ({ type: "evaluate", expression: requiredString(input, "expression") })),
    {
      definition: {
        name: "browser_capture",
        description: "Capture the current projected browser frame.",
        parameters: {
          type: "object",
          properties: { browserSessionId: { type: "string" } }
        }
      },
      async execute(input) {
        const sessionId = await resolveBrowserSessionId(input, options);
        const frame = await options.manager.captureFrame(sessionId);
        return {
          output: frame ?? { status: "no_frame", browserSessionId: sessionId },
          emittedEvents: frame ? [{ type: "browser.projection_frame", frame }] : []
        };
      }
    }
  ];

  function browserActionTool(name: string, description: string, parameters: Record<string, unknown>, buildAction: (input: Record<string, unknown>) => Promise<BrowserAction>): AgentTool {
    return {
      definition: { name, description, parameters },
      async execute(input) {
        const sessionId = await resolveBrowserSessionId(input, options);
        const action = await buildAction(input);
        const frame = await options.manager.dispatch(sessionId, action);
        return {
          output: { browserSessionId: sessionId, action, frame },
          emittedEvents: [
            { type: "browser.action", browserSessionId: sessionId, action },
            ...(frame ? [{ type: "browser.projection_frame" as const, frame }] : [])
          ]
        };
      }
    };
  }
}

async function resolveBrowserSessionId(input: Record<string, unknown>, options: BrowserAgentToolOptions): Promise<BrowserSessionId> {
  if (typeof input.browserSessionId === "string") return input.browserSessionId as BrowserSessionId;
  const defaultId = options.defaultSessionId?.();
  if (defaultId) return defaultId;
  const existing = options.manager.list()[0];
  if (existing) return existing.id;
  if (options.createSession) return (await options.createSession()).id;
  throw new Error("No browser session exists and no browser session factory is registered");
}

async function createWithoutHostSurface(manager: BrowserSessionManager): Promise<BrowserSession> {
  throw new Error(`Browser session creation requires a host modality surface. Existing sessions: ${manager.list().length}`);
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function requiredNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Optional numeric value must be finite");
  return value;
}

function optionalButton(value: unknown): "left" | "middle" | "right" | undefined {
  if (value === undefined) return undefined;
  if (value === "left" || value === "middle" || value === "right") return value;
  throw new Error("button must be left, middle, or right");
}

function optionalModifiers(value: unknown): Array<"Alt" | "Control" | "Meta" | "Shift"> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("modifiers must be an array");
  return value.map((modifier) => {
    if (modifier === "Alt" || modifier === "Control" || modifier === "Meta" || modifier === "Shift") return modifier;
    throw new Error("modifier must be Alt, Control, Meta, or Shift");
  });
}
